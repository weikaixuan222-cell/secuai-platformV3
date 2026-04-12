'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AttackEventListItem } from '@/lib/contracts';
import {
  DEFAULT_EVENT_FILTERS,
  EVENT_SEVERITY_OPTIONS,
  EVENT_STATUS_OPTIONS,
  EVENT_TYPE_OPTIONS,
  type EventFiltersState,
  buildAttackEventsQuery,
  buildEventDetailPagePath,
  buildEventsPagePath,
  getEventFilterValidationError,
  hasEventFilters,
  hasPendingEventFilterChanges,
  parseEventFiltersFromSearch
} from '@/lib/eventFilters';
import {
  buildSiteFilterOptions,
  buildPoliciesPagePath,
  type SiteFilterOption
} from '@/lib/siteFilters';
import {
  listAttackEvents,
  listDashboardSiteSummaries
} from '@/lib/services';
import {
  formatDateTime,
  formatEventType,
  formatSeverity,
  formatStatus
} from '@/lib/securityDisplay';
import SiteFilterSelect from '../components/SiteFilterSelect';
import StatePanelCard from '../components/StatePanelCard';
import styles from './events.module.css';

export default function EventsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<EventFiltersState>(DEFAULT_EVENT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<EventFiltersState>(
    DEFAULT_EVENT_FILTERS
  );
  const [siteOptions, setSiteOptions] = useState<SiteFilterOption[]>([]);
  const [events, setEvents] = useState<AttackEventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async (nextFilters: EventFiltersState) => {
    setLoading(true);
    setError(null);
    setAppliedFilters(nextFilters);

    const validationError = getEventFilterValidationError(nextFilters);

    if (validationError) {
      setEvents([]);
      setError(validationError);
      setLoading(false);
      return;
    }

    try {
      const [summaryData, eventData] = await Promise.all([
        listDashboardSiteSummaries(),
        listAttackEvents(buildAttackEventsQuery(nextFilters))
      ]);

      setSiteOptions(buildSiteFilterOptions(summaryData.items));
      setEvents(eventData.items || []);
    } catch (err: any) {
      setEvents([]);
      setError(err.message || '攻击事件加载失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      const parsedFilters = parseEventFiltersFromSearch(window.location.search);
      setFilters(parsedFilters);
      loadEvents(parsedFilters);
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);

    return () => {
      window.removeEventListener('popstate', syncFromUrl);
    };
  }, [loadEvents]);

  const applyFilters = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.replace(buildEventsPagePath(filters));
    await loadEvents(filters);
  };

  const clearFilters = async () => {
    setFilters(DEFAULT_EVENT_FILTERS);
    router.replace('/dashboard/events');
    await loadEvents(DEFAULT_EVENT_FILTERS);
  };

  const renderSeverityBadge = (severity: AttackEventListItem['severity']) => {
    const badgeClassName =
      severity === 'critical'
        ? styles.badgeCritical
        : severity === 'high'
          ? styles.badgeHigh
          : severity === 'medium'
            ? styles.badgeMedium
            : styles.badgeLow;

    return (
      <span className={`${styles.badge} ${badgeClassName}`}>
        {formatSeverity(severity)}
      </span>
    );
  };

  const draftHasFilters = hasEventFilters(filters);
  const appliedHasFilters = hasEventFilters(appliedFilters);
  const hasPendingChanges = hasPendingEventFilterChanges(filters, appliedFilters);

  const currentSiteName = useMemo(() => {
    if (!appliedFilters.siteId) {
      return '全部站点';
    }

    return (
      siteOptions.find((option) => option.value === appliedFilters.siteId)?.label ||
      '当前站点'
    );
  }, [appliedFilters.siteId, siteOptions]);

  const currentSiteOption = useMemo(
    () =>
      siteOptions.find((option) => option.value === appliedFilters.siteId) || null,
    [appliedFilters.siteId, siteOptions]
  );

  const filterMetaText = useMemo(() => {
    if (loading) {
      return hasPendingChanges
        ? '正在按新筛选条件刷新事件列表，完成后会同步更新 URL。'
        : '正在按当前 URL 中的筛选条件加载事件列表。';
    }

    if (hasPendingChanges) {
      return `筛选草稿尚未应用。当前 URL 对应“${currentSiteName}”，已匹配 ${events.length} 条事件。`;
    }

    return `当前 URL 对应“${currentSiteName}”，已匹配 ${events.length} 条事件。`;
  }, [currentSiteName, events.length, hasPendingChanges, loading]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>攻击事件检索</p>
          <h1 className={styles.title}>攻击事件</h1>
        </div>
        <p className={styles.subtitle}>
          按站点范围、事件类型、处理状态、风险等级和时间范围筛选攻击事件。点击“应用筛选”后，筛选结果会同步到 URL，并在进入详情页后保留。
        </p>
      </header>

      {appliedFilters.siteId && currentSiteOption ? (
        <section
          className={`glass-panel ${styles.siteContextPanel}`}
          aria-label="当前站点上下文"
          data-testid="events-site-context"
        >
          <div className={styles.siteContextHeader}>
            <div>
              <p className={styles.siteContextEyebrow}>当前站点上下文</p>
              <p
                className={styles.siteContextName}
                data-testid="events-site-context-name"
              >
                {currentSiteOption.label}
              </p>
              <p
                className={styles.siteContextDomain}
                data-testid="events-site-context-domain"
              >
                {currentSiteOption.meta}
              </p>
            </div>
            <Link
              href={buildPoliciesPagePath(appliedFilters.siteId)}
              className={styles.siteContextLink}
              data-testid="events-site-context-policies-link"
            >
              返回该站点策略页
            </Link>
          </div>

          <div className={styles.siteContextMeta}>
            <span className={styles.siteContextChip}>当前站点范围已生效</span>
            <code
              className={styles.siteContextCode}
              data-testid="events-site-context-site-id"
            >
              siteId: {appliedFilters.siteId}
            </code>
          </div>

          <p
            className={styles.siteContextHint}
            data-testid="events-site-context-hint"
          >
            当前 URL 已锁定 <code>siteId</code>。从总览跳入后会沿用这个范围，进入事件详情再返回时也会保留。
          </p>
        </section>
      ) : null}

      <form
        className={`glass-panel ${styles.filterPanel}`}
        aria-busy={loading}
        data-testid="events-filter-form"
        onSubmit={applyFilters}
      >
        <div className={styles.filterGrid}>
          <SiteFilterSelect
            value={filters.siteId}
            options={siteOptions}
            labelClassName={styles.fieldLabel}
            fieldClassName={styles.fieldGroup}
            selectClassName={styles.fieldControl}
            selectId="events-site-filter"
            disabled={loading}
            onChange={(siteId) =>
              setFilters((current) => ({
                ...current,
                siteId
              }))
            }
          />

          <label className={styles.fieldGroup} htmlFor="events-type-filter">
            <span className={styles.fieldLabel}>事件类型</span>
            <select
              id="events-type-filter"
              value={filters.eventType}
              disabled={loading}
              aria-disabled={loading}
              aria-busy={loading}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  eventType: event.target.value
                }))
              }
              className={styles.fieldControl}
            >
              {EVENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value || 'all-type'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.fieldGroup} htmlFor="events-status-filter">
            <span className={styles.fieldLabel}>处理状态</span>
            <select
              id="events-status-filter"
              value={filters.status}
              disabled={loading}
              aria-disabled={loading}
              aria-busy={loading}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as EventFiltersState['status']
                }))
              }
              className={styles.fieldControl}
            >
              {EVENT_STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all-status'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.fieldGroup} htmlFor="events-severity-filter">
            <span className={styles.fieldLabel}>风险等级</span>
            <select
              id="events-severity-filter"
              value={filters.severity}
              disabled={loading}
              aria-disabled={loading}
              aria-busy={loading}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  severity: event.target.value as EventFiltersState['severity']
                }))
              }
              className={styles.fieldControl}
            >
              {EVENT_SEVERITY_OPTIONS.map((option) => (
                <option key={option.value || 'all-severity'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.fieldGroup} htmlFor="events-start-filter">
            <span className={styles.fieldLabel}>开始时间</span>
            <input
              id="events-start-filter"
              type="datetime-local"
              value={filters.startAt}
              disabled={loading}
              aria-disabled={loading}
              aria-busy={loading}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  startAt: event.target.value
                }))
              }
              className={styles.fieldControl}
            />
          </label>

          <label className={styles.fieldGroup} htmlFor="events-end-filter">
            <span className={styles.fieldLabel}>结束时间</span>
            <input
              id="events-end-filter"
              type="datetime-local"
              value={filters.endAt}
              disabled={loading}
              aria-disabled={loading}
              aria-busy={loading}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  endAt: event.target.value
                }))
              }
              className={styles.fieldControl}
            />
          </label>
        </div>

        <div className={styles.filterActions}>
          <div className={styles.filterMeta} role="status" aria-live="polite">
            {filterMetaText}
          </div>
          <div className={styles.actionGroup}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={clearFilters}
              disabled={loading || (!draftHasFilters && !appliedHasFilters)}
              aria-disabled={loading || (!draftHasFilters && !appliedHasFilters)}
              aria-busy={loading}
              data-testid="events-clear-filters"
            >
              清空筛选
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={loading}
              aria-disabled={loading}
              aria-busy={loading}
              data-testid="events-apply-filters"
            >
              {loading ? '正在应用筛选...' : '应用筛选'}
            </button>
          </div>
        </div>
      </form>

      {loading ? (
        <StatePanelCard
          className={styles.tableWrapper}
          tone="loading"
          title="正在加载攻击事件"
          description="正在按当前 URL 中的筛选条件读取攻击事件列表。"
        />
      ) : error ? (
        <StatePanelCard
          className={styles.tableWrapper}
          tone="error"
          title="攻击事件加载失败"
          description={error}
          actionLabel="重试加载事件列表"
          onAction={() => loadEvents(appliedFilters)}
        />
      ) : events.length === 0 ? (
        <StatePanelCard
          className={styles.tableWrapper}
          tone="empty"
          title={appliedHasFilters ? '当前筛选条件下暂无事件' : '暂无攻击事件记录'}
          description={
            appliedHasFilters
              ? '可以放宽站点范围、事件类型、处理状态、风险等级或时间范围后重新查询。当前已应用的筛选条件会保留在 URL 中，便于从详情页返回原结果。'
              : '当前租户尚未检测到攻击事件。接入站点并上报 request_logs 后，检测结果会自动出现在这里。'
          }
          actionLabel={appliedHasFilters ? '清空筛选条件' : '返回安全总览'}
          actionHref={appliedHasFilters ? undefined : '/dashboard'}
          onAction={appliedHasFilters ? clearFilters : undefined}
        />
      ) : (
        <div className={`glass-panel ${styles.tableWrapper}`}>
          <table className="sec-table">
            <thead>
              <tr>
                <th>检测时间</th>
                <th>事件类型</th>
                <th>风险等级</th>
                <th>摘要</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.detectedAt)}</td>
                  <td>
                    <span className={styles.codeStyle}>
                      {formatEventType(event.eventType)}
                    </span>
                  </td>
                  <td>{renderSeverityBadge(event.severity)}</td>
                  <td className={styles.truncate} title={event.summary}>
                    {event.summary}
                  </td>
                  <td>{formatStatus(event.status)}</td>
                  <td>
                    <Link
                      href={buildEventDetailPagePath(event.id, appliedFilters)}
                      className={styles.actionLink}
                    >
                      查看事件详情
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
