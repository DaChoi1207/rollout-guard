import {
  createDatabasePool,
  PostgresDeploymentRepository,
  runMigrations
} from "@rollout-guard/database";
import { buildControlApi } from "./app.js";
import { loadControlApiConfig } from "./config.js";
import { HttpRouterClient } from "./router-client.js";
import { ControlPlaneService } from "./service.js";

const config = loadControlApiConfig();
await runMigrations(config.databaseUrl);
const pool = createDatabasePool(config.databaseUrl);
const repository = new PostgresDeploymentRepository(pool);
const router = new HttpRouterClient(config.routerUrl);
const service = new ControlPlaneService(repository, router);
const app = await buildControlApi({
  service,
  dashboardOrigin: config.dashboardOrigin
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "shutting down control API");
  await app.close();
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await app.listen({ port: config.port, host: config.host });
