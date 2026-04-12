import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";

import { getServerEnvConfig } from "./config/env.js";
import { withTransaction } from "./db/client.js";
import type {
  AiRiskResultListFilters,
  AttackEventListFilters,
  AttackSeverity,
  AttackStatus,
  BlockedEntitySource,
  BlockedEntityType,
  CreateRequestLogInput,
  RequestLogListFilters,
  RequestLogRow,
  RiskLevel,
  SecurityPolicyMode,
  SiteRow,
  TenantMembershipRow,
  UserRow
} from "./db/types.js";
import { hashOpaqueToken, hashPassword, verifyPassword, generateOpaqueToken } from "./lib/security.js";
import {
  createBlockedEntity,
  createRequestLog,
  createSite,
  createUser,
  createUserSession,
  deleteBlockedEntityById,
  deleteExpiredUserSessions,
  deleteUserSessionByTokenHash,
  findAttackEventById,
  findActiveUserSessionByTokenHash,
  findBlockedEntityById,
  findLatestRiskResultForAttackEvent,
  findRequestLogById,
  findSecurityPolicyBySiteId,
  findSiteById,
  findUserByEmail,
  findUserById,
  listAiRiskResults,
  listAttackEvents,
  listBlockedEntitiesBySiteId,
  listRecentHighRiskEvents,
  listRequestLogs,
  listSiteDashboardSummaries,
  listTenantMembershipsByUserId,
  touchUserSession,
  updateUserLastLoginAt,
  upsertSecurityPolicy
} from "./repositories/index.js";
import { runAttackDetection } from "./services/attackDetection.js";
import { evaluateProtectionEnforcement } from "./services/protectionEnforcement.js";

const MAX_BODY_SIZE_BYTES = 1024 * 1024;
const SESSION_TTL_DAYS = 30;

type JsonObject = Record<string, unknown>;

class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: JsonObject;

  constructor(statusCode: number, code: string, message: string, details?: JsonObject) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

type AuthContext = {
  user: UserRow;
  memberships: TenantMembershipRow[];
};

function sendJson(response: ServerResponse, statusCode: number, payload: JsonObject): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendSuccess(response: ServerResponse, statusCode: number, data: JsonObject): void {
  sendJson(response, statusCode, { success: true, data });
}

function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(response, error.statusCode, {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null
      }
    });
    return;
  }

  console.error(error);
  sendJson(response, 500, {
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred."
    }
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    // 安全说明：MVP 服务端对请求体做硬上限限制，降低异常大包带来的滥用面。
    if (size > MAX_BODY_SIZE_BYTES) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds the 1 MB limit.");
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function expectObject(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${name} must be a JSON object.`);
  }

  return value as JsonObject;
}

function getTrimmedString(
  object: JsonObject,
  key: string,
  options: { minLength?: number; maxLength?: number; optional?: boolean } = {}
): string | undefined {
  const value = object[key];

  if (value === undefined || value === null) {
    if (options.optional) {
      return undefined;
    }

    throw new ApiError(400, "VALIDATION_ERROR", `${key} is required.`);
  }

  if (typeof value !== "string") {
    throw new ApiError(400, "VALIDATION_ERROR", `${key} must be a string.`);
  }

  const trimmed = value.trim();

  if (options.minLength && trimmed.length < options.minLength) {
    throw new ApiError(400, "VALIDATION_ERROR", `${key} must be at least ${options.minLength} characters.`);
  }

  if (options.maxLength && trimmed.length > options.maxLength) {
    throw new ApiError(400, "VALIDATION_ERROR", `${key} must be at most ${options.maxLength} characters.`);
  }

  return trimmed;
}

function getOptionalRecord(object: JsonObject, key: string): Record<string, unknown> | undefined {
  const value = object[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${key} must be a JSON object when provided.`);
  }

  return value as Record<string, unknown>;
}

function getOptionalInteger(
  object: JsonObject,
  key: string,
  options: { min?: number; max?: number } = {}
): number | undefined {
  const value = object[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${key} must be an integer.`);
  }

  if (options.min !== undefined && value < options.min) {
    throw new ApiError(400, "VALIDATION_ERROR", `${key} must be >= ${options.min}.`);
  }

  if (options.max !== undefined && value > options.max) {
    throw new ApiError(400, "VALIDATION_ERROR", `${key} must be <= ${options.max}.`);
  }

  return value;
}

function getRequiredBoolean(object: JsonObject, key: string): boolean {
  const value = object[key];

  if (typeof value !== "boolean") {
    throw new ApiError(400, "VALIDATION_ERROR", `${key} must be a boolean.`);
  }

  return value;
}

function parseEmail(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", "email must be a valid email address.");
  }

  return normalized;
}

function parseOptionalClientIp(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parseIpEntityValue(value);
}

function parseSlug(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "slug must use lowercase letters, numbers, and hyphens only."
    );
  }

  return normalized;
}

function parseDomain(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", "domain must be a valid hostname.");
  }

  return normalized;
}

function parseSecurityPolicyMode(value: string): SecurityPolicyMode {
  if (!["monitor", "protect"].includes(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", "mode must be one of: monitor, protect.");
  }

  return value as SecurityPolicyMode;
}

function parseBlockedEntityType(value: string): BlockedEntityType {
  if (value !== "ip") {
    throw new ApiError(400, "VALIDATION_ERROR", "entityType must be ip for the current MVP.");
  }

  return value;
}

function parseBlockedEntitySource(value: string): BlockedEntitySource {
  if (!["manual", "automatic"].includes(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", "source must be one of: manual, automatic.");
  }

  return value as BlockedEntitySource;
}

function parseIpEntityValue(value: string): string {
  const normalized = value.trim();

  // 安全说明：只有语法合法的 IP 才能进入 MVP block list，避免后续匹配出现歧义。
  if (isIP(normalized) === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "entityValue must be a valid IPv4 or IPv6 address.");
  }

  return normalized;
}

function parseUuidPathParam(value: string, fieldName: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${fieldName} must be a valid UUID.`);
  }

  return normalized;
}

function parseDateTime(value: unknown, fieldName: string): Date {
  if (typeof value !== "string") {
    throw new ApiError(400, "VALIDATION_ERROR", `${fieldName} must be an ISO datetime string.`);
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "VALIDATION_ERROR", `${fieldName} must be a valid ISO datetime string.`);
  }

  return parsed;
}

function parseOptionalDateTime(value: string | null, fieldName: string): Date | undefined {
  if (value === null) {
    return undefined;
  }

  return parseDateTime(value, fieldName);
}

function getBearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;

  if (!authorization) {
    throw new ApiError(401, "UNAUTHORIZED", "Authorization header is required.");
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new ApiError(401, "UNAUTHORIZED", "Authorization header must use the Bearer scheme.");
  }

  return token.trim();
}

