'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { SiteItem, SiteStatus, UpdateSiteInput } from '@/lib/contracts';
import { buildSitesPagePath, parseSiteIdFromSearch } from '@/lib/siteFilters';
import { createSite, deleteSite, listSites, updateSite } from '@/lib/services';
import StateCard from '../components/StateCard';
import styles from './sites.module.css';

interface SiteFormState {
  name: string;
  domain: string;
  status: SiteStatus;
}

interface SiteFieldErrors {
  name?: string;
  domain?: string;
}

interface FeedbackState {
  tone: 'success' | 'error';
  message: string;
}

interface LatestCreateState {
  siteId: string;
  siteName: string;
  siteDomain: string;
  ingestionKey: string;
}

const INITIAL_FORM_STATE: SiteFormState = {
  name: '',
  domain: '',
  status: 'active'
};

function normalizeSiteName(name: string): string {
  return name.trim();
}

function normalizeSiteDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function validateSiteForm(input: SiteFormState): SiteFieldErrors {
  const normalizedName = normalizeSiteName(input.name);
  const normalizedDomain = normalizeSiteDomain(input.domain);
  const nextErrors: SiteFieldErrors = {};

  if (normalizedName.length < 2 || normalizedName.length > 120) {
    nextErrors.name = '站点名称长度必须在 2 到 120 个字符之间。';
  }

  if (!normalizedDomain) {
    nextErrors.domain = '请输入站点域名。';
  } else if (
    normalizedDomain.length < 4 ||
    normalizedDomain.length > 255 ||
    normalizedDomain.includes('://') ||
    normalizedDomain.includes('/') ||
    normalizedDomain.includes('?') ||
    normalizedDomain.includes('#') ||
    /\s/.test(normalizedDomain) ||
    !normalizedDomain.includes('.')
  ) {
    nextErrors.domain = '请输入不包含协议和路径的有效域名，例如 shop.example.com。';
  }

  return nextErrors;
}

function countSitesByStatus(items: SiteItem[], status: SiteStatus): number {
  return items.filter((item) => item.status === status).length;
}

