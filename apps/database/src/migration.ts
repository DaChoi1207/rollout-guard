import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabasePool } from "./pool.js";

export async function runMigrations(databaseUrl: string): Promise<void> {
  const migrationsDirectory = fileURLToPath(
    new URL("../migrations/", import.meta.url)
  );
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const pool = createDatabasePool(databaseUrl);

  try {
    for (const migrationFile of migrationFiles) {
      const sql = await readFile(
        `${migrationsDirectory}/${migrationFile}`,
        "utf8"
      );
      await pool.query(sql);
    }
  } finally {
    await pool.end();
  }
}
