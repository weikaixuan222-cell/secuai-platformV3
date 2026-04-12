import { query } from "../db/client.js";
import type { BlockedEntityRow, CreateBlockedEntityInput } from "../db/types.js";

export async function listBlockedEntitiesBySiteId(
  siteId: string,
  filters?: { attackEventId?: number }
): Promise<BlockedEntityRow[]> {
  const values: Array<string | number> = [siteId];
  const conditions = ["site_id = $1"];

  if (filters?.attackEventId !== undefined) {
    values.push(filters.attackEventId);
    conditions.push(`attack_event_id = $${values.length}`);
  }

  const result = await query<BlockedEntityRow>(
    `
      SELECT *
      FROM blocked_entities
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC, id DESC
    `,
    values
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
  const source = input.source ?? "manual";
  const isAutomaticActiveIp =
    source === "automatic" &&
    input.entityType === "ip" &&
    input.expiresAt === undefined;

  if (isAutomaticActiveIp) {
    const result = await query<BlockedEntityRow>(
      `
        INSERT INTO blocked_entities (
          site_id,
          entity_type,
          entity_value,
          reason,
          source,
          attack_event_id,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (site_id, entity_type, entity_value)
        WHERE source = 'automatic'
          AND entity_type = 'ip'
          AND expires_at IS NULL
        DO NOTHING
        RETURNING *
      `,
      [
        input.siteId,
        input.entityType,
        input.entityValue,
        input.reason,
        source,
        input.attackEventId ?? null,
        null
      ]
    );

    if (result.rows[0]) {
      return result.rows[0];
    }

    const existingBlockedEntity = await query<BlockedEntityRow>(
      `
        SELECT *
        FROM blocked_entities
        WHERE site_id = $1
          AND entity_type = 'ip'
          AND entity_value = $2
          AND source = 'automatic'
          AND expires_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [input.siteId, input.entityValue]
    );

    if (existingBlockedEntity.rows[0]) {
      return existingBlockedEntity.rows[0];
    }

    throw new Error("Failed to create or reuse the active automatic blocked entity.");
  }

  const result = await query<BlockedEntityRow>(
    `
      INSERT INTO blocked_entities (
        site_id,
        entity_type,
        entity_value,
        reason,
        source,
        attack_event_id,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      input.siteId,
      input.entityType,
      input.entityValue,
      input.reason,
      source,
      input.attackEventId ?? null,
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
