import type { Deployment } from "@rollout-guard/database";
import type { DeploymentStore } from "./contracts.js";
import type { ReconcileResult } from "./reconciler.js";

export interface DeploymentFailureFinalizer {
  failDeployment(
    deploymentId: string,
    reason: string
  ): Promise<ReconcileResult>;
}

export type RetryPolicy = {
  maximumAttempts: number;
  maximumRollbackAttempts: number;
  baseDelayMs: number;
  maximumDelayMs: number;
};

export const defaultRetryPolicy: RetryPolicy = {
  maximumAttempts: 5,
  maximumRollbackAttempts: 5,
  baseDelayMs: 1_000,
  maximumDelayMs: 30_000
};

export function calculateRetryDelayMs(
  failureCount: number,
  policy: RetryPolicy
): number {
  return Math.min(
    policy.baseDelayMs * 2 ** Math.max(0, failureCount - 1),
    policy.maximumDelayMs
  );
}

export async function handleReconcileFailure(input: {
  deployment: Deployment;
  error: Error;
  deployments: DeploymentStore;
  reconciler: DeploymentFailureFinalizer;
  policy: RetryPolicy;
  clock?: () => Date;
}): Promise<"CONFLICT" | "RETRY_SCHEDULED" | "FAILED"> {
  const clock = input.clock ?? (() => new Date());
  const failureCount = input.deployment.reconcileFailureCount + 1;
  const rollbackAttemptCount =
    input.deployment.rollbackAttemptCount +
    (input.deployment.state === "ROLLING_BACK" ? 1 : 0);
  const delayMs = calculateRetryDelayMs(failureCount, input.policy);
  const nextReconcileAt = new Date(clock().getTime() + delayMs);
  const recorded = await input.deployments.recordReconcileFailure({
    deploymentId: input.deployment.id,
    expectedStateVersion: input.deployment.stateVersion,
    error: input.error.message,
    nextReconcileAt,
    isRollback: input.deployment.state === "ROLLING_BACK"
  });
  if (!recorded) {
    return "CONFLICT";
  }

  const exhausted =
    failureCount >= input.policy.maximumAttempts ||
    (input.deployment.state === "ROLLING_BACK" &&
      rollbackAttemptCount >= input.policy.maximumRollbackAttempts);
  if (!exhausted) {
    return "RETRY_SCHEDULED";
  }

  await input.reconciler.failDeployment(
    input.deployment.id,
    input.error.message
  );
  return "FAILED";
}
