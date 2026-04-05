import type {
  AttackEventStatus,
  AttackEventsQuery,
  AttackSeverity
} from '@/lib/contracts';

export const EVENT_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'sql_injection', label: 'SQL 注入' },
  { value: 'xss_payload', label: 'XSS 攻击载荷' },
  { value: 'high_frequency_access', label: '高频访问' },
  { value: 'suspicious_user_agent', label: '可疑 User-Agent' }
] as const;

export const EVENT_STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'open', label: '待处理' },
  { value: 'reviewed', label: '已复核' },
  { value: 'resolved', label: '已处理' }
] as const;

export const EVENT_SEVERITY_OPTIONS = [
  { value: '', label: '全部等级' },
  { value: 'critical', label: '严重' },
  { value: 'high', label: '高危' },
  { value: 'medium', label: '中危' },
  { value: 'low', label: '低危' }
] as const;

export interface EventFiltersState {
  siteId: string;
  eventType: string;
  status: '' | AttackEventStatus;
  severity: '' | AttackSeverity;
  startAt: string;
  endAt: string;
}

export const DEFAULT_EVENT_FILTERS: EventFiltersState = {
  siteId: '',
  eventType: '',
  status: '',
  severity: '',
  startAt: '',
  endAt: ''
};

function isStatus(value: string): value is AttackEventStatus {
  return value === 'open' || value === 'reviewed' || value === 'resolved';
}

function isSeverity(value: string): value is AttackSeverity {
  return (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'critical'
  );
}

function toDateTimeInputValue(value: string | null): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function toIsoString(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

function buildEventFilterAwarePath(
  pathname: string,
  filters: EventFiltersState
): string {
  const params = new URLSearchParams();

  if (filters.siteId) params.set('siteId', filters.siteId);
  if (filters.eventType) params.set('eventType', filters.eventType);
  if (filters.status) params.set('status', filters.status);
  if (filters.severity) params.set('severity', filters.severity);

  const startAt = toIsoString(filters.startAt);
  const endAt = toIsoString(filters.endAt);

  if (startAt) params.set('startAt', startAt);
  if (endAt) params.set('endAt', endAt);

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function parseEventFiltersFromSearch(search: string): EventFiltersState {
  const params = new URLSearchParams(search);
  const status = params.get('status') || '';
  const severity = params.get('severity') || '';

  return {
    siteId: (params.get('siteId') || '').trim(),
    eventType: (params.get('eventType') || '').trim(),
    status: isStatus(status) ? status : '',
    severity: isSeverity(severity) ? severity : '',
    startAt: toDateTimeInputValue(params.get('startAt')),
    endAt: toDateTimeInputValue(params.get('endAt'))
  };
}

export function hasEventFilters(filters: EventFiltersState): boolean {
  return Boolean(
    filters.siteId ||
      filters.eventType ||
      filters.status ||
      filters.severity ||
      filters.startAt ||
      filters.endAt
  );
}

export function hasPendingEventFilterChanges(
  draftFilters: EventFiltersState,
  appliedFilters: EventFiltersState
): boolean {
  return buildEventsPagePath(draftFilters) !== buildEventsPagePath(appliedFilters);
}

export function getEventFilterValidationError(
  filters: EventFiltersState
): string | null {
  if (!filters.startAt || !filters.endAt) {
    return null;
  }

  const startTime = new Date(filters.startAt).getTime();
  const endTime = new Date(filters.endAt).getTime();

  if (
    !Number.isNaN(startTime) &&
    !Number.isNaN(endTime) &&
    startTime > endTime
  ) {
    return '开始时间不能晚于结束时间，请调整筛选范围后重试。';
  }

  return null;
}

export function buildAttackEventsQuery(
  filters: EventFiltersState
): AttackEventsQuery {
  return {
    siteId: filters.siteId || undefined,
    eventType: filters.eventType || undefined,
    status: filters.status || undefined,
    severity: filters.severity || undefined,
    startAt: toIsoString(filters.startAt),
    endAt: toIsoString(filters.endAt),
    limit: 50
  };
}

export function buildEventsPagePath(filters: EventFiltersState): string {
  return buildEventFilterAwarePath('/dashboard/events', filters);
}

export function buildEventDetailPagePath(
  eventId: number | string,
  filters: EventFiltersState
): string {
  return buildEventFilterAwarePath(`/dashboard/events/${eventId}`, filters);
}
