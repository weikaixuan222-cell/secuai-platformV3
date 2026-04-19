import { query, type QueryExecutor } from "../db/client.js";
import type { CreateSiteInput, SiteRow, UpdateSiteInput } from "../db/types.js";

function getExecutor(executor?: QueryExecutor): QueryExecutor {
  return executor ?? { query };
}

export async function createSite(
  input: CreateSiteInput,
  executor?: QueryExecutor
): Promise<SiteRow> {
  const result = await getExecutor(executor).query<SiteRow>(
    `
      INSERT INTO sites (tenant_id, name, domain, ingestion_key_hash, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [
      input.tenantId,
      input.name,
      input.domain,
      input.ingestionKeyHash,
      input.status ?? "active"
    ]
  );

  return result.rows[0];
}

export async function findSiteById(siteId: string): Promise<SiteRow | null> {
  const result = await query<SiteRow>(
    `
      SELECT *
      FROM sites
      WHERE id = $1
      LIMIT 1
    `,
    [siteId]
  );

  return result.rows[0] ?? null;
}

export async function listSitesByTenant(tenantId: string): Promise<SiteRow[]> {
  const result = await query<SiteRow>(
    `
      SELECT *
      FROM sites
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `,
    [tenantId]
  );

  return result.rows;
}

export async function updateSiteById(
  siteId: string,
  input: UpdateSiteInput,
  executor?: QueryExecutor
): Promise<SiteRow | null> {
  const result = await getExecutor(executor).query<SiteRow>(
    `
      UPDATE sites
      SET
        name = $2,
        domain = $3,
        status = $4,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [siteId, input.name, input.domain, input.status]
  );

  return result.rows[0] ?? null;
}

export async function deleteSiteById(
  siteId: string,
  executor?: QueryExecutor
): Promise<SiteRow | null> {
  const result = await getExecutor(executor).query<SiteRow>(
    `
      DELETE FROM sites
      WHERE id = $1
      RETURNING *
    `,
    [siteId]
  );

  return result.rows[0] ?? null;
}
