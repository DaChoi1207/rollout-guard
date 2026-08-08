import { randomUUID } from "node:crypto";
import type {
  Deployment,
  DeploymentEvent,
  DeploymentState,
  Service
} from "@rollout-guard/database";
import type { ControlRepository, RouterClient } from "./contracts.js";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

const rollbackEligibleStates: readonly DeploymentState[] = [
  "QUEUED",
  "STARTING_CANDIDATE",
  "WAITING_FOR_HEALTH",
  "CANARY_10",
  "CANARY_50",
  "FULL_TRAFFIC",
  "OBSERVING"
];

export class ControlPlaneService {
  public constructor(
    private readonly repository: ControlRepository,
    private readonly router: RouterClient,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID
  ) {}

  public async createDeployment(input: {
    serviceName: string;
    stableRevisionId: string;
    candidateRevisionId: string;
  }): Promise<Deployment> {
    let service = await this.repository.getServiceByName(input.serviceName);
    const now = this.clock();
    if (!service) {
      service = {
        id: this.createId(),
        name: input.serviceName,
        createdAt: now,
        updatedAt: now
      } satisfies Service;
      await this.repository.createService(service);
    }

    const deployment: Deployment = {
      id: this.createId(),
      serviceId: service.id,
      stableRevisionId: input.stableRevisionId,
      candidateRevisionId: input.candidateRevisionId,
      state: "QUEUED",
      stableWeight: 100,
      candidateWeight: 0,
      currentStepIndex: 0,
      stateVersion: 0,
      reconcileFailureCount: 0,
      rollbackAttemptCount: 0,
      nextReconcileAt: null,
      lastReconcileError: null,
      failureReason: null,
      stepStartedAt: null,
      createdAt: now,
      updatedAt: now
    };
    const event: DeploymentEvent = {
      id: this.createId(),
      deploymentId: deployment.id,
      eventType: "DEPLOYMENT_CREATED",
      fromState: null,
      toState: "QUEUED",
      message: `Deployment from ${input.stableRevisionId} to ${input.candidateRevisionId} created`,
      metadata: { serviceName: input.serviceName },
      createdAt: now
    };

    try {
      await this.repository.createDeploymentWithEvent(deployment, event);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw new ConflictError(
          `Service ${input.serviceName} already has an active deployment`
        );
      }
      throw error;
    }
    return deployment;
  }

  public async listDeployments(): Promise<Deployment[]> {
    return this.repository.listDeployments();
  }

  public async getDeployment(id: string): Promise<{
    deployment: Deployment;
    events: DeploymentEvent[];
    traffic: { stableWeight: number; candidateWeight: number };
    metrics: {
      stable: Awaited<ReturnType<RouterClient["getMetrics"]>>;
      candidate: Awaited<ReturnType<RouterClient["getMetrics"]>>;
    };
  }> {
    const deployment = await this.repository.getDeploymentById(id);
    if (!deployment) {
      throw new NotFoundError(`Deployment ${id} was not found`);
    }
    const [events, traffic, stableMetrics, candidateMetrics] = await Promise.all([
      this.repository.listEvents(id),
      this.router.getWeights(),
      this.router.getMetrics({
        revisionId: deployment.stableRevisionId,
        since: deployment.createdAt
      }),
      this.router.getMetrics({
        revisionId:
          deployment.candidateRevisionId ?? "candidate-not-started",
        since: deployment.createdAt
      })
    ]);
    return {
      deployment,
      events,
      traffic,
      metrics: {
        stable: stableMetrics,
        candidate: candidateMetrics
      }
    };
  }

  public async requestRollback(id: string): Promise<Deployment> {
    const deployment = await this.repository.getDeploymentById(id);
    if (!deployment) {
      throw new NotFoundError(`Deployment ${id} was not found`);
    }
    if (!rollbackEligibleStates.includes(deployment.state)) {
      throw new ConflictError(
        `Deployment in ${deployment.state} cannot be rolled back`
      );
    }
    const now = this.clock();
    const updated: Deployment = {
      ...deployment,
      state: "ROLLING_BACK",
      failureReason: "Manual rollback requested",
      reconcileFailureCount: 0,
      nextReconcileAt: null,
      lastReconcileError: null,
      updatedAt: now
    };
    const succeeded = await this.repository.transitionDeployment(
      updated,
      deployment.stateVersion,
      {
        id: this.createId(),
        deploymentId: deployment.id,
        eventType: "MANUAL_ROLLBACK_REQUESTED",
        fromState: deployment.state,
        toState: "ROLLING_BACK",
        message: "Manual rollback requested",
        metadata: {},
        createdAt: now
      }
    );
    if (!succeeded) {
      throw new ConflictError("Deployment changed; reload and try again");
    }
    return updated;
  }

  public startDemoLoad(input: {
    durationSeconds: number;
    requestsPerSecond: number;
  }): void {
    this.router.generateLoad(input);
  }
}
