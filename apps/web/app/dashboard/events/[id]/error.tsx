'use client';

import { useEffect } from 'react';
import StatePanelCard from '../../components/StatePanelCard';
import EventDetailShell from './EventDetailShell';
import styles from './event-detail.module.css';

interface EventDetailRouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function EventDetailRouteError({
  error,
  reset
}: EventDetailRouteErrorProps) {
  useEffect(() => {
    console.error('Attack event detail route render failed:', error);
  }, [error]);

  return (
    <EventDetailShell
      title="攻击事件详情"
      summary="事件详情路由渲染失败。你可以直接重试打开当前页面，或通过返回入口回到原筛选结果。"
    >
      {() => (
        <StatePanelCard
          className={styles.statePanel}
          tone="error"
          title="事件详情页打开失败"
          description={
            error.message ||
            '事件详情页渲染时发生异常，请重试加载当前页面。'
          }
          actionLabel="重试打开事件详情页"
          testId="event-detail-route-error-state"
          actionTestId="event-detail-route-error-retry"
          onAction={reset}
        />
      )}
    </EventDetailShell>
  );
}
