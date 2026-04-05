import type { DashboardSiteSummaryItem } from '@/lib/contracts';

export interface SiteFilterOption {
  value: string;
  label: string;
  meta: string;
}

export function buildSiteFilterOptions(
  summaries: DashboardSiteSummaryItem[]
): SiteFilterOption[] {
  return summaries.map((site) => ({
    value: site.siteId,
    label: site.siteName,
    meta: site.siteDomain
  }));
}

export function parseSiteIdFromSearch(search: string): string {
  return new URLSearchParams(search).get('siteId')?.trim() || '';
}

export function buildDashboardPagePath(siteId: string): string {
  if (!siteId) {
    return '/dashboard';
  }

  const params = new URLSearchParams();
  params.set('siteId', siteId);
  return `/dashboard?${params.toString()}`;
}

export function buildPoliciesPagePath(siteId: string): string {
  if (!siteId) {
    return '/dashboard/policies';
  }

  const params = new URLSearchParams();
  params.set('siteId', siteId);
  return `/dashboard/policies?${params.toString()}`;
}
