import { randomUUID } from "node:crypto";
import type {
  Deployment,
  DeploymentState
} from "@rollout-guard/database";
import type {
  DeploymentStore,
  RuntimeProvider,
  StepObservationProvider,
  TrafficRouter
} from "./contracts.js";
import {
  developmentRolloutPolicy,
  findRolloutStep,
  type RolloutStep
} from "./policy.js";
import { assertTransitionAllowed } from "./state-machine.js";

export type ReconcileResult =
  | { outcome: "NOT_FOUND" }
  | { outcome: "WAITING"; reason: string }
  | { outcome: "CONFLICT" }
  | { outcome: "TRANSITIONED"; from: DeploymentState; to: DeploymentState }
  | { outcome: "TERMINAL"; state: DeploymentState };

export type ReconcilerDependencies = {
  deployments: DeploymentStore;
  runtime: RuntimeProvider;
  traffic: TrafficRouter;
  observations: StepObservationProvider;
  policy?: readonly RolloutStep[];
  clock?: () => Date;
  createId?: () => string;
};

function nextStepState(state: DeploymentState): DeploymentState {
  switch (state) {
    case "CANARY_10":
      return "CANARY_50";
    case "CANARY_50":
      return "FULL_TRAFFIC";
    case "FULL_TRAFFIC":
      return "OBSERVING";
    case "OBSERVING":
      return "SUCCEEDED";
    default:
      throw new Error(`${state} is not a rollout observation state`);
  }
}

export class DeploymentReconciler {
  private readonly policy: readonly RolloutStep[];
  private readonly clock: () => Date;
  private readonly createId: () => string;

  public constructor(private readonly dependencies: ReconcilerDependencies) {
    this.policy = dependencies.policy ?? developmentRolloutPolicy;
    this.clock = dependencies.clock ?? (() => new Date());
    this.createId = dependencies.createId ?? randomUUID;
  }

  public async reconcile(deploymentId: string): Promise<ReconcileResult> {
    const deployment =
      await this.dependencies.deployments.getDeploymentById(deploymentId);
    if (!deployment) {
      return { outcome: "NOT_FOUND" };
    }

    switch (deployment.state) {
      case "QUEUED":
        return this.transition(
          deployment,
          "STARTING_CANDIDATE",
          "Candidate startup scheduled"
        );

      case "STARTING_CANDIDATE":
        if (!deployment.candidateRevisionId) {
          return {
            outcome: "WAITING",
            reason: "Candidate revision identifier is missing"
          };
        }
        await this.dependencies.runtime.ensureCandidate(
          deployment.candidateRevisionId
        );
        return this.transition(
          deployment,
          "WAITING_FOR_HEALTH",
          "Candidate revision is available"
        );

      case "WAITING_FOR_HEALTH":
        return this.reconcileCandidateHealth(deployment);

      case "CANARY_10":
      case "CANARY_50":
      case "FULL_TRAFFIC":
      case "OBSERVING":
        return this.reconcileRolloutStep(deployment);

      case "ROLLING_BACK":
        return {
          outcome: "WAITING",
          reason: "Rollback behavior is implemented in Milestone 5"
        };

      case "SUCCEEDED":
      case "ROLLED_BACK":
      case "FAILED":
        return { outcome: "TERMINAL", state: deployment.state };
    }
  }

  private async reconcileCandidateHealth(
    deployment: Deployment
  ): Promise<ReconcileResult> {
    const candidateRevisionId = deployment.candidateRevisionId;
    if (!candidateRevisionId) {
      return {
        outcome: "WAITING",
        reason: "Candidate revision identifier is missing"
      };
    }

    const healthy =
      await this.dependencies.runtime.isRevisionHealthy(candidateRevisionId);
    if (!healthy) {
      return { outcome: "WAITING", reason: "Candidate is not healthy yet" };
    }

    const firstStep = this.policy[0];
    if (!firstStep || firstStep.state !== "CANARY_10") {
      throw new Error("Rollout policy must begin with CANARY_10");
    }
    await this.dependencies.traffic.setWeights({
      stableWeight: firstStep.stableWeight,
      candidateWeight: firstStep.candidateWeight
    });
    return this.transition(
      deployment,
      firstStep.state,
      "Candidate passed health checks and received 10% traffic",
      firstStep
    );
  }

  private async reconcileRolloutStep(
    deployment: Deployment
  ): Promise<ReconcileResult> {
    const step = findRolloutStep(deployment.state, this.policy);
    const stepStartedAt = deployment.stepStartedAt;
    const candidateRevisionId = deployment.candidateRevisionId;
    if (!step || !stepStartedAt || !candidateRevisionId) {
      throw new Error(`Deployment ${deployment.id} has incomplete step state`);
    }

    const elapsedMs = this.clock().getTime() - stepStartedAt.getTime();
    if (elapsedMs < step.minimumDurationMs) {
      return {
        outcome: "WAITING",
        reason: "Minimum observation duration has not elapsed"
      };
    }

    const requestCount =
      await this.dependencies.observations.getCandidateRequestCount({
        revisionId: candidateRevisionId,
        since: stepStartedAt
      });
    if (requestCount < step.minimumRequests) {
      return {
        outcome: "WAITING",
        reason: "Minimum candidate request count has not been reached"
      };
    }

    const nextState = nextStepState(deployment.state);
    const nextStep = findRolloutStep(nextState, this.policy);
    if (nextStep) {
      await this.dependencies.traffic.setWeights({
        stableWeight: nextStep.stableWeight,
        candidateWeight: nextStep.candidateWeight
      });
    }

    return this.transition(
      deployment,
      nextState,
      nextState === "SUCCEEDED"
        ? "Candidate completed the rollout"
        : `Rollout advanced to ${nextState}`,
      nextStep ?? undefined,
      requestCount
    );
  }

  private async transition(
    deployment: Deployment,
    nextState: DeploymentState,
    message: string,
    step?: RolloutStep,
    requestCount?: number
  ): Promise<ReconcileResult> {
    assertTransitionAllowed(deployment.state, nextState);
    const now = this.clock();
    const updated: Deployment = {
      ...deployment,
      state: nextState,
      stableWeight: step?.stableWeight ?? deployment.stableWeight,
      candidateWeight: step?.candidateWeight ?? deployment.candidateWeight,
      currentStepIndex: step
        ? this.policy.findIndex((candidate) => candidate.state === step.state)
        : deployment.currentStepIndex,
      stepStartedAt: step ? now : deployment.stepStartedAt,
      updatedAt: now
    };

    const updatedSuccessfully =
      await this.dependencies.deployments.updateDeployment(
        updated,
        deployment.stateVersion
      );
    if (!updatedSuccessfully) {
      return { outcome: "CONFLICT" };
    }

    await this.dependencies.deployments.appendEvent({
      id: this.createId(),
      deploymentId: deployment.id,
      eventType: "STATE_CHANGED",
      fromState: deployment.state,
      toState: nextState,
      message,
      metadata: {
        stableWeight: updated.stableWeight,
        candidateWeight: updated.candidateWeight,
        ...(requestCount === undefined ? {} : { candidateRequestCount: requestCount })
      },
      createdAt: now
    });

    return {
      outcome: "TRANSITIONED",
      from: deployment.state,
      to: nextState
    };
  }
}
