export type RecordStatus = "active" | "inactive";
export type UserStatus = "active" | "disabled";
export type TenantRole = "owner" | "admin" | "member";
export type AttackSeverity = "low" | "medium" | "high" | "critical";
export type AttackStatus = "open" | "reviewed" | "resolved";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type SecurityPolicyMode = "monitor" | "protect";
export type BlockedEntityType = "ip";
export type BlockedEntitySource = "manual" | "automatic";

export interface UserSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  last_used_at: Date | null;
  created_at: Date;
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: RecordStatus;
  created_at: Date;
  updated_at: Date;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  status: UserStatus;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TenantUserRow {
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  created_at: Date;
}

export interface TenantMembershipRow {
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: RecordStatus;
}

export interface SiteRow {
  id: string;
  tenant_id: string;
  name: string;
  domain: string;
  ingestion_key_hash: string;
  status: RecordStatus;
  created_at: Date;
  updated_at: Date;
}

export interface SecurityPolicyRow {
  site_id: string;
  mode: SecurityPolicyMode;
  block_sql_injection: boolean;
  block_xss: boolean;
  block_suspicious_user_agent: boolean;
  enable_rate_limit: boolean;
  rate_limit_threshold: number;
  auto_block_high_risk: boolean;
  high_risk_score_threshold: string;
  created_at: Date;
  updated_at: Date;
}

export interface BlockedEntityRow {
  id: number;
  site_id: string;
  entity_type: BlockedEntityType;
  entity_value: string;
  reason: string;
  source: BlockedEntitySource;
  expires_at: Date | null;
  created_at: Date;
}

export interface RequestLogRow {
  id: number;
  tenant_id: string;
  site_id: string;
  external_request_id: string | null;
  occurred_at: Date;
  method: string;
  scheme: string;
  host: string;
  path: string;
  query_string: string | null;
  status_code: number | null;
  client_ip: string | null;
  country_code: string | null;
  user_agent: string | null;
  referer: string | null;
  request_size_bytes: number | null;
  response_size_bytes: number | null;
  latency_ms: number | null;
  headers: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ingest_source: string;
  processed_for_detection: boolean;
  created_at: Date;
}

export interface AttackEventRow {
  id: number;
  tenant_id: string;
  site_id: string;
  request_log_id: number;
  event_type: string;
  rule_code: string;
  severity: AttackSeverity;
  status: AttackStatus;
  detected_at: Date;
  summary: string;
  details: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface AiRiskResultRow {
  id: number;
  tenant_id: string;
  site_id: string;
  request_log_id: number | null;
  attack_event_id: number | null;
  model_name: string;
  model_version: string;
  risk_score: string;
  risk_level: RiskLevel;
  explanation: string | null;
  factors: Record<string, unknown> | null;
  raw_response: Record<string, unknown> | null;
  analyzed_at: Date;
  created_at: Date;
}

export interface CreateRequestLogInput {
  tenantId: string;
  siteId: string;
  occurredAt: Date;
  method: string;
  host: string;
  path: string;
  externalRequestId?: string;
  queryString?: string;
  statusCode?: number;
  clientIp?: string;
  countryCode?: string;
  userAgent?: string;
  referer?: string;
  requestSizeBytes?: number;
  responseSizeBytes?: number;
  latencyMs?: number;
  headers?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ingestSource?: string;
  scheme?: string;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  status?: RecordStatus;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
  status?: UserStatus;
}

export interface AddTenantUserInput {
  tenantId: string;
  userId: string;
  role?: TenantRole;
}

export interface CreateUserSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface CreateSiteInput {
  tenantId: string;
  name: string;
  domain: string;
  ingestionKeyHash: string;
  status?: RecordStatus;
}

export interface UpsertSecurityPolicyInput {
  siteId: string;
  mode: SecurityPolicyMode;
  blockSqlInjection: boolean;
  blockXss: boolean;
  blockSuspiciousUserAgent: boolean;
  enableRateLimit: boolean;
  rateLimitThreshold: number;
  autoBlockHighRisk: boolean;
  highRiskScoreThreshold: number;
}

export interface CreateBlockedEntityInput {
  siteId: string;
  entityType: BlockedEntityType;
  entityValue: string;
  reason: string;
  source?: BlockedEntitySource;
  expiresAt?: Date;
}

export interface CreateAttackEventInput {
  tenantId: string;
  siteId: string;
  requestLogId: number;
  eventType: string;
  ruleCode: string;
  severity: AttackSeverity;
  summary: string;
  details?: Record<string, unknown>;
}

export interface CreateAiRiskResultInput {
  tenantId: string;
  siteId: string;
  requestLogId?: number;
  attackEventId?: number;
  riskScore: number;
  riskLevel: RiskLevel;
  explanation?: string;
  factors?: Record<string, unknown>;
  rawResponse?: Record<string, unknown>;
}

export interface AttackEventListFilters {
  tenantId: string;
  siteId?: string;
  status?: AttackStatus;
  limit?: number;
}

export interface AiRiskResultListFilters {
  tenantId: string;
  siteId?: string;
  riskLevel?: RiskLevel;
  startAt?: Date;
  endAt?: Date;
  limit?: number;
}

export interface RequestLogListFilters {
  tenantId: string;
  siteId?: string;
  clientIp?: string;
  method?: string;
  statusCode?: number;
  startAt?: Date;
  endAt?: Date;
  processedForDetection?: boolean;
  limit?: number;
}

export interface PendingRequestLogsFilters {
  tenantIds: string[];
  limit?: number;
}

export interface HeuristicAnalyzerResult {
  riskScore: number;
  riskLevel: RiskLevel;
  reasons: string[];
}
