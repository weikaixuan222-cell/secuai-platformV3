import { query } from "../db/client.js";
import type { CreateTenantInput, TenantRow } from "../db/types.js";

export async function createTenant(input: CreateTenantInput): Promise<TenantRow> {
  const result = await query<TenantRow>(
    `
      INSERT INTO tenants (name, slug, status)
      VALUES ($1, $2, $3)
      RETURNING *
    `,
    [input.name, input.slug, input.status ?? "active"]
  );

  return result.rows[0];
}

export async function findTenantBySlug(slug: string): Promise<TenantRow | null> {
  const result = await query<TenantRow>(
    `
      SELECT *
      FROM tenants
      WHERE slug = $1
      LIMIT 1
    `,
    [slug]
  );

  return result.rows[0] ?? null;
}
