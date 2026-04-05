'use client';

import { useEffect } from 'react';
import StateCard from '../components/StateCard';
import styles from './policies.module.css';

interface PoliciesErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PoliciesError({ error, reset }: PoliciesErrorProps) {
  useEffect(() => {
    console.error('Policies route render failed:', error);
  }, [error]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>站点防护策略</p>
          <h1 className={styles.title}>策略与封禁管理</h1>
        </div>
        <p className={styles.subtitle}>
          策略页路由渲染失败。你可以直接重试加载，或返回安全总览确认当前站点和租户状态是否正常。
        </p>
      </header>

      <section className={`glass-panel ${styles.policyPanel}`}>
        <StateCard
          tone="error"
          title="策略页打开失败"
          description={error.message || '策略页渲染时发生异常，请重试加载或返回安全总览。'}
          actionLabel="重试打开策略页"
          actionTestId="policies-route-error-retry"
          testId="policies-route-error-state"
          onAction={reset}
        />
      </section>
    </div>
  );
}