async function requireAuth(request: IncomingMessage): Promise<AuthContext> {
  await deleteExpiredUserSessions();
  const token = getBearerToken(request);
  const tokenHash = hashOpaqueToken(token);
  const session = await findActiveUserSessionByTokenHash(tokenHash);

  if (!session) {
    throw new ApiError(401, "UNAUTHORIZED", "Session is missing or expired.");
  }

  const user = await findUserById(session.user_id);

  if (!user || user.status !== "active") {
    throw new ApiError(401, "UNAUTHORIZED", "User account is not available.");
  }

  await touchUserSession(session.id);
  const memberships = await listTenantMembershipsByUserId(user.id);

  return { user, memberships };
}

function assertTenantAccess(auth: AuthContext, tenantId: string): TenantMembershipRow {
  const membership = auth.memberships.find((item) => item.tenant_id === tenantId);

  if (!membership) {
    throw new ApiError(403, "FORBIDDEN", "You do not have access to this tenant.");
  }

  return membership;
}

async function requireSiteAccess(auth: AuthContext, siteId: string): Promise<SiteRow> {
  const site = await findSiteById(siteId);

  if (!site) {
    throw new ApiError(404, "SITE_NOT_FOUND", "Site not found.");
  }

  // 安全说明：站点级策略和 blocklist 操作必须被限制在调用方所属租户边界内。
  assertTenantAccess(auth, site.tenant_id);

  return site;
}

async function requireActiveSiteByIngestionKey(
  request: IncomingMessage,
  siteId: string
): Promise<SiteRow> {
  const ingestionKey = request.headers["x-site-ingestion-key"];

  if (typeof ingestionKey !== "string" || ingestionKey.trim() === "") {
    throw new ApiError(401, "INGESTION_KEY_REQUIRED", "x-site-ingestion-key header is required.");
  }

  const site = await findSiteById(siteId);

  if (!site || site.status !== "active") {
    throw new ApiError(404, "SITE_NOT_FOUND", "Site not found.");
  }

  const providedKeyHash = hashOpaqueToken(ingestionKey.trim());

  // 安全说明：站点中间件和日志写入入口都使用 ingestion key 的哈希值做认证比对。
  if (providedKeyHash !== site.ingestion_key_hash) {
    throw new ApiError(401, "INVALID_INGESTION_KEY", "Invalid site ingestion key.");
  }

  return site;
}

function mapUser(user: UserRow): JsonObject {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    lastLoginAt: user.last_login_at ? user.last_login_at.toISOString() : null,
    createdAt: user.created_at.toISOString()
  };
}

function mapMembership(membership: TenantMembershipRow): JsonObject {
  return {
    tenantId: membership.tenant_id,
    role: membership.role,
    tenant: {
      id: membership.tenant_id,
      name: membership.tenant_name,
      slug: membership.tenant_slug,
      status: membership.tenant_status
    }
  };
}

function mapSecurityPolicy(policy: Awaited<ReturnType<typeof upsertSecurityPolicy>>): JsonObject {
  return {
    siteId: policy.site_id,
    mode: policy.mode,
    blockSqlInjection: policy.block_sql_injection,
    blockXss: policy.block_xss,
    blockSuspiciousUserAgent: policy.block_suspicious_user_agent,
    enableRateLimit: policy.enable_rate_limit,
    rateLimitThreshold: policy.rate_limit_threshold,
    autoBlockHighRisk: policy.auto_block_high_risk,
    highRiskScoreThreshold: Number(policy.high_risk_score_threshold),
    createdAt: policy.created_at.toISOString(),
    updatedAt: policy.updated_at.toISOString()
  };
}

function mapBlockedEntity(entity: Awaited<ReturnType<typeof createBlockedEntity>>): JsonObject {
  const isActive = entity.expires_at ? entity.expires_at.getTime() > Date.now() : true;
  const originKind = entity.attack_event_id
    ? "event_disposition"
    : entity.source === "automatic"
      ? "automatic"
      : "manual";

  return {
    id: entity.id,
    siteId: entity.site_id,
    entityType: entity.entity_type,
    entityValue: entity.entity_value,
    reason: entity.reason,
    source: entity.source,
    attackEventId: entity.attack_event_id,
    originKind,
    isActive,
    expiresAt: entity.expires_at ? entity.expires_at.toISOString() : null,
    createdAt: entity.created_at.toISOString()
  };
}

function pickActiveBlockedEntity(
  blockedEntities: Array<ReturnType<typeof mapBlockedEntity>>
): ReturnType<typeof mapBlockedEntity> | null {
  return blockedEntities.find((item) => item.isActive === true) ?? null;
}

function buildDispositionSummary(input: {
  blockedEntities: Array<ReturnType<typeof mapBlockedEntity>>;
  activeBlockedEntity: ReturnType<typeof mapBlockedEntity> | null;
}): {
  status: "none" | "active" | "inactive";
  blockedEntityCount: number;
  activeBlockedEntityId: number | null;
  activeEntityType: "ip" | null;
  activeEntityValue: string | null;
  activeSource: "manual" | "automatic" | null;
  activeOriginKind: "manual" | "automatic" | "event_disposition" | null;
  activeAttackEventId: number | null;
} {
  if (input.activeBlockedEntity) {
    return {
      status: "active",
      blockedEntityCount: input.blockedEntities.length,
      activeBlockedEntityId: input.activeBlockedEntity.id as number,
      activeEntityType: input.activeBlockedEntity.entityType as "ip",
      activeEntityValue: input.activeBlockedEntity.entityValue as string,
      activeSource: input.activeBlockedEntity.source as "manual" | "automatic",
      activeOriginKind: input.activeBlockedEntity.originKind as
        | "manual"
        | "automatic"
        | "event_disposition",
      activeAttackEventId:
        input.activeBlockedEntity.attackEventId === null
          ? null
          : Number(input.activeBlockedEntity.attackEventId)
    };
  }

  if (input.blockedEntities.length > 0) {
    return {
      status: "inactive",
      blockedEntityCount: input.blockedEntities.length,
      activeBlockedEntityId: null,
      activeEntityType: null,
      activeEntityValue: null,
      activeSource: null,
      activeOriginKind: null,
      activeAttackEventId: null
    };
  }

  return {
    status: "none",
    blockedEntityCount: 0,
    activeBlockedEntityId: null,
    activeEntityType: null,
    activeEntityValue: null,
    activeSource: null,
    activeOriginKind: null,
    activeAttackEventId: null
  };
}

