import {
  ApiError,
  buildApiPath,
  fetchApi,
  getRequiredTenantId
} from '@/lib/api';
import type {
  CreateSiteInput,
  CreateSiteResponse,
  DeleteSiteResponse,
  ListResponse,
  SiteItem,
  UpdateSiteInput
} from '@/lib/contracts';

const UUID_V4_LIKE_PATTERN = /^[0-9a-fA-F-]{36}$/;

function normalizeSiteId(siteId: string): string {
  const normalizedSiteId = siteId.trim();

  if (!UUID_V4_LIKE_PATTERN.test(normalizedSiteId)) {
    throw new ApiError('站点 ID 不合法，请重新选择站点。', 'VALIDATION_ERROR');
  }

  return normalizedSiteId;
}

function normalizeName(name: string): string {
  const normalizedName = name.trim();

  if (normalizedName.length < 2 || normalizedName.length > 120) {
    throw new ApiError('站点名称长度必须在 2 到 120 个字符之间。', 'VALIDATION_ERROR');
  }

  return normalizedName;
}

function normalizeDomain(domain: string): string {
  const normalizedDomain = domain.trim().toLowerCase();

  if (
    normalizedDomain.length < 4 ||
    normalizedDomain.length > 255 ||
    normalizedDomain.includes('://') ||
    normalizedDomain.includes('/') ||
    normalizedDomain.includes('?') ||
    normalizedDomain.includes('#') ||
    /\s/.test(normalizedDomain) ||
    !normalizedDomain.includes('.')
  ) {
    throw new ApiError(
      '请输入不包含协议和路径的有效域名，例如 shop.example.com。',
      'VALIDATION_ERROR'
    );
  }

  return normalizedDomain;
}

export function listSites(tenantId?: string): Promise<ListResponse<SiteItem>> {
  return fetchApi<ListResponse<SiteItem>>(
    buildApiPath('/api/v1/sites', {
      tenantId: tenantId?.trim() || getRequiredTenantId()
    })
  );
}

export function createSite(input: CreateSiteInput): Promise<CreateSiteResponse> {
  const payload = {
    tenantId: input.tenantId?.trim() || getRequiredTenantId(),
    name: normalizeName(input.name),
    domain: normalizeDomain(input.domain)
  };

  return fetchApi<CreateSiteResponse>('/api/v1/sites', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function updateSite(
  siteId: string,
  input: UpdateSiteInput
): Promise<{ site: SiteItem }> {
  const normalizedSiteId = normalizeSiteId(siteId);

  return fetchApi<{ site: SiteItem }>(`/api/v1/sites/${normalizedSiteId}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: normalizeName(input.name),
      domain: normalizeDomain(input.domain),
      status: input.status
    })
  });
}

export function deleteSite(siteId: string): Promise<DeleteSiteResponse> {
  const normalizedSiteId = normalizeSiteId(siteId);

  return fetchApi<DeleteSiteResponse>(`/api/v1/sites/${normalizedSiteId}`, {
    method: 'DELETE'
  });
}
