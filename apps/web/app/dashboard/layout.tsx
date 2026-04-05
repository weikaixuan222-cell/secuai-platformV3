'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { clearAuthData } from '@/lib/api';
import styles from './dashboard.module.css';

function ShieldIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M24 0L48 10V24C48 36.315 37.893 46 24 48C10.107 46 0 36.315 0 24V10L24 0ZM24 4.343L4.5 12.468V24C4.5 34.025 12.603 41.745 24 43.513C35.397 41.745 43.5 34.025 43.5 24V12.468L24 4.343ZM28.534 18.066L20.803 26.541L15.912 21.65L12.73 24.832L20.916 33.018L31.83 21.054L28.534 18.066Z"
        fill="currentColor"
      />
    </svg>
  );
}

function OverviewIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="4" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="13" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EventsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3L20 6.5V12C20 16.9 16.8 20 12 21C7.2 20 4 16.9 4 12V6.5L12 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 8V12.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M12 15.5H12.01"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PoliciesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4H17C18.1046 4 19 4.89543 19 6V18C19 19.1046 18.1046 20 17 20H7C5.89543 20 5 19.1046 5 18V6C5 4.89543 5.89543 4 7 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M9 9H15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M9 13H15"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M9 17H13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    clearAuthData();
    router.push('/login');
  };

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.logoMark}>
            <ShieldIcon />
          </span>
          <div>
            <div className={styles.brand}>SecuAI</div>
            <div className={styles.brandMeta}>安全防护控制台</div>
          </div>
        </div>

        <nav className={styles.nav} aria-label="控制台导航">
          <Link
            href="/dashboard"
            className={`${styles.navItem} ${
              pathname === '/dashboard' ? styles.active : ''
            }`}
          >
            <span className={styles.navIcon}>
              <OverviewIcon />
            </span>
            安全总览
          </Link>
          <Link
            href="/dashboard/events"
            className={`${styles.navItem} ${
              pathname.startsWith('/dashboard/events') ? styles.active : ''
            }`}
          >
            <span className={styles.navIcon}>
              <EventsIcon />
            </span>
            攻击事件
          </Link>
          <Link
            href="/dashboard/policies"
            className={`${styles.navItem} ${
              pathname.startsWith('/dashboard/policies') ? styles.active : ''
            }`}
          >
            <span className={styles.navIcon}>
              <PoliciesIcon />
            </span>
            站点策略
          </Link>
        </nav>

        <div className={styles.sidebarFooter}>
          <button type="button" onClick={handleLogout} className={styles.logoutButton}>
            退出登录
          </button>
        </div>
      </aside>

      <div className={styles.mainContent}>
        <header className={styles.topbar}>
          <div className={styles.pageTitle}>安全控制台</div>
          <div className={styles.userBadge}>管理员</div>
        </header>

        <main className={styles.pageContent}>{children}</main>
      </div>
    </div>
  );
}
