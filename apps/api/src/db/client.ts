import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { getDatabaseEnvConfig } from "../config/env.js";

let pool: Pool | undefined;

export type QueryExecutor = {
  query<T extends QueryResultRow>(
    text: string,
    values?: ReadonlyArray<unknown>
  ): Promise<QueryResult<T>>;
};

export function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const env = getDatabaseEnvConfig();

  pool = new Pool({
    connectionString: env.databaseUrl,
    ssl: env.dbSslMode === "require" ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30_000
  });

  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: ReadonlyArray<unknown> = []
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, [...values]);
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
