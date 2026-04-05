'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { setAuthData } from '@/lib/api';
import { loginWithPassword } from '@/lib/services';
import styles from './login.module.css';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        throw new Error(
          '登录失败：当前账号尚未关联租户。请先创建租户，或联系管理员分配访问权限。'
        );
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
    <form className={styles.form} onSubmit={handleSubmit}>
      {error ? (
        <div className={styles.errorAlert} role="alert" aria-live="assertive">
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
        />
      </div>

      <button type="submit" disabled={loading} className={styles.submitButton}>
        {loading ? '正在登录控制台...' : '登录控制台'}
      </button>
    </form>
  );
}
