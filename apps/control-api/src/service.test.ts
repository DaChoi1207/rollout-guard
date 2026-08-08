import type {
  Deployment,
  DeploymentEvent,
  Service
} from "@rollout-guard/database";
import { describe, expect, it } from "vitest";
import type {
  ControlRepository,
  RevisionMetrics,
  RouterClient
} from "./contracts.js";
import {
  ConflictError,
  ControlPlaneService,
  NotFoundError
} from "./service.js";

function emptyMetrics(): RevisionMetrics {
  return {
    requestCount: 0,
    errorCount: 0,
    errorRate: 0,
    averageLatencyMs: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    p99LatencyMs: 0
  };
}

class MemoryRepository implements ControlRepository {
  public service: Service | null = null;
  public deployment: Deployment | null = null;
  public events: DeploymentEvent[] = [];

  public async getServiceByName(): Promise<Service | null> {
    return this.service;
  }
  public async createService(service: Service): Promise<void> {
    this.service = service;
  }
  public async createDeploymentWithEvent(
    deployment: Deployment,
    event: DeploymentEvent
  ): Promise<void> {
    this.deployment = deployment;
    this.events.push(event);
  }
  public async listDeployments(): Promise<Deployment[]> {
    return this.deployment ? [this.deployment] : [];
  }
  public async getDeploymentById(id: string): Promise<Deployment | null> {
    return this.deployment?.id === id ? this.deployment : null;
  }
  public async listEvents(): Promise<DeploymentEvent[]> {
    return this.events;
  }
  public async transitionDeployment(
    deployment: Deployment,
    expectedStateVersion: number,
    event: DeploymentEvent
  ): Promise<boolean> {
    if (this.deployment?.stateVersion !== expectedStateVersion) {
      return false;
    }
    this.deployment = {
      ...deployment,
      stateVersion: expectedStateVersion + 1
    };
    this.events.push(event);
    return true;
  }
}

class FakeRouter implements RouterClient {
  public loadStarted = false;
  public async getWeights() {
    return { stableWeight: 100, candidateWeight: 0 };
  }
  public async getMetrics(): Promise<RevisionMetrics> {
    return emptyMetrics();
  }
  public generateLoad(): void {
    this.loadStarted = true;
  }
}

function createService(repository: MemoryRepository, router = new FakeRouter()) {
  let id = 0;
  return new ControlPlaneService(
    repository,
    router,
    () => new Date("2026-07-27T12:00:00.000Z"),
    () => `id-${(id += 1)}`
  );
}

describe("ControlPlaneService", () => {
  it("creates a service, deployment, and initial event", async () => {
    const repository = new MemoryRepository();
    const service = createService(repository);

    const deployment = await service.createDeployment({
      serviceName: "demo-service",
      stableRevisionId: "v1",
      candidateRevisionId: "v2"
    });

    expect(repository.service?.name).toBe("demo-service");
    expect(deployment.state).toBe("QUEUED");
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]?.eventType).toBe("DEPLOYMENT_CREATED");
  });

  it("returns deployment detail with traffic, metrics, and events", async () => {
    const repository = new MemoryRepository();
    const service = createService(repository);
    const deployment = await service.createDeployment({
      serviceName: "demo-service",
      stableRevisionId: "v1",
      candidateRevisionId: "v2"
    });

    const detail = await service.getDeployment(deployment.id);

    expect(detail.traffic).toEqual({
      stableWeight: 100,
      candidateWeight: 0
    });
    expect(detail.events).toHaveLength(1);
    expect(detail.metrics.candidate.requestCount).toBe(0);
  });

  it("persists a manual rollback request", async () => {
    const repository = new MemoryRepository();
    const service = createService(repository);
    const deployment = await service.createDeployment({
      serviceName: "demo-service",
      stableRevisionId: "v1",
      candidateRevisionId: "v2"
    });
    repository.deployment = {
      ...deployment,
      state: "CANARY_10",
      stateVersion: 3,
      stableWeight: 90,
      candidateWeight: 10
    };

    const updated = await service.requestRollback(deployment.id);

    expect(updated.state).toBe("ROLLING_BACK");
    expect(updated.failureReason).toBe("Manual rollback requested");
    expect(repository.events.at(-1)?.eventType).toBe(
      "MANUAL_ROLLBACK_REQUESTED"
    );
  });

  it("rejects missing and terminal rollback targets", async () => {
    const repository = new MemoryRepository();
    const service = createService(repository);

    await expect(service.getDeployment("missing")).rejects.toBeInstanceOf(
      NotFoundError
    );
    const deployment = await service.createDeployment({
      serviceName: "demo-service",
      stableRevisionId: "v1",
      candidateRevisionId: "v2"
    });
    repository.deployment = { ...deployment, state: "SUCCEEDED" };
    await expect(
      service.requestRollback(deployment.id)
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
