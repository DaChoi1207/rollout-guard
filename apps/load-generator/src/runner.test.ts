import { describe, expect, it } from "vitest";
import { parseLoadGeneratorArgs } from "./config.js";
import { percentile } from "./latency.js";
import { formatLoadSummary, runLoadTest, type RequestResult } from "./runner.js";

describe("load generator config", () => {
  it("parses required and optional flags", () => {
    expect(
      parseLoadGeneratorArgs([
        "--target",
        "http://localhost:8080/api/demo",
        "--requests-per-second",
        "25",
        "--duration-seconds",
        "60",
        "--concurrency",
        "5",
        "--request-timeout-ms",
        "1000"
      ])
    ).toEqual({
      targetUrl: "http://localhost:8080/api/demo",
      requestsPerSecond: 25,
      durationSeconds: 60,
      concurrency: 5,
      requestTimeoutMs: 1000
    });
  });

  it("rejects invalid input", () => {
    expect(() =>
      parseLoadGeneratorArgs([
        "--target",
        "not-a-url",
        "--requests-per-second",
        "25",
        "--duration-seconds",
        "60"
      ])
    ).toThrow("--target must be a valid URL");
  });
});

describe("latency helpers", () => {
  it("calculates nearest-rank percentiles", () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50);
  });
});

describe("load test runner", () => {
  it("summarizes requests, failures, latency, and served-by counts", async () => {
    const results: RequestResult[] = [
      { ok: true, statusCode: 200, durationMs: 50, servedBy: "v1" },
      { ok: true, statusCode: 200, durationMs: 60, servedBy: "v1" },
      { ok: false, statusCode: 500, durationMs: 300, servedBy: "v2" }
    ];
    let index = 0;

    const summary = await runLoadTest(
      {
        targetUrl: "http://localhost:8080/api/demo",
        requestsPerSecond: 100,
        durationSeconds: 1,
        concurrency: 10,
        requestTimeoutMs: 1000
      },
      async () => {
        const result = results[index % results.length];
        index += 1;
        if (!result) {
          throw new Error("missing result");
        }
        return result;
      }
    );

    expect(summary.requestsSent).toBe(100);
    expect(summary.successful).toBe(67);
    expect(summary.failed).toBe(33);
    expect(summary.servedByCounts).toEqual({
      v1: 67,
      v2: 33
    });
    expect(summary.p95LatencyMs).toBe(300);
  });

  it("formats a human-readable summary", () => {
    expect(
      formatLoadSummary({
        targetUrl: "http://localhost:8080/api/demo",
        requestsSent: 3,
        successful: 2,
        failed: 1,
        averageLatencyMs: 137,
        p50LatencyMs: 60,
        p95LatencyMs: 300,
        p99LatencyMs: 300,
        servedByCounts: {
          v1: 2,
          v2: 1
        }
      })
    ).toContain("Requests sent: 3");
  });
});

