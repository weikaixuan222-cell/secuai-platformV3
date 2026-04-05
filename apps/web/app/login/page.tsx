import type { Metadata } from 'next';
import LoginForm from './LoginForm';
import styles from './login.module.css';

export const metadata: Metadata = {
  title: '登录控制台 - SecuAI',
  description: '登录 SecuAI 管理控制台，查看安全总览、攻击事件和站点防护策略。'
};

export default function LoginPage() {
  return (
    <main className={styles.container}>
      <div className={`glass-panel ${styles.loginBox}`}>
        <div className={styles.header}>
          <div className={styles.logoBox}>
            <svg
              width="32"
              height="32"
              viewBox="0 0 48 48"
              fill="none"
              className={styles.logo}
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M24 0L48 10V24C48 36.315 37.893 46 24 48C10.107 46 0 36.315 0 24V10L24 0ZM24 4.343L4.5 12.468V24C4.5 34.025 12.603 41.745 24 43.513C35.397 41.745 43.5 34.025 43.5 24V12.468L24 4.343ZM28.534 18.066L20.803 26.541L15.912 21.65L12.73 24.832L20.916 33.018L31.83 21.054L28.534 18.066Z"
                fill="var(--accent-cyan)"
              />
            </svg>
          </div>
          <h1 className={styles.title}>登录 SecuAI 控制台</h1>
          <p className={styles.subtitle}>
            登录后可查看安全总览、攻击事件、站点策略和封禁名单，并继续处理当前租户下的风险告警。
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
