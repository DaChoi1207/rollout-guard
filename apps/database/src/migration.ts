import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabasePool } from "./pool.js";

export async function runMigrations(databaseUrl: string): Promise<void> {
  const migrationPath = fileURLToPath(
    new URL("../migrations/001_initial_schema.sql", import.meta.url)
  );
  const sql = await readFile(migrationPath, "utf8");
  const pool = createDatabasePool(databaseUrl);

  try {
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}
