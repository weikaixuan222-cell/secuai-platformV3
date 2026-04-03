'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchApi, getTenantId } from '@/lib/api';
import type { AttackEventListItem } from '@secuai/shared';
import styles from './events.module.css';

export default function EventsPage() {
  const [events, setEvents] = useState<AttackEventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadEvents = async () => {
      const tenantId = getTenantId();
      if (!tenantId) {
        setError('未找到可用租户。');
        setLoading(false);
        return;
      }

      try {
        const data = await fetchApi<{ items: AttackEventListItem[] }>(`/api/v1/attack-events?tenantId=${tenantId}&limit=50`);
        setEvents(data.items || []);
      } catch (err: any) {
        setError(err.message || '攻击事件加载失败');
      } finally {
        setLoading(false);
      }
    };

    loadEvents();
  }, []);

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <span className={`${styles.badge} ${styles.badgeCritical}`}>严重</span>;
      case 'high':
        return <span className={`${styles.badge} ${styles.badgeHigh}`}>高危</span>;
      case 'medium':
        return <span className={`${styles.badge} ${styles.badgeMedium}`}>中危</span>;
      case 'low':
      default:
        return <span className={`${styles.badge} ${styles.badgeLow}`}>低危</span>;
    }
  };

  const getEventTypeLabel = (eventType: string) => {
    switch (eventType) {
      case 'sql_injection':
        return 'SQL 注入';
      case 'xss_attempt':
        return 'XSS 攻击尝试';
      case 'high_frequency_access':
        return '高频访问';
      case 'suspicious_user_agent':
        return '可疑 User-Agent';
      default:
        return eventType;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'open':
        return '待处理';
      case 'resolved':
        return '已处理';
      default:
        return status;
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>攻击事件</h1>
        <p className={styles.subtitle}>最近已识别并完成分析的可疑请求流量。</p>
      </header>

      <div className={`glass-panel ${styles.tableWrapper}`}>
        {loading ? (
          <div className={styles.emptyState}>攻击事件加载中...</div>
        ) : error ? (
          <div className={styles.errorState}>{error}</div>
        ) : events.length === 0 ? (
          <div className={styles.emptyState}>暂未检测到攻击事件，当前状态安全。</div>
        ) : (
          <table className="sec-table">
            <thead>
              <tr>
                <th>检测时间</th>
                <th>事件类型</th>
                <th>严重等级</th>
                <th>摘要</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => (
                <tr key={evt.id}>
                  <td>{new Date(evt.detectedAt).toLocaleString()}</td>
                  <td>
                    <span className={styles.codeStyle}>{getEventTypeLabel(evt.eventType)}</span>
                  </td>
                  <td>{getSeverityBadge(evt.severity)}</td>
                  <td className={styles.truncate}>{evt.summary}</td>
                  <td>{getStatusLabel(evt.status)}</td>
                  <td>
                    <Link href={`/dashboard/events/${evt.id}`} className={styles.actionLink}>
                      查看分析
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
