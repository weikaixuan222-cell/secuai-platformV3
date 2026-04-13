'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { setAuthData } from '@/lib/api';
import { loginWithPassword } from '@/lib/services';
import styles from './login.module.css';

type LoginFormProps = {
  initialEmail?: string;
  showRegistrationSuccess?: boolean;
};

export default function LoginForm({
  initialEmail = '',
  showRegistrationSuccess = false
}: LoginFormProps) {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email || !password) {
      setError('登录失败，请先输入邮箱地址和密码。');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { token, memberships } = await loginWithPassword({ email, password });
      const tenantId = memberships.length > 0 ? memberships[0].tenantId : '';

      if (!token) {
        throw new Error('登录失败：服务端未返回 token，请稍后重试。');
      }

      if (!tenantId) {
        throw new Error('登录失败：当前账号尚未关联租户，请联系管理员排查注册流程。');
      }

      setAuthData(token, tenantId);
      router.push('/dashboard/events');
    } catch (err: any) {
      setError(err.message || '登录失败，请检查邮箱地址和密码后重试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit}
      data-testid="login-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      {showRegistrationSuccess ? (
        <div
          className={`${styles.statusAlert} ${styles.successAlert}`}
          role="status"
          aria-live="polite"
          data-testid="login-success-alert"
        >
          注册成功，系统已为你创建默认租户。下一步登录后即可进入控制台，再继续创建站点并接入日志。
        </div>
      ) : null}

      {error ? (
        <div
          className={`${styles.statusAlert} ${styles.errorAlert}`}
          role="alert"
          aria-live="assertive"
          data-testid="login-form-alert"
        >
          {error}
        </div>
      ) : null}

      <div className={styles.formGroup}>
        <label htmlFor="email" className={styles.label}>
          邮箱地址
        </label>
        <input
          id="email"
          type="email"
          placeholder="请输入邮箱地址"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className={styles.input}
          autoComplete="email"
          data-testid="login-email-input"
        />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="password" className={styles.label}>
          密码
        </label>
        <input
          id="password"
          type="password"
          placeholder="请输入密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className={styles.input}
          autoComplete="current-password"
          data-testid="login-password-input"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className={styles.submitButton}
        data-testid="login-submit-button"
        data-loading-state={loading ? 'submitting' : 'idle'}
      >
        {loading ? '正在登录控制台...' : '登录控制台'}
      </button>

      <p className={styles.alternateAction}>
        还没有账号？
        <a href="/register" className={styles.alternateLink} data-testid="login-register-link">
          去注册
        </a>
      </p>
    </form>
  );
}
