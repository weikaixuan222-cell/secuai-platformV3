'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { getAuthToken } from '@/lib/api';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    if (getAuthToken()) {
      router.push('/dashboard');
      return;
    }

    router.push('/login');
  }, [router]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        alignItems: 'center',
        color: 'var(--text-secondary)',
        display: 'flex',
        height: '100vh',
        justifyContent: 'center'
      }}
    >
      正在加载控制台入口...
    </div>
  );
}
