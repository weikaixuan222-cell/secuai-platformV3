'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { DashboardSiteSummaryItem } from '@/lib/contracts';
import {
  buildEventsPagePath,
  hasEventFilters,
  parseEventFiltersFromSearch
} from '@/lib/eventFilters';
import { listDashboardSiteSummaries } from '@/lib/services';
import { parseSiteIdFromSearch } from '@/lib/siteFilters';
import styles from './event-detail.module.css';

interface EventDetailNavigationState {
  backHref: string;
  backLabel: string;
  backHint: string;
  hasReturnFilters: boolean;
  hasSiteContext: boolean;
  siteName: string;
  siteDomain: string;
}

interface EventDetailShellProps {
  title: string;
  summary: string;
  eyebrow?: string;
  badge?: ReactNode;
  busy?: boolean;
  children: (navigationState: EventDetailNavigationState) => ReactNode;
}

export default function EventDetailShell({
  title,
  summary,
  eyebrow = '事件研判',
  badge,
  busy = false,
  children
}: EventDetailShellProps) {
  const searchParams = useSearchParams();
  const [siteSummary, setSiteSummary] = useState<DashboardSiteSummaryItem | null>(null);
  const selectedSiteId = useMemo(
    () => parseSiteIdFromSearch(`?${searchParams.toString()}`),
    [searchParams]
  );

  useEffect(() => {
    let ignore = false;

    if (!selectedSiteId) {
      setSiteSummary(null);
      return () => {
        ignore = true;
      };
    }

    setSiteSummary(null);

    const loadSiteSummary = async () => {
      try {
        const response = await listDashboardSiteSummaries({
          siteId: selectedSiteId
        });

        if (ignore) {
          return;
        }

        setSiteSummary(
          response.items.find((item) => item.siteId === selectedSiteId) ?? null
        );
      } catch {
        if (!ignore) {
          setSiteSummary(null);
        }
      }
    };

    loadSiteSummary();

    return () => {
      ignore = true;
    };
  }, [selectedSiteId]);

  const navigationState = useMemo(() => {
    const returnFilters = parseEventFiltersFromSearch(
      `?${searchParams.toString()}`
    );
    const hasReturnFilters = hasEventFilters(returnFilters);

    return {
      backHref: buildEventsPagePath(returnFilters),
      backLabel: hasReturnFilters ? '返回当前筛选结果' : '返回攻击事件列表',
      backHint: hasReturnFilters
        ? '已保留当前筛选条件，返回后会恢复原筛选结果。'
        : '当前详情页未携带筛选参数，返回后展示完整攻击事件列表。',
      hasReturnFilters,
      hasSiteContext: Boolean(selectedSiteId),
      siteName: siteSummary?.siteName || '当前站点',
      siteDomain: siteSummary?.siteDomain || ''
    };
  }, [searchParams, selectedSiteId, siteSummary]);

  return (
    <div
      className={styles.container}
      aria-busy={busy}
      data-testid="event-detail-page-shell"
    >
      <header className={styles.header}>
        <div className={styles.backRow}>
          <Link
            href={navigationState.backHref}
            className={styles.backLink}
            data-testid="event-detail-back-link"
          >
            {navigationState.backLabel}
          </Link>
          <span
            className={styles.backHint}
            role="status"
            aria-live="polite"
            data-testid="event-detail-back-hint"
          >
            {navigationState.backHint}
          </span>
          {navigationState.hasSiteContext ? (
            <div
              className={styles.siteContextBadge}
              aria-label="所属站点上下文"
              data-testid="event-detail-site-context"
            >
              <span className={styles.siteContextLabel}>所属站点</span>
              <span
                className={styles.siteContextName}
                data-testid="event-detail-site-context-name"
              >
                {navigationState.siteName}
              </span>
              {navigationState.siteDomain ? (
                <span
                  className={styles.siteContextDomain}
                  data-testid="event-detail-site-context-domain"
                >
                  {navigationState.siteDomain}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={styles.heroRow}>
          <div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.summary}>{summary}</p>
          </div>
          {badge}
        </div>
      </header>

      {children(navigationState)}
    </div>
  );
}
