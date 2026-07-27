import {
  createDatabasePool,
  PostgresDeploymentRepository,
  runMigrations
} from "@rollout-guard/database";
import { HttpRuntimeProvider, HttpTrafficRouter } from "./adapters.js";
import { loadWorkerConfig } from "./config.js";
import { DeploymentReconciler } from "./reconciler.js";
import { handleReconcileFailure } from "./reliability.js";

const config = loadWorkerConfig();
await runMigrations(config.databaseUrl);
const pool = createDatabasePool(config.databaseUrl);
const deployments = new PostgresDeploymentRepository(pool);
const runtime = new HttpRuntimeProvider(
  {
    [config.stableRevisionId]: config.stableUrl,
    [config.candidateRevisionId]: config.candidateUrl
  },
  config.httpTimeoutMs
);
const traffic = new HttpTrafficRouter(config.routerUrl, config.httpTimeoutMs);
const reconciler = new DeploymentReconciler({
  deployments,
  runtime,
  traffic,
  metrics: traffic
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
  if (level === "error") {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

async function poll(): Promise<void> {
  const activeDeployments = await deployments.listActiveDeployments();
  for (const deployment of activeDeployments) {
    try {
      const result = await reconciler.reconcile(deployment.id);
      log("info", "deployment reconciled", {
        deploymentId: deployment.id,
        result
      });
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      const retryOutcome = await handleReconcileFailure({
        deployment,
        error: normalizedError,
        deployments,
        reconciler,
        policy: {
          maximumAttempts: config.maximumRetryAttempts,
          maximumRollbackAttempts: config.maximumRollbackAttempts,
          baseDelayMs: config.retryBaseDelayMs,
          maximumDelayMs: config.retryMaximumDelayMs
        }
      });
      log("error", "deployment reconciliation failed", {
        deploymentId: deployment.id,
        error: normalizedError.message,
        retryOutcome
      });
    }
  }
}

async function run(): Promise<void> {
  log("info", "rollout worker started");
  while (!stopping) {
    try {
      await poll();
    } catch (error) {
      log("error", "rollout poll failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, config.pollIntervalMs);
    });
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  log("info", "rollout worker stopping", { signal });
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await run();
