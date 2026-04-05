'use client';

import StatePanelCard from '../../components/StatePanelCard';
import EventDetailShell from './EventDetailShell';
import styles from './event-detail.module.css';

export default function EventDetailLoading() {
  return (
    <EventDetailShell
      title="攻击事件详情"
      summary="正在打开事件详情页，并保留从列表页带入的筛选参数。页面资源加载完成后，会继续读取真实事件详情数据。"
      busy
    >
      {() => (
        <StatePanelCard
          className={styles.statePanel}
          tone="loading"
          title="正在打开事件详情页"
          description="正在加载事件详情路由资源，请稍候。"
          testId="event-detail-route-loading-state"
        />
      )}
    </EventDetailShell>
  );
}
