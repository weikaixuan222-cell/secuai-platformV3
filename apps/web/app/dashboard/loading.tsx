import StatePanelCard from './components/StatePanelCard';
import styles from './overview.module.css';

export default function DashboardLoading() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>安全态势总览</p>
          <h1 className={styles.title}>安全总览</h1>
        </div>
        <p className={styles.subtitle}>
          正在准备安全总览页面结构和站点筛选入口，完成后会继续读取真实站点汇总数据。
        </p>
      </header>

      <StatePanelCard
        className={styles.panel}
        tone="loading"
        title="正在打开安全总览"
        description="正在加载 Dashboard 路由资源，请稍候。"
        testId="dashboard-route-loading-state"
      />
    </div>
  );
}
