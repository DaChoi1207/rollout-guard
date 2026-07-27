import Fastify, { type FastifyInstance } from "fastify";
import type { DemoServiceConfig } from "./env.js";

export type RandomSource = () => number;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function buildDemoService(
  config: DemoServiceConfig,
  random: RandomSource = Math.random
): FastifyInstance {
  const logger =
    process.env.NODE_ENV === "test"
      ? false
      : {
          level: process.env.LOG_LEVEL ?? "info"
        };

  const app = Fastify({
    logger
  });

  app.get("/health", async () => ({
    status: "ok",
    version: config.appVersion
  }));

  app.get("/version", async () => ({
    version: config.appVersion
  }));

  app.get("/api/demo", async (_request, reply) => {
    const startedAt = Date.now();
    await delay(config.responseDelayMs);

    const durationMs = Date.now() - startedAt;
    if (random() < config.errorRate) {
      app.log.warn(
        { version: config.appVersion, durationMs },
        "simulated service failure"
      );

      return reply.code(500).send({
        version: config.appVersion,
        error: "Simulated service failure",
        durationMs
      });
    }

    app.log.info(
      { version: config.appVersion, durationMs },
      "request completed"
    );

    return {
      version: config.appVersion,
      message: "Request completed",
      durationMs
    };
  });

  return app;
}
