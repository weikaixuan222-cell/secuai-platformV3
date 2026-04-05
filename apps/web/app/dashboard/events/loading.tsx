import StatePanelCard from '../components/StatePanelCard';
import styles from './events.module.css';

export default function EventsLoading() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>攻击事件检索</p>
          <h1 className={styles.title}>攻击事件</h1>
        </div>
        <p className={styles.subtitle}>
          正在准备事件列表和筛选控件。页面加载完成后，会继续按 URL 中的筛选条件读取真实攻击事件数据。
        </p>
      </header>

      <StatePanelCard
        className={styles.tableWrapper}
        tone="loading"
        title="正在打开攻击事件列表"
        description="正在加载事件路由资源，请稍候。"
        testId="events-route-loading-state"
      />
    </div>
  );
}
