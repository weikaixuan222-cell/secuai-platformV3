export type ServiceStatus = "ok" | "degraded";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AttackSeverity = "low" | "medium" | "high" | "critical";

export interface HealthResponse {
  service: string;
  status: ServiceStatus;
}

export interface RequestLogListItem {
  id: number;
  tenantId: string;
  siteId: string;
  occurredAt: string;
  method: string;
  host: string;
  path: string;
  queryString: string | null;
  statusCode: number | null;
  clientIp: string | null;
  userAgent: string | null;
  processedForDetection: boolean;
  createdAt: string;
}

export interface AttackEventListItem {
  id: number;
  tenantId: string;
  siteId: string;
  requestLogId: number;
  eventType: string;
  ruleCode: string;
  severity: AttackSeverity;
  status: "open" | "reviewed" | "resolved";
  summary: string;
  details: Record<string, unknown> | null;
  detectedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttackEventDetailItem {
  id: number;
  tenantId: string;
  siteId: string;
  requestLogId: number;
  eventType: string;
  severity: AttackSeverity;
  summary: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AttackEventRequestLogItem {
  id: number;
  occurredAt: string;
  method: string;
  host: string;
  path: string;
  queryString: string | null;
  statusCode: number | null;
  clientIp: string | null;
  userAgent: string | null;
}

export interface AiRiskResultItem {
  id: number;
  tenantId: string;
  siteId: string;
  requestLogId: number | null;
  attackEventId: number | null;
  modelName: string;
  modelVersion: string;
  riskScore: number;
  riskLevel: RiskLevel;
  explanation: string | null;
  factors: Record<string, unknown> | null;
  rawResponse: Record<string, unknown> | null;
  createdAt: string;
}

export interface EventDispositionBlockedEntityItem {
  id: number;
  siteId: string;
  entityType: "ip";
  entityValue: string;
  reason: string;
  source: "manual" | "automatic";
  attackEventId: number | null;
  originKind: string;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface AttackEventProtectionEnforcement {
  mode: "monitor" | "protect";
  action: "allow" | "monitor" | "block";
  reasons: string[];
  matchedBlockedEntity: {
    id: number;
    entityType: "ip";
    entityValue: string;
    source: "manual" | "automatic";
    attackEventId: number | null;
    originKind: "manual" | "automatic" | "event_disposition";
    expiresAt: string | null;
  } | null;
}

export interface AttackEventDispositionSummary {
  status: "none" | "active" | "inactive";
  blockedEntityCount: number;
  activeBlockedEntityId: number | null;
  activeEntityType: "ip" | null;
  activeEntityValue: string | null;
  activeSource: "manual" | "automatic" | null;
  activeOriginKind: "manual" | "automatic" | "event_disposition" | null;
  activeAttackEventId: number | null;
}

export interface AttackEventDetailResponse {
  attackEvent: AttackEventDetailItem;
  requestLog: AttackEventRequestLogItem;
  aiRiskResult: Omit<AiRiskResultItem, "tenantId" | "siteId" | "requestLogId" | "attackEventId"> | null;
  protectionEnforcement: AttackEventProtectionEnforcement | null;
  blockedEntities: EventDispositionBlockedEntityItem[];
  activeBlockedEntity: EventDispositionBlockedEntityItem | null;
  dispositionSummary: AttackEventDispositionSummary;
}
