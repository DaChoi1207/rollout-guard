import type {
  Deployment,
  DeploymentEvent
} from "@rollout-guard/database";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DeploymentStore,
  MetricsProvider,
  RevisionMetrics,
  RuntimeProvider,
  TrafficRouter
} from "./contracts.js";
import type { RolloutStep } from "./policy.js";
import { DeploymentReconciler } from "./reconciler.js";

const instantPolicy: readonly RolloutStep[] = [
  {
    state: "CANARY_10",
    stableWeight: 90,
    candidateWeight: 10,
    minimumRequests: 1,
    minimumDurationMs: 0,
    maximumObservationMs: 60_000
  },
  {
    state: "CANARY_50",
    stableWeight: 50,
    candidateWeight: 50,
    minimumRequests: 1,
    minimumDurationMs: 0,
    maximumObservationMs: 60_000
  },
  {
    state: "FULL_TRAFFIC",
    stableWeight: 0,
    candidateWeight: 100,
    minimumRequests: 1,
    minimumDurationMs: 0,
    maximumObservationMs: 60_000
  },
  {
    state: "OBSERVING",
    stableWeight: 0,
    candidateWeight: 100,
    minimumRequests: 1,
    minimumDurationMs: 0,
    maximumObservationMs: 60_000
  }
];

function queuedDeployment(): Deployment {
  const now = new Date("2026-07-27T12:00:00.000Z");
  return {
    id: "20000000-0000-4000-8000-000000000001",
    serviceId: "10000000-0000-4000-8000-000000000001",
    stableRevisionId: "v1",
    candidateRevisionId: "v2",
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
}

class MemoryDeploymentStore implements DeploymentStore {
  public deployment: Deployment = queuedDeployment();
  public readonly events: DeploymentEvent[] = [];
  public failNextUpdate = false;

  public async getDeploymentById(id: string): Promise<Deployment | null> {
    return id === this.deployment.id ? { ...this.deployment } : null;
  }

  public async listActiveDeployments(): Promise<Deployment[]> {
    return [{ ...this.deployment }];
  }

  public async updateDeployment(
    deployment: Deployment,
    expectedStateVersion: number
  ): Promise<boolean> {
    if (
      this.failNextUpdate ||
      this.deployment.stateVersion !== expectedStateVersion
    ) {
      this.failNextUpdate = false;
      return false;
    }
    this.deployment = {
      ...deployment,
      stateVersion: expectedStateVersion + 1
    };
    return true;
  }

  public async transitionDeployment(
    deployment: Deployment,
    expectedStateVersion: number,
    event: DeploymentEvent
  ): Promise<boolean> {
    const updated = await this.updateDeployment(
      deployment,
      expectedStateVersion
    );
    if (!updated) {
      return false;
    }
    this.events.push(event);
    return true;
  }

  public async recordReconcileFailure(input: {
    deploymentId: string;
    expectedStateVersion: number;
    error: string;
    nextReconcileAt: Date;
    isRollback: boolean;
  }): Promise<boolean> {
    if (
      input.deploymentId !== this.deployment.id ||
      input.expectedStateVersion !== this.deployment.stateVersion
    ) {
      return false;
    }
    this.deployment = {
      ...this.deployment,
      stateVersion: this.deployment.stateVersion + 1,
      reconcileFailureCount: this.deployment.reconcileFailureCount + 1,
      rollbackAttemptCount:
        this.deployment.rollbackAttemptCount + (input.isRollback ? 1 : 0),
      nextReconcileAt: input.nextReconcileAt,
      lastReconcileError: input.error
    };
    return true;
  }
}

class FakeRuntime implements RuntimeProvider {
  public healthy = true;
  public ensureCalls = 0;

  public async ensureCandidate(): Promise<void> {
    this.ensureCalls += 1;
  }

  public async isRevisionHealthy(): Promise<boolean> {
    return this.healthy;
  }
}

class FakeTraffic implements TrafficRouter {
  public readonly calls: Array<{
    stableWeight: number;
    candidateWeight: number;
  }> = [];
  public failuresRemaining = 0;

  public async setWeights(input: {
    stableWeight: number;
    candidateWeight: number;
  }): Promise<void> {
    this.calls.push(input);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("traffic router unavailable");
    }
  }
}

function healthyMetrics(): RevisionMetrics {
  return {
    requestCount: 100,
    errorCount: 0,
    errorRate: 0,
    averageLatencyMs: 100,
    p50LatencyMs: 90,
    p95LatencyMs: 120,
    p99LatencyMs: 150
  };
}

