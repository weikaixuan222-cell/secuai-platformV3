import type { Metadata } from 'next';
import RegisterForm from './RegisterForm';
import styles from '../login/login.module.css';

export const metadata: Metadata = {
  title: '注册控制台账号 - SecuAI',
  description: '注册 SecuAI 最小可用控制台账号，创建默认租户后沿用现有登录链路进入安全控制台。'
};

export default function RegisterPage() {
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
          <h1 className={styles.title} data-testid="auth-page-title">
            注册 SecuAI 控制台
          </h1>
          <p className={styles.subtitle}>
            这一页只收口最小可用注册闭环：创建账号、自动生成默认租户，然后回到现有登录链路继续进入控制台。
          </p>
        </div>
        <RegisterForm />
      </div>
    </main>
  );
}