function extractAttackEventProtectionEnforcement(
  details: unknown
):
  | {
      mode: "monitor" | "protect";
      action: "allow" | "monitor" | "block";
      reasons: string[];
      matchedBlockedEntity: {
        id: number;
        entityType: "ip";
        entityValue: string;
        source: "manual" | "automatic";
        attackEventId: number | null;
        originKind: "manual" | "automatic" | "event_disposition";
        expiresAt: string | null;
      } | null;
    }
  | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }

  const rawProtectionEnforcement = (details as Record<string, unknown>).protectionEnforcement;

  if (
    !rawProtectionEnforcement ||
    typeof rawProtectionEnforcement !== "object" ||
    Array.isArray(rawProtectionEnforcement)
  ) {
    return null;
  }

  const traceRecord = rawProtectionEnforcement as Record<string, unknown>;
  const rawMode = traceRecord.mode;
  const rawAction = traceRecord.action;
  const rawReasons = traceRecord.reasons;

  if (rawMode !== "monitor" && rawMode !== "protect") {
    return null;
  }

  if (rawAction !== "allow" && rawAction !== "monitor" && rawAction !== "block") {
    return null;
  }

  if (!Array.isArray(rawReasons) || rawReasons.some((item) => typeof item !== "string")) {
    return null;
  }

  const rawMatchedBlockedEntity = traceRecord.matchedBlockedEntity;
  let matchedBlockedEntity:
    | {
        id: number;
        entityType: "ip";
        entityValue: string;
        source: "manual" | "automatic";
        attackEventId: number | null;
        originKind: "manual" | "automatic" | "event_disposition";
        expiresAt: string | null;
      }
    | null
    | undefined;

  if (rawMatchedBlockedEntity === null) {
    matchedBlockedEntity = null;
  } else if (rawMatchedBlockedEntity !== undefined) {
    if (
      typeof rawMatchedBlockedEntity !== "object" ||
      Array.isArray(rawMatchedBlockedEntity)
    ) {
      return null;
    }

    const entityRecord = rawMatchedBlockedEntity as Record<string, unknown>;
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
          : typeof entityRecord.attackEventId === "string" && /^\d+$/.test(entityRecord.attackEventId)
            ? Number(entityRecord.attackEventId)
            : null;

    if (
      id === null ||
      entityRecord.entityType !== "ip" ||
      typeof entityRecord.entityValue !== "string" ||
      (entityRecord.source !== "manual" && entityRecord.source !== "automatic") ||
      (entityRecord.originKind !== "manual" &&
        entityRecord.originKind !== "automatic" &&
        entityRecord.originKind !== "event_disposition") ||
      (entityRecord.expiresAt !== null && typeof entityRecord.expiresAt !== "string")
    ) {
      return null;
    }

    matchedBlockedEntity = {
      id,
      entityType: "ip",
      entityValue: entityRecord.entityValue,
      source: entityRecord.source,
      attackEventId,
      originKind: entityRecord.originKind,
      expiresAt: entityRecord.expiresAt
    };
  }

  return {
    mode: rawMode,
    action: rawAction,
    reasons: rawReasons,
    matchedBlockedEntity: matchedBlockedEntity ?? null
  };
}

function mapRequestLog(requestLog: RequestLogRow): JsonObject {
  return {
    id: requestLog.id,
    tenantId: requestLog.tenant_id,
    siteId: requestLog.site_id,
    occurredAt: requestLog.occurred_at.toISOString(),
    method: requestLog.method,
    host: requestLog.host,
    path: requestLog.path,
    statusCode: requestLog.status_code,
    processedForDetection: requestLog.processed_for_detection,
    createdAt: requestLog.created_at.toISOString()
  };
}

async function evaluateSiteProtectionForBody(
  request: IncomingMessage,
  body: JsonObject
): Promise<{
  site: SiteRow;
  occurredAt: Date;
  method: string;
  host: string;
  path: string;
  queryString?: string;
  clientIp?: string;
  userAgent?: string;
  referer?: string;
  protection: Awaited<ReturnType<typeof evaluateProtectionEnforcement>>;
}> {
  const siteId = getTrimmedString(body, "siteId", { minLength: 36, maxLength: 36 })!;
  const site = await requireActiveSiteByIngestionKey(request, siteId);
  const occurredAt = parseDateTime(body.occurredAt, "occurredAt");
  const method = getTrimmedString(body, "method", { minLength: 3, maxLength: 16 })!.toUpperCase();
  const host = getTrimmedString(body, "host", { minLength: 3, maxLength: 255 })!;
  const path = getTrimmedString(body, "path", { minLength: 1, maxLength: 2048 })!;
  const queryString = getTrimmedString(body, "queryString", {
    maxLength: 4096,
    optional: true
  });
  const clientIp = parseOptionalClientIp(
    getTrimmedString(body, "clientIp", { maxLength: 64, optional: true })
  );
  const userAgent = getTrimmedString(body, "userAgent", {
    maxLength: 2048,
    optional: true
  });
  const referer = getTrimmedString(body, "referer", {
    maxLength: 2048,
    optional: true
  });
  const protection = await evaluateProtectionEnforcement({
    siteId: site.id,
    occurredAt,
    path,
    queryString,
    clientIp,
    userAgent,
    referer
  });

  return {
    site,
    occurredAt,
    method,
    host,
    path,
    queryString,
    clientIp,
    userAgent,
    referer,
    protection
  };
}

async function handleRegister(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = expectObject(await readJsonBody(request), "body");
  const email = parseEmail(getTrimmedString(body, "email", { minLength: 5, maxLength: 255 })!);
  const password = getTrimmedString(body, "password", { minLength: 8, maxLength: 128 })!;
  const displayName = getTrimmedString(body, "displayName", { minLength: 2, maxLength: 120 })!;

  const existingUser = await findUserByEmail(email);

  if (existingUser) {
    throw new ApiError(409, "EMAIL_ALREADY_EXISTS", "A user with this email already exists.");
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser({
    email,
    passwordHash,
    displayName
  }).catch((error: unknown) => {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new ApiError(409, "EMAIL_ALREADY_EXISTS", "A user with this email already exists.");
    }

    throw error;
  });

  sendSuccess(response, 201, {
    user: mapUser(user)
  });
}

async function handleLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = expectObject(await readJsonBody(request), "body");
  const email = parseEmail(getTrimmedString(body, "email", { minLength: 5, maxLength: 255 })!);
  const password = getTrimmedString(body, "password", { minLength: 8, maxLength: 128 })!;
  await deleteExpiredUserSessions();
  const user = await findUserByEmail(email);

  if (!user || user.status !== "active") {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  const isValidPassword = await verifyPassword(password, user.password_hash);

  if (!isValidPassword) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  const rawToken = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await createUserSession({
    userId: user.id,
    tokenHash,
    expiresAt
  });
  await updateUserLastLoginAt(user.id);

  const memberships = await listTenantMembershipsByUserId(user.id);

  sendSuccess(response, 200, {
    token: rawToken,
    expiresAt: expiresAt.toISOString(),
    user: mapUser({
      ...user,
      last_login_at: new Date()
    }),
    memberships: memberships.map(mapMembership)
  });
}

