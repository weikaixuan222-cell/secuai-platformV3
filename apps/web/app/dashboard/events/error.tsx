'use client';

import { useEffect } from 'react';
import StatePanelCard from '../components/StatePanelCard';
import styles from './events.module.css';

interface EventsRouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function EventsRouteError({ error, reset }: EventsRouteErrorProps) {
  useEffect(() => {
    console.error('Attack events route render failed:', error);
  }, [error]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>攻击事件检索</p>
          <h1 className={styles.title}>攻击事件</h1>
        </div>
        <p className={styles.subtitle}>
          攻击事件路由渲染失败。你可以直接重试打开列表，现有筛选条件仍会优先从 URL 中恢复。
        </p>
      </header>

      <StatePanelCard
        className={styles.tableWrapper}
        tone="error"
        title="攻击事件列表打开失败"
        description={
          error.message || '攻击事件列表页面渲染时发生异常，请重试加载当前页面。'
        }
        actionLabel="重试打开事件列表"
        testId="events-route-error-state"
        actionTestId="events-route-error-retry"
        onAction={reset}
      />
    </div>
  );
}