class FakeMetrics implements MetricsProvider {
  public stable = healthyMetrics();
  public candidate = healthyMetrics();

  public async getRevisionMetrics(input: {
    revisionId: string;
  }): Promise<RevisionMetrics> {
    return input.revisionId === "v1" ? this.stable : this.candidate;
  }
}

let store: MemoryDeploymentStore;
let runtime: FakeRuntime;
let traffic: FakeTraffic;
let metrics: FakeMetrics;
let reconciler: DeploymentReconciler;

beforeEach(() => {
  store = new MemoryDeploymentStore();
  runtime = new FakeRuntime();
  traffic = new FakeTraffic();
  metrics = new FakeMetrics();
  let id = 0;
  reconciler = new DeploymentReconciler({
    deployments: store,
    runtime,
    traffic,
    metrics,
    policy: instantPolicy,
    clock: () => new Date("2026-07-27T12:01:00.000Z"),
    createId: () => `event-${(id += 1)}`
  });
});

describe("DeploymentReconciler", () => {
  it("advances a healthy candidate through 10%, 50%, and 100%", async () => {
    const states = [];
    for (let index = 0; index < 7; index += 1) {
      const result = await reconciler.reconcile(store.deployment.id);
      states.push(result);
    }

    expect(store.deployment.state).toBe("SUCCEEDED");
    expect(store.deployment.stateVersion).toBe(7);
    expect(runtime.ensureCalls).toBe(1);
    expect(traffic.calls).toEqual([
      { stableWeight: 90, candidateWeight: 10 },
      { stableWeight: 50, candidateWeight: 50 },
      { stableWeight: 0, candidateWeight: 100 },
      { stableWeight: 0, candidateWeight: 100 }
    ]);
    expect(store.events).toHaveLength(7);
    expect(states.every((result) => result.outcome === "TRANSITIONED")).toBe(
      true
    );
  });

  it("waits when the candidate is unhealthy", async () => {
    store.deployment = {
      ...store.deployment,
      state: "WAITING_FOR_HEALTH",
      stateVersion: 2
    };
    runtime.healthy = false;

    await expect(reconciler.reconcile(store.deployment.id)).resolves.toEqual({
      outcome: "WAITING",
      reason: "Candidate is not healthy yet"
    });
    expect(traffic.calls).toEqual([]);
    expect(store.events).toEqual([]);
  });

  it("requires both time and candidate request count", async () => {
    store.deployment = {
      ...store.deployment,
      state: "CANARY_10",
      stableWeight: 90,
      candidateWeight: 10,
      stateVersion: 3,
      stepStartedAt: new Date("2026-07-27T12:00:59.999Z")
    };
    metrics.candidate = {
      ...metrics.candidate,
      requestCount: 0
    };
    const policy: readonly RolloutStep[] = [
      { ...instantPolicy[0]!, minimumDurationMs: 10 },
      ...instantPolicy.slice(1)
    ];
    reconciler = new DeploymentReconciler({
      deployments: store,
      runtime,
      traffic,
      metrics,
      policy,
      clock: () => new Date("2026-07-27T12:01:00.000Z")
    });

    const timeResult = await reconciler.reconcile(store.deployment.id);
    expect(timeResult).toMatchObject({
      outcome: "WAITING",
      reason: "Minimum observation duration has not elapsed"
    });

    store.deployment.stepStartedAt = new Date("2026-07-27T12:00:30.000Z");
    const countResult = await reconciler.reconcile(store.deployment.id);
    expect(countResult).toMatchObject({
      outcome: "WAITING",
      reason: "Minimum candidate request count has not been reached"
    });
  });

  it("repeats an absolute traffic command safely after a state conflict", async () => {
    store.deployment = {
      ...store.deployment,
      state: "WAITING_FOR_HEALTH",
      stateVersion: 2
    };
    store.failNextUpdate = true;

    await expect(reconciler.reconcile(store.deployment.id)).resolves.toEqual({
      outcome: "CONFLICT"
    });
    await reconciler.reconcile(store.deployment.id);

    expect(traffic.calls).toEqual([
      { stableWeight: 90, candidateWeight: 10 },
      { stableWeight: 90, candidateWeight: 10 }
    ]);
    expect(store.deployment.state).toBe("CANARY_10");
    expect(store.events).toHaveLength(1);
  });

  it("rolls back a high-error candidate and restores stable traffic", async () => {
    store.deployment = {
      ...store.deployment,
      state: "CANARY_10",
      stableWeight: 90,
      candidateWeight: 10,
      stateVersion: 3,
      stepStartedAt: new Date("2026-07-27T12:00:00.000Z")
    };
    metrics.candidate = {
      ...metrics.candidate,
      errorCount: 15,
      errorRate: 0.15
    };

    const regression = await reconciler.reconcile(store.deployment.id);
    expect(regression).toMatchObject({
      outcome: "TRANSITIONED",
      from: "CANARY_10",
      to: "ROLLING_BACK"
    });
    expect(store.deployment.failureReason).toContain("15.00%");

    const rollback = await reconciler.reconcile(store.deployment.id);
    expect(rollback).toMatchObject({
      outcome: "TRANSITIONED",
      from: "ROLLING_BACK",
      to: "ROLLED_BACK"
    });
    expect(traffic.calls.at(-1)).toEqual({
      stableWeight: 100,
      candidateWeight: 0
    });
    expect(store.deployment.state).toBe("ROLLED_BACK");
    expect(store.deployment.stableWeight).toBe(100);
    expect(store.deployment.candidateWeight).toBe(0);
  });

  it("resumes from persisted canary state after a worker restart", async () => {
    store.deployment = {
      ...store.deployment,
      state: "CANARY_10",
      stableWeight: 90,
      candidateWeight: 10,
      stateVersion: 3,
      stepStartedAt: new Date("2026-07-27T12:00:00.000Z")
    };
    const restartedWorker = new DeploymentReconciler({
      deployments: store,
      runtime,
      traffic,
      metrics,
      policy: instantPolicy,
      clock: () => new Date("2026-07-27T12:01:00.000Z")
    });

    await restartedWorker.reconcile(store.deployment.id);

    expect(store.deployment.state).toBe("CANARY_50");
    expect(runtime.ensureCalls).toBe(0);
    expect(traffic.calls).toEqual([
      { stableWeight: 50, candidateWeight: 50 }
    ]);
  });

  it("allows only one of two workers to persist the same transition", async () => {
    const secondWorker = new DeploymentReconciler({
      deployments: store,
      runtime,
      traffic,
      metrics,
      policy: instantPolicy
    });

    const results = await Promise.all([
      reconciler.reconcile(store.deployment.id),
      secondWorker.reconcile(store.deployment.id)
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "CONFLICT",
      "TRANSITIONED"
    ]);
    expect(store.deployment.state).toBe("STARTING_CANDIDATE");
    expect(store.events).toHaveLength(1);
  });

  it("keeps rollback active when traffic restoration fails so it can retry", async () => {
    store.deployment = {
      ...store.deployment,
      state: "ROLLING_BACK",
      stateVersion: 4,
      failureReason: "Candidate error rate exceeded threshold"
    };
    traffic.failuresRemaining = 1;

    await expect(
      reconciler.reconcile(store.deployment.id)
    ).rejects.toThrow("traffic router unavailable");
    expect(store.deployment.state).toBe("ROLLING_BACK");

    await reconciler.reconcile(store.deployment.id);
    expect(store.deployment.state).toBe("ROLLED_BACK");
    expect(traffic.calls).toEqual([
      { stableWeight: 100, candidateWeight: 0 },
      { stableWeight: 100, candidateWeight: 0 }
    ]);
  });

  it("fails safe when metrics remain insufficient past the deadline", async () => {
    store.deployment = {
      ...store.deployment,
      state: "CANARY_10",
      stateVersion: 3,
      stepStartedAt: new Date("2026-07-27T11:59:00.000Z")
    };
    metrics.candidate = {
      ...metrics.candidate,
      requestCount: 0
    };

    await reconciler.reconcile(store.deployment.id);

    expect(store.deployment.state).toBe("ROLLING_BACK");
    expect(store.deployment.failureReason).toContain(
      "Observation deadline exceeded"
    );
  });

  it("marks a nonterminal deployment failed after retry exhaustion", async () => {
    store.deployment = {
      ...store.deployment,
      state: "ROLLING_BACK",
      stateVersion: 5,
      lastReconcileError: "router unavailable"
    };

    await reconciler.failDeployment(
      store.deployment.id,
      "router unavailable"
    );

    expect(store.deployment.state).toBe("FAILED");
    expect(store.deployment.failureReason).toBe("router unavailable");
    expect(store.events.at(-1)?.message).toContain("Retry policy exhausted");
  });
});
