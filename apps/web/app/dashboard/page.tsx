'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type {
  DashboardSiteSummaryItem,
  RecentHighRiskEventItem
} from '@/lib/contracts';
import {
  DEFAULT_EVENT_FILTERS,
  buildEventDetailPagePath
} from '@/lib/eventFilters';
import {
  buildDashboardPagePath,
  buildSiteFilterOptions,
  parseSiteIdFromSearch,
  type SiteFilterOption
} from '@/lib/siteFilters';
import {
  listDashboardSiteSummaries,
  listRecentHighRiskEvents
} from '@/lib/services';
import {
  formatDateTime,
  formatEventType,
  formatRiskLevel,
  getRiskColor
} from '@/lib/securityDisplay';
import SiteFilterSelect from './components/SiteFilterSelect';
import StateCard from './components/StateCard';
import styles from './overview.module.css';

interface DashboardOverviewData {
  allSummaries: DashboardSiteSummaryItem[];
  visibleSummaries: DashboardSiteSummaryItem[];
  recentEvents: RecentHighRiskEventItem[];
}

const INITIAL_DATA: DashboardOverviewData = {
  allSummaries: [],
  visibleSummaries: [],
  recentEvents: []
};

export default function DashboardIndexPage() {
  const router = useRouter();
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [siteOptions, setSiteOptions] = useState<SiteFilterOption[]>([]);
  const [data, setData] = useState<DashboardOverviewData>(INITIAL_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = async (siteId: string) => {
    setLoading(true);
    setError(null);

    try {
      const [summaryResult, recentEventsResult] = await Promise.all([
        listDashboardSiteSummaries(),
        listRecentHighRiskEvents({
          siteId: siteId || undefined,
          limit: 8,
          offset: 0
        })
      ]);

      setSiteOptions(buildSiteFilterOptions(summaryResult.items));
      setData({
        allSummaries: summaryResult.items,
        visibleSummaries: siteId
          ? summaryResult.items.filter((item) => item.siteId === siteId)
          : summaryResult.items,
        recentEvents: recentEventsResult.items
      });
    } catch (err: any) {
      setData(INITIAL_DATA);
      setError(err.message || '安全总览数据加载失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const syncFromUrl = () => {
      const siteId = parseSiteIdFromSearch(window.location.search);
      setSelectedSiteId(siteId);
      loadDashboardData(siteId);
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);

    return () => {
      window.removeEventListener('popstate', syncFromUrl);
    };
  }, []);

  const totals = useMemo(() => {
    return data.visibleSummaries.reduce(
      (acc, item) => ({
        siteCount: acc.siteCount + 1,
        requestLogCount: acc.requestLogCount + item.requestLogCount,
        attackEventCount: acc.attackEventCount + item.attackEventCount,
        highRiskResultCount: acc.highRiskResultCount + item.highRiskResultCount
      }),
      {
        siteCount: 0,
        requestLogCount: 0,
        attackEventCount: 0,
        highRiskResultCount: 0
      }
    );
  }, [data.visibleSummaries]);

  const applySiteFilter = async (siteId: string) => {
    setSelectedSiteId(siteId);
    router.replace(buildDashboardPagePath(siteId));
    await loadDashboardData(siteId);
  };

  const selectedSiteName = useMemo(() => {
    if (!selectedSiteId) {
      return '全部站点';
    }

    return (
      data.allSummaries.find((item) => item.siteId === selectedSiteId)?.siteName ||
      '当前站点'
    );
  }, [data.allSummaries, selectedSiteId]);

  const eventsPageHref = selectedSiteId
    ? `/dashboard/events?siteId=${encodeURIComponent(selectedSiteId)}`
    : '/dashboard/events';

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>安全态势总览</p>
          <h1 className={styles.title}>安全总览</h1>
        </div>
        <p className={styles.subtitle}>
          按站点查看请求量、攻击事件和最近高风险告警。当前站点范围会同步到 URL，方便刷新、回退和分享。
        </p>
      </header>

      <form
        className={`glass-panel ${styles.filterPanel}`}
        aria-busy={loading}
        data-testid="dashboard-filter-form"
        onSubmit={(event) => event.preventDefault()}
      >
        <SiteFilterSelect
          value={selectedSiteId}
          options={siteOptions}
          labelClassName={styles.fieldLabel}
          fieldClassName={styles.fieldGroup}
          selectClassName={styles.fieldControl}
          allSitesLabel="全部站点"
          disabled={loading}
          selectId="dashboard-site-filter"
          onChange={applySiteFilter}
        />
        <div className={styles.filterSummary} role="status" aria-live="polite">
          {loading
            ? '正在同步站点范围...'
            : `当前站点范围：${selectedSiteName}，URL 已同步`}
        </div>
      </form>

      <section className={styles.statsGrid}>
        <div className={`glass-panel ${styles.statCard}`}>
          <div className={styles.statLabel}>接入站点</div>
          <div className={styles.statValue}>{totals.siteCount}</div>
          <div className={styles.statHint}>当前筛选范围内已接入的站点数量</div>
        </div>
        <div className={`glass-panel ${styles.statCard}`}>
          <div className={styles.statLabel}>请求日志</div>
          <div className={styles.statValue}>{totals.requestLogCount}</div>
          <div className={styles.statHint}>来自后端汇总接口的累计请求量</div>
        </div>
        <div className={`glass-panel ${styles.statCard}`}>
          <div className={styles.statLabel}>攻击事件</div>
          <div className={styles.statValue}>{totals.attackEventCount}</div>
          <div className={styles.statHint}>
            由 request_logs → detection → attack_events 主流程生成
          </div>
        </div>
        <div className={`glass-panel ${styles.statCard}`}>
          <div className={styles.statLabel}>高风险结果</div>
          <div className={styles.statValue}>{totals.highRiskResultCount}</div>
          <div className={styles.statHint}>AI 判定为 high / critical 的结果数</div>
        </div>
      </section>

      <section className={styles.contentGrid}>
        <div className={`glass-panel ${styles.panel}`} aria-busy={loading}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>站点态势</p>
              <h2 className={styles.panelTitle}>站点汇总</h2>
            </div>
          </div>

          {loading ? (
            <StateCard
              tone="loading"
              title="正在加载站点汇总"
              description="正在读取站点统计和最近安全事件摘要。"
            />
          ) : error ? (
            <StateCard
              tone="error"
              title="站点汇总加载失败"
              description={error}
              actionLabel="重试加载站点汇总"
              onAction={() => loadDashboardData(selectedSiteId)}
            />
          ) : data.allSummaries.length === 0 ? (
            <StateCard
              tone="empty"
              title="暂无站点汇总数据"
              description="当前租户还没有可展示的站点汇总。接入站点并上报 request_logs 后，这里会展示流量和检测统计。"
              actionLabel="查看攻击事件"
              actionHref="/dashboard/events"
            />
          ) : data.visibleSummaries.length === 0 ? (
            <StateCard
              tone="empty"
              title="当前站点暂无汇总数据"
              description="当前站点范围下暂时没有汇总数据。可以切回“全部站点”查看整体情况，URL 会同步回默认状态。"
              actionLabel="切回全部站点"
              onAction={() => applySiteFilter('')}
            />
          ) : (
            <div className={styles.siteList}>
              {data.visibleSummaries.map((item) => (
                <article key={item.siteId} className={styles.siteItem}>
                  <div className={styles.itemTitleRow}>
                    <div>
                      <h3 className={styles.itemTitle}>{item.siteName}</h3>
                      <div className={styles.itemMeta}>{item.siteDomain}</div>
                    </div>
                    <div className={styles.siteScore}>
                      {item.highRiskResultCount} 高风险
                    </div>
                  </div>
                  <div className={styles.metricsRow}>
                    <span>请求 {item.requestLogCount}</span>
                    <span>事件 {item.attackEventCount}</span>
                    <span>AI 结果 {item.aiRiskResultCount}</span>
                    <span>最近事件 {formatDateTime(item.latestAttackEventAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className={`glass-panel ${styles.panel}`} aria-busy={loading}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>高风险告警</p>
              <h2 className={styles.panelTitle}>最近高风险事件</h2>
            </div>
            <Link href={eventsPageHref} className={styles.panelLink}>
              查看全部
            </Link>
          </div>

          {loading ? (
            <StateCard
              tone="loading"
              title="正在加载高风险事件"
              description="正在读取最近高风险和严重风险事件。"
            />
          ) : error ? (
            <StateCard
              tone="error"
              title="高风险事件加载失败"
              description={error}
              actionLabel="重试加载高风险事件"
              onAction={() => loadDashboardData(selectedSiteId)}
            />
          ) : data.recentEvents.length === 0 ? (
            <StateCard
              tone="empty"
              title="暂无高风险事件"
              description="当前站点范围内暂无高风险或严重风险事件。可以切换站点范围，或进入攻击事件列表继续按条件筛选。"
              actionLabel="查看攻击事件"
              actionHref={eventsPageHref}
            />
          ) : (
            <div className={styles.eventList}>
              {data.recentEvents.map((item) => (
                <Link
                  key={item.attackEventId}
                  href={buildEventDetailPagePath(item.attackEventId, {
                    ...DEFAULT_EVENT_FILTERS,
                    siteId: selectedSiteId || item.siteId,
                    eventType: item.eventType
                  })}
                  className={styles.eventItem}
                >
                  <div className={styles.itemTitleRow}>
                    <h3 className={styles.itemTitle}>{formatEventType(item.eventType)}</h3>
                    <span
                      className={styles.severityText}
                      style={{ color: getRiskColor(item.riskLevel) }}
                    >
                      {formatRiskLevel(item.riskLevel)} · {item.riskScore}
                    </span>
                  </div>
                  <div className={styles.itemMeta}>
                    {item.siteName} / {item.siteDomain}
                  </div>
                  <div className={styles.itemMeta}>
                    {item.summary} · {formatDateTime(item.detectedAt)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
