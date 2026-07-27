import type { RevisionMetrics } from "./contracts.js";

export type MetricObservation = {
  statusCode: number;
  durationMs: number;
};

export function calculateRevisionMetrics(
  observations: readonly MetricObservation[]
): RevisionMetrics {
  const latencies = observations
    .map((observation) => observation.durationMs)
    .sort((left, right) => left - right);
  const percentile = (value: number): number => {
    if (latencies.length === 0) {
      return 0;
    }
    const index = Math.max(
      0,
      Math.ceil((value / 100) * latencies.length) - 1
    );
    return latencies[index] ?? 0;
  };
  const errorCount = observations.filter(
    (observation) => observation.statusCode >= 500
  ).length;
  const totalLatency = latencies.reduce((sum, latency) => sum + latency, 0);

  return {
    requestCount: observations.length,
    errorCount,
    errorRate: observations.length === 0 ? 0 : errorCount / observations.length,
    averageLatencyMs:
      observations.length === 0
        ? 0
        : Math.round(totalLatency / observations.length),
    p50LatencyMs: percentile(50),
    p95LatencyMs: percentile(95),
    p99LatencyMs: percentile(99)
  };
}
