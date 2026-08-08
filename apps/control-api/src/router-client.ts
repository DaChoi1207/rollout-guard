import type { RevisionMetrics, RouterClient } from "./contracts.js";

type Observation = {
  revisionId: string;
  statusCode: number;
  durationMs: number;
  timestamp: string;
};

function aggregate(observations: readonly Observation[]): RevisionMetrics {
  const latencies = observations
    .map((observation) => observation.durationMs)
    .sort((left, right) => left - right);
  const percentile = (value: number): number => {
    if (latencies.length === 0) {
      return 0;
    }
    return (
      latencies[Math.ceil((value / 100) * latencies.length) - 1] ?? 0
    );
  };
  const errorCount = observations.filter(
    (observation) => observation.statusCode >= 500
  ).length;
  const totalLatency = latencies.reduce((sum, value) => sum + value, 0);
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

export class HttpRouterClient implements RouterClient {
  public constructor(private readonly routerUrl: string) {}

  public async getWeights(): Promise<{
    stableWeight: number;
    candidateWeight: number;
  }> {
    const response = await fetch(`${this.routerUrl}/internal/traffic`);
    if (!response.ok) {
      throw new Error(`Router weights failed with ${response.status}`);
    }
    return (await response.json()) as {
      stableWeight: number;
      candidateWeight: number;
    };
  }

  public async getMetrics(input: {
    revisionId: string;
    since: Date;
  }): Promise<RevisionMetrics> {
    const response = await fetch(`${this.routerUrl}/internal/observations`);
    if (!response.ok) {
      throw new Error(`Router observations failed with ${response.status}`);
    }
    const body = (await response.json()) as {
      observations?: Observation[];
    };
    if (!Array.isArray(body.observations)) {
      throw new Error("Router observations response is invalid");
    }
    return aggregate(
      body.observations.filter(
        (observation) =>
          observation.revisionId === input.revisionId &&
          Date.parse(observation.timestamp) >= input.since.getTime()
      )
    );
  }

  public generateLoad(input: {
    durationSeconds: number;
    requestsPerSecond: number;
  }): void {
    const totalRequests = input.durationSeconds * input.requestsPerSecond;
    const spacingMs = 1_000 / input.requestsPerSecond;
    void (async () => {
      for (let request = 0; request < totalRequests; request += 1) {
        void fetch(`${this.routerUrl}/api/demo`).catch(() => undefined);
        if (request < totalRequests - 1) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, spacingMs);
          });
        }
      }
    })();
  }
}

export { aggregate as aggregateObservations };
