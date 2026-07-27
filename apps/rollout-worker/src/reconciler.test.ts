import type {
  Deployment,
  DeploymentEvent
} from "@rollout-guard/database";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DeploymentStore,
  RuntimeProvider,
  StepObservationProvider,
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
    minimumDurationMs: 0
  },
  {
    state: "CANARY_50",
    stableWeight: 50,
    candidateWeight: 50,
    minimumRequests: 1,
    minimumDurationMs: 0
  },
  {
    state: "FULL_TRAFFIC",
    stableWeight: 0,
    candidateWeight: 100,
    minimumRequests: 1,
    minimumDurationMs: 0
  },
  {
    state: "OBSERVING",
    stableWeight: 0,
    candidateWeight: 100,
    minimumRequests: 1,
    minimumDurationMs: 0
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

  public async appendEvent(event: DeploymentEvent): Promise<void> {
    this.events.push(event);
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

  public async setWeights(input: {
    stableWeight: number;
    candidateWeight: number;
  }): Promise<void> {
    this.calls.push(input);
  }
}

class FakeObservations implements StepObservationProvider {
  public requestCount = 100;

  public async getCandidateRequestCount(): Promise<number> {
    return this.requestCount;
  }
}

let store: MemoryDeploymentStore;
let runtime: FakeRuntime;
let traffic: FakeTraffic;
let observations: FakeObservations;
let reconciler: DeploymentReconciler;

beforeEach(() => {
  store = new MemoryDeploymentStore();
  runtime = new FakeRuntime();
  traffic = new FakeTraffic();
  observations = new FakeObservations();
  let id = 0;
  reconciler = new DeploymentReconciler({
    deployments: store,
    runtime,
    traffic,
    observations,
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
    observations.requestCount = 0;
    const policy: readonly RolloutStep[] = [
      { ...instantPolicy[0]!, minimumDurationMs: 10 },
      ...instantPolicy.slice(1)
    ];
    reconciler = new DeploymentReconciler({
      deployments: store,
      runtime,
      traffic,
      observations,
      policy,
      clock: () => new Date("2026-07-27T12:01:00.000Z")
    });

    const timeResult = await reconciler.reconcile(store.deployment.id);
    expect(timeResult).toMatchObject({
      outcome: "WAITING",
      reason: "Minimum observation duration has not elapsed"
    });

    store.deployment.stepStartedAt = new Date("2026-07-27T12:00:00.000Z");
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
});
