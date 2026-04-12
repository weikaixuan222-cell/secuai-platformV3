import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPool } from "./client.js";

const DB_READY_TIMEOUT_MS = 30_000;
const DB_READY_POLL_INTERVAL_MS = 500;

function isTransientDatabaseConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    "code" in error &&
    (error.code === "ECONNREFUSED" ||
      error.code === "ECONNRESET" ||
      error.code === "ENOTFOUND" ||
      error.code === "EHOSTUNREACH")
  );
}

async function waitForDatabaseReady(timeoutMs: number): Promise<void> {
  const pool = getPool();
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await pool.query("select 1");
      return;
    } catch (error) {
      lastError = error;

      if (!isTransientDatabaseConnectionError(error)) {
        throw error;
      }

      await new Promise((resolveDelay) => setTimeout(resolveDelay, DB_READY_POLL_INTERVAL_MS));
    }
  }

  throw new Error(
    `Database did not become ready within ${timeoutMs} ms.`,
    {
      cause: lastError instanceof Error ? lastError : undefined
    }
  );
}

async function main(): Promise<void> {
  const pool = getPool();
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirectoryPath = path.dirname(currentFilePath);
  const schemaPath = path.resolve(currentDirectoryPath, "../../db/schema.sql");
  const schemaSql = await readFile(schemaPath, "utf8");

  try {
    await waitForDatabaseReady(DB_READY_TIMEOUT_MS);
    await pool.query(schemaSql);
    console.log(`Applied database schema from ${schemaPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Failed to apply database schema.");
  console.error(error);
  process.exitCode = 1;
});
