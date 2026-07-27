import { describe, expect, it } from "vitest";
import type { RevisionMetrics } from "./contracts.js";
import { evaluateCandidate } from "./analysis.js";

function metrics(
  overrides: Partial<RevisionMetrics> = {}
): RevisionMetrics {
  return {
    requestCount: 100,
    errorCount: 0,
    errorRate: 0,
    averageLatencyMs: 100,
    p50LatencyMs: 90,
    p95LatencyMs: 120,
    p99LatencyMs: 150,
    ...overrides
  };
}

describe("candidate analysis", () => {
  it("continues when the candidate passes absolute and relative limits", () => {
    const result = evaluateCandidate({
      stableMetrics: metrics(),
      candidateMetrics: metrics({ p95LatencyMs: 150 }),
      minimumCandidateRequests: 50
    });

    expect(result.decision).toBe("CONTINUE");
  });

  it("waits for candidate samples and a stable baseline", () => {
    expect(
      evaluateCandidate({
        stableMetrics: metrics(),
        candidateMetrics: metrics({ requestCount: 9 }),
        minimumCandidateRequests: 10
      }).decision
    ).toBe("INSUFFICIENT_DATA");

    expect(
      evaluateCandidate({
        stableMetrics: metrics({ requestCount: 0 }),
        candidateMetrics: metrics(),
        minimumCandidateRequests: 10
      }).reason
    ).toBe("Stable revision baseline is not available");
  });

  it("rolls back a candidate above the 2% error threshold", () => {
    const result = evaluateCandidate({
      stableMetrics: metrics(),
      candidateMetrics: metrics({
        errorCount: 15,
        errorRate: 0.15
      }),
      minimumCandidateRequests: 10
    });

    expect(result.decision).toBe("ROLLBACK");
    expect(result.reason).toContain("15.00%");
  });

  it("rolls back a candidate whose p95 latency exceeds the limit", () => {
    const result = evaluateCandidate({
      stableMetrics: metrics({ p95LatencyMs: 100 }),
      candidateMetrics: metrics({ p95LatencyMs: 700 }),
      minimumCandidateRequests: 10
    });

    expect(result.decision).toBe("ROLLBACK");
    expect(result.reason).toContain("700ms");
    expect(result.reason).toContain("500ms");
  });
});
