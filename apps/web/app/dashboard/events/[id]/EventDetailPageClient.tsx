'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { AttackEventDetailResponse } from '@/lib/contracts';
import type { BlockedEntityItem } from '@/lib/contracts/policy';
import { getAttackEventDetail } from '@/lib/services';
import { createSiteBlockedEntity, listSiteBlockedEntities } from '@/lib/services/policy';
import { buildPoliciesPagePath } from '@/lib/siteFilters';
import {
  QUICK_BLOCK_REASON_FROM_EVENT_DETAIL,
  formatBlockedEntityOrigin,
  formatBlockedEntitySource,
  formatDateTime,
  formatEventType,
  formatIsActive,
  formatProtectionAction,
  formatProtectionReason,
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

const EVENT_REASON_HINTS: Record<string, string> = {
  blocked_ip: '当前请求 IP 已命中站点封禁名单，因此会触发封禁类判定。',
  blocked_rate_limit: '同一来源在短时间内请求过快，已触发站点限速规则。',
  blocked_sql_injection: '请求文本命中了 SQL 注入防护规则，因此进入拦截类判定。',
  blocked_xss: '请求文本命中了 XSS 防护规则，因此进入拦截类判定。',
  blocked_suspicious_user_agent: '当前 User-Agent 命中了可疑扫描工具规则，因此进入防护判定。',
  'mvp-sqli-keyword': '当前请求命中了 SQL 注入关键词规则，因此生成了这条检测事件。',
  'mvp-xss-payload': '当前请求命中了 XSS 攻击载荷规则，因此生成了这条检测事件。',
  'mvp-suspicious-user-agent': '当前请求的 User-Agent 命中了扫描或枚举工具规则，因此生成了这条检测事件。',
  'mvp-high-frequency-access': '当前客户端在短时间内请求过于频繁，因此生成了这条检测事件。'
};

function collectReasonCodes(details: Record<string, unknown> | null): string[] {
  if (!details) {
    return [];
  }

  const codes: string[] = [];
  const pushCode = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }

    const normalizedValue = value.trim();

    if (!normalizedValue || codes.includes(normalizedValue)) {
      return;
    }

    codes.push(normalizedValue);
  };

  pushCode(details.matchedRule);
  pushCode(details.reasonCode);

  if (Array.isArray(details.reasons)) {
    details.reasons.forEach(pushCode);
  }

  return codes;
}

function buildReasonSummary(details: Record<string, unknown> | null): {
  primaryCode: string;
  explanation: string;
  extraCount: number;
} | null {
  const reasonCodes = collectReasonCodes(details);

  if (reasonCodes.length === 0) {
    return null;
  }

  const [primaryCode] = reasonCodes;

  return {
    primaryCode,
    explanation:
      EVENT_REASON_HINTS[primaryCode] ||
      '当前请求触发了暂未补充详细解释的检测规则，请结合下方检测摘要排查原始请求特征。',
    extraCount: Math.max(0, reasonCodes.length - 1)
  };
}

function isActiveBlockedIp(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return true;
  }

  const expiresAtMs = Date.parse(expiresAt);

  if (Number.isNaN(expiresAtMs)) {
    return true;
  }

  return expiresAtMs > Date.now();
}

function buildProtectionTraceSummary(
  protectionEnforcement: AttackEventDetailResponse['protectionEnforcement']
): string | null {
  if (!protectionEnforcement) {
    return null;
  }

  const reasonsText = protectionEnforcement.reasons.length > 0
    ? protectionEnforcement.reasons.map((reason) => formatProtectionReason(reason as never)).join('、')
    : '无';

  return `当前防护轨迹：${protectionEnforcement.mode === 'protect' ? '防护模式' : '监控模式'}，结果为${formatProtectionAction(protectionEnforcement.action)}，命中原因：${reasonsText}。`;
}

function buildDispositionSummaryText(input: {
  dispositionSummary: AttackEventDetailResponse['dispositionSummary'];
  activeBlockedEntity: AttackEventDetailResponse['activeBlockedEntity'];
}): string | null {
  const { dispositionSummary, activeBlockedEntity } = input;

  if (dispositionSummary.blockedEntityCount === 0) {
    return null;
  }

  if (!activeBlockedEntity || dispositionSummary.status !== 'active') {
    return `本事件已关联 ${dispositionSummary.blockedEntityCount} 条处置记录，当前没有仍在生效的封禁。`;
  }

  const originLabel =
    formatBlockedEntityOrigin(
      activeBlockedEntity.source,
      activeBlockedEntity.reason,
      activeBlockedEntity.originKind
    ) || formatBlockedEntitySource(activeBlockedEntity.source);

  return `本事件当前关联的处置对象为 ${activeBlockedEntity.entityType.toUpperCase()} ${activeBlockedEntity.entityValue}，来源：${originLabel}，当前状态：${formatIsActive(activeBlockedEntity.isActive)}。`;
}

