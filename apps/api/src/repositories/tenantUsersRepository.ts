import { query } from "../db/client.js";
import type { AddTenantUserInput, TenantMembershipRow, TenantUserRow } from "../db/types.js";

export async function addTenantUser(input: AddTenantUserInput): Promise<TenantUserRow> {
  const result = await query<TenantUserRow>(
    `
      INSERT INTO tenant_users (tenant_id, user_id, role)
      VALUES ($1, $2, $3)
      RETURNING *
    `,
    [input.tenantId, input.userId, input.role ?? "member"]
  );

  return result.rows[0];
}

export async function listTenantUsers(tenantId: string): Promise<TenantUserRow[]> {
  const result = await query<TenantUserRow>(
    `
      SELECT *
      FROM tenant_users
      WHERE tenant_id = $1
      ORDER BY created_at ASC
    `,
    [tenantId]
  );

  return result.rows;
}

export async function listTenantMembershipsByUserId(userId: string): Promise<TenantMembershipRow[]> {
  const result = await query<TenantMembershipRow>(
    `
      SELECT
        tu.tenant_id,
        tu.user_id,
        tu.role,
        t.name AS tenant_name,
        t.slug AS tenant_slug,
        t.status AS tenant_status
      FROM tenant_users tu
      INNER JOIN tenants t
        ON t.id = tu.tenant_id
      WHERE tu.user_id = $1
      ORDER BY t.created_at ASC
    `,
    [userId]
  );

  return result.rows;
}

export async function findTenantMembership(
  userId: string,
  tenantId: string
): Promise<TenantMembershipRow | null> {
  const result = await query<TenantMembershipRow>(
    `
      SELECT
        tu.tenant_id,
        tu.user_id,
        tu.role,
        t.name AS tenant_name,
        t.slug AS tenant_slug,
        t.status AS tenant_status
      FROM tenant_users tu
      INNER JOIN tenants t
        ON t.id = tu.tenant_id
      WHERE tu.user_id = $1
        AND tu.tenant_id = $2
      LIMIT 1
    `,
    [userId, tenantId]
  );

  return result.rows[0] ?? null;
}
