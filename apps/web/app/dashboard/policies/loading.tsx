import StateCard from '../components/StateCard';
import styles from './policies.module.css';

export default function PoliciesLoading() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>站点防护策略</p>
          <h1 className={styles.title}>策略与封禁管理</h1>
        </div>
        <p className={styles.subtitle}>
          正在准备策略页界面和站点筛选控件。页面加载完成后，将继续读取真实站点策略和封禁名单数据。
        </p>
      </header>

      <section className={`glass-panel ${styles.policyPanel}`}>
        <StateCard
          tone="loading"
          title="正在打开策略页"
          description="正在加载策略页路由资源，请稍候。若长时间没有响应，请刷新页面后重试。"
          testId="policies-route-loading-state"
        />
      </section>
    </div>
  );
}
