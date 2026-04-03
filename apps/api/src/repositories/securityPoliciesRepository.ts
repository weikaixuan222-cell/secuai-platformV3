import { query, type QueryExecutor } from "../db/client.js";
import type { SecurityPolicyRow, UpsertSecurityPolicyInput } from "../db/types.js";

function getExecutor(executor?: QueryExecutor): QueryExecutor {
  return executor ?? { query };
}

export async function findSecurityPolicyBySiteId(
  siteId: string
): Promise<SecurityPolicyRow | null> {
  const result = await query<SecurityPolicyRow>(
    `
      SELECT *
      FROM security_policies
      WHERE site_id = $1
      LIMIT 1
    `,
    [siteId]
  );

  return result.rows[0] ?? null;
}

export async function upsertSecurityPolicy(
  input: UpsertSecurityPolicyInput,
  executor?: QueryExecutor
): Promise<SecurityPolicyRow> {
  const result = await getExecutor(executor).query<SecurityPolicyRow>(
    `
      INSERT INTO security_policies (
        site_id,
        mode,
        block_sql_injection,
        block_xss,
        block_suspicious_user_agent,
        enable_rate_limit,
        rate_limit_threshold,
        auto_block_high_risk,
        high_risk_score_threshold,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (site_id)
      DO UPDATE SET
        mode = EXCLUDED.mode,
        block_sql_injection = EXCLUDED.block_sql_injection,
        block_xss = EXCLUDED.block_xss,
        block_suspicious_user_agent = EXCLUDED.block_suspicious_user_agent,
        enable_rate_limit = EXCLUDED.enable_rate_limit,
        rate_limit_threshold = EXCLUDED.rate_limit_threshold,
        auto_block_high_risk = EXCLUDED.auto_block_high_risk,
        high_risk_score_threshold = EXCLUDED.high_risk_score_threshold,
        updated_at = NOW()
      RETURNING *
    `,
    [
      input.siteId,
      input.mode,
      input.blockSqlInjection,
      input.blockXss,
      input.blockSuspiciousUserAgent,
      input.enableRateLimit,
      input.rateLimitThreshold,
      input.autoBlockHighRisk,
      input.highRiskScoreThreshold
    ]
  );

  return result.rows[0];
}
