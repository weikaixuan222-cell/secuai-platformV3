import { ApiError, fetchApi } from '@/lib/api';
import type { ProtectionCheckRequest, ProtectionCheckResponse } from '@/lib/contracts';

const UUID_V4_LIKE_PATTERN = /^[0-9a-fA-F-]{36}$/;

function normalizeSiteId(siteId: string): string {
  const normalizedSiteId = siteId.trim();

  if (!UUID_V4_LIKE_PATTERN.test(normalizedSiteId)) {
    throw new ApiError('站点 ID 不合法，请重新选择站点。', 'VALIDATION_ERROR');
  }

  return normalizedSiteId;
}

function normalizeTrimmedString(
  value: string,
  fieldName: string,
  options: { minLength?: number; maxLength?: number } = {}
): string {
  const normalizedValue = value.trim();

  if (options.minLength && normalizedValue.length < options.minLength) {
    throw new ApiError(
      `${fieldName} 至少需要 ${options.minLength} 个字符。`,
      'VALIDATION_ERROR'
    );
  }

  if (options.maxLength && normalizedValue.length > options.maxLength) {
    throw new ApiError(
      `${fieldName} 最多允许 ${options.maxLength} 个字符。`,
      'VALIDATION_ERROR'
    );
  }

  return normalizedValue;
}

function normalizeOptionalString(
  value: string | undefined,
  fieldName: string,
  options: { maxLength?: number } = {}
): string | undefined {
  if (!value) {
    return undefined;
  }

  return normalizeTrimmedString(value, fieldName, {
    minLength: 1,
    maxLength: options.maxLength
  });
}

export function runProtectionCheck(
  request: ProtectionCheckRequest
): Promise<ProtectionCheckResponse> {
  const ingestionKey = normalizeTrimmedString(
    request.ingestionKey,
    '站点接入密钥',
    { minLength: 1, maxLength: 512 }
  );
  const normalizedSiteId = normalizeSiteId(request.input.siteId);
  const occurredAt = normalizeTrimmedString(
    request.input.occurredAt,
    'occurredAt',
    { minLength: 20, maxLength: 64 }
  );
  const method = normalizeTrimmedString(
    request.input.method,
    'method',
    { minLength: 3, maxLength: 16 }
  ).toUpperCase();
  const host = normalizeTrimmedString(
    request.input.host,
    'host',
    { minLength: 3, maxLength: 255 }
  );
  const path = normalizeTrimmedString(
    request.input.path,
    'path',
    { minLength: 1, maxLength: 2048 }
  );

  return fetchApi<ProtectionCheckResponse>('/api/v1/protection/check', {
    method: 'POST',
    headers: {
      'x-site-ingestion-key': ingestionKey
    },
    body: JSON.stringify({
      siteId: normalizedSiteId,
      occurredAt,
      method,
      host,
      path,
      queryString: normalizeOptionalString(request.input.queryString, 'queryString', {
        maxLength: 4096
      }),
      clientIp: normalizeOptionalString(request.input.clientIp, 'clientIp', {
        maxLength: 64
      }),
      userAgent: normalizeOptionalString(request.input.userAgent, 'userAgent', {
        maxLength: 2048
      }),
      referer: normalizeOptionalString(request.input.referer, 'referer', {
        maxLength: 2048
      })
    })
  });
}
