'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearAuthData } from '@/lib/api';
import styles from './dashboard.module.css';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    clearAuthData();
    router.push('/login');
  };

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <svg width="24" height="24" viewBox="0 0 48 48" fill="none" className={styles.logo}>
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M24 0L48 10V24C48 36.315 37.893 46 24 48C10.107 46 0 36.315 0 24V10L24 0ZM24 4.343L4.5 12.468V24C4.5 34.025 12.603 41.745 24 43.513C35.397 41.745 43.5 34.025 43.5 24V12.468L24 4.343ZM28.534 18.066L20.803 26.541L15.912 21.65L12.73 24.832L20.916 33.018L31.83 21.054L28.534 18.066Z"
              fill="var(--accent-cyan)"
            />
          </svg>
          <span className={styles.brand}>SecuAI</span>
        </div>

        <nav className={styles.nav}>
          <Link 
            href="/dashboard/events" 
            className={`${styles.navItem} ${pathname.startsWith('/dashboard/events') ? styles.active : ''}`}
          >
            <span className={styles.navIcon}>🛡️</span>
            攻击事件
          </Link>
          {/* Future sections would go here */}
        </nav>

        <div className={styles.sidebarFooter}>
          <button onClick={handleLogout} className={styles.logoutButton}>
            退出登录
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className={styles.mainContent}>
        <header className={styles.topbar}>
          <h2 className={styles.pageTitle}>安全控制台</h2>
          <div className={styles.userBadge}>管理员</div>
        </header>

        <main className={styles.pageContent}>
          {children}
        </main>
      </div>
    </div>
  );
}
