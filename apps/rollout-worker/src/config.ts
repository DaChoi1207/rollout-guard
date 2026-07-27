export type WorkerConfig = {
  databaseUrl: string;
  stableRevisionId: string;
  stableUrl: string;
  candidateRevisionId: string;
  candidateUrl: string;
  routerUrl: string;
  pollIntervalMs: number;
  httpTimeoutMs: number;
  maximumRetryAttempts: number;
  maximumRollbackAttempts: number;
  retryBaseDelayMs: number;
  retryMaximumDelayMs: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function url(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number
): number {
  const value = Number(env[name] ?? defaultValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): WorkerConfig {
  return {
    databaseUrl: required(env, "DATABASE_URL"),
    stableRevisionId: env.STABLE_REVISION_ID ?? "v1",
    stableUrl: url(env, "STABLE_URL"),
    candidateRevisionId: env.CANDIDATE_REVISION_ID ?? "v2",
    candidateUrl: url(env, "CANDIDATE_URL"),
    routerUrl: url(env, "ROUTER_URL"),
    pollIntervalMs: positiveInteger(env, "POLL_INTERVAL_MS", 1_000),
    httpTimeoutMs: positiveInteger(env, "HTTP_TIMEOUT_MS", 2_000),
    maximumRetryAttempts: positiveInteger(env, "MAXIMUM_RETRY_ATTEMPTS", 5),
    maximumRollbackAttempts: positiveInteger(
      env,
      "MAXIMUM_ROLLBACK_ATTEMPTS",
      5
    ),
    retryBaseDelayMs: positiveInteger(env, "RETRY_BASE_DELAY_MS", 1_000),
    retryMaximumDelayMs: positiveInteger(
      env,
      "RETRY_MAXIMUM_DELAY_MS",
      30_000
    )
  };
}
