'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import {
  buildEventsPagePath,
  hasEventFilters,
  parseEventFiltersFromSearch
} from '@/lib/eventFilters';
import styles from './event-detail.module.css';

interface EventDetailNavigationState {
  backHref: string;
  backLabel: string;
  backHint: string;
  hasReturnFilters: boolean;
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
      hasReturnFilters
    };
  }, [searchParams]);

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
