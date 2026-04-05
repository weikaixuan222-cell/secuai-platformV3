export type SecurityPolicyMode = 'monitor' | 'protect';

export type BlockedEntityType = 'ip';

export type BlockedEntitySource = 'manual' | 'automatic';

export interface SecurityPolicyItem {
  siteId: string;
  mode: SecurityPolicyMode;
  blockSqlInjection: boolean;
  blockXss: boolean;
  blockSuspiciousUserAgent: boolean;
  enableRateLimit: boolean;
  rateLimitThreshold: number;
  autoBlockHighRisk: boolean;
  highRiskScoreThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityPolicyResponse {
  securityPolicy: SecurityPolicyItem;
}

export interface UpdateSecurityPolicyInput {
  mode: SecurityPolicyMode;
  blockSqlInjection: boolean;
  blockXss: boolean;
  blockSuspiciousUserAgent: boolean;
  enableRateLimit: boolean;
  rateLimitThreshold: number;
  autoBlockHighRisk: boolean;
  highRiskScoreThreshold: number;
}

export interface BlockedEntityItem {
  id: number;
  siteId: string;
  entityType: BlockedEntityType;
  entityValue: string;
  reason: string;
  source: BlockedEntitySource;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateBlockedEntityInput {
  entityType: BlockedEntityType;
  entityValue: string;
  reason: string;
  source?: BlockedEntitySource;
  expiresAt?: string | null;
}

export interface BlockedEntityResponse {
  blockedEntity: BlockedEntityItem;
}

export interface DeleteBlockedEntityResponse {
  deleted: boolean;
  blockedEntity: BlockedEntityItem;
}
