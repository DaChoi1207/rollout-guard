export type RouterConfig = {
  port: number;
  host: string;
  stableUrl: string;
  candidateUrl: string;
  stableRevisionId: string;
  candidateRevisionId: string;
  stableWeight: number;
  candidateWeight: number;
  upstreamTimeoutMs: number;
};

function readRequiredString(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  options: { defaultValue?: number; min: number; max?: number }
): number {
  const raw = env[name] ?? String(options.defaultValue ?? "");
  if (raw.length === 0) {
    throw new Error(`${name} is required`);
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < options.min) {
    throw new Error(`${name} must be an integer >= ${options.min}`);
  }

  if (options.max !== undefined && value > options.max) {
    throw new Error(`${name} must be <= ${options.max}`);
  }

  return value;
}

function validateUrl(value: string, name: string): string {
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

export function loadRouterConfig(env: NodeJS.ProcessEnv = process.env): RouterConfig {
  const stableWeight = readNumber(env, "STABLE_WEIGHT", {
    defaultValue: 100,
    min: 0,
    max: 100
  });
  const candidateWeight = readNumber(env, "CANDIDATE_WEIGHT", {
    defaultValue: 0,
    min: 0,
    max: 100
  });

  if (stableWeight + candidateWeight !== 100) {
    throw new Error("STABLE_WEIGHT and CANDIDATE_WEIGHT must sum to 100");
  }

  return {
    port: readNumber(env, "PORT", { defaultValue: 8080, min: 1, max: 65535 }),
    host: env.HOST ?? "0.0.0.0",
    stableUrl: validateUrl(readRequiredString(env, "STABLE_URL"), "STABLE_URL"),
    candidateUrl: validateUrl(
      readRequiredString(env, "CANDIDATE_URL"),
      "CANDIDATE_URL"
    ),
    stableRevisionId: env.STABLE_REVISION_ID ?? "stable",
    candidateRevisionId: env.CANDIDATE_REVISION_ID ?? "candidate",
    stableWeight,
    candidateWeight,
    upstreamTimeoutMs: readNumber(env, "UPSTREAM_TIMEOUT_MS", {
      defaultValue: 2000,
      min: 1
    })
  };
}

