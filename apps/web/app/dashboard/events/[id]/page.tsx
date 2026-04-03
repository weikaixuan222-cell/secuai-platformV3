'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import type { AttackEventDetailResponse } from '@secuai/shared';
import styles from './event-detail.module.css';
import Link from 'next/link';

export default function EventDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState<AttackEventDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDetail = async () => {
      try {
        const respData = await fetchApi<AttackEventDetailResponse>(`/api/v1/attack-events/${id}`);
        setData(respData);
      } catch (err: any) {
        setError(err.message || '攻击事件详情加载失败');
      } finally {
        setLoading(false);
      }
    };
    if (id) loadDetail();
  }, [id]);

  if (loading) {
    return <div className={styles.loadingState}>取证数据加载中...</div>;
  }

  if (error || !data) {
    return (
      <div className={styles.errorState}>
        <p>{error || '未找到该事件'}</p>
        <button onClick={() => router.back()} className={styles.backButton}>返回</button>
      </div>
    );
  }

  const { attackEvent, requestLog, aiRiskResult } = data;

  const getRiskColor = (level?: string) => {
    if (!level) return 'var(--text-secondary)';
    switch (level) {
      case 'critical': return 'var(--severity-critical)';
      case 'high': return 'var(--severity-high)';
      case 'medium': return 'var(--severity-medium)';
      case 'low': return 'var(--severity-low)';
      default: return 'var(--text-secondary)';
    }
  };

  const getSeverityLabel = (severity: string) => {
    switch (severity) {
      case 'critical':
        return '严重';
      case 'high':
        return '高危';
      case 'medium':
        return '中危';
      case 'low':
        return '低危';
      default:
        return severity;
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

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href="/dashboard/events" className={styles.backLink}>← 返回攻击事件</Link>
          <h1 className={styles.title}>事件 #{attackEvent.id} 分析</h1>
        </div>
      </header>

      <div className={styles.grid}>
        {/* Detection Details Sub-panel */}
        <div className={`glass-panel ${styles.panel}`}>
          <h2 className={styles.panelTitle}>检测摘要</h2>
          <div className={styles.infoRow}>
            <span className={styles.label}>事件类型</span>
            <span className={styles.value}>{getEventTypeLabel(attackEvent.eventType)}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>严重等级</span>
            <span className={styles.value} style={{ color: getRiskColor(attackEvent.severity), fontWeight: 'bold' }}>
              {getSeverityLabel(attackEvent.severity)}
            </span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>摘要</span>
            <span className={styles.value}>{attackEvent.summary}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.label}>检测时间</span>
            <span className={styles.value}>{new Date(attackEvent.createdAt).toLocaleString()}</span>
          </div>
        </div>

        {/* AI Risk Result Sub-panel */}
        <div className={`glass-panel ${styles.panel}`}>
          <h2 className={styles.panelTitle}>AI 风险分析</h2>
          {aiRiskResult ? (
            <div className={styles.aiRiskContainer}>
              <div className={styles.scoreCircle} style={{ borderColor: getRiskColor(aiRiskResult.riskLevel) }}>
                <span className={styles.scoreValue} style={{ color: getRiskColor(aiRiskResult.riskLevel) }}>
                  {aiRiskResult.riskScore}
                </span>
                <span className={styles.scoreLabel}>风险评分</span>
              </div>
              <div className={styles.aiDetails}>
                <p className={styles.aiExplanation}>{aiRiskResult.explanation}</p>
                <div className={styles.aiMeta}>
                  <span className={styles.metaBadge}>模型：{aiRiskResult.modelName} ({aiRiskResult.modelVersion})</span>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.noAiData}>
              该事件暂无 AI 分析结果，请等待处理完成或检查后端日志。
            </div>
          )}
        </div>

        {/* Network Footprint Sub-panel */}
        <div className={`glass-panel ${styles.panel} ${styles.fullWidth}`}>
          <h2 className={styles.panelTitle}>网络请求信息</h2>
          <div className={styles.grid2Col}>
            <div className={styles.infoRow}>
              <span className={styles.label}>客户端 IP</span>
              <span className={`${styles.value} ${styles.code}`}>{requestLog.clientIp || '未知'}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>主机名</span>
              <span className={`${styles.value} ${styles.code}`}>{requestLog.host}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>HTTP 方法</span>
              <span className={`${styles.value} ${styles.code}`}>{requestLog.method}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>请求路径</span>
              <span className={`${styles.value} ${styles.code}`}>{requestLog.path}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>响应状态码</span>
              <span className={styles.value}>{requestLog.statusCode || '无'}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>用户代理（User-Agent）</span>
              <span className={`${styles.value} ${styles.truncated}`} title={requestLog.userAgent || ''}>{requestLog.userAgent || '未知'}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