function buildDispositionEventReference(input: {
  currentAttackEventId: number;
  dispositionSummary: AttackEventDetailResponse['dispositionSummary'];
  activeBlockedEntity: AttackEventDetailResponse['activeBlockedEntity'];
}): {
  relatedAttackEventId: number;
  isCurrentEvent: boolean;
} | null {
  const relatedAttackEventId =
    input.activeBlockedEntity?.attackEventId ?? input.dispositionSummary.activeAttackEventId;

  if (!relatedAttackEventId) {
    return null;
  }

  return {
    relatedAttackEventId,
    isCurrentEvent: relatedAttackEventId === input.currentAttackEventId
  };
}

function normalizeBlockedEntityForDetail(
  blockedEntity: BlockedEntityItem
): AttackEventDetailResponse['blockedEntities'][number] {
  const fallbackOriginKind = blockedEntity.source === 'automatic' ? 'automatic' : 'manual';

  return {
    ...blockedEntity,
    attackEventId: blockedEntity.attackEventId ?? null,
    originKind: blockedEntity.originKind ?? fallbackOriginKind,
    isActive: blockedEntity.isActive ?? isActiveBlockedIp(blockedEntity.expiresAt)
  };
}

export default function EventDetailPageClient() {
  const { id } = useParams();
  const [data, setData] = useState<AttackEventDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockingIp, setBlockingIp] = useState(false);
  const [blockIpFeedback, setBlockIpFeedback] = useState<string | null>(null);
  const [blockIpFeedbackTone, setBlockIpFeedbackTone] = useState<'success' | 'error'>('success');
  const [blockedIpState, setBlockedIpState] = useState<'checking' | 'blocked' | 'ready' | 'unknown'>('unknown');

  const attackEventId = useMemo(() => normalizeAttackEventRouteId(id), [id]);

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
      setBlockIpFeedback(null);
      setBlockIpFeedbackTone('success');
      setBlockedIpState('unknown');
      setBlockingIp(false);

      try {
        const respData = await getAttackEventDetail(attackEventId);

        if (!ignore) {
          setData(respData);
        }
      } catch (err: any) {
        if (!ignore) {
          setData(null);
          setError(err.message || '攻击事件详情加载失败，请稍后重试。');
        }
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

  useEffect(() => {
    if (!data) {
      return;
    }

    const siteId = data.attackEvent.siteId?.trim();
    const nextClientIp = data.requestLog.clientIp?.trim() || '';

    if (!siteId || !nextClientIp) {
      setBlockedIpState('unknown');
      return;
    }

    let ignore = false;

    const loadBlockedIpState = async () => {
      setBlockedIpState('checking');

      try {
        const allBlocked = await listSiteBlockedEntities(siteId);

        if (ignore) {
          return;
        }

        const isBlocked = allBlocked.items.some(
          (item) =>
            item.entityType === 'ip' &&
            item.entityValue.trim() === nextClientIp &&
            isActiveBlockedIp(item.expiresAt)
        );

        setBlockedIpState(isBlocked ? 'blocked' : 'ready');
      } catch {
        if (!ignore) {
          setBlockedIpState('unknown');
        }
      }
    };

    loadBlockedIpState();

    return () => {
      ignore = true;
    };
  }, [data]);

  if (loading) {
    return (
      <EventDetailShell
        title={attackEventId ? `事件 #${attackEventId}` : '攻击事件详情'}
        summary="正在读取事件摘要、AI 风险分析和原始请求证据。返回入口会保留当前列表筛选参数。"
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
            testId={isInvalidIdState ? 'event-detail-invalid-id-state' : 'event-detail-error-state'}
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

  const { attackEvent, requestLog, aiRiskResult, activeBlockedEntity, dispositionSummary, protectionEnforcement } = data;
  const reasonSummary = buildReasonSummary(attackEvent.details);
  const clientIp = requestLog.clientIp?.trim() || '';
  const canBlockClientIp = Boolean(clientIp && attackEvent.siteId);
  const isCheckingBlockedIpState = canBlockClientIp && blockedIpState === 'checking';
  const isClientIpBlocked = canBlockClientIp && blockedIpState === 'blocked';
  const showBlockedIpStatus = isClientIpBlocked && !blockIpFeedback;
  const currentDispositionSummary = buildDispositionSummaryText({
    dispositionSummary,
    activeBlockedEntity
  });
  const dispositionEventReference = buildDispositionEventReference({
    currentAttackEventId: Number(attackEvent.id),
    dispositionSummary,
    activeBlockedEntity
  });
  const protectionTraceSummary = buildProtectionTraceSummary(protectionEnforcement);

  const handleBlockClientIp = async () => {
    if (!canBlockClientIp || blockingIp || isClientIpBlocked) {
      return;
    }

    setBlockingIp(true);
    setBlockIpFeedback(null);
    setBlockIpFeedbackTone('success');

    try {
      const newBlock = await createSiteBlockedEntity(attackEvent.siteId, {
        entityType: 'ip',
        entityValue: clientIp,
        reason: QUICK_BLOCK_REASON_FROM_EVENT_DETAIL,
        source: 'manual',
        expiresAt: null,
        attackEventId: Number(attackEventId)
      });

      setBlockedIpState('blocked');
      setData((currentData) => {
        if (!currentData) {
          return currentData;
        }

        const nextBlockedEntity = normalizeBlockedEntityForDetail(newBlock.blockedEntity);
        const nextBlockedEntities = [nextBlockedEntity, ...currentData.blockedEntities];

        return {
          ...currentData,
          blockedEntities: nextBlockedEntities,
          activeBlockedEntity: nextBlockedEntity,
          dispositionSummary: {
            status: 'active',
            blockedEntityCount: nextBlockedEntities.length,
            activeBlockedEntityId: nextBlockedEntity.id,
            activeEntityType: nextBlockedEntity.entityType,
            activeEntityValue: nextBlockedEntity.entityValue,
            activeSource: nextBlockedEntity.source,
            activeOriginKind: nextBlockedEntity.originKind as 'manual' | 'automatic' | 'event_disposition',
            activeAttackEventId: nextBlockedEntity.attackEventId
          }
        };
      });
      setBlockIpFeedback('已加入当前站点封禁名单。');
      setBlockIpFeedbackTone('success');
    } catch (err: any) {
      setBlockIpFeedback(err?.message || '封禁失败，请稍后重试。');
      setBlockIpFeedbackTone('error');
    } finally {
      setBlockingIp(false);
    }
  };

  return (
    <EventDetailShell
      title={`事件 #${attackEvent.id}`}
      summary={attackEvent.summary}
      badge={(
        <div
          className={styles.severityBadge}
          style={{ color: getRiskColor(attackEvent.severity) }}
        >
          {formatSeverity(attackEvent.severity)}
        </div>
      )}
    >
      {({ backHref, backLabel }) => (
        <>
          {reasonSummary ? (
            <section
              className={styles.reasonSummary}
              aria-label="当前命中原因说明"
              data-testid="event-detail-reason-summary"
            >
              <div className={styles.reasonSummaryRow}>
                <span className={styles.reasonLabel}>命中原因</span>
                <code
                  className={styles.reasonCode}
                  data-testid="event-detail-reason-code"
                >
                  {reasonSummary.primaryCode}
                </code>
                {reasonSummary.extraCount > 0 ? (
                  <span className={styles.reasonMore}>等 {reasonSummary.extraCount + 1} 项</span>
                ) : null}
              </div>
              <p
                className={styles.reasonHint}
                data-testid="event-detail-reason-hint"
              >
                {reasonSummary.explanation}
              </p>
            </section>
          ) : null}

          <section className={styles.quickFacts} aria-label="事件关键摘要">
            <div className={`glass-panel ${styles.factCard}`}>
              <div className={styles.factLabel}>事件类型</div>
              <div className={styles.factValue}>{formatEventType(attackEvent.eventType)}</div>
            </div>
            <div className={`glass-panel ${styles.factCard}`}>
              <div className={styles.factLabel}>事件生成时间</div>
              <div className={styles.factValue}>{formatDateTime(attackEvent.createdAt)}</div>
            </div>
            <div className={`glass-panel ${styles.factCard}`}>
              <div className={styles.factLabel}>客户端 IP</div>
              <div className={styles.factValue}>
                <div className={styles.factValueRow}>
                  <span>{requestLog.clientIp || '未知'}</span>
                  {canBlockClientIp ? (
                    <button
                      type="button"
                      className={styles.blockIpButton}
                      onClick={handleBlockClientIp}
                      disabled={blockingIp || isClientIpBlocked || isCheckingBlockedIpState}
                      aria-busy={blockingIp}
                      data-testid="event-detail-block-ip-button"
                    >
                      {isClientIpBlocked ? '已封禁' : blockingIp ? '封禁中...' : '封禁该 IP'}
                    </button>
                  ) : null}
                </div>

                {currentDispositionSummary || protectionTraceSummary ? (
                  <div
                    className={styles.associatedBlocks}
                    data-testid="event-detail-associated-blocks"
                  >
                    {currentDispositionSummary ? (
                      <p
                        className={styles.blockIpStatus}
                        role="status"
                        aria-live="polite"
                      >
                        {currentDispositionSummary}
                        {attackEvent.siteId ? (
                          <>
                            {' '}
                            <Link
                              href={buildPoliciesPagePath(attackEvent.siteId)}
                              className={styles.blockIpFeedbackLink}
                            >
                              查看当前站点封禁名单
                            </Link>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    {dispositionEventReference ? (
                      <p
                        className={styles.blockIpStatus}
                        data-testid="event-detail-associated-event"
                      >
                        {dispositionEventReference.isCurrentEvent ? (
                          `关联事件 #${dispositionEventReference.relatedAttackEventId}（当前事件）`
                        ) : (
                          <>
                            关联事件{' '}
                            <Link
                              href={`/dashboard/events/${dispositionEventReference.relatedAttackEventId}?siteId=${encodeURIComponent(attackEvent.siteId)}`}
                              className={styles.blockIpFeedbackLink}
                              data-testid="event-detail-associated-event-link"
                            >
                              #{dispositionEventReference.relatedAttackEventId}
                            </Link>
                          </>
                        )}
                      </p>
                    ) : null}
                    {protectionTraceSummary ? (
                      <p
                        className={styles.blockIpStatus}
                        data-testid="event-detail-protection-trace"
                      >
                        {protectionTraceSummary}
                      </p>
                    ) : null}
                  </div>
                ) : showBlockedIpStatus ? (
                  <p
                    className={styles.blockIpStatus}
                    role="status"
                    aria-live="polite"
                    data-testid="event-detail-block-ip-status"
                  >
                    当前 IP 已在当前站点全局封禁名单中。
                    {attackEvent.siteId ? (
                      <>
                        {' '}
                        <Link
                          href={buildPoliciesPagePath(attackEvent.siteId)}
                          className={styles.blockIpFeedbackLink}
                        >
                          查看当前站点封禁名单
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}

                {blockIpFeedback ? (
                  <p
                    className={
                      blockIpFeedbackTone === 'error'
                        ? `${styles.blockIpFeedback} ${styles.blockIpFeedbackError}`
                        : styles.blockIpFeedback
                    }
                    role="status"
                    aria-live="polite"
                    data-testid="event-detail-block-ip-feedback"
                  >
                    {blockIpFeedback}
                    {blockIpFeedbackTone === 'success' && attackEvent.siteId ? (
                      <>
                        {' '}
                        <Link
                          href={buildPoliciesPagePath(attackEvent.siteId)}
                          className={styles.blockIpFeedbackLink}
                          data-testid="event-detail-block-ip-feedback-link"
                        >
                          查看当前站点封禁名单
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
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
                  <span className={styles.value}>{formatEventType(attackEvent.eventType)}</span>
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
                      {aiRiskResult.explanation || 'AI analyzer 未返回说明文本。'}
                    </p>
                    <div className={styles.aiMeta}>
                      <span className={styles.metaBadge}>模型 {aiRiskResult.modelName}</span>
                      <span className={styles.metaBadge}>版本 {aiRiskResult.modelVersion}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <StateCard
                  tone="empty"
                  title="暂无 AI 风险分析结果"
                  description="攻击事件已记录，但 AI 风险分析服务暂未返回评分。这不影响基础安全防护策略的正常生效。"
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
                  <span className={styles.value}>{requestLog.queryString || '无'}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.label}>响应状态码</span>
                  <span className={styles.value}>{requestLog.statusCode ?? '未知'}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.label}>请求发生时间</span>
                  <span className={styles.value}>{formatDateTime(requestLog.occurredAt)}</span>
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
