import type { IncomingMessage, ServerResponse } from "node:http";

export type SiteProtectionAction = "allow" | "monitor" | "block";
export type SiteProtectionMode = "monitor" | "protect";

export interface SiteRequestContext {
  method: string;
  host: string;
  path: string;
  queryString?: string;
  clientIp?: string;
  userAgent?: string;
  referer?: string;
  occurredAt?: string;
}

export interface SiteProtectionDecision {
  action: SiteProtectionAction;
  mode: SiteProtectionMode | "fail-open";
  reasons: string[];
  matchedBlockedEntity?: SiteMatchedBlockedEntity;
  monitored: boolean;
  failOpen: boolean;
  failOpenReason?: string;
}

export interface SiteMatchedBlockedEntity {
  id: number;
  entityType: "ip";
  entityValue: string;
  source: "manual" | "automatic";
  attackEventId: number | null;
  originKind: "manual" | "automatic" | "event_disposition";
  expiresAt: string | null;
}

export interface SiteProtectionClientOptions {
  platformBaseUrl: string;
  siteId: string;
  siteIngestionKey: string;
  timeoutMs?: number;
  requestLogReporting?: SiteRequestLogReportingOptions;
}

export interface SiteRequestLogReportingOptions {
  enabled?: boolean;
  scope?: "monitor" | "all";
  timeoutMs?: number;
}

export interface HandleNodeRequestOptions {
  blockStatusCode?: number;
  blockResponseBody?: string;
}

export interface SiteProtectionClient {
  checkRequest: (context: SiteRequestContext) => Promise<SiteProtectionDecision>;
  reportRequestLog: (
    context: SiteRequestContext,
    decision: SiteProtectionDecision
  ) => Promise<boolean>;
  reportRequestLogAsync: (
    context: SiteRequestContext,
    decision: SiteProtectionDecision
  ) => void;
}

const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_LOG_REPORT_TIMEOUT_MS = 1500;

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildFailOpenDecision(reason: string): SiteProtectionDecision {
  return {
    action: "allow",
    mode: "fail-open",
    reasons: [],
    monitored: false,
    failOpen: true,
    failOpenReason: reason
  };
}

function shouldReportRequestLog(
  decision: SiteProtectionDecision,
  options?: SiteRequestLogReportingOptions
): boolean {
  if (!options?.enabled || decision.action === "block" || decision.failOpen) {
    return false;
  }

  if (options.scope === "all") {
    return decision.action === "allow" || decision.action === "monitor";
  }

  return decision.action === "monitor";
}

function extractClientIp(request: IncomingMessage): string | undefined {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim() !== "") {
    return forwardedFor.split(",")[0]?.trim() || undefined;
  }

  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return forwardedFor[0].split(",")[0]?.trim() || undefined;
  }

  return request.socket.remoteAddress ?? undefined;
}

function normalizeMatchedBlockedEntity(
  value: unknown
): SiteProtectionDecision["matchedBlockedEntity"] {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entityRecord = value as Record<string, unknown>;
  const id =
    typeof entityRecord.id === "number"
      ? entityRecord.id
      : typeof entityRecord.id === "string" && /^\d+$/.test(entityRecord.id)
        ? Number(entityRecord.id)
        : null;
  const attackEventId =
    entityRecord.attackEventId === null
      ? null
      : typeof entityRecord.attackEventId === "number"
        ? entityRecord.attackEventId
        : typeof entityRecord.attackEventId === "string" &&
            /^\d+$/.test(entityRecord.attackEventId)
          ? Number(entityRecord.attackEventId)
          : null;

  if (
    id === null ||
    entityRecord.entityType !== "ip" ||
    typeof entityRecord.entityValue !== "string" ||
    (entityRecord.source !== "manual" && entityRecord.source !== "automatic") ||
    (entityRecord.attackEventId !== null && attackEventId === null) ||
    (entityRecord.originKind !== "manual" &&
      entityRecord.originKind !== "automatic" &&
      entityRecord.originKind !== "event_disposition") ||
    (entityRecord.expiresAt !== null && typeof entityRecord.expiresAt !== "string")
  ) {
    return undefined;
  }

  return {
    id,
    entityType: entityRecord.entityType,
    entityValue: entityRecord.entityValue,
    source: entityRecord.source,
    attackEventId,
    originKind: entityRecord.originKind,
    expiresAt: entityRecord.expiresAt
  };
}

export function extractNodeRequestContext(request: IncomingMessage): SiteRequestContext {
  const hostHeader = request.headers.host;
  const host = Array.isArray(hostHeader)
    ? hostHeader[0] ?? "localhost"
    : hostHeader ?? "localhost";
  const requestUrl = new URL(request.url ?? "/", `http://${host}`);
  const userAgentHeader = request.headers["user-agent"];
  const refererHeader = request.headers.referer ?? request.headers.referrer;

  return {
    method: request.method ?? "GET",
    host,
    path: requestUrl.pathname,
    queryString: requestUrl.search.length > 1 ? requestUrl.search.slice(1) : undefined,
    clientIp: extractClientIp(request),
    userAgent: Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader,
    referer: Array.isArray(refererHeader) ? refererHeader[0] : refererHeader,
    occurredAt: new Date().toISOString()
  };
}

