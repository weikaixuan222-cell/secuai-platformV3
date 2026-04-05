import Link from 'next/link';
import styles from '../login/login.module.css';

interface ErrorBoundarySmokeProbeProps {
  probeId: string;
}

export default function ErrorBoundarySmokeProbe({
  probeId
}: ErrorBoundarySmokeProbeProps) {
  return (
    <main className={styles.container}>
      <div className={`glass-panel ${styles.loginBox}`}>
        <div className={styles.header}>
          <h1 className={styles.title} data-testid="error-boundary-smoke-title">
            错误边界已恢复
          </h1>
          <p className={styles.subtitle} data-testid="error-boundary-smoke-description">
            已通过全局错误页重试恢复到验证页面。当前探针 ID：{probeId}
            。这个入口仅用于开发环境下验证 app/error.tsx 的浏览器级重试链路，不影响正常业务数据流。
          </p>
        </div>

        <Link
          href="/login"
          className={styles.submitButton}
          data-testid="error-boundary-smoke-login-link"
        >
          返回登录页
        </Link>
      </div>
    </main>
  );
}
