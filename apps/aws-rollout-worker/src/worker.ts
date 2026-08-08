import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { ECSClient } from "@aws-sdk/client-ecs";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  AlbTrafficRouter,
  CloudWatchMetricsProvider,
  EcsRuntimeProvider
} from "@rollout-guard/aws-adapters";
import {
  createDatabasePool,
  PostgresDeploymentRepository,
  runMigrations
} from "@rollout-guard/database";
import {
  DeploymentReconciler,
  handleReconcileFailure
} from "@rollout-guard/rollout-worker";
import { loadAwsWorkerConfig } from "./config.js";
import { awsRolloutPolicy } from "./policy.js";

const config = loadAwsWorkerConfig();
await runMigrations(config.databaseUrl);
const pool = createDatabasePool(config.databaseUrl);
const deployments = new PostgresDeploymentRepository(pool);
const ecs = new ECSClient({ region: config.region });
const elb = new ElasticLoadBalancingV2Client({ region: config.region });
const cloudWatch = new CloudWatchClient({ region: config.region });
const revisions = {
  [config.stableRevisionId]: {
    serviceName: config.stableService,
    targetGroupArn: config.stableTargetGroupArn
  },
  [config.candidateRevisionId]: {
    serviceName: config.candidateService,
    targetGroupArn: config.candidateTargetGroupArn
  }
};
const runtime = new EcsRuntimeProvider(ecs, elb, {
  cluster: config.cluster,
  revisions
});
const traffic = new AlbTrafficRouter(elb, {
  listenerArn: config.listenerArn,
  stableTargetGroupArn: config.stableTargetGroupArn,
  candidateTargetGroupArn: config.candidateTargetGroupArn
});
const metrics = new CloudWatchMetricsProvider(cloudWatch, {
  revisions: {
    [config.stableRevisionId]: {
      loadBalancer: config.loadBalancerDimension,
      targetGroup: config.stableTargetGroupDimension
    },
    [config.candidateRevisionId]: {
      loadBalancer: config.loadBalancerDimension,
      targetGroup: config.candidateTargetGroupDimension
    }
  }
});
const reconciler = new DeploymentReconciler({
  deployments,
  runtime,
  traffic,
  metrics,
  policy: awsRolloutPolicy
});
let stopping = false;

function log(
  level: "info" | "error",
  message: string,
  details: Record<string, unknown> = {}
): void {
  const entry = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...details
  });
  level === "error" ? console.error(entry) : console.log(entry);
}

async function poll(): Promise<void> {
  const activeDeployments = await deployments.listActiveDeployments();
  for (const deployment of activeDeployments) {
    try {
      const result = await reconciler.reconcile(deployment.id);
      log("info", "AWS deployment reconciled", {
        deploymentId: deployment.id,
        result
      });
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      const retryOutcome = await handleReconcileFailure({
        deployment,
        error: normalized,
        deployments,
        reconciler,
        policy: {
          maximumAttempts: config.maximumRetryAttempts,
          maximumRollbackAttempts: config.maximumRollbackAttempts,
          baseDelayMs: config.retryBaseDelayMs,
          maximumDelayMs: config.retryMaximumDelayMs
        }
      });
      log("error", "AWS deployment reconciliation failed", {
        deploymentId: deployment.id,
        error: normalized.message,
        retryOutcome
      });
    }
  }
}

async function run(): Promise<void> {
  log("info", "AWS rollout worker started", {
    region: config.region,
    cluster: config.cluster
  });
  while (!stopping) {
    try {
      await poll();
    } catch (error) {
      log("error", "AWS rollout poll failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, config.pollIntervalMs)
    );
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  log("info", "AWS rollout worker stopping", { signal });
  ecs.destroy();
  elb.destroy();
  cloudWatch.destroy();
  await pool.end();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
await run();
