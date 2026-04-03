import { query, type QueryExecutor } from "../db/client.js";
import type {
  CreateRequestLogInput,
  PendingRequestLogsFilters,
  RequestLogListFilters,
  RequestLogRow
} from "../db/types.js";

export async function createRequestLog(input: CreateRequestLogInput): Promise<RequestLogRow> {
  const result = await query<RequestLogRow>(
    `
      INSERT INTO request_logs (
        tenant_id,
        site_id,
        external_request_id,
        occurred_at,
        method,
        scheme,
        host,
        path,
        query_string,
        status_code,
        client_ip,
        country_code,
        user_agent,
        referer,
        request_size_bytes,
        response_size_bytes,
        latency_ms,
        headers,
        metadata,
        ingest_source
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
      RETURNING *
    `,
    [
      input.tenantId,
      input.siteId,
      input.externalRequestId ?? null,
      input.occurredAt,
      input.method,
      input.scheme ?? "https",
      input.host,
      input.path,
      input.queryString ?? null,
      input.statusCode ?? null,
      input.clientIp ?? null,
      input.countryCode ?? null,
      input.userAgent ?? null,
      input.referer ?? null,
      input.requestSizeBytes ?? null,
      input.responseSizeBytes ?? null,
      input.latencyMs ?? null,
      input.headers ?? null,
      input.metadata ?? null,
      input.ingestSource ?? "site_agent"
    ]
  );

  return result.rows[0];
}

export async function listPendingRequestLogs(
  filters: PendingRequestLogsFilters
): Promise<RequestLogRow[]> {
  if (filters.tenantIds.length === 0) {
    return [];
  }

  const safeLimit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const result = await query<RequestLogRow>(
    `
      SELECT *
      FROM request_logs
      WHERE processed_for_detection = FALSE
        AND tenant_id = ANY($1::uuid[])
      ORDER BY occurred_at ASC
      LIMIT $2
    `,
    [filters.tenantIds, safeLimit]
  );

  return result.rows;
}

export async function listRequestLogs(filters: RequestLogListFilters): Promise<RequestLogRow[]> {
  const safeLimit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const values: Array<string | number | boolean | Date> = [filters.tenantId];
  const conditions = ["tenant_id = $1"];

  if (filters.siteId) {
    values.push(filters.siteId);
    conditions.push(`site_id = $${values.length}`);
  }

  if (filters.clientIp) {
    values.push(filters.clientIp);
    conditions.push(`client_ip = $${values.length}::inet`);
  }

  if (filters.method) {
    values.push(filters.method);
    conditions.push(`method = $${values.length}`);
  }

  if (filters.statusCode !== undefined) {
    values.push(filters.statusCode);
    conditions.push(`status_code = $${values.length}`);
  }

  if (filters.startAt) {
    values.push(filters.startAt);
    conditions.push(`occurred_at >= $${values.length}`);
  }

  if (filters.endAt) {
    values.push(filters.endAt);
    conditions.push(`occurred_at <= $${values.length}`);
  }

  if (filters.processedForDetection !== undefined) {
    values.push(filters.processedForDetection);
    conditions.push(`processed_for_detection = $${values.length}`);
  }

  values.push(safeLimit);

  const result = await query<RequestLogRow>(
    `
      SELECT *
      FROM request_logs
      WHERE ${conditions.join(" AND ")}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows;
}

export async function findRequestLogById(id: number): Promise<RequestLogRow | null> {
  const result = await query<RequestLogRow>(
    `
      SELECT *
      FROM request_logs
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function countRecentRequestsBySiteAndIp(
  siteId: string,
  clientIp: string,
  occurredAt: Date,
  windowSeconds = 60
): Promise<number> {
  const result = await query<{ request_count: string }>(
    `
      SELECT COUNT(*)::text AS request_count
      FROM request_logs
      WHERE site_id = $1
        AND client_ip = $2::inet
        AND occurred_at BETWEEN ($3::timestamptz - ($4::text || ' seconds')::interval) AND $3::timestamptz
    `,
    [siteId, clientIp, occurredAt.toISOString(), String(windowSeconds)]
  );

  return Number(result.rows[0]?.request_count ?? 0);
}

export async function markRequestLogProcessed(
  id: number,
  executor?: QueryExecutor
): Promise<void> {
  const activeExecutor = executor ?? { query };

  await activeExecutor.query(
    `
      UPDATE request_logs
      SET processed_for_detection = TRUE
      WHERE id = $1
    `,
    [id]
  );
}
