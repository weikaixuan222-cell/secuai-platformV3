import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPool } from "./client.js";

async function main(): Promise<void> {
  const pool = getPool();
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirectoryPath = path.dirname(currentFilePath);
  const schemaPath = path.resolve(currentDirectoryPath, "../../db/schema.sql");
  const schemaSql = await readFile(schemaPath, "utf8");

  try {
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
