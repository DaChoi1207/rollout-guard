import type {
  Deployment,
  DeploymentEvent
} from "@rollout-guard/database";
import { describe, expect, it } from "vitest";
import type { DeploymentStore } from "./contracts.js";
import {
  calculateRetryDelayMs,
  handleReconcileFailure,
  type DeploymentFailureFinalizer,
  type RetryPolicy
} from "./reliability.js";

const policy: RetryPolicy = {
  maximumAttempts: 3,
  maximumRollbackAttempts: 2,
  baseDelayMs: 1_000,
  maximumDelayMs: 5_000
};

function deployment(state: Deployment["state"] = "CANARY_10"): Deployment {
  const now = new Date("2026-07-27T12:00:00.000Z");
  return {
    id: "deployment-1",
    serviceId: "service-1",
    stableRevisionId: "v1",
    candidateRevisionId: "v2",
    state,
    stableWeight: 90,
    candidateWeight: 10,
    currentStepIndex: 0,
    stateVersion: 4,
    reconcileFailureCount: 0,
    rollbackAttemptCount: 0,
    nextReconcileAt: null,
    lastReconcileError: null,
    failureReason: null,
    stepStartedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

class RetryStore implements DeploymentStore {
  public current = deployment();

  public async getDeploymentById(): Promise<Deployment | null> {
    return this.current;
  }
  public async listActiveDeployments(): Promise<Deployment[]> {
    return [this.current];
  }
  public async updateDeployment(): Promise<boolean> {
    return true;
  }
  public async transitionDeployment(
    _deployment: Deployment,
    _expectedStateVersion: number,
    _event: DeploymentEvent
  ): Promise<boolean> {
    return true;
  }
  public async recordReconcileFailure(input: {
    expectedStateVersion: number;
    error: string;
    nextReconcileAt: Date;
    isRollback: boolean;
  }): Promise<boolean> {
    if (input.expectedStateVersion !== this.current.stateVersion) {
      return false;
    }
    this.current = {
      ...this.current,
      stateVersion: this.current.stateVersion + 1,
      reconcileFailureCount: this.current.reconcileFailureCount + 1,
      rollbackAttemptCount:
        this.current.rollbackAttemptCount + (input.isRollback ? 1 : 0),
      nextReconcileAt: input.nextReconcileAt,
      lastReconcileError: input.error
    };
    return true;
  }
}

class FailureFinalizer implements DeploymentFailureFinalizer {
  public calls: Array<{ deploymentId: string; reason: string }> = [];

  public async failDeployment(
    deploymentId: string,
    reason: string
  ): Promise<{ outcome: "TRANSITIONED"; from: "CANARY_10"; to: "FAILED" }> {
    this.calls.push({ deploymentId, reason });
    return {
      outcome: "TRANSITIONED",
      from: "CANARY_10",
      to: "FAILED"
    };
  }
}

describe("retry reliability", () => {
  it("uses capped exponential backoff", () => {
    expect(calculateRetryDelayMs(1, policy)).toBe(1_000);
    expect(calculateRetryDelayMs(2, policy)).toBe(2_000);
    expect(calculateRetryDelayMs(3, policy)).toBe(4_000);
    expect(calculateRetryDelayMs(10, policy)).toBe(5_000);
  });

  it("persists a retry time and error", async () => {
    const store = new RetryStore();
    const finalizer = new FailureFinalizer();

    await expect(
      handleReconcileFailure({
        deployment: store.current,
        error: new Error("metrics unavailable"),
        deployments: store,
        reconciler: finalizer,
        policy,
        clock: () => new Date("2026-07-27T12:00:00.000Z")
      })
    ).resolves.toBe("RETRY_SCHEDULED");

    expect(store.current.reconcileFailureCount).toBe(1);
    expect(store.current.nextReconcileAt).toEqual(
      new Date("2026-07-27T12:00:01.000Z")
    );
    expect(store.current.lastReconcileError).toBe("metrics unavailable");
  });

  it("marks rollback failed after its retry policy is exhausted", async () => {
    const store = new RetryStore();
    store.current = {
      ...deployment("ROLLING_BACK"),
      reconcileFailureCount: 1,
      rollbackAttemptCount: 1
    };
    const finalizer = new FailureFinalizer();

    await expect(
      handleReconcileFailure({
        deployment: store.current,
        error: new Error("router unavailable"),
        deployments: store,
        reconciler: finalizer,
        policy
      })
    ).resolves.toBe("FAILED");

    expect(finalizer.calls).toEqual([
      {
        deploymentId: "deployment-1",
        reason: "router unavailable"
      }
    ]);
  });
});
