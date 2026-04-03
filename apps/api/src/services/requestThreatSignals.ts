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

export function findThreatSignalMatch(
  fields: Array<{ name: string; value: string | null | undefined }>,
  tokens: string[]
): { field: string; token: string; matchedTokens: string[] } | null {
  for (const field of fields) {
    const normalizedValue = (field.value ?? "").toLowerCase();

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
