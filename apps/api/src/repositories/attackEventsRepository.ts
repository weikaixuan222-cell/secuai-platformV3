import { query, type QueryExecutor } from "../db/client.js";
import type { AttackEventListFilters, AttackEventRow, CreateAttackEventInput } from "../db/types.js";

function getExecutor(executor?: QueryExecutor): QueryExecutor {
  return executor ?? { query };
}

export async function createAttackEvent(
  input: CreateAttackEventInput,
  executor?: QueryExecutor
): Promise<AttackEventRow> {
  const result = await getExecutor(executor).query<AttackEventRow>(
    `
      INSERT INTO attack_events (
        tenant_id,
        site_id,
        request_log_id,
        event_type,
        rule_code,
        severity,
        summary,
        details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      input.tenantId,
      input.siteId,
      input.requestLogId,
      input.eventType,
      input.ruleCode,
      input.severity,
      input.summary,
      input.details ?? null
    ]
  );

  return result.rows[0];
}

export async function listAttackEvents(filters: AttackEventListFilters): Promise<AttackEventRow[]> {
  const safeLimit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const values: Array<string | number> = [filters.tenantId];
  const conditions = ["tenant_id = $1"];

  if (filters.siteId) {
    values.push(filters.siteId);
    conditions.push(`site_id = $${values.length}`);
  }

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`status = $${values.length}`);
  }

  values.push(safeLimit);

  const result = await query<AttackEventRow>(
    `
      SELECT *
      FROM attack_events
      WHERE ${conditions.join(" AND ")}
      ORDER BY detected_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows;
}

export async function findAttackEventById(id: number): Promise<AttackEventRow | null> {
  const result = await query<AttackEventRow>(
    `
      SELECT *
      FROM attack_events
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function hasRecentAttackEventForClient(input: {
  siteId: string;
  eventType: string;
  clientIp: string;
  referenceTime: Date;
  windowSeconds: number;
}): Promise<boolean> {
  const result = await query<{ event_exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM attack_events
        WHERE site_id = $1
          AND event_type = $2
          AND details->>'clientIp' = $3
          AND detected_at >= ($4::timestamptz - ($5::text || ' seconds')::interval)
      ) AS event_exists
    `,
    [
      input.siteId,
      input.eventType,
      input.clientIp,
      input.referenceTime.toISOString(),
      String(input.windowSeconds)
    ]
  );

  return Boolean(result.rows[0]?.event_exists);
}
