import pg from "pg";

const { Pool } = pg;

export function createDatabasePool(databaseUrl: string): pg.Pool {
  if (databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL is required");
  }

  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000
  });
}
