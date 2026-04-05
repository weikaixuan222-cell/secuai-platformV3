'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import type {
  BlockedEntityItem,
  BlockedEntitySource,
  CreateBlockedEntityInput,
  DashboardSiteSummaryItem,
  ProtectionCheckResult,
  SecurityPolicyItem,
  SecurityPolicyMode,
  UpdateSecurityPolicyInput
} from '@/lib/contracts';
import {
  buildPoliciesPagePath,
  buildSiteFilterOptions,
  parseSiteIdFromSearch,
  type SiteFilterOption
} from '@/lib/siteFilters';
import {
  createSiteBlockedEntity,
  deleteSiteBlockedEntity,
  getSiteSecurityPolicy,
  listDashboardSiteSummaries,
  listSiteBlockedEntities,
  runProtectionCheck,
  updateSiteSecurityPolicy
} from '@/lib/services';
import {
  formatBlockedEntitySource,
  formatBlockedEntityType,
  formatDateTime,
  formatProtectionAction,
  formatProtectionReason,
  formatPolicyMode,
  formatSwitchState
} from '@/lib/securityDisplay';
import SiteFilterSelect from '../components/SiteFilterSelect';
import StateCard from '../components/StateCard';
import StatePanelCard from '../components/StatePanelCard';
import styles from './policies.module.css';

interface PolicyPageData {
  siteSummaries: DashboardSiteSummaryItem[];
  securityPolicy: SecurityPolicyItem | null;
  blockedEntities: BlockedEntityItem[];
}

const INITIAL_POLICY_DATA: PolicyPageData = {
  siteSummaries: [],
  securityPolicy: null,
  blockedEntities: []
};

type PolicyDraftState = UpdateSecurityPolicyInput;

interface BlockedEntityFormState {
  entityValue: string;
  reason: string;
  source: BlockedEntitySource;
  expiresAt: string;
}

interface ProtectionSimulatorFormState {
  ingestionKey: string;
  path: string;
  queryString: string;
  clientIp: string;
  userAgent: string;
  referer: string;
}

const INITIAL_BLOCK_FORM_STATE: BlockedEntityFormState = {
  entityValue: '',
  reason: '',
  source: 'manual',
  expiresAt: ''
};

const INITIAL_PROTECTION_FORM_STATE: ProtectionSimulatorFormState = {
  ingestionKey: '',
  path: '/',
  queryString: '',
  clientIp: '',
  userAgent: '',
  referer: ''
};

function buildPolicyDraft(policy: SecurityPolicyItem): PolicyDraftState {
  return {
    mode: policy.mode,
    blockSqlInjection: policy.blockSqlInjection,
    blockXss: policy.blockXss,
    blockSuspiciousUserAgent: policy.blockSuspiciousUserAgent,
    enableRateLimit: policy.enableRateLimit,
    rateLimitThreshold: policy.rateLimitThreshold,
    autoBlockHighRisk: policy.autoBlockHighRisk,
    highRiskScoreThreshold: policy.highRiskScoreThreshold
  };
}

function toOptionalIsoString(value: string): string | null {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

async function waitForVisiblePendingState(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
}

function PolicyStatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className={`${styles.statusBadge} ${enabled ? styles.badgeOn : styles.badgeOff}`}>
      {formatSwitchState(enabled)}
    </span>
  );
}

function buildProtectionResultDescription(result: ProtectionCheckResult): string {
  if (result.reasons.length === 0) {
    return '当前请求样本没有命中任何拦截条件，系统会按当前策略直接放行。';
  }

  if (result.action === 'block') {
    return '当前策略处于防护模式，命中条件后会执行阻断。';
  }

  return '当前策略处于监控模式，命中条件后会保留原因并继续放行。';
}

