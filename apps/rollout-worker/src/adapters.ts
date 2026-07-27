import type {
  MetricsProvider,
  RuntimeProvider,
  TrafficRouter
} from "./contracts.js";
import { calculateRevisionMetrics } from "./metrics.js";
import type { RevisionMetrics } from "./contracts.js";

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export class HttpRuntimeProvider implements RuntimeProvider {
  public constructor(
    private readonly revisionUrls: Readonly<Record<string, string>>,
    private readonly timeoutMs: number
  ) {}

  public async ensureCandidate(revisionId: string): Promise<void> {
    if (!this.revisionUrls[revisionId]) {
      throw new Error(`Unknown local candidate revision: ${revisionId}`);
    }
  }

  public async isRevisionHealthy(revisionId: string): Promise<boolean> {
    const revisionUrl = this.revisionUrls[revisionId];
    if (!revisionUrl) {
      return false;
    }

    try {
      const response = await fetchWithTimeout(
        `${revisionUrl}/health`,
        { method: "GET" },
        this.timeoutMs
      );
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as {
        status?: unknown;
        version?: unknown;
      };
      return body.status === "ok" && body.version === revisionId;
    } catch {
      return false;
    }
  }
}

export class HttpTrafficRouter
  implements TrafficRouter, MetricsProvider
{
  public constructor(
    private readonly routerBaseUrl: string,
    private readonly timeoutMs: number
  ) {}

  public async setWeights(input: {
    stableWeight: number;
    candidateWeight: number;
  }): Promise<void> {
    const response = await fetchWithTimeout(
      `${this.routerBaseUrl}/internal/traffic`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      },
      this.timeoutMs
    );
    if (!response.ok) {
      throw new Error(`Traffic router rejected weights with ${response.status}`);
    }
  }

  public async getRevisionMetrics(input: {
    revisionId: string;
    since: Date;
  }): Promise<RevisionMetrics> {
    const response = await fetchWithTimeout(
      `${this.routerBaseUrl}/internal/observations`,
      { method: "GET" },
      this.timeoutMs
    );
    if (!response.ok) {
      throw new Error(`Traffic observations failed with ${response.status}`);
    }
    const body = (await response.json()) as {
      observations?: Array<{
        revisionId?: unknown;
        statusCode?: unknown;
        durationMs?: unknown;
        timestamp?: unknown;
      }>;
    };
    if (!Array.isArray(body.observations)) {
      throw new Error("Traffic observations response is invalid");
    }

    const observations = body.observations.filter((observation) => {
      if (
        observation.revisionId !== input.revisionId ||
        typeof observation.timestamp !== "string" ||
        typeof observation.statusCode !== "number" ||
        typeof observation.durationMs !== "number"
      ) {
        return false;
      }
      const timestamp = Date.parse(observation.timestamp);
      return Number.isFinite(timestamp) && timestamp >= input.since.getTime();
    }) as Array<{
      revisionId: string;
      statusCode: number;
      durationMs: number;
      timestamp: string;
    }>;

    return calculateRevisionMetrics(observations);
  }
}
