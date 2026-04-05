import { ApiError, fetchApi } from '@/lib/api';
import type {
  BlockedEntityItem,
  BlockedEntityResponse,
  CreateBlockedEntityInput,
  DeleteBlockedEntityResponse,
  ListResponse,
  SecurityPolicyResponse,
  UpdateSecurityPolicyInput
} from '@/lib/contracts';

const UUID_V4_LIKE_PATTERN = /^[0-9a-fA-F-]{36}$/;
const POLICY_SCORE_RANGE = {
  min: 0,
  max: 100
} as const;
const RATE_LIMIT_RANGE = {
  min: 1,
  max: 100000
} as const;

function toIntegerInRange(
  value: number,
  fieldName: string,
  range: { min: number; max: number }
): number {
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new ApiError(
      `${fieldName} 必须是 ${range.min} 到 ${range.max} 之间的整数。`,
      'VALIDATION_ERROR'
    );
  }

  return value;
}

function normalizeBlockedEntityId(
  blockedEntityId: number | string
): number {
  return toIntegerInRange(
    typeof blockedEntityId === 'string'
      ? Number(blockedEntityId)
      : blockedEntityId,
    '封禁实体 ID',
    {
      min: 1,
      max: Number.MAX_SAFE_INTEGER
    }
  );
}

function normalizeBlockedEntityItem(
  blockedEntity: BlockedEntityItem
): BlockedEntityItem {
  return {
    ...blockedEntity,
    id: normalizeBlockedEntityId(
      blockedEntity.id as unknown as number | string
    )
  };
}

function normalizeSiteId(siteId: string): string {
  const normalizedSiteId = siteId.trim();

  if (!UUID_V4_LIKE_PATTERN.test(normalizedSiteId)) {
    throw new ApiError('站点 ID 不合法，请重新选择站点。', 'VALIDATION_ERROR');
  }

  return normalizedSiteId;
}

export function getSiteSecurityPolicy(
  siteId: string
): Promise<SecurityPolicyResponse> {
  const normalizedSiteId = normalizeSiteId(siteId);

  return fetchApi<SecurityPolicyResponse>(
    `/api/v1/sites/${normalizedSiteId}/security-policy`
  );
}

export function listSiteBlockedEntities(
  siteId: string
): Promise<ListResponse<BlockedEntityItem>> {
  const normalizedSiteId = normalizeSiteId(siteId);

  return fetchApi<ListResponse<BlockedEntityItem>>(
    `/api/v1/sites/${normalizedSiteId}/blocked-entities`
  ).then((result) => ({
    items: result.items.map(normalizeBlockedEntityItem)
  }));
}

export function updateSiteSecurityPolicy(
  siteId: string,
  input: UpdateSecurityPolicyInput
): Promise<SecurityPolicyResponse> {
  const normalizedSiteId = normalizeSiteId(siteId);
  const payload: UpdateSecurityPolicyInput = {
    mode: input.mode,
    blockSqlInjection: input.blockSqlInjection,
    blockXss: input.blockXss,
    blockSuspiciousUserAgent: input.blockSuspiciousUserAgent,
    enableRateLimit: input.enableRateLimit,
    rateLimitThreshold: toIntegerInRange(
      input.rateLimitThreshold,
      'rateLimitThreshold',
      RATE_LIMIT_RANGE
    ),
    autoBlockHighRisk: input.autoBlockHighRisk,
    highRiskScoreThreshold: toIntegerInRange(
      input.highRiskScoreThreshold,
      'highRiskScoreThreshold',
      POLICY_SCORE_RANGE
    )
  };

  return fetchApi<SecurityPolicyResponse>(
    `/api/v1/sites/${normalizedSiteId}/security-policy`,
    {
      method: 'PUT',
      body: JSON.stringify(payload)
    }
  );
}

export function createSiteBlockedEntity(
  siteId: string,
  input: CreateBlockedEntityInput
): Promise<BlockedEntityResponse> {
  const normalizedSiteId = normalizeSiteId(siteId);
  const entityValue = input.entityValue.trim();
  const reason = input.reason.trim();

  if (!entityValue) {
    throw new ApiError('请输入要封禁的 IP 地址。', 'VALIDATION_ERROR');
  }

  if (!reason) {
    throw new ApiError('请输入封禁原因。', 'VALIDATION_ERROR');
  }

  const payload: CreateBlockedEntityInput = {
    entityType: input.entityType,
    entityValue,
    reason,
    source: input.source,
    expiresAt: input.expiresAt || null
  };

  return fetchApi<BlockedEntityResponse>(
    `/api/v1/sites/${normalizedSiteId}/blocked-entities`,
    {
      method: 'POST',
      body: JSON.stringify(payload)
    }
  ).then((result) => ({
    blockedEntity: normalizeBlockedEntityItem(result.blockedEntity)
  }));
}

export function deleteSiteBlockedEntity(
  blockedEntityId: number
): Promise<DeleteBlockedEntityResponse> {
  const normalizedBlockedEntityId = normalizeBlockedEntityId(blockedEntityId);

  return fetchApi<DeleteBlockedEntityResponse>(
    `/api/v1/blocked-entities/${normalizedBlockedEntityId}`,
    {
      method: 'DELETE'
    }
  ).then((result) => ({
    deleted: result.deleted,
    blockedEntity: normalizeBlockedEntityItem(result.blockedEntity)
  }));
}
