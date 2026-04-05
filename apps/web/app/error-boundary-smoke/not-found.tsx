import styles from '../login/login.module.css';

export default function ErrorBoundarySmokeNotFoundPage() {
  return (
    <main className={styles.container}>
      <div className={`glass-panel ${styles.loginBox}`}>
        <div className={styles.header}>
          <h1 className={styles.title}>404</h1>
          <p className={styles.subtitle}>当前环境未开启错误边界验证入口。</p>
        </div>
      </div>
    </main>
  );
}
