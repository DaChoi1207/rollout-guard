import { buildDemoService } from "./app.js";
import { loadDemoServiceConfig } from "./env.js";

const config = loadDemoServiceConfig();
const app = buildDemoService(config);

const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, "shutting down demo service");
  await app.close();
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await app.listen({ port: config.port, host: config.host });

