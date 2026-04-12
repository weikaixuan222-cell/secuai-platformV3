import { query } from "../db/client.js";
import type {
  AiRiskResultListFilters,
  AiRiskResultRow,
  CreateAiRiskResultInput
} from "../db/types.js";
import { AI_RISK_MODEL_NAME, AI_RISK_MODEL_VERSION } from "../lib/aiRiskResults.js";

function validateTarget(input: CreateAiRiskResultInput): void {
  if (!input.requestLogId && !input.attackEventId) {
    throw new Error("AI risk results must target a request log or an attack event.");
  }
}

export async function createAiRiskResult(input: CreateAiRiskResultInput): Promise<AiRiskResultRow> {
  validateTarget(input);

  const values = [
    input.tenantId,
    input.siteId,
    input.requestLogId ?? null,
    input.attackEventId ?? null,
    AI_RISK_MODEL_NAME,
    AI_RISK_MODEL_VERSION,
    input.riskScore,
    input.riskLevel,
    input.explanation ?? null,
    input.factors ?? null,
    input.rawResponse ?? null
  ];

  const result = input.attackEventId
    ? await query<AiRiskResultRow>(
        `
          INSERT INTO ai_risk_results (
            tenant_id,
            site_id,
            request_log_id,
            attack_event_id,
            model_name,
            model_version,
            risk_score,
            risk_level,
            explanation,
            factors,
            raw_response
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (attack_event_id, model_name, model_version)
          WHERE attack_event_id IS NOT NULL
          DO UPDATE SET
            tenant_id = EXCLUDED.tenant_id,
            site_id = EXCLUDED.site_id,
            request_log_id = EXCLUDED.request_log_id,
            risk_score = EXCLUDED.risk_score,
            risk_level = EXCLUDED.risk_level,
            explanation = EXCLUDED.explanation,
            factors = EXCLUDED.factors,
            raw_response = EXCLUDED.raw_response,
            analyzed_at = NOW()
          RETURNING *
        `,
        values
      )
    : await query<AiRiskResultRow>(
        `
          INSERT INTO ai_risk_results (
            tenant_id,
            site_id,
            request_log_id,
            attack_event_id,
            model_name,
            model_version,
            risk_score,
            risk_level,
            explanation,
            factors,
            raw_response
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `,
        values
      );

  return result.rows[0];
}

export async function findLatestRiskResultForAttackEvent(
  attackEventId: number
): Promise<AiRiskResultRow | null> {
  const result = await query<AiRiskResultRow>(
    `
      SELECT *
      FROM ai_risk_results
      WHERE attack_event_id = $1
      ORDER BY analyzed_at DESC
      LIMIT 1
    `,
    [attackEventId]
  );

  return result.rows[0] ?? null;
}

export async function listAiRiskResults(
  filters: AiRiskResultListFilters
): Promise<AiRiskResultRow[]> {
  const safeLimit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const values: Array<string | number | Date> = [filters.tenantId];
  const conditions = ["tenant_id = $1"];

  if (filters.siteId) {
    values.push(filters.siteId);
    conditions.push(`site_id = $${values.length}`);
  }

  if (filters.riskLevel) {
    values.push(filters.riskLevel);
    conditions.push(`risk_level = $${values.length}`);
  }

  if (filters.requestLogId) {
    values.push(filters.requestLogId);
    conditions.push(`request_log_id = $${values.length}`);
  }

  if (filters.attackEventId) {
    values.push(filters.attackEventId);
    conditions.push(`attack_event_id = $${values.length}`);
  }

  if (filters.startAt) {
    values.push(filters.startAt);
    conditions.push(`created_at >= $${values.length}`);
  }

  if (filters.endAt) {
    values.push(filters.endAt);
    conditions.push(`created_at <= $${values.length}`);
  }

  values.push(safeLimit);

  const result = await query<AiRiskResultRow>(
    `
      SELECT *
      FROM ai_risk_results
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return result.rows;
}
