import type { BlockedEntityRow, SecurityPolicyRow } from "../db/types.js";
import { findActiveBlockedIpBySiteId } from "../repositories/blockedEntitiesRepository.js";
import { countRecentRequestsBySiteAndIp } from "../repositories/requestLogsRepository.js";
import { findSecurityPolicyBySiteId } from "../repositories/securityPoliciesRepository.js";
import {
  findThreatSignalMatch,
  isSuspiciousUserAgentAllowed,
  SQLI_RULE_TOKENS,
  SUSPICIOUS_USER_AGENTS,
  XSS_RULE_TOKENS
} from "./requestThreatSignals.js";

const RATE_LIMIT_WINDOW_SECONDS = 60;

export type ProtectionAction = "allow" | "monitor" | "block";

export type ProtectionReasonCode =
  | "blocked_ip"
  | "blocked_sql_injection"
  | "blocked_xss"
  | "blocked_suspicious_user_agent"
  | "blocked_rate_limit";

export type ProtectionEnforcementInput = {
  siteId: string;
  occurredAt: Date;
  path: string;
  queryString?: string;
  clientIp?: string;
  userAgent?: string;
  referer?: string;
};

export type ProtectionEnforcementResult = {
  mode: "monitor" | "protect";
  action: ProtectionAction;
  reasons: ProtectionReasonCode[];
  matchedBlockedEntity?: {
    id: number;
    entityType: "ip";
    entityValue: string;
    source: "manual" | "automatic";
    attackEventId: number | null;
    originKind: "manual" | "automatic" | "event_disposition";
    expiresAt: string | null;
  };
};

const DEFAULT_POLICY: Omit<SecurityPolicyRow, "site_id" | "created_at" | "updated_at"> = {
  mode: "monitor",
  block_sql_injection: true,
  block_xss: true,
  block_suspicious_user_agent: true,
  enable_rate_limit: true,
  rate_limit_threshold: 120,
  auto_block_high_risk: false,
  high_risk_score_threshold: "90"
};

async function resolvePolicy(siteId: string): Promise<SecurityPolicyRow> {
  const policy = await findSecurityPolicyBySiteId(siteId);

  if (policy) {
    return policy;
  }

  return {
    site_id: siteId,
    created_at: new Date(),
    updated_at: new Date(),
    ...DEFAULT_POLICY
  };
}

function mapMatchedBlockedEntityTrace(blockedEntity: BlockedEntityRow): NonNullable<
  ProtectionEnforcementResult["matchedBlockedEntity"]
> {
  return {
    id: blockedEntity.id,
    entityType: blockedEntity.entity_type,
    entityValue: blockedEntity.entity_value,
    source: blockedEntity.source,
    attackEventId: blockedEntity.attack_event_id,
    originKind: blockedEntity.attack_event_id
      ? "event_disposition"
      : blockedEntity.source === "automatic"
        ? "automatic"
        : "manual",
    expiresAt: blockedEntity.expires_at ? blockedEntity.expires_at.toISOString() : null
  };
}

export async function evaluateProtectionEnforcement(
  input: ProtectionEnforcementInput
): Promise<ProtectionEnforcementResult> {
  const policy = await resolvePolicy(input.siteId);
  const reasons: ProtectionReasonCode[] = [];
  let matchedBlockedEntity: ProtectionEnforcementResult["matchedBlockedEntity"];
  const textFields = [
    { name: "path", value: input.path },
    { name: "queryString", value: input.queryString },
    { name: "userAgent", value: input.userAgent },
    { name: "referer", value: input.referer }
  ];

  if (input.clientIp) {
    const blockedIp = await findActiveBlockedIpBySiteId(
      input.siteId,
      input.clientIp,
      input.occurredAt
    );

    if (blockedIp) {
      reasons.push("blocked_ip");
      matchedBlockedEntity = mapMatchedBlockedEntityTrace(blockedIp);
    }
  }

  if (policy.block_sql_injection && findThreatSignalMatch(textFields, SQLI_RULE_TOKENS)) {
    reasons.push("blocked_sql_injection");
  }

  if (policy.block_xss && findThreatSignalMatch(textFields, XSS_RULE_TOKENS)) {
    reasons.push("blocked_xss");
  }

  if (
    policy.block_suspicious_user_agent &&
    findThreatSignalMatch([{ name: "userAgent", value: input.userAgent }], SUSPICIOUS_USER_AGENTS) &&
    !isSuspiciousUserAgentAllowed(input.userAgent)
  ) {
    reasons.push("blocked_suspicious_user_agent");
  }

  if (policy.enable_rate_limit && input.clientIp) {
    const recentRequestCount = await countRecentRequestsBySiteAndIp(
      input.siteId,
      input.clientIp,
      input.occurredAt,
      RATE_LIMIT_WINDOW_SECONDS
    );

    if (recentRequestCount >= policy.rate_limit_threshold) {
      reasons.push("blocked_rate_limit");
    }
  }

  return {
    mode: policy.mode,
    action:
      reasons.length === 0 ? "allow" : policy.mode === "protect" ? "block" : "monitor",
    reasons,
    matchedBlockedEntity
  };
}
