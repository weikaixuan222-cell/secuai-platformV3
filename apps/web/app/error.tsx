'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import styles from './login/login.module.css';

interface GlobalErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  const router = useRouter();
  const [isRetryReady, setIsRetryReady] = useState(false);

  useEffect(() => {
    console.error('SecuAI global route render failed:', error);
    setIsRetryReady(true);
  }, [error]);

  const handleRetry = () => {
    reset();
    router.refresh();
    window.location.reload();
  };

  return (
    <main className={styles.container}>
      <div className={`glass-panel ${styles.loginBox}`}>
        <div className={styles.header}>
          <h1 className={styles.title} data-testid="global-error-title">
            控制台页面加载失败
          </h1>
          <p className={styles.subtitle} data-testid="global-error-description">
            页面渲染时发生异常。你可以先重试加载当前页面；如果问题持续存在，请返回登录页重新进入控制台。
          </p>
        </div>

        <div
          className={styles.errorAlert}
          role="alert"
          aria-live="assertive"
          data-testid="global-error-message"
        >
          {error.message || '控制台页面加载失败，请稍后重试。'}
        </div>

        <button
          type="button"
          disabled={!isRetryReady}
          onClick={handleRetry}
          className={styles.submitButton}
          data-retry-ready={isRetryReady ? 'true' : 'false'}
          data-testid="global-error-retry"
        >
          重试加载当前页面
        </button>
      </div>
    </main>
  );
}
