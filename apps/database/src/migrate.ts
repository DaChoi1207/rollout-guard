import { runMigrations } from "./migration.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

await runMigrations(databaseUrl);
