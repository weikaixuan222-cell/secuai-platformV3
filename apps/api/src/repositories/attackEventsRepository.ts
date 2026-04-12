import { query, type QueryExecutor } from "../db/client.js";
import type { AttackEventListFilters, AttackEventRow, CreateAttackEventInput } from "../db/types.js";

function getExecutor(executor?: QueryExecutor): QueryExecutor {
  return executor ?? { query };
}

export async function createAttackEvent(
  input: CreateAttackEventInput,
  executor?: QueryExecutor
): Promise<{ attackEvent: AttackEventRow; created: boolean }> {
  const activeExecutor = getExecutor(executor);
  const insertedResult = await activeExecutor.query<AttackEventRow>(
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
      ON CONFLICT (request_log_id, event_type, rule_code)
      DO NOTHING
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

  if (insertedResult.rows[0]) {
    return {
      attackEvent: insertedResult.rows[0],
      created: true
    };
  }

  const existingResult = await activeExecutor.query<AttackEventRow>(
    `
      SELECT *
      FROM attack_events
      WHERE request_log_id = $1
        AND event_type = $2
        AND rule_code = $3
      LIMIT 1
    `,
    [input.requestLogId, input.eventType, input.ruleCode]
  );

  if (!existingResult.rows[0]) {
    throw new Error("Failed to read existing attack_event after duplicate detection deduplication.");
  }

  return {
    attackEvent: existingResult.rows[0],
    created: false
  };
}

export async function listAttackEvents(filters: AttackEventListFilters): Promise<AttackEventRow[]> {
  const safeLimit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const values: Array<string | number | Date> = [filters.tenantId];
  const conditions = ["tenant_id = $1"];

  if (filters.siteId) {
    values.push(filters.siteId);
    conditions.push(`site_id = $${values.length}`);
  }

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`status = $${values.length}`);
  }

  if (filters.eventType) {
    values.push(filters.eventType);
    conditions.push(`event_type = $${values.length}`);
  }

  if (filters.severity) {
    values.push(filters.severity);
    conditions.push(`severity = $${values.length}`);
  }

  if (filters.startAt) {
    values.push(filters.startAt);
    conditions.push(`detected_at >= $${values.length}`);
  }

  if (filters.endAt) {
    values.push(filters.endAt);
    conditions.push(`detected_at <= $${values.length}`);
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