async function handleLogout(request: IncomingMessage, response: ServerResponse): Promise<void> {
  await deleteExpiredUserSessions();
  const tokenHash = hashOpaqueToken(getBearerToken(request));
  await deleteUserSessionByTokenHash(tokenHash);

  sendSuccess(response, 200, {
    loggedOut: true
  });
}

async function handleCreateTenant(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const auth = await requireAuth(request);
  const body = expectObject(await readJsonBody(request), "body");
  const name = getTrimmedString(body, "name", { minLength: 2, maxLength: 120 })!;
  const slug = parseSlug(getTrimmedString(body, "slug", { minLength: 2, maxLength: 80 })!);

  const tenant = await withTransaction(async (client) => {
    const tenantId = randomUUID();
    const now = new Date();
    const tenantResult = await client.query(
      `
        INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
        VALUES ($1, $2, $3, 'active', $4, $4)
        RETURNING *
      `,
      [tenantId, name, slug, now]
    );

    await client.query(
      `
        INSERT INTO tenant_users (tenant_id, user_id, role)
        VALUES ($1, $2, 'owner')
      `,
      [tenantId, auth.user.id]
    );

    return tenantResult.rows[0];
  }).catch((error: unknown) => {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new ApiError(409, "TENANT_SLUG_ALREADY_EXISTS", "The tenant slug is already in use.");
    }

    throw error;
  });

  sendSuccess(response, 201, {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      createdAt: tenant.created_at.toISOString()
    }
  });
}

async function handleCreateSite(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const auth = await requireAuth(request);
  const body = expectObject(await readJsonBody(request), "body");
  const tenantId = getTrimmedString(body, "tenantId", { minLength: 36, maxLength: 36 })!;
  const name = getTrimmedString(body, "name", { minLength: 2, maxLength: 120 })!;
  const domain = parseDomain(getTrimmedString(body, "domain", { minLength: 4, maxLength: 255 })!);

  assertTenantAccess(auth, tenantId);

  const ingestionKey = generateOpaqueToken();
  const ingestionKeyHash = hashOpaqueToken(ingestionKey);

  const site = await withTransaction(async (client) => {
    const createdSite = await createSite(
      {
        tenantId,
        name,
        domain,
        ingestionKeyHash
      },
      client
    );

    await upsertSecurityPolicy(
      {
        siteId: createdSite.id,
        mode: "monitor",
        blockSqlInjection: true,
        blockXss: true,
        blockSuspiciousUserAgent: true,
        enableRateLimit: true,
        rateLimitThreshold: 120,
        autoBlockHighRisk: false,
        highRiskScoreThreshold: 90
      },
      client
    );

    return createdSite;
  }).catch((error: unknown) => {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new ApiError(
        409,
        "SITE_DOMAIN_ALREADY_EXISTS",
        "This domain already exists inside the tenant."
      );
    }

    throw error;
  });

  sendSuccess(response, 201, {
    site: {
      id: site.id,
      tenantId: site.tenant_id,
      name: site.name,
      domain: site.domain,
      status: site.status,
      createdAt: site.created_at.toISOString()
    },
    ingestionKey
  });
}

async function handleGetSecurityPolicy(
  request: IncomingMessage,
  response: ServerResponse,
  siteId: string
): Promise<void> {
  const auth = await requireAuth(request);
  const site = await requireSiteAccess(auth, siteId);
  const existingPolicy = await findSecurityPolicyBySiteId(site.id);
  const policy =
    existingPolicy ??
    (await upsertSecurityPolicy({
      siteId: site.id,
      mode: "monitor",
      blockSqlInjection: true,
      blockXss: true,
      blockSuspiciousUserAgent: true,
      enableRateLimit: true,
      rateLimitThreshold: 120,
      autoBlockHighRisk: false,
      highRiskScoreThreshold: 90
    }));

  sendSuccess(response, 200, {
    securityPolicy: mapSecurityPolicy(policy)
  });
}

async function handleUpdateSecurityPolicy(
  request: IncomingMessage,
  response: ServerResponse,
  siteId: string
): Promise<void> {
  const auth = await requireAuth(request);
  const site = await requireSiteAccess(auth, siteId);
  const body = expectObject(await readJsonBody(request), "body");
  const mode = parseSecurityPolicyMode(
    getTrimmedString(body, "mode", { minLength: 7, maxLength: 7 })!
  );
  const rateLimitThreshold = getOptionalInteger(body, "rateLimitThreshold", {
    min: 1,
    max: 100000
  });
  const highRiskScoreThreshold = getOptionalInteger(body, "highRiskScoreThreshold", {
    min: 0,
    max: 100
  });

  if (rateLimitThreshold === undefined) {
    throw new ApiError(400, "VALIDATION_ERROR", "rateLimitThreshold is required.");
  }

  if (highRiskScoreThreshold === undefined) {
    throw new ApiError(400, "VALIDATION_ERROR", "highRiskScoreThreshold is required.");
  }

  const policy = await upsertSecurityPolicy({
    siteId: site.id,
    mode,
    blockSqlInjection: getRequiredBoolean(body, "blockSqlInjection"),
    blockXss: getRequiredBoolean(body, "blockXss"),
    blockSuspiciousUserAgent: getRequiredBoolean(body, "blockSuspiciousUserAgent"),
    enableRateLimit: getRequiredBoolean(body, "enableRateLimit"),
    rateLimitThreshold,
    autoBlockHighRisk: getRequiredBoolean(body, "autoBlockHighRisk"),
    highRiskScoreThreshold
  });

  sendSuccess(response, 200, {
    securityPolicy: mapSecurityPolicy(policy)
  });
}

async function handleListBlockedEntities(
  request: IncomingMessage,
  response: ServerResponse,
  siteId: string
): Promise<void> {
  const auth = await requireAuth(request);
  const site = await requireSiteAccess(auth, siteId);
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const attackEventId = parseOptionalPositiveIntegerQueryParam(
    requestUrl.searchParams.get("attackEventId"),
    "attackEventId"
  );

  if (attackEventId !== undefined) {
    const attackEvent = await findAttackEventById(attackEventId);

    if (!attackEvent) {
      throw new ApiError(404, "ATTACK_EVENT_NOT_FOUND", "Attack event not found.");
    }

    if (attackEvent.site_id !== site.id) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "attackEventId must belong to the current site."
      );
    }
  }

  const items = await listBlockedEntitiesBySiteId(site.id, { attackEventId });

  sendSuccess(response, 200, {
    items: items.map(mapBlockedEntity)
  });
}