export default function PoliciesPage() {
  const router = useRouter();
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [siteOptions, setSiteOptions] = useState<SiteFilterOption[]>([]);
  const [data, setData] = useState<PolicyPageData>(INITIAL_POLICY_DATA);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraftState | null>(null);
  const [blockForm, setBlockForm] = useState<BlockedEntityFormState>(
    INITIAL_BLOCK_FORM_STATE
  );
  const [protectionForm, setProtectionForm] = useState<ProtectionSimulatorFormState>(
    INITIAL_PROTECTION_FORM_STATE
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [blockCreating, setBlockCreating] = useState(false);
  const [protectionChecking, setProtectionChecking] = useState(false);
  const [deletingBlockedEntityId, setDeletingBlockedEntityId] = useState<
    number | null
  >(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [protectionResult, setProtectionResult] = useState<ProtectionCheckResult | null>(
    null
  );
  const [protectionError, setProtectionError] = useState<string | null>(null);
  const [protectionErrorCode, setProtectionErrorCode] = useState<string | null>(null);

  const selectedSiteSummary = useMemo(
    () => data.siteSummaries.find((site) => site.siteId === selectedSiteId) || null,
    [data.siteSummaries, selectedSiteId]
  );
  const isDeletingBlockedEntity = deletingBlockedEntityId !== null;
  const isPageBusy =
    loading || policySaving || blockCreating || protectionChecking || isDeletingBlockedEntity;
  const isBlockedEntityFormDisabled =
    loading || blockCreating || isDeletingBlockedEntity || !selectedSiteId;
  const isProtectionSimulatorDisabled =
    loading || protectionChecking || !selectedSiteSummary;

  const loadPolicyData = async (siteIdFromUrl: string) => {
    setLoading(true);
    setError(null);
    setActionMessage(null);
    setActionError(null);
    setProtectionError(null);
    setProtectionErrorCode(null);
    setProtectionResult(null);

    try {
      const summaryResult = await listDashboardSiteSummaries();
      const nextSiteOptions = buildSiteFilterOptions(summaryResult.items);
      const fallbackSiteId = nextSiteOptions[0]?.value || '';
      const nextSiteId = siteIdFromUrl || fallbackSiteId;

      setSiteOptions(nextSiteOptions);
      setSelectedSiteId(nextSiteId);

      if (!nextSiteId) {
        setData({
          siteSummaries: summaryResult.items,
          securityPolicy: null,
          blockedEntities: []
        });
        setPolicyDraft(null);
        setBlockForm(INITIAL_BLOCK_FORM_STATE);
        setProtectionForm(INITIAL_PROTECTION_FORM_STATE);
        return;
      }

      if (nextSiteId !== siteIdFromUrl) {
        router.replace(buildPoliciesPagePath(nextSiteId));
      }

      const [policyResult, blockedEntityResult] = await Promise.all([
        getSiteSecurityPolicy(nextSiteId),
        listSiteBlockedEntities(nextSiteId)
      ]);

      setData({
        siteSummaries: summaryResult.items,
        securityPolicy: policyResult.securityPolicy,
        blockedEntities: blockedEntityResult.items
      });
      setPolicyDraft(buildPolicyDraft(policyResult.securityPolicy));
      setBlockForm(INITIAL_BLOCK_FORM_STATE);
      setProtectionForm(INITIAL_PROTECTION_FORM_STATE);
    } catch (err: any) {
      setData(INITIAL_POLICY_DATA);
      setPolicyDraft(null);
      setBlockForm(INITIAL_BLOCK_FORM_STATE);
      setProtectionForm(INITIAL_PROTECTION_FORM_STATE);
      setError(err.message || '策略页数据加载失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const syncFromUrl = () => {
      void loadPolicyData(parseSiteIdFromSearch(window.location.search));
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);

    return () => {
      window.removeEventListener('popstate', syncFromUrl);
    };
  }, []);

  const applySiteFilter = async (siteId: string) => {
    router.replace(buildPoliciesPagePath(siteId));
    await loadPolicyData(siteId);
  };

  const savePolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedSiteId || !policyDraft) {
      return;
    }

    setPolicySaving(true);
    setActionMessage(null);
    setActionError(null);

    try {
      const result = await updateSiteSecurityPolicy(selectedSiteId, policyDraft);
      setData((current) => ({
        ...current,
        securityPolicy: result.securityPolicy
      }));
      setPolicyDraft(buildPolicyDraft(result.securityPolicy));
      setActionMessage('策略配置已保存，新的防护规则已对当前站点生效。');
    } catch (err: any) {
      setActionError(err.message || '策略配置保存失败，请检查阈值后重试。');
    } finally {
      setPolicySaving(false);
    }
  };

  const createBlockedEntity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedSiteId) {
      return;
    }

    setBlockCreating(true);
    setActionMessage(null);
    setActionError(null);

    try {
      const payload: CreateBlockedEntityInput = {
        entityType: 'ip',
        entityValue: blockForm.entityValue,
        reason: blockForm.reason,
        source: blockForm.source,
        expiresAt: toOptionalIsoString(blockForm.expiresAt)
      };
      const result = await createSiteBlockedEntity(selectedSiteId, payload);

      setData((current) => ({
        ...current,
        blockedEntities: [result.blockedEntity, ...current.blockedEntities]
      }));
      setBlockForm(INITIAL_BLOCK_FORM_STATE);
      setActionMessage('封禁 IP 已新增，当前站点封禁名单已更新。');
    } catch (err: any) {
      setActionError(err.message || '新增封禁 IP 失败，请检查 IP 和封禁原因后重试。');
    } finally {
      setBlockCreating(false);
    }
  };

  const deleteBlockedEntity = async (blockedEntityId: number) => {
    flushSync(() => {
      setDeletingBlockedEntityId(blockedEntityId);
    });
    setActionMessage(null);
    setActionError(null);

    try {
      await Promise.all([
        deleteSiteBlockedEntity(blockedEntityId),
        waitForVisiblePendingState()
      ]);
      setData((current) => ({
        ...current,
        blockedEntities: current.blockedEntities.filter(
          (entity) => entity.id !== blockedEntityId
        )
      }));
      setActionMessage('封禁记录已删除，当前站点封禁名单已更新。');
    } catch (err: any) {
      setActionError(err.message || '删除封禁记录失败，请刷新后重试。');
    } finally {
      setDeletingBlockedEntityId(null);
    }
  };

  const runProtectionSimulator = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedSiteSummary) {
      return;
    }

    setProtectionChecking(true);
    setProtectionError(null);
    setProtectionErrorCode(null);
    setProtectionResult(null);

    try {
      const result = await runProtectionCheck({
        ingestionKey: protectionForm.ingestionKey,
        input: {
          siteId: selectedSiteSummary.siteId,
          occurredAt: new Date().toISOString(),
          method: 'GET',
          host: selectedSiteSummary.siteDomain,
          path: protectionForm.path,
          queryString: protectionForm.queryString,
          clientIp: protectionForm.clientIp,
          userAgent: protectionForm.userAgent,
          referer: protectionForm.referer
        }
      });

      setProtectionResult(result.protection);
    } catch (err: any) {
      setProtectionErrorCode(
        typeof err?.code === 'string' ? err.code : 'UNKNOWN_ERROR'
      );
      setProtectionError(
        err.message || '防护判定失败，请检查站点接入密钥和请求样本后重试。'
      );
    } finally {
      setProtectionChecking(false);
    }
  };

  const updatePolicyBoolean = (
    fieldName:
      | 'blockSqlInjection'
      | 'blockXss'
      | 'blockSuspiciousUserAgent'
      | 'enableRateLimit'
      | 'autoBlockHighRisk',
    value: boolean
  ) => {
    setPolicyDraft((current) =>
      current
        ? {
          ...current,
          [fieldName]: value
        }
        : current
    );
  };

  const updatePolicyMode = (mode: SecurityPolicyMode) => {
    setPolicyDraft((current) =>
      current
        ? {
          ...current,
          mode
        }
        : current
    );
  };

  const updatePolicyNumber = (
    fieldName: 'rateLimitThreshold' | 'highRiskScoreThreshold',
    value: string
  ) => {
    setPolicyDraft((current) =>
      current
        ? {
          ...current,
          [fieldName]: Number(value)
        }
        : current
    );
  };

  const policyRows = policyDraft
    ? [
      {
        label: 'SQL 注入拦截',
        description: '命中 SQL 注入检测信号后，根据当前防护模式执行监控或拦截。',
        fieldName: 'blockSqlInjection' as const,
        enabled: policyDraft.blockSqlInjection
      },
      {
        label: 'XSS 攻击拦截',
        description: '命中 XSS 载荷检测信号后，根据当前防护模式执行监控或拦截。',
        fieldName: 'blockXss' as const,
        enabled: policyDraft.blockXss
      },
      {
        label: '可疑 User-Agent 拦截',
        description: '对明显异常的 User-Agent 请求启用防护策略判定。',
        fieldName: 'blockSuspiciousUserAgent' as const,
        enabled: policyDraft.blockSuspiciousUserAgent
      },
      {
        label: '请求频率限制',
        description: `同一 IP 的近期请求数达到 ${policyDraft.rateLimitThreshold} 次后触发限速判定。`,
        fieldName: 'enableRateLimit' as const,
        enabled: policyDraft.enableRateLimit
      },
      {
        label: '高风险自动封禁',
        description: `AI 风险评分达到 ${policyDraft.highRiskScoreThreshold} 分后，可进入自动封禁流程。`,
        fieldName: 'autoBlockHighRisk' as const,
        enabled: policyDraft.autoBlockHighRisk
      }
    ]
    : [];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>站点防护策略</p>
          <h1 className={styles.title}>策略与封禁管理</h1>
        </div>
        <p className={styles.subtitle}>
          按站点维护防护模式、检测开关、阈值配置和封禁名单；站点范围会同步到 URL，便于回到同一策略视图继续处理。
        </p>
      </header>

      {(actionMessage || actionError) && (
        <div
          className={`${styles.feedbackBanner} ${
            actionError ? styles.errorBanner : styles.successBanner
          }`}
          role={actionError ? 'alert' : 'status'}
          aria-live={actionError ? 'assertive' : 'polite'}
          aria-atomic="true"
          data-feedback-state={actionError ? 'error' : 'success'}
          data-testid="policy-feedback-banner"
        >
          {actionError || actionMessage}
        </div>
      )}

      <form
        className={`glass-panel ${styles.filterPanel}`}
        onSubmit={(event) => event.preventDefault()}
        aria-busy={isPageBusy}
        data-testid="policy-site-filter-form"
      >
        <SiteFilterSelect
          value={selectedSiteId}
          options={siteOptions}
          labelClassName={styles.fieldLabel}
          fieldClassName={styles.fieldGroup}
          selectClassName={styles.fieldControl}
          allSitesLabel="请选择站点"
          disabled={isPageBusy}
          selectId="policy-site-filter"
          testId="policy-site-filter-select"
          onChange={applySiteFilter}
        />
        <div className={styles.filterSummary}>
          当前站点范围：
          {selectedSiteSummary
            ? `${selectedSiteSummary.siteName} / ${selectedSiteSummary.siteDomain}`
            : '暂无可选站点'}
        </div>
      </form>

      <section className={styles.grid}>
        <div
          className={`glass-panel ${styles.policyPanel}`}
          aria-busy={loading || policySaving}
          data-testid="policy-panel"
        >
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>策略配置</p>
              <h2 className={styles.panelTitle}>当前站点防护策略</h2>
            </div>
            {policyDraft ? (
              <span className={`${styles.modeBadge} ${styles[policyDraft.mode]}`}>
                {formatPolicyMode(policyDraft.mode)}
              </span>
            ) : null}
          </div>

          {loading ? (
            <StateCard
              tone="loading"
              title="正在加载站点策略"
              description="正在读取当前站点的防护模式、检测开关和阈值配置。"
            />
          ) : error ? (
            <StateCard
              tone="error"
              title="站点策略加载失败"
              description={error}
              actionLabel="重试加载策略"
              onAction={() => loadPolicyData(selectedSiteId)}
            />
          ) : siteOptions.length === 0 ? (
            <StateCard
              tone="empty"
              title="暂无可配置站点"
              description="当前租户还没有可配置的站点。请先完成站点接入并生成 site-summaries，再回到这里维护防护策略。"
              actionLabel="返回安全总览"
              actionHref="/dashboard"
              testId="policy-no-site-empty-state"
              actionTestId="policy-no-site-empty-action"
            />
          ) : !data.securityPolicy || !policyDraft ? (
            <StateCard
              tone="empty"
              title="请选择一个站点"
              description="选择站点后，这里会显示该站点的防护模式、检测开关和限速/高风险阈值。"
            />
          ) : (
            <form
              className={styles.policyForm}
              onSubmit={savePolicy}
              aria-busy={policySaving}
            >
              <div className={styles.modeFieldset}>
                <span className={styles.inlineLabel}>防护模式</span>
                <div className={styles.modeButtons}>
                  {(['monitor', 'protect'] as SecurityPolicyMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`${styles.modeButton} ${
                        policyDraft.mode === mode ? styles.modeButtonActive : ''
                      }`}
                      onClick={() => updatePolicyMode(mode)}
                      disabled={policySaving}
                      aria-disabled={policySaving}
                      aria-pressed={policyDraft.mode === mode}
                      data-selected-state={
                        policyDraft.mode === mode ? 'active' : 'idle'
                      }
                      data-testid={`policy-mode-${mode}`}
                    >
                      {formatPolicyMode(mode)}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.policyList}>
              {policyRows.map((row) => (
                <article key={row.label} className={styles.policyItem}>
                  <div>
                    <h3 className={styles.itemTitle}>{row.label}</h3>
                    <p className={styles.itemDescription}>{row.description}</p>
                  </div>
                  <label className={styles.switchControl}>
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(event) =>
                        updatePolicyBoolean(row.fieldName, event.target.checked)
                      }
                      disabled={policySaving}
                      aria-disabled={policySaving}
                      className={styles.switchInput}
                      data-testid={`policy-toggle-${row.fieldName}`}
                    />
                    <PolicyStatusBadge enabled={row.enabled} />
                  </label>
                </article>
              ))}
              </div>

              <div className={styles.thresholdGrid}>
                <label className={styles.fieldGroup}>
                  <span className={styles.inlineLabel}>限速阈值</span>
                  <input
                    type="number"
                    min="1"
                    max="100000"
                    value={policyDraft.rateLimitThreshold}
                    onChange={(event) =>
                      updatePolicyNumber('rateLimitThreshold', event.target.value)
                    }
                    className={styles.fieldControl}
                    disabled={policySaving}
                    aria-disabled={policySaving}
                    data-testid="policy-rate-limit-input"
                  />
                </label>

                <label className={styles.fieldGroup}>
                  <span className={styles.inlineLabel}>高风险阈值</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={policyDraft.highRiskScoreThreshold}
                    onChange={(event) =>
                      updatePolicyNumber(
                        'highRiskScoreThreshold',
                        event.target.value
                      )
                    }
                    className={styles.fieldControl}
                    disabled={policySaving}
                    aria-disabled={policySaving}
                    data-testid="policy-high-risk-input"
                  />
                </label>
              </div>

              <div className={styles.policyActions}>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={policySaving}
                  aria-disabled={policySaving}
                  aria-busy={policySaving}
                  data-loading-state={policySaving ? 'saving' : 'idle'}
                  data-testid="policy-save-button"
                >
                  {policySaving ? '正在保存策略...' : '保存策略配置'}
                </button>
              </div>

              <div className={styles.policyMetaRow}>
                <span>最近更新时间 {formatDateTime(data.securityPolicy.updatedAt)}</span>
                <span>策略创建时间 {formatDateTime(data.securityPolicy.createdAt)}</span>
              </div>
            </form>
          )}
        </div>

        <div
          className={`glass-panel ${styles.blockPanel}`}
          aria-busy={loading || blockCreating || isDeletingBlockedEntity}
          data-testid="blocked-entities-panel"
        >
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>封禁名单</p>
              <h2 className={styles.panelTitle}>当前站点封禁 IP</h2>
            </div>
          </div>

          <form
            className={styles.blockCreateForm}
            onSubmit={createBlockedEntity}
            aria-busy={blockCreating}
          >
            <label className={styles.fieldGroup}>
              <span className={styles.inlineLabel}>封禁 IP</span>
              <input
                type="text"
                value={blockForm.entityValue}
                onChange={(event) =>
                  setBlockForm((current) => ({
                    ...current,
                    entityValue: event.target.value
                  }))
                }
                placeholder="例如 203.0.113.10"
                className={styles.fieldControl}
                disabled={isBlockedEntityFormDisabled}
                aria-disabled={isBlockedEntityFormDisabled}
                data-testid="blocked-entity-value-input"
              />
            </label>

            <label className={styles.fieldGroup}>
              <span className={styles.inlineLabel}>封禁原因</span>
              <input
                type="text"
                value={blockForm.reason}
                onChange={(event) =>
                  setBlockForm((current) => ({
                    ...current,
                    reason: event.target.value
                  }))
                }
                placeholder="说明该 IP 的封禁原因和处置背景"
                className={styles.fieldControl}
                disabled={isBlockedEntityFormDisabled}
                aria-disabled={isBlockedEntityFormDisabled}
                data-testid="blocked-entity-reason-input"
              />
            </label>

            <label className={styles.fieldGroup}>
              <span className={styles.inlineLabel}>过期时间</span>
              <input
                type="datetime-local"
                value={blockForm.expiresAt}
                onChange={(event) =>
                  setBlockForm((current) => ({
                    ...current,
                    expiresAt: event.target.value
                  }))
                }
                className={styles.fieldControl}
                disabled={isBlockedEntityFormDisabled}
                aria-disabled={isBlockedEntityFormDisabled}
                data-testid="blocked-entity-expires-at-input"
              />
            </label>

            <button
              type="submit"
              className={styles.primaryButton}
              disabled={isBlockedEntityFormDisabled}
              aria-disabled={isBlockedEntityFormDisabled}
              aria-busy={blockCreating}
              data-loading-state={blockCreating ? 'creating' : 'idle'}
              data-testid="blocked-entity-create-button"
            >
              {blockCreating ? '正在新增封禁...' : '新增封禁 IP'}
            </button>
          </form>

          {loading ? (
            <StateCard
              tone="loading"
              title="正在加载封禁名单"
              description="正在读取当前站点的封禁 IP、来源说明和过期时间。"
            />
          ) : error ? (
            <StateCard
              tone="error"
              title="封禁名单加载失败"
              description={error}
              actionLabel="重试加载封禁名单"
              onAction={() => loadPolicyData(selectedSiteId)}
            />
          ) : siteOptions.length === 0 ? (
            <StateCard
              tone="empty"
              title="暂无封禁名单"
              description="当前租户还没有可关联的站点，因此暂时没有封禁记录可展示。请先接入站点，再回到这里管理封禁 IP。"
              actionLabel="返回安全总览"
              actionHref="/dashboard"
              testId="blocked-entities-no-site-empty-state"
              actionTestId="blocked-entities-no-site-empty-action"
            />
          ) : selectedSiteId && data.blockedEntities.length === 0 ? (
            <StateCard
              tone="empty"
              title="当前站点暂无封禁记录"
              description="该站点目前没有手动或自动生成的封禁 IP。新增封禁后，这里会展示 IP、来源、原因和过期时间。"
              actionLabel="查看攻击事件"
              actionHref={`/dashboard/events?siteId=${encodeURIComponent(selectedSiteId)}`}
            />
          ) : (
            <div className={styles.blockList}>
              {data.blockedEntities.map((entity) => (
                <article key={entity.id} className={styles.blockItem}>
                  <div className={styles.itemTopRow}>
                    <div>
                      <h3 className={styles.itemTitle}>{entity.entityValue}</h3>
                      <p className={styles.itemDescription}>{entity.reason}</p>
                    </div>
                    <span className={styles.entityType}>
                      {formatBlockedEntityType(entity.entityType)}
                    </span>
                  </div>

                  <div className={styles.blockMetaRow}>
                    <span>来源 {formatBlockedEntitySource(entity.source)}</span>
                    <span>创建时间 {formatDateTime(entity.createdAt)}</span>
                    <span>过期时间 {formatDateTime(entity.expiresAt)}</span>
                  </div>

                  <button
                    type="button"
                    className={styles.deleteButton}
                    onClick={() => deleteBlockedEntity(entity.id)}
                    disabled={deletingBlockedEntityId === entity.id}
                    aria-disabled={deletingBlockedEntityId === entity.id}
                    aria-busy={deletingBlockedEntityId === entity.id}
                    data-loading-state={
                      deletingBlockedEntityId === entity.id ? 'deleting' : 'idle'
                    }
                    data-testid={`blocked-entity-delete-${entity.id}`}
                  >
                    {deletingBlockedEntityId === entity.id
                      ? '正在删除...'
                      : '删除封禁记录'}
                  </button>
                </article>
              ))}
            </div>
          )}

          <Link
            href={
              selectedSiteId
                ? `/dashboard/events?siteId=${encodeURIComponent(selectedSiteId)}`
                : '/dashboard/events'
            }
            className={styles.footerLink}
          >
            查看该站点攻击事件
          </Link>
        </div>
      </section>

      {loading ? (
        <StatePanelCard
          className={styles.simulatorPanel}
          panelTestId="protection-simulator-panel"
          tone="loading"
          title="正在加载防护判定模拟器"
          description="正在准备当前站点的模拟参数和策略上下文。"
        />
      ) : error ? (
        <StatePanelCard
          className={styles.simulatorPanel}
          panelTestId="protection-simulator-panel"
          tone="error"
          title="防护判定模拟器加载失败"
          description={error}
          actionLabel="重试加载模拟器"
          onAction={() => loadPolicyData(selectedSiteId)}
        />
      ) : siteOptions.length === 0 ? (
        <StatePanelCard
          className={styles.simulatorPanel}
          panelTestId="protection-simulator-panel"
          tone="empty"
          title="暂无可用于模拟的站点"
          description="当前租户还没有可用于防护判定的站点。请先完成站点接入，再回到这里模拟策略命中结果。"
          actionLabel="返回安全总览"
          actionHref="/dashboard"
          testId="protection-simulator-no-site-empty-state"
        />
      ) : !selectedSiteSummary ? (
        <StatePanelCard
          className={styles.simulatorPanel}
          panelTestId="protection-simulator-panel"
          tone="empty"
          title="请选择一个站点后再模拟"
          description="站点筛选会决定本次模拟使用的站点 ID、域名和对应防护策略。"
        />
      ) : (
        <section
          className={`glass-panel ${styles.simulatorPanel}`}
          aria-busy={protectionChecking}
          data-testid="protection-simulator-panel"
        >
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>防护判定模拟器</p>
              <h2 className={styles.panelTitle}>当前策略下的请求判定</h2>
            </div>
          </div>

          <div className={styles.simulatorSummary}>
            <span>当前站点 ID：{selectedSiteSummary.siteId}</span>
            <span>默认 Host：{selectedSiteSummary.siteDomain}</span>
            <span>默认 Method：GET</span>
          </div>

          <p className={styles.simulatorHint}>
            本模拟器会使用当前时间、固定方法 `GET` 和当前站点域名调用
            `POST /api/v1/protection/check`。由于该接口要求站点接入密钥，必须输入有效的
            ingestion key 才能得到真实判定结果。
          </p>

          <form
            className={styles.simulatorForm}
            onSubmit={runProtectionSimulator}
            aria-busy={protectionChecking}
            data-testid="protection-simulator-form"
          >
            <label className={styles.fieldGroup}>
              <span className={styles.inlineLabel}>站点接入密钥</span>
              <input
                type="password"
                value={protectionForm.ingestionKey}
                onChange={(event) =>
                  setProtectionForm((current) => ({
                    ...current,
                    ingestionKey: event.target.value
                  }))
                }
                placeholder="输入当前站点的 ingestion key"
                className={styles.fieldControl}
                disabled={isProtectionSimulatorDisabled}
                aria-disabled={isProtectionSimulatorDisabled}
                data-testid="protection-simulator-ingestion-key-input"
              />
            </label>

            <div className={styles.simulatorGrid}>
              <label className={styles.fieldGroup}>
                <span className={styles.inlineLabel}>请求路径</span>
                <input
                  type="text"
                  value={protectionForm.path}
                  onChange={(event) =>
                    setProtectionForm((current) => ({
                      ...current,
                      path: event.target.value
                    }))
                  }
                  placeholder="/products"
                  className={styles.fieldControl}
                  disabled={isProtectionSimulatorDisabled}
                  aria-disabled={isProtectionSimulatorDisabled}
                  data-testid="protection-simulator-path-input"
                />
              </label>

              <label className={styles.fieldGroup}>
                <span className={styles.inlineLabel}>查询字符串</span>
                <input
                  type="text"
                  value={protectionForm.queryString}
                  onChange={(event) =>
                    setProtectionForm((current) => ({
                      ...current,
                      queryString: event.target.value
                    }))
                  }
                  placeholder="id=1"
                  className={styles.fieldControl}
                  disabled={isProtectionSimulatorDisabled}
                  aria-disabled={isProtectionSimulatorDisabled}
                  data-testid="protection-simulator-query-input"
                />
              </label>

              <label className={styles.fieldGroup}>
                <span className={styles.inlineLabel}>客户端 IP</span>
                <input
                  type="text"
                  value={protectionForm.clientIp}
                  onChange={(event) =>
                    setProtectionForm((current) => ({
                      ...current,
                      clientIp: event.target.value
                    }))
                  }
                  placeholder="203.0.113.10"
                  className={styles.fieldControl}
                  disabled={isProtectionSimulatorDisabled}
                  aria-disabled={isProtectionSimulatorDisabled}
                  data-testid="protection-simulator-client-ip-input"
                />
              </label>

              <label className={styles.fieldGroup}>
                <span className={styles.inlineLabel}>User-Agent</span>
                <input
                  type="text"
                  value={protectionForm.userAgent}
                  onChange={(event) =>
                    setProtectionForm((current) => ({
                      ...current,
                      userAgent: event.target.value
                    }))
                  }
                  placeholder="Mozilla/5.0"
                  className={styles.fieldControl}
                  disabled={isProtectionSimulatorDisabled}
                  aria-disabled={isProtectionSimulatorDisabled}
                  data-testid="protection-simulator-user-agent-input"
                />
              </label>
            </div>

            <label className={styles.fieldGroup}>
              <span className={styles.inlineLabel}>Referer</span>
              <input
                type="text"
                value={protectionForm.referer}
                onChange={(event) =>
                  setProtectionForm((current) => ({
                    ...current,
                    referer: event.target.value
                  }))
                }
                placeholder="https://example.com/search"
                className={styles.fieldControl}
                disabled={isProtectionSimulatorDisabled}
                aria-disabled={isProtectionSimulatorDisabled}
                data-testid="protection-simulator-referer-input"
              />
            </label>

            <div className={styles.policyActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={isProtectionSimulatorDisabled}
                aria-disabled={isProtectionSimulatorDisabled}
                aria-busy={protectionChecking}
                data-loading-state={protectionChecking ? 'checking' : 'idle'}
                data-testid="protection-simulator-submit-button"
              >
                {protectionChecking ? '正在执行判定...' : '执行防护判定'}
              </button>
            </div>
          </form>

          {protectionError ? (
            <div
              className={`${styles.feedbackBanner} ${styles.errorBanner}`}
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              data-error-code={protectionErrorCode || ''}
              data-testid="protection-simulator-feedback"
            >
              {protectionError}
            </div>
          ) : null}

          {protectionResult ? (
            <article
              className={styles.simulatorResultCard}
              role="status"
              aria-live="polite"
              data-testid="protection-simulator-result"
            >
              <div className={styles.itemTopRow}>
                <div>
                  <h3 className={styles.itemTitle}>判定结果</h3>
                  <p className={styles.itemDescription}>
                    {buildProtectionResultDescription(protectionResult)}
                  </p>
                </div>
                <div className={styles.resultBadgeGroup}>
                  <span
                    className={`${styles.modeBadge} ${styles[protectionResult.mode]}`}
                    data-testid="protection-simulator-mode"
                  >
                    {formatPolicyMode(protectionResult.mode)}
                  </span>
                  <span
                    className={`${styles.actionBadge} ${styles[`action${protectionResult.action[0].toUpperCase()}${protectionResult.action.slice(1)}`]}`}
                    data-testid="protection-simulator-action"
                  >
                    {formatProtectionAction(protectionResult.action)}
                  </span>
                </div>
              </div>

              {protectionResult.reasons.length > 0 ? (
                <ul
                  className={styles.reasonList}
                  data-testid="protection-simulator-reasons"
                >
                  {protectionResult.reasons.map((reason) => (
                    <li key={reason} className={styles.reasonItem}>
                      <span>{formatProtectionReason(reason)}</span>
                      <code className={styles.reasonCode}>{reason}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p
                  className={styles.emptyReasonText}
                  data-testid="protection-simulator-reasons"
                >
                  未命中任何阻断条件。
                </p>
              )}
            </article>
          ) : (
            <StateCard
              tone="empty"
              title="输入请求样本后执行判定"
              description="可以用路径、查询字符串、客户端 IP、User-Agent 和 Referer 模拟一次真实判定，查看当前策略会放行、监控还是拦截。"
              testId="protection-simulator-empty-state"
            />
          )}
        </section>
      )}
    </div>
  );
}
