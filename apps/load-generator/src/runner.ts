import type { LoadGeneratorConfig } from "./config.js";
import { average, percentile } from "./latency.js";

export type RequestResult = {
  ok: boolean;
  statusCode: number;
  durationMs: number;
  servedBy: string | null;
};

export type LoadSummary = {
  targetUrl: string;
  requestsSent: number;
  successful: number;
  failed: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  servedByCounts: Record<string, number>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function sendRequest(
  targetUrl: string,
  requestTimeoutMs: number
): Promise<RequestResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      signal: controller.signal
    });

    await response.arrayBuffer();

    return {
      ok: response.status < 500,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      servedBy: response.headers.get("x-served-by")
    };
  } catch {
    return {
      ok: false,
      statusCode: 0,
      durationMs: Date.now() - startedAt,
      servedBy: null
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runLoadTest(
  config: LoadGeneratorConfig,
  send: (
    targetUrl: string,
    requestTimeoutMs: number
  ) => Promise<RequestResult> = sendRequest
): Promise<LoadSummary> {
  const totalRequests = config.requestsPerSecond * config.durationSeconds;
  const spacingMs = 1000 / config.requestsPerSecond;
  const results: RequestResult[] = [];
  const inFlight = new Set<Promise<void>>();

  for (let index = 0; index < totalRequests; index += 1) {
    while (inFlight.size >= config.concurrency) {
      await Promise.race(inFlight);
    }

    const request = send(config.targetUrl, config.requestTimeoutMs).then((result) => {
      results.push(result);
    });
    inFlight.add(request);
    request.finally(() => {
      inFlight.delete(request);
    });

    if (index < totalRequests - 1) {
      await sleep(spacingMs);
    }
  }

  await Promise.all(inFlight);

  const latencies = results.map((result) => result.durationMs);
  const servedByCounts = results.reduce<Record<string, number>>((counts, result) => {
    const key = result.servedBy ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return {
    targetUrl: config.targetUrl,
    requestsSent: results.length,
    successful: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    averageLatencyMs: Math.round(average(latencies)),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    servedByCounts
  };
}

export function formatLoadSummary(summary: LoadSummary): string {
  const servedByLines = Object.entries(summary.servedByCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([revision, count]) => `  ${revision}: ${count}`)
    .join("\n");

  return [
    `Target: ${summary.targetUrl}`,
    `Requests sent: ${summary.requestsSent}`,
    `Successful: ${summary.successful}`,
    `Failed: ${summary.failed}`,
    `Average latency: ${summary.averageLatencyMs} ms`,
    `p50 latency: ${summary.p50LatencyMs} ms`,
    `p95 latency: ${summary.p95LatencyMs} ms`,
    `p99 latency: ${summary.p99LatencyMs} ms`,
    "Served by:",
    servedByLines.length > 0 ? servedByLines : "  none"
  ].join("\n");
}

