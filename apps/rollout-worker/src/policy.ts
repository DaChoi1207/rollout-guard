import type { DeploymentState } from "@rollout-guard/database";

export type RolloutStep = {
  state: "CANARY_10" | "CANARY_50" | "FULL_TRAFFIC" | "OBSERVING";
  stableWeight: number;
  candidateWeight: number;
  minimumRequests: number;
  minimumDurationMs: number;
};

export const developmentRolloutPolicy: readonly RolloutStep[] = [
  {
    state: "CANARY_10",
    stableWeight: 90,
    candidateWeight: 10,
    minimumRequests: 10,
    minimumDurationMs: 5_000
  },
  {
    state: "CANARY_50",
    stableWeight: 50,
    candidateWeight: 50,
    minimumRequests: 20,
    minimumDurationMs: 5_000
  },
  {
    state: "FULL_TRAFFIC",
    stableWeight: 0,
    candidateWeight: 100,
    minimumRequests: 30,
    minimumDurationMs: 5_000
  },
  {
    state: "OBSERVING",
    stableWeight: 0,
    candidateWeight: 100,
    minimumRequests: 30,
    minimumDurationMs: 5_000
  }
];

export function findRolloutStep(
  state: DeploymentState,
  policy: readonly RolloutStep[]
): RolloutStep | null {
  return policy.find((step) => step.state === state) ?? null;
}
