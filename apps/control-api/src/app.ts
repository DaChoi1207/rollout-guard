import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import {
  ConflictError,
  ControlPlaneService,
  NotFoundError
} from "./service.js";

export type ControlApiService = Pick<
  ControlPlaneService,
  | "createDeployment"
  | "listDeployments"
  | "getDeployment"
  | "requestRollback"
  | "startDemoLoad"
>;

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function boundedInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

export async function buildControlApi(input: {
  service: ControlApiService;
  dashboardOrigin: string;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : true
  });
  await app.register(cors, {
    origin: input.dashboardOrigin,
    methods: ["GET", "POST"]
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: error.message });
    }
    if (error instanceof ConflictError) {
      return reply.code(409).send({ error: error.message });
    }
    const message =
      error instanceof Error ? error.message : "Unknown request error";
    if (
      message.includes("is required") ||
      message.includes("must be an integer")
    ) {
      return reply.code(400).send({ error: message });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({ error: message });
    }
    app.log.error({ error }, "control API request failed");
    return reply.code(500).send({ error: "Internal control plane error" });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/deployments", async () => ({
    deployments: await input.service.listDeployments()
  }));

  app.post<{ Body: Record<string, unknown> }>(
    "/deployments",
    async (request, reply) => {
      const deployment = await input.service.createDeployment({
        serviceName: requiredText(request.body?.serviceName, "serviceName"),
        stableRevisionId: requiredText(
          request.body?.stableRevisionId,
          "stableRevisionId"
        ),
        candidateRevisionId: requiredText(
          request.body?.candidateRevisionId,
          "candidateRevisionId"
        )
      });
      return reply.code(201).send({ deployment });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/deployments/:id",
    async (request) => input.service.getDeployment(request.params.id)
  );

  app.post<{ Params: { id: string } }>(
    "/deployments/:id/rollback",
    async (request) => ({
      deployment: await input.service.requestRollback(request.params.id)
    })
  );

  app.post<{ Body: Record<string, unknown> }>(
    "/demo/load",
    async (request, reply) => {
      const durationSeconds = boundedInteger(
        request.body?.durationSeconds ?? 30,
        "durationSeconds",
        1,
        300
      );
      const requestsPerSecond = boundedInteger(
        request.body?.requestsPerSecond ?? 25,
        "requestsPerSecond",
        1,
        200
      );
      input.service.startDemoLoad({ durationSeconds, requestsPerSecond });
      return reply.code(202).send({
        status: "started",
        durationSeconds,
        requestsPerSecond
      });
    }
  );

  return app;
}
