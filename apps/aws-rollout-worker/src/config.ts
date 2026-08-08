export type AwsWorkerConfig = {
  region: string;
  databaseUrl: string;
  cluster: string;
  listenerArn: string;
  loadBalancerDimension: string;
  stableRevisionId: string;
  stableService: string;
  stableTargetGroupArn: string;
  stableTargetGroupDimension: string;
  candidateRevisionId: string;
  candidateService: string;
  candidateTargetGroupArn: string;
  candidateTargetGroupDimension: string;
  pollIntervalMs: number;
  maximumRetryAttempts: number;
  maximumRollbackAttempts: number;
  retryBaseDelayMs: number;
  retryMaximumDelayMs: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
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

export function loadAwsWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): AwsWorkerConfig {
  return {
    region: env.AWS_REGION?.trim() || "us-east-1",
    databaseUrl: required(env, "DATABASE_URL"),
    cluster: required(env, "ECS_CLUSTER"),
    listenerArn: required(env, "ALB_LISTENER_ARN"),
    loadBalancerDimension: required(env, "ALB_LOAD_BALANCER_DIMENSION"),
    stableRevisionId: env.STABLE_REVISION_ID?.trim() || "v1",
    stableService: required(env, "STABLE_ECS_SERVICE"),
    stableTargetGroupArn: required(env, "STABLE_TARGET_GROUP_ARN"),
    stableTargetGroupDimension: required(
      env,
      "STABLE_TARGET_GROUP_DIMENSION"
    ),
    candidateRevisionId: env.CANDIDATE_REVISION_ID?.trim() || "v2",
    candidateService: required(env, "CANDIDATE_ECS_SERVICE"),
    candidateTargetGroupArn: required(env, "CANDIDATE_TARGET_GROUP_ARN"),
    candidateTargetGroupDimension: required(
      env,
      "CANDIDATE_TARGET_GROUP_DIMENSION"
    ),
    pollIntervalMs: positiveInteger(env, "POLL_INTERVAL_MS", 5_000),
    maximumRetryAttempts: positiveInteger(
      env,
      "MAXIMUM_RETRY_ATTEMPTS",
      5
    ),
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
