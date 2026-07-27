import { describe, expect, it } from "vitest";
import { buildDemoService } from "./app.js";
import type { DemoServiceConfig } from "./env.js";
import { loadDemoServiceConfig } from "./env.js";

const baseConfig: DemoServiceConfig = {
  appVersion: "v2",
  errorRate: 0.15,
  responseDelayMs: 0,
  port: 3000,
  host: "127.0.0.1"
};

describe("demo service", () => {
  it("returns version and health information", async () => {
    const app = buildDemoService(baseConfig);

    const version = await app.inject({ method: "GET", url: "/version" });
    const health = await app.inject({ method: "GET", url: "/health" });

    expect(version.statusCode).toBe(200);
    expect(version.json()).toEqual({ version: "v2" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", version: "v2" });

    await app.close();
  });

  it("simulates failures according to the configured error rate", async () => {
    let callCount = 0;
    const app = buildDemoService(baseConfig, () => {
      callCount += 1;
      return callCount === 1 ? 0.1 : 0.9;
    });

    const failed = await app.inject({ method: "GET", url: "/api/demo" });
    const succeeded = await app.inject({ method: "GET", url: "/api/demo" });

    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toMatchObject({
      version: "v2",
      error: "Simulated service failure"
    });
    expect(succeeded.statusCode).toBe(200);
    expect(succeeded.json()).toMatchObject({
      version: "v2",
      message: "Request completed"
    });

    await app.close();
  });

  it("validates environment values", () => {
    expect(() =>
      loadDemoServiceConfig({
        APP_VERSION: "v1",
        ERROR_RATE: "2",
        RESPONSE_DELAY_MS: "0"
      })
    ).toThrow("ERROR_RATE must be <= 1");
  });
});

