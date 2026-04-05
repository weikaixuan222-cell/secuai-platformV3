export type ProtectionAction = 'allow' | 'monitor' | 'block';

export type ProtectionReasonCode =
  | 'blocked_ip'
  | 'blocked_sql_injection'
  | 'blocked_xss'
  | 'blocked_suspicious_user_agent'
  | 'blocked_rate_limit';

export interface ProtectionCheckInput {
  siteId: string;
  occurredAt: string;
  method: string;
  host: string;
  path: string;
  queryString?: string;
  clientIp?: string;
  userAgent?: string;
  referer?: string;
}

export interface ProtectionCheckRequest {
  ingestionKey: string;
  input: ProtectionCheckInput;
}

export interface ProtectionCheckResult {
  mode: 'monitor' | 'protect';
  action: ProtectionAction;
  reasons: ProtectionReasonCode[];
}

export interface ProtectionCheckResponse {
  siteId: string;
  protection: ProtectionCheckResult;
}