async function handleCreateBlockedEntity(
  request: IncomingMessage,
  response: ServerResponse,
  siteId: string
): Promise<void> {
  const auth = await requireAuth(request);
  const site = await requireSiteAccess(auth, siteId);
  const body = expectObject(await readJsonBody(request), "body");
  const entityType = parseBlockedEntityType(
    getTrimmedString(body, "entityType", { minLength: 2, maxLength: 16 })!
  );
  const sourceValue = getTrimmedString(body, "source", {
    minLength: 6,
    maxLength: 9,
    optional: true
  });
  const expiresAtRaw = body.expiresAt;
  const attackEventId = getOptionalInteger(body, "attackEventId", { min: 1 });
  const expiresAt =
    expiresAtRaw === undefined || expiresAtRaw === null
      ? undefined
      : parseDateTime(expiresAtRaw, "expiresAt");

  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new ApiError(400, "VALIDATION_ERROR", "expiresAt must be a future datetime.");
  }

  if (attackEventId !== undefined) {
    const attackEvent = await findAttackEventById(attackEventId);

    if (!attackEvent) {
      throw new ApiError(404, "ATTACK_EVENT_NOT_FOUND", "Attack event not found.");
    }

    if (attackEvent.site_id !== site.id) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "attackEventId must belong to the current site."
      );
    }
  }

  const blockedEntity = await createBlockedEntity({
    siteId: site.id,
    entityType,
    entityValue: parseIpEntityValue(
      getTrimmedString(body, "entityValue", { minLength: 3, maxLength: 255 })!
    ),
    reason: getTrimmedString(body, "reason", { minLength: 2, maxLength: 500 })!,
    source: sourceValue ? parseBlockedEntitySource(sourceValue) : undefined,
    attackEventId,
    expiresAt
  });

  sendSuccess(response, 201, {
    blockedEntity: mapBlockedEntity(blockedEntity)
  });
}

async function handleDeleteBlockedEntity(
  request: IncomingMessage,
  response: ServerResponse,
  blockedEntityId: number
): Promise<void> {
  const auth = await requireAuth(request);
  const blockedEntity = await findBlockedEntityById(blockedEntityId);

  if (!blockedEntity) {
    throw new ApiError(404, "BLOCKED_ENTITY_NOT_FOUND", "Blocked entity not found.");
  }

  await requireSiteAccess(auth, blockedEntity.site_id);
  const deletedEntity = await deleteBlockedEntityById(blockedEntity.id);

  if (!deletedEntity) {
    throw new ApiError(404, "BLOCKED_ENTITY_NOT_FOUND", "Blocked entity not found.");
  }

  sendSuccess(response, 200, {
    deleted: true,
    blockedEntity: mapBlockedEntity(deletedEntity)
  });
}

async function handleProtectionCheck(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = expectObject(await readJsonBody(request), "body");
  const protectionContext = await evaluateSiteProtectionForBody(request, body);

  sendSuccess(response, 200, {
    siteId: protectionContext.site.id,
    protection: protectionContext.protection
  });
}

async function handleCreateRequestLog(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const body = expectObject(await readJsonBody(request), "body");
  const protectionContext = await evaluateSiteProtectionForBody(request, body);
  const countryCode = getTrimmedString(body, "countryCode", { maxLength: 2, optional: true })?.toUpperCase();

  const input: CreateRequestLogInput = {
    tenantId: protectionContext.site.tenant_id,
    siteId: protectionContext.site.id,
    occurredAt: protectionContext.occurredAt,
    method: protectionContext.method,
    host: protectionContext.host,
    path: protectionContext.path,
    externalRequestId: getTrimmedString(body, "externalRequestId", { maxLength: 128, optional: true }),
    queryString: protectionContext.queryString,
    statusCode: getOptionalInteger(body, "statusCode", { min: 100, max: 599 }),
    clientIp: protectionContext.clientIp,
    countryCode,
    userAgent: protectionContext.userAgent,
    referer: protectionContext.referer,
    requestSizeBytes: getOptionalInteger(body, "requestSizeBytes", { min: 0 }),
    responseSizeBytes: getOptionalInteger(body, "responseSizeBytes", { min: 0 }),
    latencyMs: getOptionalInteger(body, "latencyMs", { min: 0 }),
    headers: getOptionalRecord(body, "headers"),
    metadata: getOptionalRecord(body, "metadata"),
    scheme: getTrimmedString(body, "scheme", { minLength: 4, maxLength: 16, optional: true })?.toLowerCase()
  };

  if (protectionContext.protection.action === "block") {
    throw new ApiError(
      403,
      "PROTECTION_BLOCKED",
      "Request was blocked by the site security policy.",
        {
          siteId: protectionContext.site.id,
          mode: protectionContext.protection.mode,
          reasons: protectionContext.protection.reasons,
          matchedBlockedEntity: protectionContext.protection.matchedBlockedEntity ?? null
        }
      );
  }

    if (protectionContext.protection.action === "monitor") {
      input.metadata = {
        ...(input.metadata ?? {}),
        protectionEnforcement: {
          mode: protectionContext.protection.mode,
          action: protectionContext.protection.action,
          reasons: protectionContext.protection.reasons,
          matchedBlockedEntity: protectionContext.protection.matchedBlockedEntity ?? null
        }
      };
    }

  const requestLog = await createRequestLog(input);

  sendSuccess(response, 201, {
    requestLog: mapRequestLog(requestLog),
    protection: protectionContext.protection
  });
}

async function handleListAttackEvents(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<void> {
  const auth = await requireAuth(request);
  const tenantId = url.searchParams.get("tenantId");

  if (!tenantId) {
    throw new ApiError(400, "VALIDATION_ERROR", "tenantId query parameter is required.");
  }

  assertTenantAccess(auth, tenantId);

  const status = url.searchParams.get("status");
  const siteId = url.searchParams.get("siteId") ?? undefined;
  const eventType = url.searchParams.get("eventType");
  const severity = url.searchParams.get("severity");
  const startAt = parseOptionalDateTime(url.searchParams.get("startAt"), "startAt");
  const endAt = parseOptionalDateTime(url.searchParams.get("endAt"), "endAt");
  const limitParam = url.searchParams.get("limit");
  const filters: AttackEventListFilters = {
    tenantId,
    siteId,
    startAt,
    endAt
  };

  if (status) {
    if (!["open", "reviewed", "resolved"].includes(status)) {
      throw new ApiError(400, "VALIDATION_ERROR", "status must be one of: open, reviewed, resolved.");
    }

    filters.status = status as AttackStatus;
  }

  if (eventType) {
    filters.eventType = parseAttackEventType(eventType);
  }

  if (severity) {
    filters.severity = parseAttackSeverity(severity);
  }

  if (startAt && endAt && startAt > endAt) {
    throw new ApiError(400, "VALIDATION_ERROR", "startAt must be earlier than or equal to endAt.");
  }

  if (limitParam) {
    const parsedLimit = Number(limitParam);

    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      throw new ApiError(400, "VALIDATION_ERROR", "limit must be an integer between 1 and 200.");
    }

    filters.limit = parsedLimit;
  }

  if (siteId) {
    const site = await findSiteById(siteId);

    if (!site || site.tenant_id !== tenantId) {
      throw new ApiError(404, "SITE_NOT_FOUND", "Site not found inside the tenant.");
    }
  }

  const events = await listAttackEvents(filters);

  sendSuccess(response, 200, {
    items: events.map((event) => ({
      id: event.id,
      tenantId: event.tenant_id,
      siteId: event.site_id,
      requestLogId: event.request_log_id,
      eventType: event.event_type,
      ruleCode: event.rule_code,
      severity: event.severity,
      status: event.status,
      summary: event.summary,
      details: event.details,
      detectedAt: event.detected_at.toISOString(),
      createdAt: event.created_at.toISOString(),
      updatedAt: event.updated_at.toISOString()
    }))
  });
}

