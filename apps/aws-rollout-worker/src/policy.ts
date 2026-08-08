import type { RolloutStep } from "@rollout-guard/rollout-worker";

// ALB metrics are emitted to CloudWatch in one-minute periods. The cloud policy
// leaves enough time for a completed period to become queryable, unlike the
// deliberately fast policy used by the local Docker demonstration.
export const awsRolloutPolicy: readonly RolloutStep[] = [
  {
    state: "CANARY_10",
    stableWeight: 90,
    candidateWeight: 10,
    minimumRequests: 25,
    minimumDurationMs: 90_000,
    maximumObservationMs: 180_000
  },
  {
    state: "CANARY_50",
    stableWeight: 50,
    candidateWeight: 50,
    minimumRequests: 50,
    minimumDurationMs: 90_000,
    maximumObservationMs: 180_000
  },
  {
    state: "FULL_TRAFFIC",
    stableWeight: 0,
    candidateWeight: 100,
    minimumRequests: 100,
    minimumDurationMs: 90_000,
    maximumObservationMs: 180_000
  },
  {
    state: "OBSERVING",
    stableWeight: 0,
    candidateWeight: 100,
    minimumRequests: 100,
    minimumDurationMs: 90_000,
    maximumObservationMs: 180_000
  }
];