export function createSiteProtectionClient(
  options: SiteProtectionClientOptions
): SiteProtectionClient {
  const baseUrl = normalizeBaseUrl(options.platformBaseUrl);
  const protectionCheckEndpoint = `${baseUrl}/api/v1/protection/check`;
  const requestLogEndpoint = `${baseUrl}/api/v1/request-logs`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestLogReportTimeoutMs =
    options.requestLogReporting?.timeoutMs ?? DEFAULT_LOG_REPORT_TIMEOUT_MS;

  return {
    async checkRequest(context: SiteRequestContext): Promise<SiteProtectionDecision> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(protectionCheckEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-site-ingestion-key": options.siteIngestionKey
          },
          body: JSON.stringify({
            siteId: options.siteId,
            occurredAt: context.occurredAt ?? new Date().toISOString(),
            method: context.method,
            host: context.host,
            path: context.path,
            queryString: context.queryString,
            clientIp: context.clientIp,
            userAgent: context.userAgent,
            referer: context.referer
          }),
          signal: controller.signal
        });

        const payload = (await response.json()) as {
          success?: boolean;
          data?: {
            protection?: {
              action?: SiteProtectionAction;
              mode?: SiteProtectionMode;
              reasons?: string[];
              matchedBlockedEntity?: unknown;
            };
          };
          error?: {
            code?: string;
            message?: string;
          };
        };

        if (!response.ok || payload.success !== true || !payload.data?.protection) {
          return buildFailOpenDecision(
            `platform_error:${response.status}:${payload.error?.code ?? "UNKNOWN_ERROR"}`
          );
        }

        const protection = payload.data.protection;

        if (
          protection.action !== "allow" &&
          protection.action !== "monitor" &&
          protection.action !== "block"
        ) {
          return buildFailOpenDecision("platform_error:invalid_action");
        }

        const matchedBlockedEntity = normalizeMatchedBlockedEntity(protection.matchedBlockedEntity);

        return {
          action: protection.action,
          mode: protection.mode === "protect" ? "protect" : "monitor",
          reasons: protection.reasons ?? [],
          ...(matchedBlockedEntity ? { matchedBlockedEntity } : {}),
          monitored: protection.action === "monitor",
          failOpen: false
        };
      } catch (error) {
        const reason =
          error instanceof Error && error.name === "AbortError"
            ? "platform_timeout"
            : `platform_unavailable:${error instanceof Error ? error.message : String(error)}`;

        return buildFailOpenDecision(reason);
      } finally {
        clearTimeout(timeoutId);
      }
    },

    async reportRequestLog(
      context: SiteRequestContext,
      decision: SiteProtectionDecision
    ): Promise<boolean> {
      if (!shouldReportRequestLog(decision, options.requestLogReporting)) {
        return false;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestLogReportTimeoutMs);

      try {
        const response = await fetch(requestLogEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-site-ingestion-key": options.siteIngestionKey
          },
          body: JSON.stringify({
            siteId: options.siteId,
            occurredAt: context.occurredAt ?? new Date().toISOString(),
            method: context.method,
            host: context.host,
            path: context.path,
            queryString: context.queryString,
            clientIp: context.clientIp,
            userAgent: context.userAgent,
            referer: context.referer,
            metadata: {
              siteMiddleware: {
                protectionAction: decision.action,
                protectionMode: decision.mode,
                protectionReasons: decision.reasons,
                matchedBlockedEntity: decision.matchedBlockedEntity ?? null
              }
            }
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          return false;
        }

        const payload = (await response.json()) as { success?: boolean };
        return payload.success === true;
      } catch (error) {
        console.error("SecuAI request log report failed.", {
          reason:
            error instanceof Error && error.name === "AbortError"
              ? "platform_timeout"
              : error instanceof Error
                ? error.message
                : String(error)
        });
        return false;
      } finally {
        clearTimeout(timeoutId);
      }
    },

    reportRequestLogAsync(
      context: SiteRequestContext,
      decision: SiteProtectionDecision
    ): void {
      void this.reportRequestLog(context, decision).catch((error) => {
        console.error("SecuAI async request log report failed.", {
          reason: error instanceof Error ? error.message : String(error)
        });
      });
    }
  };
}

export async function enforceNodeRequestProtection(
  request: IncomingMessage,
  response: ServerResponse,
  client: SiteProtectionClient,
  options: HandleNodeRequestOptions = {}
): Promise<SiteProtectionDecision> {
  const context = extractNodeRequestContext(request);
  const decision = await client.checkRequest(context);

  if (decision.action === "block") {
    response.writeHead(options.blockStatusCode ?? 403, {
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(
      options.blockResponseBody ??
        JSON.stringify({
          success: false,
          error: {
            code: "REQUEST_BLOCKED",
            message: "Request blocked by site security policy.",
            details: {
              reasons: decision.reasons,
              mode: decision.mode,
              matchedBlockedEntity: decision.matchedBlockedEntity ?? null
            }
          }
        })
    );
    return decision;
  }

  client.reportRequestLogAsync(context, decision);

  return decision;
}
