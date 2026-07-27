import type {
  RuntimeProvider,
  StepObservationProvider,
  TrafficRouter
} from "./contracts.js";

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
    private readonly candidateRevisionId: string,
    private readonly candidateBaseUrl: string,
    private readonly timeoutMs: number
  ) {}

  public async ensureCandidate(revisionId: string): Promise<void> {
    if (revisionId !== this.candidateRevisionId) {
      throw new Error(`Unknown local candidate revision: ${revisionId}`);
    }
  }

  public async isRevisionHealthy(revisionId: string): Promise<boolean> {
    if (revisionId !== this.candidateRevisionId) {
      return false;
    }

    try {
      const response = await fetchWithTimeout(
        `${this.candidateBaseUrl}/health`,
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
  implements TrafficRouter, StepObservationProvider
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

  public async getCandidateRequestCount(input: {
    revisionId: string;
    since: Date;
  }): Promise<number> {
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
        timestamp?: unknown;
      }>;
    };
    if (!Array.isArray(body.observations)) {
      throw new Error("Traffic observations response is invalid");
    }

    return body.observations.filter((observation) => {
      if (
        observation.revisionId !== input.revisionId ||
        typeof observation.timestamp !== "string"
      ) {
        return false;
      }
      const timestamp = Date.parse(observation.timestamp);
      return Number.isFinite(timestamp) && timestamp >= input.since.getTime();
    }).length;
  }
}
