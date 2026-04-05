import { query } from "../db/client.js";
import type {
  RecentHighRiskEventListFilters,
  RecentHighRiskEventRow,
  SiteDashboardSummaryFilters,
  SiteDashboardSummaryRow
} from "../db/types.js";

export async function listSiteDashboardSummaries(
  filters: SiteDashboardSummaryFilters
): Promise<SiteDashboardSummaryRow[]> {
  const values: Array<string | Date> = [filters.tenantId];
  let startAtPlaceholder = "";
  let endAtPlaceholder = "";

  if (filters.startAt) {
    values.push(filters.startAt);
    startAtPlaceholder = `$${values.length}`;
  }

  if (filters.endAt) {
    values.push(filters.endAt);
    endAtPlaceholder = `$${values.length}`;
  }

  const requestLogJoinConditions = ["rl.site_id = s.id"];
  const attackEventJoinConditions = ["ae.site_id = s.id"];
  const aiRiskResultJoinConditions = ["arr.site_id = s.id"];

  if (startAtPlaceholder) {
    requestLogJoinConditions.push(`rl.occurred_at >= ${startAtPlaceholder}`);
    attackEventJoinConditions.push(`ae.detected_at >= ${startAtPlaceholder}`);
    aiRiskResultJoinConditions.push(`arr.created_at >= ${startAtPlaceholder}`);
  }

  if (endAtPlaceholder) {
    requestLogJoinConditions.push(`rl.occurred_at <= ${endAtPlaceholder}`);
    attackEventJoinConditions.push(`ae.detected_at <= ${endAtPlaceholder}`);
    aiRiskResultJoinConditions.push(`arr.created_at <= ${endAtPlaceholder}`);
  }

  const siteCondition = filters.siteId ? `AND s.id = $${values.length + 1}` : "";

  if (filters.siteId) {
    values.push(filters.siteId);
  }

  const result = await query<SiteDashboardSummaryRow>(
    `
      SELECT
        s.id AS site_id,
        s.name AS site_name,
        s.domain AS site_domain,
        COUNT(DISTINCT rl.id)::text AS request_log_count,
        COUNT(DISTINCT ae.id)::text AS attack_event_count,
        COUNT(DISTINCT arr.id)::text AS ai_risk_result_count,
        COUNT(DISTINCT arr.id) FILTER (
          WHERE arr.risk_level IN ('high', 'critical')
        )::text AS high_risk_result_count,
        MAX(rl.occurred_at) AS latest_request_log_at,
        MAX(ae.detected_at) AS latest_attack_event_at,
        MAX(arr.created_at) AS latest_ai_risk_result_at
      FROM sites s
      LEFT JOIN request_logs rl ON ${requestLogJoinConditions.join(" AND ")}
      LEFT JOIN attack_events ae ON ${attackEventJoinConditions.join(" AND ")}
      LEFT JOIN ai_risk_results arr ON ${aiRiskResultJoinConditions.join(" AND ")}
      WHERE s.tenant_id = $1
        ${siteCondition}
      GROUP BY s.id, s.name, s.domain, s.created_at
      ORDER BY s.created_at DESC
    `,
    values
  );

  return result.rows;
}

export async function listRecentHighRiskEvents(
  filters: RecentHighRiskEventListFilters
): Promise<RecentHighRiskEventRow[]> {
  const safeLimit = Math.min(Math.max(filters.limit ?? 20, 1), 200);
  const safeOffset = Math.min(Math.max(filters.offset ?? 0, 0), 10000);
  const values: Array<string | number> = [filters.tenantId];
  const conditions = ["ae.tenant_id = $1", "latest_risk.risk_level IN ('high', 'critical')"];

  if (filters.siteId) {
    values.push(filters.siteId);
    conditions.push(`ae.site_id = $${values.length}`);
  }

  values.push(safeLimit);
  values.push(safeOffset);

  const result = await query<RecentHighRiskEventRow>(
    `
      SELECT
        ae.id AS attack_event_id,
        ae.site_id,
        s.name AS site_name,
        s.domain AS site_domain,
        ae.request_log_id,
        ae.event_type,
        ae.severity,
        ae.status,
        ae.summary,
        ae.detected_at,
        latest_risk.risk_score,
        latest_risk.risk_level,
        rl.client_ip::text AS client_ip,
        rl.path,
        rl.occurred_at
      FROM attack_events ae
      INNER JOIN sites s ON s.id = ae.site_id
      INNER JOIN request_logs rl ON rl.id = ae.request_log_id
      INNER JOIN LATERAL (
        SELECT arr.risk_score, arr.risk_level, arr.analyzed_at, arr.id
        FROM ai_risk_results arr
        WHERE arr.attack_event_id = ae.id
        ORDER BY arr.analyzed_at DESC, arr.id DESC
        LIMIT 1
      ) AS latest_risk ON TRUE
      WHERE ${conditions.join(" AND ")}
      ORDER BY latest_risk.analyzed_at DESC, latest_risk.id DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `,
    values
  );

  return result.rows;
}
