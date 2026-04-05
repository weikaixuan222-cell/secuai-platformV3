import styles from './login/login.module.css';

export default function AppLoading() {
  return (
    <main className={styles.container}>
      <div className={`glass-panel ${styles.loginBox}`}>
        <div className={styles.header}>
          <h1 className={styles.title}>正在加载控制台</h1>
          <p className={styles.subtitle}>
            正在准备登录页和安全总览入口。若长时间没有响应，请刷新页面后重试。
          </p>
        </div>
      </div>
    </main>
  );
}
