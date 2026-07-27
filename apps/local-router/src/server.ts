import { buildLocalRouter } from "./app.js";
import { loadRouterConfig } from "./env.js";

const config = loadRouterConfig();
const app = buildLocalRouter(config);

const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, "shutting down local router");
  await app.close();
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await app.listen({ port: config.port, host: config.host });

