import { describe, expect, it } from "vitest";
import { calculateRevisionMetrics } from "./metrics.js";

describe("revision metric aggregation", () => {
  it("calculates HTTP 5xx error rate and nearest-rank latency percentiles", () => {
    const metrics = calculateRevisionMetrics([
      { statusCode: 200, durationMs: 10 },
      { statusCode: 200, durationMs: 20 },
      { statusCode: 502, durationMs: 30 },
      { statusCode: 500, durationMs: 40 },
      { statusCode: 404, durationMs: 50 }
    ]);

    expect(metrics).toEqual({
      requestCount: 5,
      errorCount: 2,
      errorRate: 0.4,
      averageLatencyMs: 30,
      p50LatencyMs: 30,
      p95LatencyMs: 50,
      p99LatencyMs: 50
    });
  });

  it("returns zero-valued metrics for an empty observation window", () => {
    expect(calculateRevisionMetrics([])).toEqual({
      requestCount: 0,
      errorCount: 0,
      errorRate: 0,
      averageLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0
    });
  });
});