function parseRiskLevel(value: string): RiskLevel {
  if (!["low", "medium", "high", "critical"].includes(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", "riskLevel must be one of: low, medium, high, critical.");
  }

  return value as RiskLevel;
}

function parseAttackSeverity(value: string): AttackSeverity {
  if (!["low", "medium", "high", "critical"].includes(value)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "severity must be one of: low, medium, high, critical."
    );
  }

  return value as AttackSeverity;
}

function parseAttackEventType(value: string): string {
  const normalizedValue = value.trim().toLowerCase();

  if (!/^[a-z][a-z0-9_]{1,63}$/.test(normalizedValue)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "eventType must be 2-64 chars and contain lowercase letters, digits, or underscores."
    );
  }

  return normalizedValue;
}

async function handleListAiRiskResults(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<void> {
  const auth = await requireAuth(request);
  const tenantId = url.searchParams.get("tenantId");

  if (!tenantId) {
    throw new ApiError(400, "VALIDATION_ERROR", "tenantId query parameter is required.");
  }

  assertTenantAccess(auth, tenantId);

  const siteId = url.searchParams.get("siteId") ?? undefined;
  const requestLogId = parseOptionalPositiveIntegerQueryParam(
    url.searchParams.get("requestLogId"),
    "requestLogId"
  );
  const attackEventId = parseOptionalPositiveIntegerQueryParam(
    url.searchParams.get("attackEventId"),
    "attackEventId"
  );
  const riskLevel = url.searchParams.get("riskLevel");
  const startAt = parseOptionalDateTime(url.searchParams.get("startAt"), "startAt");
  const endAt = parseOptionalDateTime(url.searchParams.get("endAt"), "endAt");
  const limitParam = url.searchParams.get("limit");
  const filters: AiRiskResultListFilters = {
    tenantId,
    siteId,
    requestLogId,
    attackEventId,
    startAt,
    endAt
  };

  if (siteId) {
    const site = await findSiteById(siteId);

    if (!site || site.tenant_id !== tenantId) {
      throw new ApiError(404, "SITE_NOT_FOUND", "Site not found inside the tenant.");
    }
  }

  if (riskLevel) {
    filters.riskLevel = parseRiskLevel(riskLevel);
  }

  if (requestLogId) {
    const requestLog = await findRequestLogById(requestLogId);

    if (!requestLog || requestLog.tenant_id !== tenantId) {
      throw new ApiError(
        404,
        "REQUEST_LOG_NOT_FOUND",
        "Request log not found inside the tenant."
      );
    }

    if (siteId && requestLog.site_id !== siteId) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "requestLogId does not belong to the selected siteId."
      );
    }
  }

  if (attackEventId) {
    const attackEvent = await findAttackEventById(attackEventId);

    if (!attackEvent || attackEvent.tenant_id !== tenantId) {
      throw new ApiError(
        404,
        "ATTACK_EVENT_NOT_FOUND",
        "Attack event not found inside the tenant."
      );
    }

    if (siteId && attackEvent.site_id !== siteId) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "attackEventId does not belong to the selected siteId."
      );
    }
  }

  if (startAt && endAt && startAt > endAt) {
    throw new ApiError(400, "VALIDATION_ERROR", "startAt must be earlier than or equal to endAt.");
  }

  if (limitParam) {
    const parsedLimit = Number(limitParam);

    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      throw new ApiError(400, "VALIDATION_ERROR", "limit must be an integer between 1 and 200.");
    }

    filters.limit = parsedLimit;
  }

  const items = await listAiRiskResults(filters);

  sendSuccess(response, 200, {
    items: items.map((item) => ({
      id: item.id,
      tenantId: item.tenant_id,
      siteId: item.site_id,
      requestLogId: item.request_log_id,
      attackEventId: item.attack_event_id,
      modelName: item.model_name,
      modelVersion: item.model_version,
      riskScore: Number(item.risk_score),
      riskLevel: item.risk_level,
      explanation: item.explanation,
      factors: item.factors,
      rawResponse: item.raw_response,
      createdAt: item.created_at.toISOString()
    }))
  });
}

async function assertOptionalTenantSiteAccess(tenantId: string, siteId?: string): Promise<void> {
  if (!siteId) {
    return;
  }

  const site = await findSiteById(siteId);

  if (!site || site.tenant_id !== tenantId) {
    throw new ApiError(404, "SITE_NOT_FOUND", "Site not found inside the tenant.");
  }
}

