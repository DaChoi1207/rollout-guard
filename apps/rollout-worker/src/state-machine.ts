import type { DeploymentState } from "@rollout-guard/database";

const allowedTransitions = {
  QUEUED: ["STARTING_CANDIDATE"],
  STARTING_CANDIDATE: ["WAITING_FOR_HEALTH"],
  WAITING_FOR_HEALTH: ["CANARY_10", "ROLLING_BACK"],
  CANARY_10: ["CANARY_50", "ROLLING_BACK"],
  CANARY_50: ["FULL_TRAFFIC", "ROLLING_BACK"],
  FULL_TRAFFIC: ["OBSERVING", "ROLLING_BACK"],
  OBSERVING: ["SUCCEEDED", "ROLLING_BACK"],
  SUCCEEDED: [],
  ROLLING_BACK: ["ROLLED_BACK", "FAILED"],
  ROLLED_BACK: [],
  FAILED: []
} satisfies Record<DeploymentState, readonly DeploymentState[]>;

export function isTransitionAllowed(
  from: DeploymentState,
  to: DeploymentState
): boolean {
  return allowedTransitions[from].includes(to as never);
}

export function assertTransitionAllowed(
  from: DeploymentState,
  to: DeploymentState
): void {
  if (!isTransitionAllowed(from, to)) {
    throw new Error(`Illegal deployment transition: ${from} -> ${to}`);
  }
}
