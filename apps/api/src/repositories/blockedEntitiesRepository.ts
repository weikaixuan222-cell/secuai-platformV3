import { query } from "../db/client.js";
import type { BlockedEntityRow, CreateBlockedEntityInput } from "../db/types.js";

export async function listBlockedEntitiesBySiteId(siteId: string): Promise<BlockedEntityRow[]> {
  const result = await query<BlockedEntityRow>(
    `
      SELECT *
      FROM blocked_entities
      WHERE site_id = $1
      ORDER BY created_at DESC, id DESC
    `,
    [siteId]
  );

  return result.rows;
}

export async function findActiveBlockedIpBySiteId(
  siteId: string,
  clientIp: string,
  referenceTime: Date
): Promise<BlockedEntityRow | null> {
  const result = await query<BlockedEntityRow>(
    `
      SELECT *
      FROM blocked_entities
      WHERE site_id = $1
        AND entity_type = 'ip'
        AND entity_value = $2
        AND (expires_at IS NULL OR expires_at > $3)
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [siteId, clientIp, referenceTime]
  );

  return result.rows[0] ?? null;
}

export async function createBlockedEntity(
  input: CreateBlockedEntityInput
): Promise<BlockedEntityRow> {
  const result = await query<BlockedEntityRow>(
    `
      INSERT INTO blocked_entities (
        site_id,
        entity_type,
        entity_value,
        reason,
        source,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [
      input.siteId,
      input.entityType,
      input.entityValue,
      input.reason,
      input.source ?? "manual",
      input.expiresAt ?? null
    ]
  );

  return result.rows[0];
}

export async function findBlockedEntityById(id: number): Promise<BlockedEntityRow | null> {
  const result = await query<BlockedEntityRow>(
    `
      SELECT *
      FROM blocked_entities
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function deleteBlockedEntityById(id: number): Promise<BlockedEntityRow | null> {
  const result = await query<BlockedEntityRow>(
    `
      DELETE FROM blocked_entities
      WHERE id = $1
      RETURNING *
    `,
    [id]
  );

  return result.rows[0] ?? null;
}