export default function SiteManagementPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [formState, setFormState] = useState<SiteFormState>(INITIAL_FORM_STATE);
  const [fieldErrors, setFieldErrors] = useState<SiteFieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [latestCreate, setLatestCreate] = useState<LatestCreateState | null>(null);

  const selectedSite = useMemo(
    () => sites.find((item) => item.id === selectedSiteId) ?? null,
    [selectedSiteId, sites]
  );
  const isEditMode = Boolean(selectedSite);
  const isCreateMode = !selectedSite;
  const activeSiteCount = useMemo(() => countSitesByStatus(sites, 'active'), [sites]);
  const inactiveSiteCount = useMemo(() => countSitesByStatus(sites, 'inactive'), [sites]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!selectedSite) {
      setFormState(INITIAL_FORM_STATE);
      setDeleteConfirming(false);
      return;
    }

    setFormState({
      name: selectedSite.name,
      domain: selectedSite.domain,
      status: selectedSite.status
    });
    setDeleteConfirming(false);
  }, [selectedSite?.id, selectedSite?.name, selectedSite?.domain, selectedSite?.status]);

  const loadSiteData = async (siteIdFromUrl: string) => {
    setLoading(true);

    try {
      const result = await listSites();
      const nextItems = result.items;
      const nextSiteId =
        nextItems.find((item) => item.id === siteIdFromUrl)?.id ??
        nextItems[0]?.id ??
        '';

      setSites(nextItems);
      setSelectedSiteId(nextSiteId);
      setFieldErrors({});

      if (siteIdFromUrl !== nextSiteId) {
        router.replace(buildSitesPagePath(nextSiteId));
      }
    } catch (error: any) {
      setSites([]);
      setSelectedSiteId('');
      setFeedback({
        tone: 'error',
        message: error.message || '站点列表加载失败，请稍后重试。'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const syncFromUrl = () => {
      void loadSiteData(parseSiteIdFromSearch(window.location.search));
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);

    return () => {
      window.removeEventListener('popstate', syncFromUrl);
    };
  }, []);

  const startCreateMode = () => {
    setSelectedSiteId('');
    setFormState(INITIAL_FORM_STATE);
    setFieldErrors({});
    setDeleteConfirming(false);
    setLatestCreate(null);
    router.replace(buildSitesPagePath(''));
  };

  const selectSite = (siteId: string) => {
    setSelectedSiteId(siteId);
    setFieldErrors({});
    setDeleteConfirming(false);
    if (latestCreate?.siteId !== siteId) {
      setLatestCreate(null);
    }
    router.replace(buildSitesPagePath(siteId));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validateSiteForm(formState);
    setFieldErrors(nextErrors);
    setFeedback(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSubmitting(true);

    try {
      if (selectedSite) {
        const payload: UpdateSiteInput = {
          name: normalizeSiteName(formState.name),
          domain: normalizeSiteDomain(formState.domain),
          status: formState.status
        };
        const result = await updateSite(selectedSite.id, payload);

        setSites((current) =>
          current.map((item) => (item.id === result.site.id ? result.site : item))
        );
        setFeedback({
          tone: 'success',
          message: '站点配置已保存，列表和当前编辑内容已同步更新。'
        });
        setLatestCreate((current) =>
          current && current.siteId === result.site.id
            ? {
                ...current,
                siteName: result.site.name,
                siteDomain: result.site.domain
              }
            : current
        );
      } else {
        const result = await createSite({
          name: normalizeSiteName(formState.name),
          domain: normalizeSiteDomain(formState.domain)
        });

        setSites((current) => [result.site, ...current]);
        setSelectedSiteId(result.site.id);
        setLatestCreate({
          siteId: result.site.id,
          siteName: result.site.name,
          siteDomain: result.site.domain,
          ingestionKey: result.ingestionKey
        });
        setFeedback({
          tone: 'success',
          message: '站点已创建，页面下方会保留本次 ingestion key 和下一步入口，方便继续完成接入。'
        });
        router.replace(buildSitesPagePath(result.site.id));
      }
    } catch (error: any) {
      setFeedback({
        tone: 'error',
        message: error.message || '站点保存失败，请检查输入后重试。'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDeleteSite = async () => {
    if (!selectedSite) {
      return;
    }

    setDeleting(true);
    setFeedback(null);

    try {
      const result = await deleteSite(selectedSite.id);
      const remainingSites = sites.filter((item) => item.id !== result.site.id);
      const nextSelectedSiteId = remainingSites[0]?.id ?? '';

      setSites(remainingSites);
      setSelectedSiteId(nextSelectedSiteId);
      setDeleteConfirming(false);
      setLatestCreate(null);
      setFieldErrors({});
      setFeedback({
        tone: 'success',
        message: `站点 ${result.site.name} 已删除，当前列表已更新。`
      });
      router.replace(buildSitesPagePath(nextSelectedSiteId));
    } catch (error: any) {
      setFeedback({
        tone: 'error',
        message: error.message || '删除站点失败，请稍后重试。'
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className={styles.container}
      data-testid="site-management-page"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>站点接入管理</p>
          <h1 className={styles.title}>站点管理</h1>
        </div>
        <p className={styles.subtitle}>
          用最小闭环维护站点列表、接入域名和启用状态。新建成功后会直接给出 ingestion
          key 和下一步入口，方便继续进入策略页或事件页。
        </p>
      </header>

      {feedback ? (
        <div
          className={`${styles.feedbackBanner} ${
            feedback.tone === 'error' ? styles.errorBanner : styles.successBanner
          }`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          aria-live={feedback.tone === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          data-feedback-state={feedback.tone}
          data-testid="site-feedback-banner"
        >
          {feedback.message}
        </div>
      ) : null}

      <section className={styles.grid}>
        <section
          className={`glass-panel ${styles.listPanel}`}
          aria-busy={loading}
          data-testid="site-list-panel"
        >
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>站点列表</p>
              <h2 className={styles.panelTitle}>当前租户下的站点</h2>
              <p className={styles.panelHint}>
                先确认当前有哪些站点，再决定继续新增、修改域名或执行删除。
              </p>
              <div className={styles.listSummary}>
                <span className={styles.summaryBadge}>总计 {sites.length}</span>
                <span className={styles.summaryBadge}>active {activeSiteCount}</span>
                <span className={styles.summaryBadge}>inactive {inactiveSiteCount}</span>
              </div>
            </div>

            <button
              type="button"
              className={styles.primaryButton}
              onClick={startCreateMode}
              disabled={loading || submitting || deleting || isCreateMode}
              aria-disabled={loading || submitting || deleting || isCreateMode}
              title={isCreateMode ? '当前已经处于新增站点模式，请直接填写右侧表单。' : undefined}
              data-testid="site-start-create-button"
            >
              {isCreateMode ? '当前为新增模式' : '新增站点'}
            </button>
          </div>

          {loading ? (
            <StateCard
              tone="loading"
              title="正在加载站点列表"
              description="正在读取当前租户下的站点名称、域名和状态。"
            />
          ) : sites.length === 0 ? (
            <StateCard
              tone="empty"
              title="当前还没有站点"
              description="先新增一个站点，随后就可以继续配置安全策略并查看事件。"
              actionLabel="开始新增站点"
              onAction={startCreateMode}
              testId="site-list-empty-state"
            />
          ) : (
            <div className={styles.siteList} data-testid="site-list">
              {sites.map((site) => {
                const isSelected = site.id === selectedSiteId;

                return (
                  <button
                    key={site.id}
                    type="button"
                    className={`${styles.siteListItem} ${
                      isSelected ? styles.siteListItemSelected : ''
                    }`}
                    onClick={() => selectSite(site.id)}
                    data-selected-state={isSelected ? 'active' : 'idle'}
                    data-testid={`site-list-item-${site.id}`}
                  >
                    <div className={styles.siteItemTop}>
                      <div>
                        <div className={styles.siteName}>{site.name}</div>
                        <div className={styles.siteDomain}>{site.domain}</div>
                      </div>
                      <span
                        className={`${styles.statusBadge} ${
                          site.status === 'active' ? styles.statusActive : styles.statusInactive
                        }`}
                      >
                        {site.status}
                      </span>
                    </div>

                    <div className={styles.siteMetaRow}>
                      <span>创建于 {new Date(site.createdAt).toLocaleString()}</span>
                      <span>最近更新 {new Date(site.updatedAt).toLocaleString()}</span>
                      {isSelected ? <code>当前编辑中</code> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section
          className={`glass-panel ${styles.editorPanel}`}
          aria-busy={loading || submitting || deleting}
          data-testid="site-editor-panel"
        >
          <div className={styles.editorTopBar}>
            <div>
              <p className={styles.panelEyebrow}>站点表单</p>
              <h2 className={styles.panelTitle}>{isEditMode ? '修改站点' : '新增站点'}</h2>
              <p className={styles.modeText} data-testid="site-form-mode">
                {isEditMode
                  ? '当前主操作是保存站点配置；删除被收进单独确认区，避免误触。'
                  : '当前主操作是创建新站点；创建成功后会给出 ingestion key 和下一步入口。'}
              </p>
            </div>

            {isEditMode ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={startCreateMode}
                disabled={submitting || deleting}
                data-testid="site-switch-create-button"
              >
                切换到新建
              </button>
            ) : null}
          </div>

          <form
            className={styles.siteForm}
            onSubmit={handleSubmit}
            aria-busy={submitting}
            data-testid="site-form"
          >
            <label className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>站点名称</span>
              <input
                type="text"
                value={formState.name}
                onChange={(event) => {
                  setFormState((current) => ({ ...current, name: event.target.value }));
                  setFieldErrors((current) => ({ ...current, name: undefined }));
                }}
                placeholder="例如 主站、营销站、活动站"
                className={styles.fieldControl}
                disabled={loading || submitting || deleting}
                data-testid="site-name-input"
              />
              {fieldErrors.name ? (
                <span className={styles.fieldError} data-testid="site-name-error">
                  {fieldErrors.name}
                </span>
              ) : null}
            </label>

            <label className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>站点域名</span>
              <input
                type="text"
                value={formState.domain}
                onChange={(event) => {
                  setFormState((current) => ({ ...current, domain: event.target.value }));
                  setFieldErrors((current) => ({ ...current, domain: undefined }));
                }}
                placeholder="例如 shop.example.com"
                className={styles.fieldControl}
                disabled={loading || submitting || deleting}
                data-testid="site-domain-input"
              />
              {fieldErrors.domain ? (
                <span className={styles.fieldError} data-testid="site-domain-error">
                  {fieldErrors.domain}
                </span>
              ) : null}
            </label>

            {isEditMode ? (
              <label className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>站点状态</span>
                <select
                  value={formState.status}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      status: event.target.value as SiteStatus
                    }))
                  }
                  className={styles.fieldControl}
                  disabled={loading || submitting || deleting}
                  data-testid="site-status-select"
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
                <span className={styles.fieldHint}>
                  <code>inactive</code> 会保留站点记录但暂停接入使用；后续可再切回{' '}
                  <code>active</code>。
                </span>
              </label>
            ) : (
              <p className={styles.fieldHint}>
                新建站点默认以 <code>active</code> 创建，创建后可再切换状态。
              </p>
            )}

            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={loading || submitting || deleting}
                aria-busy={submitting}
                data-loading-state={submitting ? 'saving' : 'idle'}
                data-testid="site-submit-button"
              >
                {submitting
                  ? isEditMode
                    ? '正在保存站点...'
                    : '正在创建站点...'
                  : isEditMode
                    ? '保存站点'
                    : '创建站点并生成接入信息'}
              </button>

              {selectedSite ? (
                <Link
                  href={`/dashboard/policies?siteId=${encodeURIComponent(selectedSite.id)}`}
                  className={styles.secondaryButton}
                  data-testid="site-edit-policy-link"
                >
                  去配置安全策略
                </Link>
              ) : null}
            </div>
          </form>

          {selectedSite ? (
            <section
              className={styles.deleteCard}
              aria-busy={deleting}
              data-testid="site-delete-section"
            >
              <div className={styles.deleteTitle}>删除站点</div>
              <p className={styles.deleteHint}>
                删除 <span className={styles.deleteSiteName}>{selectedSite.name}</span>{' '}
                后，会一并删除该站点的策略、封禁记录、请求日志、攻击事件和 AI
                风险结果，无法恢复。
              </p>

              {!deleteConfirming ? (
                <div className={styles.dangerActions}>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={() => setDeleteConfirming(true)}
                    disabled={submitting || deleting}
                    data-testid="site-delete-button"
                  >
                    删除站点
                  </button>
                </div>
              ) : (
                <div
                  className={styles.dangerActions}
                  data-testid="site-delete-confirmation"
                >
                  <button
                    type="button"
                    className={styles.confirmDeleteButton}
                    onClick={confirmDeleteSite}
                    disabled={submitting || deleting}
                    aria-busy={deleting}
                    data-loading-state={deleting ? 'deleting' : 'idle'}
                    data-testid="site-delete-confirm-button"
                  >
                    {deleting ? '正在删除站点...' : '确认删除'}
                  </button>
                  <button
                    type="button"
                    className={styles.cancelDeleteButton}
                    onClick={() => setDeleteConfirming(false)}
                    disabled={submitting || deleting}
                    data-testid="site-delete-cancel-button"
                  >
                    取消
                  </button>
                </div>
              )}
            </section>
          ) : null}
        </section>
      </section>

      {latestCreate ? (
        <section
          className={`glass-panel ${styles.nextStepPanel}`}
          data-testid="site-next-step-panel"
        >
          <div>
            <p className={styles.panelEyebrow}>创建后的下一步</p>
            <h2 className={styles.panelTitle}>继续完成站点接入</h2>
          </div>
          <p className={styles.nextStepBody}>
            <strong>{latestCreate.siteName}</strong> 已创建成功，域名为{' '}
            <code>{latestCreate.siteDomain}</code>。当前仅展示这一次的 ingestion key，请先保存，再继续进入策略页或事件页。
          </p>
          <div
            className={styles.ingestionKeyBox}
            data-testid="site-ingestion-key-output"
          >
            {latestCreate.ingestionKey}
          </div>
          <div className={styles.nextStepLinks}>
            <Link
              href={`/dashboard/policies?siteId=${encodeURIComponent(latestCreate.siteId)}`}
              className={styles.textLink}
              data-testid="site-next-policy-link"
            >
              去配置安全策略
            </Link>
            <Link
              href={`/dashboard/events?siteId=${encodeURIComponent(latestCreate.siteId)}`}
              className={styles.textLink}
              data-testid="site-next-events-link"
            >
              去查看攻击事件
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
