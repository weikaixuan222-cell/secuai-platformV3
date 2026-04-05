'use client';

import { useEffect } from 'react';
import StatePanelCard from './components/StatePanelCard';
import styles from './overview.module.css';

interface DashboardErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardErrorPage({
  error,
  reset
}: DashboardErrorPageProps) {
  useEffect(() => {
    console.error('Dashboard route render failed:', error);
  }, [error]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>安全态势总览</p>
          <h1 className={styles.title}>安全总览</h1>
        </div>
        <p className={styles.subtitle}>
          Dashboard 路由渲染失败。你可以直接重试加载当前页面，或返回登录页重新进入控制台。
        </p>
      </header>

      <StatePanelCard
        className={styles.panel}
        tone="error"
        title="安全总览页面打开失败"
        description={
          error.message || 'Dashboard 页面渲染时发生异常，请重试加载当前页面。'
        }
        actionLabel="重试加载安全总览"
        testId="dashboard-route-error-state"
        actionTestId="dashboard-route-error-retry"
        onAction={reset}
      />
    </div>
  );
}
