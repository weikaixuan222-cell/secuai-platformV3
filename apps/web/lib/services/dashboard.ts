import {
  ApiError,
  buildApiPath,
  fetchApi,
  getRequiredTenantId
} from '@/lib/api';
import type {
  AiRiskResultItem,
  AiRiskResultsQuery,
  AttackEventDetailResponse,
  AttackEventListItem,
  AttackEventsQuery,
  DashboardSiteSummariesQuery,
  DashboardSiteSummaryItem,
  ListResponse,
  RecentHighRiskEventsQuery,
  RecentHighRiskEventsResponse,
  TenantScopedQuery
} from '@/lib/contracts';

const DASHBOARD_LIMIT_RANGE = {
  min: 1,
  max: 200
} as const;

const RECENT_HIGH_RISK_OFFSET_RANGE = {
  min: 0,
  max: 10000
} as const;

function withTenantId<TQuery extends TenantScopedQuery>(
  query: TQuery = {} as TQuery
): TQuery & { tenantId: string } {
  const tenantId = query.tenantId?.trim() || getRequiredTenantId();
  return {
    ...query,
    tenantId
  };
}

function toBoundedInteger(
  value: number | string,
  fieldName: string,
  range: { min: number; max: number }
): number {
  const parsed = typeof value === 'string' ? Number(value) : value;

  if (!Number.isInteger(parsed) || parsed < range.min || parsed > range.max) {
    throw new ApiError(
      `${fieldName} must be an integer between ${range.min} and ${range.max}.`,
      'VALIDATION_ERROR'
    );
  }

  return parsed;
}

function toPositiveInteger(value: number | string, fieldName: string): number {
  return toBoundedInteger(value, fieldName, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER
  });
}

function toOptionalBoundedInteger(
  value: number | string | undefined,
  fieldName: string,
  range: { min: number; max: number }
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return toBoundedInteger(value, fieldName, range);
}

function normalizeRecentHighRiskEventsQuery(
  query: RecentHighRiskEventsQuery
): RecentHighRiskEventsQuery {
  return {
    ...query,
    limit: toOptionalBoundedInteger(query.limit, 'limit', DASHBOARD_LIMIT_RANGE),
    offset: toOptionalBoundedInteger(
      query.offset,
      'offset',
      RECENT_HIGH_RISK_OFFSET_RANGE
    )
  };
}

function normalizeAttackEventsQuery(query: AttackEventsQuery): AttackEventsQuery {
  return {
    ...query,
    limit: toOptionalBoundedInteger(query.limit, 'limit', DASHBOARD_LIMIT_RANGE)
  };
}

function normalizeAiRiskResultsQuery(query: AiRiskResultsQuery): AiRiskResultsQuery {
  return {
    ...query,
    requestLogId: query.requestLogId === undefined
      ? undefined
      : toPositiveInteger(query.requestLogId, 'requestLogId'),
    attackEventId: query.attackEventId === undefined
      ? undefined
      : toPositiveInteger(query.attackEventId, 'attackEventId'),
    limit: toOptionalBoundedInteger(query.limit, 'limit', DASHBOARD_LIMIT_RANGE)
  };
}

export function listDashboardSiteSummaries(
  query: DashboardSiteSummariesQuery = {}
): Promise<ListResponse<DashboardSiteSummaryItem>> {
  return fetchApi<ListResponse<DashboardSiteSummaryItem>>(
    buildApiPath('/api/v1/dashboard/site-summaries', withTenantId(query))
  );
}

export function listRecentHighRiskEvents(
  query: RecentHighRiskEventsQuery = {}
): Promise<RecentHighRiskEventsResponse> {
  return fetchApi<RecentHighRiskEventsResponse>(
    buildApiPath(
      '/api/v1/dashboard/recent-high-risk-events',
      withTenantId(normalizeRecentHighRiskEventsQuery(query))
    )
  );
}

export function listAttackEvents(
  query: AttackEventsQuery = {}
): Promise<ListResponse<AttackEventListItem>> {
  return fetchApi<ListResponse<AttackEventListItem>>(
    buildApiPath('/api/v1/attack-events', withTenantId(normalizeAttackEventsQuery(query)))
  );
}

export function getAttackEventDetail(
  attackEventId: number | string
): Promise<AttackEventDetailResponse> {
  const normalizedAttackEventId = toPositiveInteger(attackEventId, 'attackEventId');

  return fetchApi<AttackEventDetailResponse>(
    `/api/v1/attack-events/${normalizedAttackEventId}`
  );
}

export function listAiRiskResults(
  query: AiRiskResultsQuery = {}
): Promise<ListResponse<AiRiskResultItem>> {
  return fetchApi<ListResponse<AiRiskResultItem>>(
    buildApiPath(
      '/api/v1/ai-risk-results',
      withTenantId(normalizeAiRiskResultsQuery(query))
    )
  );
}
