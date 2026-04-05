'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { AttackEventDetailResponse } from '@/lib/contracts';
import { getAttackEventDetail } from '@/lib/services';
import {
  formatDateTime,
  formatEventType,
  formatRiskLevel,
  formatSeverity,
  getRiskColor
} from '@/lib/securityDisplay';
import StateCard from '../../components/StateCard';
import StatePanelCard from '../../components/StatePanelCard';
import EventDetailShell from './EventDetailShell';
import styles from './event-detail.module.css';

function normalizeAttackEventRouteId(routeId: string | string[] | undefined) {
  const rawId = Array.isArray(routeId) ? routeId[0] : routeId;

  if (!rawId) {
    return '';
  }

  try {
    const decodedId = decodeURIComponent(rawId).trim();

    if (!/^[1-9]\d*$/.test(decodedId)) {
      return '';
    }

    return Number.isSafeInteger(Number(decodedId)) ? decodedId : '';
  } catch {
    return '';
  }
}

export default function EventDetailPageClient() {
  const { id } = useParams();
  const [data, setData] = useState<AttackEventDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const attackEventId = useMemo(
    () => normalizeAttackEventRouteId(id),
    [id]
  );

  useEffect(() => {
    if (!attackEventId) {
      setData(null);
      setError('事件 ID 无效，请返回列表重新选择攻击事件。');
      setLoading(false);
      return;
    }

    let ignore = false;

    const loadDetail = async () => {
      setLoading(true);
      setError(null);

      try {
        const respData = await getAttackEventDetail(attackEventId);

        if (ignore) {
          return;
        }

        setData(respData);
      } catch (err: any) {
        if (ignore) {
          return;
        }

        setData(null);
        setError(err.message || '攻击事件详情加载失败，请稍后重试。');
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    loadDetail();

    return () => {
      ignore = true;
    };
  }, [attackEventId]);

  if (loading) {
    return (
      <EventDetailShell
        title={attackEventId ? `事件 #${attackEventId}` : '攻击事件详情'}
        summary="正在读取事件摘要、AI 风险分析和原始请求证据。返回入口已保留当前列表筛选参数。"
        busy
      >
        {() => (
          <StatePanelCard
            className={styles.statePanel}
            tone="loading"
            title="正在加载事件详情"
            description="正在读取事件摘要、AI 风险分析和原始请求证据。"
            testId="event-detail-loading-state"
          />
        )}
      </EventDetailShell>
    );
  }

  if (error) {
    const isInvalidIdState = !attackEventId;

    return (
      <EventDetailShell
        title={isInvalidIdState ? '事件 ID 无效' : `事件 #${attackEventId}`}
        summary={
          isInvalidIdState
            ? '当前详情页 URL 中的事件 ID 无效。你可以返回原筛选结果重新选择事件。'
            : '事件详情加载失败。你可以返回原筛选结果重新选择事件，或在列表页调整筛选条件后重试。'
        }
      >
        {({ backHref, backLabel }) => (
          <StatePanelCard
            className={styles.statePanel}
            tone="error"
            title={isInvalidIdState ? '事件 ID 无效' : '事件详情加载失败'}
            description={error}
            actionLabel={backLabel}
            actionHref={backHref}
            testId={isInvalidIdState
              ? 'event-detail-invalid-id-state'
              : 'event-detail-error-state'}
            actionTestId="event-detail-state-back-link"
          />
        )}
      </EventDetailShell>
    );
  }

  if (!data) {
    return (
      <EventDetailShell
        title={attackEventId ? `事件 #${attackEventId}` : '攻击事件详情'}
        summary="未找到该事件。你可以返回原筛选结果重新选择事件，或回到完整攻击事件列表继续排查。"
      >
        {({ backHref, backLabel }) => (
          <StatePanelCard
            className={styles.statePanel}
            tone="empty"
            title="未找到攻击事件详情"
            description="该事件可能已被删除，或当前账号没有访问权限。"
            actionLabel={backLabel}
            actionHref={backHref}
            testId="event-detail-empty-state"
            actionTestId="event-detail-state-back-link"
          />
        )}
      </EventDetailShell>
    );
  }

  const { attackEvent, requestLog, aiRiskResult } = data;

  return (
    <EventDetailShell
      title={`事件 #${attackEvent.id}`}
      summary={attackEvent.summary}
      badge={
        <div
          className={styles.severityBadge}
          style={{ color: getRiskColor(attackEvent.severity) }}
        >
          {formatSeverity(attackEvent.severity)}
        </div>
      }
    >
      {({ backHref, backLabel }) => (
        <>
          <section className={styles.quickFacts} aria-label="事件关键摘要">
            <div className={`glass-panel ${styles.factCard}`}>
              <div className={styles.factLabel}>事件类型</div>
              <div className={styles.factValue}>
                {formatEventType(attackEvent.eventType)}
              </div>
            </div>
            <div className={`glass-panel ${styles.factCard}`}>
              <div className={styles.factLabel}>事件生成时间</div>
              <div className={styles.factValue}>
                {formatDateTime(attackEvent.createdAt)}
              </div>
            </div>
            <div className={`glass-panel ${styles.factCard}`}>
              <div className={styles.factLabel}>客户端 IP</div>
              <div className={styles.factValue}>
                {requestLog.clientIp || '未知'}
              </div>
            </div>
            <div className={`glass-panel ${styles.factCard}`}>
              <div className={styles.factLabel}>请求路径</div>
              <div className={styles.factValue}>{requestLog.path}</div>
            </div>
          </section>

          <div className={styles.grid}>
            <section className={`glass-panel ${styles.panel}`}>
              <div className={styles.panelHeading}>
                <p className={styles.panelEyebrow}>检测信息</p>
                <h2 className={styles.panelTitle}>检测摘要</h2>
              </div>

              <div className={styles.infoList}>
                <div className={styles.infoRow}>
                  <span className={styles.label}>事件类型</span>
                  <span className={styles.value}>
                    {formatEventType(attackEvent.eventType)}
                  </span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.label}>风险等级</span>
                  <span
                    className={styles.value}
                    style={{
                      color: getRiskColor(attackEvent.severity),
                      fontWeight: 700
                    }}
                  >
                    {formatSeverity(attackEvent.severity)}
                  </span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.label}>摘要</span>
                  <span className={styles.value}>{attackEvent.summary}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.label}>检测详情字段</span>
                  <pre className={styles.jsonBlock}>
                    {JSON.stringify(attackEvent.details ?? {}, null, 2)}
                  </pre>
                </div>
              </div>
            </section>

            <section className={`glass-panel ${styles.panel}`}>
              <div className={styles.panelHeading}>
                <p className={styles.panelEyebrow}>风险评分</p>
                <h2 className={styles.panelTitle}>AI 风险分析</h2>
              </div>

              {aiRiskResult ? (
                <div className={styles.aiRiskContainer}>
                  <div
                    className={styles.scoreCircle}
                    style={{
                      borderColor: getRiskColor(aiRiskResult.riskLevel)
                    }}
                  >
                    <span
                      className={styles.scoreValue}
                      style={{ color: getRiskColor(aiRiskResult.riskLevel) }}
                    >
                      {aiRiskResult.riskScore}
                    </span>
                    <span className={styles.scoreLabel}>风险评分</span>
                  </div>

                  <div className={styles.aiDetails}>
                    <div className={styles.aiLevel}>
                      {formatRiskLevel(aiRiskResult.riskLevel)}
                    </div>
                    <p className={styles.aiExplanation}>
                      {aiRiskResult.explanation || 'AI analyzer 未返回说明文本'}
                    </p>
                    <div className={styles.aiMeta}>
                      <span className={styles.metaBadge}>
                        模型 {aiRiskResult.modelName}
                      </span>
                      <span className={styles.metaBadge}>
                        版本 {aiRiskResult.modelVersion}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <StateCard
                  tone="empty"
                  title="暂无 AI 风险分析结果"
                  description="攻击事件已生成，但 AI analyzer 暂未返回风险评分结果。这是符合后端主链路设计的安全降级状态。"
                  actionLabel={backLabel}
                  actionHref={backHref}
                  testId="event-detail-ai-empty-state"
                  actionTestId="event-detail-state-back-link"
                />
              )}
            </section>

            <section className={`glass-panel ${styles.panel} ${styles.fullWidth}`}>
              <div className={styles.panelHeading}>
                <p className={styles.panelEyebrow}>请求证据</p>
                <h2 className={styles.panelTitle}>网络请求证据</h2>
              </div>

              <div className={styles.grid2Col}>
                <div className={styles.infoRow}>
                  <span className={styles.label}>主机名</span>
                  <span className={styles.value}>{requestLog.host}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.label}>HTTP 方法</span>
                  <span className={styles.value}>{requestLog.method}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.label}>请求路径</span>
                  <span className={styles.value}>{requestLog.path}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.label}>查询参数</span>
                  <span className={styles.value}>
                    {requestLog.queryString || '无'}
                  </span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.label}>响应状态码</span>
                  <span className={styles.value}>
                    {requestLog.statusCode ?? '未知'}
                  </span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.label}>请求发生时间</span>
                  <span className={styles.value}>
                    {formatDateTime(requestLog.occurredAt)}
                  </span>
                </div>
                <div className={`${styles.infoRow} ${styles.fullSpan}`}>
                  <span className={styles.label}>User-Agent</span>
                  <span className={`${styles.value} ${styles.longText}`}>
                    {requestLog.userAgent || '未知'}
                  </span>
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </EventDetailShell>
  );
}
