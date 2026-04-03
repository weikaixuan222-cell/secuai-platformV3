import "dotenv/config";

type ServerEnvConfig = {
  port: number;
  host: string;
};

type DatabaseEnvConfig = {
  databaseUrl: string;
  dbSslMode: "disable" | "require";
};

type DetectionEnvConfig = {
  suspiciousUserAgentAllowlist: string[];
};

type AiAnalyzerEnvConfig = {
  aiAnalyzerUrl: string;
  timeoutMs: number;
  maxRetries: number;
};

const DEFAULT_PORT = 3201;
const DEFAULT_HOST = "127.0.0.1";

function parsePort(rawPort: string | undefined): number {
  if (!rawPort) {
    return DEFAULT_PORT;
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }

  return port;
}

function requireUrl(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function parseSslMode(value: string | undefined): "disable" | "require" {
  if (!value || value === "disable") {
    return "disable";
  }

  if (value === "require") {
    return "require";
  }

  throw new Error("DB_SSL_MODE must be either 'disable' or 'require'.");
}

function parsePositiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  options: { min?: number; max?: number } = {}
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer.`);
  }

  if (options.min !== undefined && parsed < options.min) {
    throw new Error(`${name} must be >= ${options.min}.`);
  }

  if (options.max !== undefined && parsed > options.max) {
    throw new Error(`${name} must be <= ${options.max}.`);
  }

  return parsed;
}

function parseCsvList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

export function getServerEnvConfig(): ServerEnvConfig {
  return {
    port: parsePort(process.env.PORT),
    host: process.env.HOST || DEFAULT_HOST
  };
}

export function getDatabaseEnvConfig(): DatabaseEnvConfig {
  return {
    databaseUrl: requireUrl("DATABASE_URL", process.env.DATABASE_URL),
    dbSslMode: parseSslMode(process.env.DB_SSL_MODE)
  };
}

export function getDetectionEnvConfig(): DetectionEnvConfig {
  return {
    suspiciousUserAgentAllowlist: parseCsvList(process.env.DETECTION_SUSPICIOUS_UA_ALLOWLIST)
  };
}

export function getAiAnalyzerEnvConfig(): AiAnalyzerEnvConfig {
  return {
    aiAnalyzerUrl: requireUrl("AI_ANALYZER_URL", process.env.AI_ANALYZER_URL),
    timeoutMs: parsePositiveInteger("AI_ANALYZER_TIMEOUT_MS", process.env.AI_ANALYZER_TIMEOUT_MS, 1500, {
      min: 100,
      max: 30000
    }),
    maxRetries: parsePositiveInteger("AI_ANALYZER_MAX_RETRIES", process.env.AI_ANALYZER_MAX_RETRIES, 1, {
      min: 0,
      max: 3
    })
  };
}

export type { AiAnalyzerEnvConfig, DatabaseEnvConfig, DetectionEnvConfig, ServerEnvConfig };