async function handleListSiteDashboardSummaries(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<void> {
  const auth = await requireAuth(request);
  const tenantId = url.searchParams.get("tenantId");

  if (!tenantId) {
    throw new ApiError(400, "VALIDATION_ERROR", "tenantId query parameter is required.");
  }

  assertTenantAccess(auth, tenantId);

  const siteId = url.searchParams.get("siteId") ?? undefined;
  const startAt = parseOptionalDateTime(url.searchParams.get("startAt"), "startAt");
  const endAt = parseOptionalDateTime(url.searchParams.get("endAt"), "endAt");

  if (startAt && endAt && startAt > endAt) {
    throw new ApiError(400, "VALIDATION_ERROR", "startAt must be earlier than or equal to endAt.");
  }

  await assertOptionalTenantSiteAccess(tenantId, siteId);

  const items = await listSiteDashboardSummaries({
    tenantId,
    siteId,
    startAt,
    endAt
  });

  sendSuccess(response, 200, {
    items: items.map((item) => ({
      siteId: item.site_id,
      siteName: item.site_name,
      siteDomain: item.site_domain,
      requestLogCount: Number(item.request_log_count),
      attackEventCount: Number(item.attack_event_count),
      aiRiskResultCount: Number(item.ai_risk_result_count),
      highRiskResultCount: Number(item.high_risk_result_count),
      latestRequestLogAt: item.latest_request_log_at
        ? item.latest_request_log_at.toISOString()
        : null,
      latestAttackEventAt: item.latest_attack_event_at
        ? item.latest_attack_event_at.toISOString()
        : null,
      latestAiRiskResultAt: item.latest_ai_risk_result_at
        ? item.latest_ai_risk_result_at.toISOString()
        : null
    }))
  });
}

async function handleListRecentHighRiskEvents(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<void> {
  const auth = await requireAuth(request);
  const tenantId = url.searchParams.get("tenantId");

  if (!tenantId) {
    throw new ApiError(400, "VALIDATION_ERROR", "tenantId query parameter is required.");
  }

  assertTenantAccess(auth, tenantId);

  const siteId = url.searchParams.get("siteId") ?? undefined;
  const limit = parseOptionalPositiveIntegerQueryParam(url.searchParams.get("limit"), "limit");
  const offset = parseOptionalNonNegativeIntegerQueryParam(
    url.searchParams.get("offset"),
    "offset"
  );

  if (limit !== undefined && limit > 200) {
    throw new ApiError(400, "VALIDATION_ERROR", "limit must be an integer between 1 and 200.");
  }

  if (offset !== undefined && offset > 10000) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "offset must be an integer between 0 and 10000."
    );
  }

  await assertOptionalTenantSiteAccess(tenantId, siteId);

  const items = await listRecentHighRiskEvents({
    tenantId,
    siteId,
    limit,
    offset
  });

  sendSuccess(response, 200, {
    pagination: {
      limit: limit ?? 20,
      offset: offset ?? 0
    },
    items: items.map((item) => ({
      attackEventId: item.attack_event_id,
      siteId: item.site_id,
      siteName: item.site_name,
      siteDomain: item.site_domain,
      requestLogId: item.request_log_id,
      eventType: item.event_type,
      severity: item.severity,
      status: item.status,
      summary: item.summary,
      detectedAt: item.detected_at.toISOString(),
      riskScore: Number(item.risk_score),
      riskLevel: item.risk_level,
      clientIp: item.client_ip,
      path: item.path,
      occurredAt: item.occurred_at.toISOString()
    }))
  });
}

function parseOptionalBoolean(value: string | null, fieldName: string): boolean | undefined {
  if (value === null) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new ApiError(400, "VALIDATION_ERROR", `${fieldName} must be either true or false.`);
}

function parsePositiveIntegerPathParam(value: string, fieldName: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", `${fieldName} must be a positive integer.`);
  }

  return parsed;
}

function parseOptionalPositiveIntegerQueryParam(
  value: string | null,
  fieldName: string
): number | undefined {
  if (value === null) {
    return undefined;
  }

  return parsePositiveIntegerPathParam(value, fieldName);
}

function parseOptionalNonNegativeIntegerQueryParam(
  value: string | null,
  fieldName: string
): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ApiError(400, "VALIDATION_ERROR", `${fieldName} must be a non-negative integer.`);
  }

  return parsed;
}

async function handleListRequestLogs(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<void> {
  const auth = await requireAuth(request);
  const tenantId = url.searchParams.get("tenantId");

  if (!tenantId) {
    throw new ApiError(400, "VALIDATION_ERROR", "tenantId query parameter is required.");
  }

  assertTenantAccess(auth, tenantId);

  const siteId = url.searchParams.get("siteId") ?? undefined;
  const clientIp = url.searchParams.get("clientIp") ?? undefined;
  const method = url.searchParams.get("method")?.trim().toUpperCase() || undefined;
  const statusCodeParam = url.searchParams.get("statusCode");
  const startAt = parseOptionalDateTime(url.searchParams.get("startAt"), "startAt");
  const endAt = parseOptionalDateTime(url.searchParams.get("endAt"), "endAt");
  const processedForDetection = parseOptionalBoolean(
    url.searchParams.get("processedForDetection"),
    "processedForDetection"
  );
  const limitParam = url.searchParams.get("limit");
  const filters: RequestLogListFilters = {
    tenantId,
    siteId,
    clientIp: parseOptionalClientIp(clientIp),
    method,
    startAt,
    endAt,
    processedForDetection
  };

  if (siteId) {
    const site = await findSiteById(siteId);

    if (!site || site.tenant_id !== tenantId) {
      throw new ApiError(404, "SITE_NOT_FOUND", "Site not found inside the tenant.");
    }
  }

  if (method && !/^[A-Z]{3,16}$/.test(method)) {
    throw new ApiError(400, "VALIDATION_ERROR", "method must be an uppercase HTTP method.");
  }

  if (statusCodeParam !== null) {
    const statusCode = Number(statusCodeParam);

    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      throw new ApiError(400, "VALIDATION_ERROR", "statusCode must be an integer between 100 and 599.");
    }

    filters.statusCode = statusCode;
  }

  if (startAt && endAt && startAt > endAt) {
    throw new ApiError(400, "VALIDATION_ERROR", "startAt must be earlier than or equal to endAt.");
  }

  if (limitParam) {
    const parsedLimit = Number(limitParam);

    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      throw new ApiError(400, "VALIDATION_ERROR", "limit must be an integer between 1 and 200.");
    }

    filters.limit = parsedLimit;
  }

  const items = await listRequestLogs(filters);

  sendSuccess(response, 200, {
    items: items.map((item) => ({
      id: item.id,
      tenantId: item.tenant_id,
      siteId: item.site_id,
      occurredAt: item.occurred_at.toISOString(),
      method: item.method,
      host: item.host,
      path: item.path,
      queryString: item.query_string,
      statusCode: item.status_code,
      clientIp: item.client_ip,
      userAgent: item.user_agent,
      processedForDetection: item.processed_for_detection,
      createdAt: item.created_at.toISOString()
    }))
  });
}

