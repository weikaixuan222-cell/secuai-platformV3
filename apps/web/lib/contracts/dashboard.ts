import type {
  AiRiskResultItem,
  AttackEventDetailResponse,
  AttackEventListItem,
  AttackSeverity,
  RiskLevel
} from '@secuai/shared';

export type {
  AiRiskResultItem,
  AttackEventDetailResponse,
  AttackEventListItem,
  AttackSeverity,
  RiskLevel
} from '@secuai/shared';

export type AttackEventStatus = AttackEventListItem['status'];

export interface ListResponse<TItem> {
  items: TItem[];
}

export interface PaginationWindow {
  limit: number;
  offset: number;
}

export interface RecentHighRiskEventsResponse extends ListResponse<RecentHighRiskEventItem> {
  pagination: PaginationWindow;
}

export interface TenantScopedQuery {
  tenantId?: string;
}

export interface TimeRangeQuery {
  startAt?: string;
  endAt?: string;
}

export interface SiteScopedQuery extends TenantScopedQuery {
  siteId?: string;
}

export interface DashboardSiteSummaryItem {
  siteId: string;
  siteName: string;
  siteDomain: string;
  requestLogCount: number;
  attackEventCount: number;
  aiRiskResultCount: number;
  highRiskResultCount: number;
  latestRequestLogAt: string | null;
  latestAttackEventAt: string | null;
  latestAiRiskResultAt: string | null;
}

export interface RecentHighRiskEventItem {
  attackEventId: number;
  siteId: string;
  siteName: string;
  siteDomain: string;
  requestLogId: number;
  eventType: string;
  severity: AttackSeverity;
  status: AttackEventStatus;
  summary: string;
  detectedAt: string;
  riskScore: number;
  riskLevel: RiskLevel;
  clientIp: string | null;
  path: string;
  occurredAt: string;
}

export interface DashboardSiteSummariesQuery extends SiteScopedQuery, TimeRangeQuery {}

export interface RecentHighRiskEventsQuery extends SiteScopedQuery {
  limit?: number;
  offset?: number;
}

export interface AttackEventsQuery extends SiteScopedQuery, TimeRangeQuery {
  status?: AttackEventStatus;
  eventType?: string;
  severity?: AttackSeverity;
  limit?: number;
}

export interface AiRiskResultsQuery extends SiteScopedQuery, TimeRangeQuery {
  requestLogId?: number;
  attackEventId?: number;
  riskLevel?: RiskLevel;
  limit?: number;
}
