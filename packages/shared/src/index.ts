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

export interface AttackEventDetailResponse {
  attackEvent: AttackEventDetailItem;
  requestLog: AttackEventRequestLogItem;
  aiRiskResult: Omit<AiRiskResultItem, "tenantId" | "siteId" | "requestLogId" | "attackEventId"> | null;
}