async function handleGetAttackEventDetail(
  request: IncomingMessage,
  response: ServerResponse,
  attackEventId: number
): Promise<void> {
  const auth = await requireAuth(request);
  const attackEvent = await findAttackEventById(attackEventId);

  if (!attackEvent) {
    throw new ApiError(404, "ATTACK_EVENT_NOT_FOUND", "Attack event not found.");
  }

  assertTenantAccess(auth, attackEvent.tenant_id);

  const requestLog = await findRequestLogById(attackEvent.request_log_id);

  if (!requestLog || requestLog.tenant_id !== attackEvent.tenant_id) {
    throw new ApiError(500, "DATA_INTEGRITY_ERROR", "Related request log is missing.");
  }

  const aiRiskResult = await findLatestRiskResultForAttackEvent(attackEvent.id);
  const blockedEntities = await listBlockedEntitiesBySiteId(attackEvent.site_id, {
    attackEventId: attackEvent.id
  });
  const mappedBlockedEntities = blockedEntities.map(mapBlockedEntity);
  const activeBlockedEntity = pickActiveBlockedEntity(mappedBlockedEntities);
  const dispositionSummary = buildDispositionSummary({
    blockedEntities: mappedBlockedEntities,
    activeBlockedEntity
  });
  const protectionEnforcement = extractAttackEventProtectionEnforcement(attackEvent.details);

  sendSuccess(response, 200, {
    attackEvent: {
      id: attackEvent.id,
      tenantId: attackEvent.tenant_id,
      siteId: attackEvent.site_id,
      requestLogId: attackEvent.request_log_id,
      eventType: attackEvent.event_type,
      severity: attackEvent.severity,
      summary: attackEvent.summary,
      details: attackEvent.details,
      createdAt: attackEvent.created_at.toISOString()
    },
    requestLog: {
      id: requestLog.id,
      occurredAt: requestLog.occurred_at.toISOString(),
      method: requestLog.method,
      host: requestLog.host,
      path: requestLog.path,
      queryString: requestLog.query_string,
      statusCode: requestLog.status_code,
      clientIp: requestLog.client_ip,
      userAgent: requestLog.user_agent
    },
    aiRiskResult: aiRiskResult
      ? {
          id: aiRiskResult.id,
          modelName: aiRiskResult.model_name,
          modelVersion: aiRiskResult.model_version,
          riskScore: Number(aiRiskResult.risk_score),
          riskLevel: aiRiskResult.risk_level,
          explanation: aiRiskResult.explanation,
          factors: aiRiskResult.factors,
          rawResponse: aiRiskResult.raw_response,
          createdAt: aiRiskResult.created_at.toISOString()
        }
      : null,
    protectionEnforcement,
    blockedEntities: mappedBlockedEntities,
    activeBlockedEntity,
    dispositionSummary
  });
}

async function handleRunDetection(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const auth = await requireAuth(request);
  const rawBody = await readJsonBody(request);
  const body = rawBody === null ? {} : expectObject(rawBody, "body");
  const tenantId = getTrimmedString(body, "tenantId", {
    minLength: 36,
    maxLength: 36,
    optional: true
  });
  const limit = getOptionalInteger(body, "limit", { min: 1, max: 200 });

  const tenantIds = tenantId
    ? [assertTenantAccess(auth, tenantId).tenant_id]
    : auth.memberships.map((membership) => membership.tenant_id);

  const result = await runAttackDetection({
    tenantIds,
    limit
  });

  sendSuccess(response, 200, {
    processedCount: result.processedCount,
    eventCount: result.eventCount,
    logsWithFindings: result.logsWithFindings,
    aiSuccessCount: result.aiSuccessCount,
    aiFailureCount: result.aiFailureCount,
    tenantIds
  });
}

function matchesRoute(request: IncomingMessage, method: string, pathname: string): boolean {
  return request.method === method && request.url !== undefined && new URL(request.url, "http://localhost").pathname === pathname;
}

const { port, host } = getServerEnvConfig();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const attackEventDetailMatch =
    request.method === "GET"
      ? /^\/api\/v1\/attack-events\/(\d+)$/.exec(url.pathname)
      : null;
  const siteSecurityPolicyMatch =
    request.method === "GET" || request.method === "PUT"
      ? /^\/api\/v1\/sites\/([0-9a-fA-F-]{36})\/security-policy$/.exec(url.pathname)
      : null;
  const siteBlockedEntitiesMatch =
    request.method === "GET" || request.method === "POST"
      ? /^\/api\/v1\/sites\/([0-9a-fA-F-]{36})\/blocked-entities$/.exec(url.pathname)
      : null;
  const deleteBlockedEntityMatch =
    request.method === "DELETE"
      ? /^\/api\/v1\/blocked-entities\/(\d+)$/.exec(url.pathname)
      : null;

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      sendSuccess(response, 200, {
        service: "api",
        status: "ok",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (matchesRoute(request, "POST", "/api/v1/auth/register")) {
      await handleRegister(request, response);
      return;
    }

    if (matchesRoute(request, "POST", "/api/v1/auth/login")) {
      await handleLogin(request, response);
      return;
    }

    if (matchesRoute(request, "POST", "/api/v1/auth/logout")) {
      await handleLogout(request, response);
      return;
    }

    if (matchesRoute(request, "POST", "/api/v1/tenants")) {
      await handleCreateTenant(request, response);
      return;
    }

    if (matchesRoute(request, "POST", "/api/v1/sites")) {
      await handleCreateSite(request, response);
      return;
    }

    if (matchesRoute(request, "POST", "/api/v1/protection/check")) {
      await handleProtectionCheck(request, response);
      return;
    }

    if (siteSecurityPolicyMatch && request.method === "GET") {
      await handleGetSecurityPolicy(
        request,
        response,
        parseUuidPathParam(siteSecurityPolicyMatch[1], "id")
      );
      return;
    }

    if (siteSecurityPolicyMatch && request.method === "PUT") {
      await handleUpdateSecurityPolicy(
        request,
        response,
        parseUuidPathParam(siteSecurityPolicyMatch[1], "id")
      );
      return;
    }

    if (siteBlockedEntitiesMatch && request.method === "GET") {
      await handleListBlockedEntities(
        request,
        response,
        parseUuidPathParam(siteBlockedEntitiesMatch[1], "id")
      );
      return;
    }

    if (siteBlockedEntitiesMatch && request.method === "POST") {
      await handleCreateBlockedEntity(
        request,
        response,
        parseUuidPathParam(siteBlockedEntitiesMatch[1], "id")
      );
      return;
    }

    if (deleteBlockedEntityMatch) {
      await handleDeleteBlockedEntity(
        request,
        response,
        parsePositiveIntegerPathParam(deleteBlockedEntityMatch[1], "id")
      );
      return;
    }

    if (matchesRoute(request, "POST", "/api/v1/request-logs")) {
      await handleCreateRequestLog(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/attack-events") {
      await handleListAttackEvents(request, response, url);
      return;
    }

    if (attackEventDetailMatch) {
      await handleGetAttackEventDetail(
        request,
        response,
        parsePositiveIntegerPathParam(attackEventDetailMatch[1], "id")
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/request-logs") {
      await handleListRequestLogs(request, response, url);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/ai-risk-results") {
      await handleListAiRiskResults(request, response, url);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/dashboard/site-summaries") {
      await handleListSiteDashboardSummaries(request, response, url);
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/v1/dashboard/recent-high-risk-events"
    ) {
      await handleListRecentHighRiskEvents(request, response, url);
      return;
    }

    if (matchesRoute(request, "POST", "/api/v1/detection/run")) {
      await handleRunDetection(request, response);
      return;
    }

    throw new ApiError(404, "NOT_FOUND", "Route not found.");
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(port, host, () => {
  console.log(`SecuAI API listening on http://${host}:${port}`);
});
