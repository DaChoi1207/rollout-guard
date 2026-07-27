export type RevisionTargetName = "stable" | "candidate";

export type TrafficWeights = {
  stableWeight: number;
  candidateWeight: number;
};

export function assertValidWeights(weights: TrafficWeights): void {
  if (
    !Number.isInteger(weights.stableWeight) ||
    !Number.isInteger(weights.candidateWeight)
  ) {
    throw new Error("Traffic weights must be integers");
  }

  if (
    weights.stableWeight < 0 ||
    weights.stableWeight > 100 ||
    weights.candidateWeight < 0 ||
    weights.candidateWeight > 100
  ) {
    throw new Error("Traffic weights must be between 0 and 100");
  }

  if (weights.stableWeight + weights.candidateWeight !== 100) {
    throw new Error("Traffic weights must sum to 100");
  }
}

export function selectTarget(
  weights: TrafficWeights,
  random: () => number = Math.random
): RevisionTargetName {
  assertValidWeights(weights);
  return random() * 100 < weights.stableWeight ? "stable" : "candidate";
}

