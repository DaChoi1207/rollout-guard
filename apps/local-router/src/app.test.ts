import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildLocalRouter } from "./app.js";
import type { RouterConfig } from "./env.js";
import { loadRouterConfig } from "./env.js";
import { selectTarget } from "./traffic.js";

const apps: FastifyInstance[] = [];

async function startUpstream(version: string, statusCode = 200): Promise<string> {
  const app = Fastify({ logger: false });
  app.get("/api/demo", async (_request, reply) =>
    reply.code(statusCode).send({
      version,
      message: statusCode >= 500 ? undefined : "Request completed",
      error: statusCode >= 500 ? "Simulated service failure" : undefined
    })
  );
  apps.push(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind test upstream");
  }
  return `http://127.0.0.1:${address.port}`;
}

function baseConfig(overrides: Partial<RouterConfig>): RouterConfig {
  return {
    port: 8080,
    host: "127.0.0.1",
    stableUrl: "http://127.0.0.1:3001",
    candidateUrl: "http://127.0.0.1:3002",
    stableRevisionId: "v1",
    candidateRevisionId: "v2",
    stableWeight: 90,
    candidateWeight: 10,
    upstreamTimeoutMs: 1000,
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("traffic selection", () => {
  it("uses absolute weights and deterministic random input", () => {
    expect(selectTarget({ stableWeight: 100, candidateWeight: 0 }, () => 0.99)).toBe(
      "stable"
    );
    expect(selectTarget({ stableWeight: 0, candidateWeight: 100 }, () => 0)).toBe(
      "candidate"
    );
    expect(selectTarget({ stableWeight: 90, candidateWeight: 10 }, () => 0.89)).toBe(
      "stable"
    );
    expect(selectTarget({ stableWeight: 90, candidateWeight: 10 }, () => 0.9)).toBe(
      "candidate"
    );
  });
});

describe("local router", () => {
  it("updates weights idempotently and routes all traffic to stable at 100/0", async () => {
    const stableUrl = await startUpstream("v1");
    const candidateUrl = await startUpstream("v2");
    const router = buildLocalRouter(
      baseConfig({ stableUrl, candidateUrl, stableWeight: 90, candidateWeight: 10 }),
      () => 0.99
    );

    const firstUpdate = await router.inject({
      method: "PUT",
      url: "/internal/traffic",
      payload: { stableWeight: 100, candidateWeight: 0 }
    });
    const secondUpdate = await router.inject({
      method: "PUT",
      url: "/internal/traffic",
      payload: { stableWeight: 100, candidateWeight: 0 }
    });
    const proxied = await router.inject({ method: "GET", url: "/api/demo" });

    expect(firstUpdate.statusCode).toBe(200);
    expect(secondUpdate.statusCode).toBe(200);
    expect(firstUpdate.json()).toEqual({ stableWeight: 100, candidateWeight: 0 });
    expect(secondUpdate.json()).toEqual({ stableWeight: 100, candidateWeight: 0 });
    expect(proxied.statusCode).toBe(200);
    expect(proxied.headers["x-served-by"]).toBe("v1");
    expect(proxied.json()).toMatchObject({ version: "v1" });

    await router.close();
  });

  it("records upstream status and revision observations", async () => {
    const stableUrl = await startUpstream("v1");
    const candidateUrl = await startUpstream("v2", 500);
    const router = buildLocalRouter(
      baseConfig({ stableUrl, candidateUrl, stableWeight: 0, candidateWeight: 100 }),
      () => 0
    );

    const proxied = await router.inject({ method: "GET", url: "/api/demo" });
    const observations = await router.inject({
      method: "GET",
      url: "/internal/observations"
    });

    expect(proxied.statusCode).toBe(500);
    expect(proxied.headers["x-served-by"]).toBe("v2");
    expect(observations.json()).toMatchObject({
      observations: [
        {
          revisionId: "v2",
          target: "candidate",
          statusCode: 500
        }
      ]
    });

    await router.close();
  });

  it("produces an approximately 90/10 distribution over a sufficient sample", async () => {
    const stableUrl = await startUpstream("v1");
    const candidateUrl = await startUpstream("v2");
    const deterministicSamples = Array.from({ length: 1000 }, (_, index) => index / 1000);
    let sampleIndex = 0;
    const router = buildLocalRouter(baseConfig({ stableUrl, candidateUrl }), () => {
      const sample = deterministicSamples[sampleIndex] ?? 0;
      sampleIndex += 1;
      return sample;
    });

    const responses = await Promise.all(
      Array.from({ length: 1000 }, () =>
        router.inject({ method: "GET", url: "/api/demo" })
      )
    );

    const stableCount = responses.filter(
      (response) => response.headers["x-served-by"] === "v1"
    ).length;
    const candidateCount = responses.filter(
      (response) => response.headers["x-served-by"] === "v2"
    ).length;

    expect(stableCount).toBe(900);
    expect(candidateCount).toBe(100);

    await router.close();
  });

  it("validates router environment and weight updates", async () => {
    expect(() =>
      loadRouterConfig({
        STABLE_URL: "http://stable:3000",
        CANDIDATE_URL: "http://candidate:3000",
        STABLE_WEIGHT: "80",
        CANDIDATE_WEIGHT: "10"
      })
    ).toThrow("STABLE_WEIGHT and CANDIDATE_WEIGHT must sum to 100");

    const stableUrl = await startUpstream("v1");
    const candidateUrl = await startUpstream("v2");
    const router = buildLocalRouter(baseConfig({ stableUrl, candidateUrl }));
    const response = await router.inject({
      method: "PUT",
      url: "/internal/traffic",
      payload: { stableWeight: 70, candidateWeight: 10 }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Traffic weights must sum to 100"
    });

    await router.close();
  });
});

