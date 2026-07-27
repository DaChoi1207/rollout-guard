import type { RevisionMetrics } from "./contracts.js";

export type AnalysisDecision =
  | "INSUFFICIENT_DATA"
  | "CONTINUE"
  | "ROLLBACK";

export type AnalysisResult = {
  decision: AnalysisDecision;
  reason: string;
  stableMetrics: RevisionMetrics;
  candidateMetrics: RevisionMetrics;
};

export type AnalysisThresholds = {
  maximumErrorRate: number;
  maximumLatencyMultiplier: number;
  absoluteMaximumP95LatencyMs: number;
};

export const defaultAnalysisThresholds: AnalysisThresholds = {
  maximumErrorRate: 0.02,
  maximumLatencyMultiplier: 1.5,
  absoluteMaximumP95LatencyMs: 500
};

export function evaluateCandidate(input: {
  stableMetrics: RevisionMetrics;
  candidateMetrics: RevisionMetrics;
  minimumCandidateRequests: number;
  thresholds?: AnalysisThresholds;
}): AnalysisResult {
  const thresholds = input.thresholds ?? defaultAnalysisThresholds;
  const result = (
    decision: AnalysisDecision,
    reason: string
  ): AnalysisResult => ({
    decision,
    reason,
    stableMetrics: input.stableMetrics,
    candidateMetrics: input.candidateMetrics
  });

  if (input.candidateMetrics.requestCount < input.minimumCandidateRequests) {
    return result(
      "INSUFFICIENT_DATA",
      "Minimum candidate request count has not been reached"
    );
  }

  if (input.stableMetrics.requestCount === 0) {
    return result(
      "INSUFFICIENT_DATA",
      "Stable revision baseline is not available"
    );
  }

  if (input.candidateMetrics.errorRate > thresholds.maximumErrorRate) {
    return result(
      "ROLLBACK",
      `Candidate error rate ${(input.candidateMetrics.errorRate * 100).toFixed(
        2
      )}% exceeded ${(thresholds.maximumErrorRate * 100).toFixed(2)}%`
    );
  }

  const maximumCandidateP95 = Math.max(
    input.stableMetrics.p95LatencyMs * thresholds.maximumLatencyMultiplier,
    thresholds.absoluteMaximumP95LatencyMs
  );
  if (input.candidateMetrics.p95LatencyMs > maximumCandidateP95) {
    return result(
      "ROLLBACK",
      `Candidate p95 latency ${input.candidateMetrics.p95LatencyMs}ms exceeded ${Math.round(
        maximumCandidateP95
      )}ms`
    );
  }

  return result("CONTINUE", "Candidate passed the current rollout step");
}
