'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setAuthData } from '@/lib/api';
import styles from './login.module.css';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setError(null);

    try {
      const resp = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      
      const data = await resp.json();
      
      if (!resp.ok || !data.success) {
        throw new Error(data.error?.message || '登录失败');
      }

      const { token, memberships } = data.data;
      const tenantId = memberships && memberships.length > 0 ? memberships[0].tenantId : '';
      
      if (!token) throw new Error('服务端未返回 token');

      setAuthData(token, tenantId);
      router.push('/dashboard/events');
    } catch (err: any) {
      setError(err.message || '发生未知错误。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {error && <div className={styles.errorAlert}>{error}</div>}
      
      <div className={styles.formGroup}>
        <label htmlFor="email" className={styles.label}>账号邮箱</label>
        <input
          id="email"
          type="email"
          placeholder="请输入邮箱地址"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={styles.input}
        />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="password" className={styles.label}>登录密码</label>
        <input
          id="password"
          type="password"
          placeholder="请输入密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className={styles.input}
        />
      </div>

      <button type="submit" disabled={loading} className={styles.submitButton}>
        {loading ? '登录验证中...' : '安全登录'}
      </button>
    </form>
  );
}
