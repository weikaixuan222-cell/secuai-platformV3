import { getDetectionEnvConfig } from "../config/env.js";

export const SQLI_RULE_TOKENS = [
  "union select",
  "' or 1=1",
  "\" or 1=1",
  "drop table",
  "information_schema",
  "sleep(",
  "benchmark("
];

export const XSS_RULE_TOKENS = [
  "<script",
  "%3cscript",
  "javascript:",
  "onerror=",
  "onload=",
  "alert(",
  "document.cookie"
];

export const SUSPICIOUS_USER_AGENTS = [
  "sqlmap",
  "nikto",
  "acunetix",
  "nmap",
  "masscan",
  "dirbuster",
  "gobuster",
  "wpscan"
];

const detectionConfig = getDetectionEnvConfig();
const URL_DECODE_FIELD_NAMES = new Set(["path", "queryString"]);
const PLUS_AS_SPACE_FIELD_NAMES = new Set(["queryString"]);
const MAX_URL_DECODE_PASSES = 2;

function decodeUrlValueSafely(value: string): string {
  let normalizedValue = value;

  for (let index = 0; index < MAX_URL_DECODE_PASSES; index += 1) {
    try {
      const decodedValue = decodeURIComponent(normalizedValue);

      if (decodedValue === normalizedValue) {
        break;
      }

      normalizedValue = decodedValue;
    } catch {
      break;
    }
  }

  return normalizedValue;
}

export function normalizeThreatSignalValue(
  field: { name: string; value: string | null | undefined }
): string {
  const rawValue = field.value ?? "";

  if (!rawValue) {
    return "";
  }

  const valueWithQuerySpaces = PLUS_AS_SPACE_FIELD_NAMES.has(field.name)
    ? rawValue.replace(/\+/g, " ")
    : rawValue;

  if (!URL_DECODE_FIELD_NAMES.has(field.name)) {
    return valueWithQuerySpaces.toLowerCase();
  }

  // 安全说明：path/queryString 的 URL 解码最多执行两轮，兼容单次和双重编码载荷；
  // 如果遇到 malformed 转义序列，则保留当前安全回退结果，避免检测流程异常中断。
  return decodeUrlValueSafely(valueWithQuerySpaces).toLowerCase();
}

export function findThreatSignalMatch(
  fields: Array<{ name: string; value: string | null | undefined }>,
  tokens: string[]
): { field: string; token: string; matchedTokens: string[] } | null {
  for (const field of fields) {
    const normalizedValue = normalizeThreatSignalValue(field);

    if (!normalizedValue) {
      continue;
    }

    const matchedTokens = tokens.filter((token) => normalizedValue.includes(token));

    if (matchedTokens.length > 0) {
      return {
        field: field.name,
        token: matchedTokens[0],
        matchedTokens
      };
    }
  }

  return null;
}

export function isSuspiciousUserAgentAllowed(userAgent: string | null | undefined): boolean {
  if (!userAgent) {
    return false;
  }

  const normalizedUserAgent = userAgent.toLowerCase();
  return detectionConfig.suspiciousUserAgentAllowlist.some((token) =>
    normalizedUserAgent.includes(token)
  );
}
