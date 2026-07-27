import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import type { RouterConfig } from "./env.js";
import { assertValidWeights, selectTarget, type TrafficWeights } from "./traffic.js";

type RevisionTarget = {
  name: "stable" | "candidate";
  baseUrl: string;
  revisionId: string;
};

export type RequestObservation = {
  id: string;
  revisionId: string;
  target: "stable" | "candidate";
  statusCode: number;
  durationMs: number;
  timestamp: string;
};

type WeightUpdateBody = {
  stableWeight?: unknown;
  candidateWeight?: unknown;
};

function toWeightUpdate(body: WeightUpdateBody): TrafficWeights {
  const weights = {
    stableWeight: body.stableWeight,
    candidateWeight: body.candidateWeight
  };

  if (
    typeof weights.stableWeight !== "number" ||
    typeof weights.candidateWeight !== "number"
  ) {
    throw new Error("stableWeight and candidateWeight must be numbers");
  }

  const parsed = {
    stableWeight: weights.stableWeight,
    candidateWeight: weights.candidateWeight
  };
  assertValidWeights(parsed);
  return parsed;
}

function buildForwardUrl(target: RevisionTarget, request: FastifyRequest): string {
  const url = new URL(request.url, target.baseUrl);
  return url.toString();
}

async function forwardRequest(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  target: RevisionTarget;
  upstreamTimeoutMs: number;
}): Promise<{ statusCode: number; durationMs: number }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.upstreamTimeoutMs);

  try {
    const init: RequestInit = {
      method: input.request.method,
      headers: {
        accept: input.request.headers.accept ?? "application/json",
        "content-type": input.request.headers["content-type"] ?? "application/json"
      },
      signal: controller.signal
    };

    if (input.request.method !== "GET" && input.request.method !== "HEAD") {
      init.body = JSON.stringify(input.request.body ?? {});
    }

    const upstreamResponse = await fetch(buildForwardUrl(input.target, input.request), init);

    const responseBody = await upstreamResponse.arrayBuffer();
    const contentType = upstreamResponse.headers.get("content-type");
    if (contentType) {
      input.reply.header("content-type", contentType);
    }

    input.reply.header("X-Served-By", input.target.revisionId);
    input.reply.code(upstreamResponse.status).send(Buffer.from(responseBody));
    return {
      statusCode: upstreamResponse.status,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const statusCode = 502;
    input.reply.header("X-Served-By", input.target.revisionId);
    input.reply.code(statusCode).send({
      error: "Upstream request failed",
      revisionId: input.target.revisionId
    });

    return {
      statusCode,
      durationMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildLocalRouter(
  config: RouterConfig,
  random: () => number = Math.random
): FastifyInstance {
  let weights: TrafficWeights = {
    stableWeight: config.stableWeight,
    candidateWeight: config.candidateWeight
  };
  const observations: RequestObservation[] = [];
  const logger =
    process.env.NODE_ENV === "test"
      ? false
      : {
          level: process.env.LOG_LEVEL ?? "info"
        };
  const app = Fastify({ logger });

  const targets = {
    stable: {
      name: "stable",
      baseUrl: config.stableUrl,
      revisionId: config.stableRevisionId
    },
    candidate: {
      name: "candidate",
      baseUrl: config.candidateUrl,
      revisionId: config.candidateRevisionId
    }
  } satisfies Record<"stable" | "candidate", RevisionTarget>;

  app.get("/health", async () => ({
    status: "ok",
    weights
  }));

  app.get("/internal/traffic", async () => weights);

  app.put<{ Body: WeightUpdateBody }>("/internal/traffic", async (request, reply) => {
    try {
      weights = toWeightUpdate(request.body);
      return weights;
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Invalid traffic weights"
      });
    }
  });

  app.get("/internal/observations", async () => ({
    observations
  }));

  app.delete("/internal/observations", async () => {
    observations.length = 0;
    return { observations: [] };
  });

  app.all("/*", async (request, reply) => {
    const targetName = selectTarget(weights, random);
    const target = targets[targetName];
    const result = await forwardRequest({
      request,
      reply,
      target,
      upstreamTimeoutMs: config.upstreamTimeoutMs
    });

    observations.push({
      id: crypto.randomUUID(),
      revisionId: target.revisionId,
      target: target.name,
      statusCode: result.statusCode,
      durationMs: result.durationMs,
      timestamp: new Date().toISOString()
    });

    request.log.info(
      {
        revisionId: target.revisionId,
        target: target.name,
        statusCode: result.statusCode,
        durationMs: result.durationMs
      },
      "proxied request"
    );
  });

  return app;
}
