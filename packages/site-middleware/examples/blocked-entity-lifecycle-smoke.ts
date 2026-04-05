import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";

import assert from "node:assert/strict";

import {
  createSiteProtectionClient,
  enforceNodeRequestProtection,
  type SiteProtectionAction,
  type SiteProtectionDecision,
  type SiteProtectionMode,
  type SiteRequestContext
} from "../src/index.js";

type JsonObject = Record<string, unknown>;

type ApiResponse = {
  status: number;
  json: JsonObject;
};

type ProvisionedSite = {
  token: string;
  tenantId: string;
  siteId: string;
  ingestionKey: string;
  siteDomain: string;
};

type ProtectionPayload = {
  mode: SiteProtectionMode;
  action: SiteProtectionAction;
  reasons: string[];
};

class SmokeError extends Error {
  constructor(message: string, readonly details?: JsonObject) {
    super(message);
  }
}

const platformBaseUrl = (process.env.SECUAI_PLATFORM_URL ?? "http://127.0.0.1:3201").replace(
  /\/+$/,
  ""
);
const sitePort = Number(process.env.SECUAI_LIFECYCLE_SITE_PORT ?? "0");
const demoStamp = Date.now().toString();
const demoEmail = `blocked-lifecycle-${demoStamp}@example.com`;
const demoTenantSlug = `blocked-lifecycle-${demoStamp}`;
const demoDomain = `blocked-lifecycle-${demoStamp}.example.com`;
const lifecycleClientIp = process.env.SECUAI_LIFECYCLE_BLOCKED_IP ?? "198.51.100.91";

let currentSiteServerPort = sitePort;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(
  path: string,
  options: {
    method?: string;
    token?: string;
    ingestionKey?: string;
    body?: JsonObject;
  } = {}
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.ingestionKey ? { "x-site-ingestion-key": options.ingestionKey } : {})
  };

  let body: string | undefined;

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${platformBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body
  });
  const text = await response.text();
  const json = (text ? JSON.parse(text) : {}) as JsonObject;

  return { status: response.status, json };
}

function expectSuccess<T>(response: ApiResponse, label: string): T {
  if (response.status < 200 || response.status >= 300 || response.json.success !== true) {
    throw new SmokeError(`${label} failed.`, {
      status: response.status,
      response: response.json
    });
  }

  return response.json.data as T;
}

async function waitForApiReady(timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${platformBaseUrl}/health`);

      if (response.ok) {
        return;
      }
    } catch {}

    await delay(250);
  }

  throw new SmokeError("API health check did not become ready in time.", {
    platformBaseUrl,
    timeoutMs
  });
}

async function provisionDemoSite(): Promise<ProvisionedSite> {
  const registerData = expectSuccess<{ user: { id: string } }>(
    await apiRequest("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: demoEmail,
        password: "StrongPass123",
        displayName: "Blocked Entity Lifecycle Smoke"
      }
    }),
    "register demo user"
  );

  assert.ok(registerData.user.id, "register should return a user id");

  const loginData = expectSuccess<{ token: string }>(
    await apiRequest("/api/v1/auth/login", {
      method: "POST",
      body: {
        email: demoEmail,
        password: "StrongPass123"
      }
    }),
    "login demo user"
  );

  const tenantData = expectSuccess<{ tenant: { id: string } }>(
    await apiRequest("/api/v1/tenants", {
      method: "POST",
      token: loginData.token,
      body: {
        name: "Blocked Entity Lifecycle Tenant",
        slug: demoTenantSlug
      }
    }),
    "create demo tenant"
  );

  const siteData = expectSuccess<{
    site: { id: string };
    ingestionKey: string;
  }>(
    await apiRequest("/api/v1/sites", {
      method: "POST",
      token: loginData.token,
      body: {
        tenantId: tenantData.tenant.id,
        name: "Blocked Entity Lifecycle Site",
        domain: demoDomain
      }
    }),
    "create demo site"
  );

  await updateSecurityPolicy(loginData.token, siteData.site.id, "monitor");

  return {
    token: loginData.token,
    tenantId: tenantData.tenant.id,
    siteId: siteData.site.id,
    ingestionKey: siteData.ingestionKey,
    siteDomain: demoDomain
  };
}

async function updateSecurityPolicy(
  token: string,
  siteId: string,
  mode: SiteProtectionMode
): Promise<void> {
  expectSuccess<{ securityPolicy: JsonObject }>(
    await apiRequest(`/api/v1/sites/${siteId}/security-policy`, {
      method: "PUT",
      token,
      body: {
        mode,
        blockSqlInjection: true,
        blockXss: true,
        blockSuspiciousUserAgent: true,
        enableRateLimit: true,
        rateLimitThreshold: 100,
        autoBlockHighRisk: false,
        highRiskScoreThreshold: 90
      }
    }),
    `update security policy to ${mode}`
  );
}

async function createBlockedIp(token: string, siteId: string, clientIp: string): Promise<number> {
  const data = expectSuccess<{ blockedEntity: { id: number } }>(
    await apiRequest(`/api/v1/sites/${siteId}/blocked-entities`, {
      method: "POST",
      token,
      body: {
        entityType: "ip",
        entityValue: clientIp,
        reason: "Blocked entity lifecycle smoke"
      }
    }),
    "create blocked entity"
  );

  return data.blockedEntity.id;
}

async function deleteBlockedEntity(token: string, blockedEntityId: number): Promise<void> {
  expectSuccess<{ blockedEntity: { id: number } }>(
    await apiRequest(`/api/v1/blocked-entities/${blockedEntityId}`, {
      method: "DELETE",
      token
    }),
    "delete blocked entity"
  );
}

async function directProtectionCheck(
  siteId: string,
  ingestionKey: string,
  context: SiteRequestContext
): Promise<ProtectionPayload> {
  const data = expectSuccess<{
    siteId: string;
    protection: ProtectionPayload;
  }>(
    await apiRequest("/api/v1/protection/check", {
      method: "POST",
      ingestionKey,
      body: {
        siteId,
        occurredAt: context.occurredAt ?? new Date().toISOString(),
        method: context.method,
        host: context.host,
        path: context.path,
        queryString: context.queryString,
        clientIp: context.clientIp,
        userAgent: context.userAgent,
        referer: context.referer
      }
    }),
    "run direct protection check"
  );

  assert.equal(data.siteId, siteId);
  return data.protection;
}

function normalizeDecision(decision: SiteProtectionDecision): JsonObject {
  return {
    action: decision.action,
    mode: decision.mode,
    reasons: decision.reasons,
    monitored: decision.monitored,
    failOpen: decision.failOpen
  };
}

function normalizeProtection(protection: ProtectionPayload): JsonObject {
  return {
    action: protection.action,
    mode: protection.mode,
    reasons: protection.reasons,
    monitored: protection.action === "monitor",
    failOpen: false
  };
}

function assertProtectionConsistency(
  label: string,
  protection: ProtectionPayload,
  middlewareDecision: SiteProtectionDecision
): void {
  assert.deepEqual(
    normalizeDecision(middlewareDecision),
    normalizeProtection(protection),
    `${label} should match direct protection/check`
  );
}

async function startDemoSiteServer(input: {
  siteId: string;
  ingestionKey: string;
}): Promise<Server> {
  const protectionClient = createSiteProtectionClient({
    platformBaseUrl,
    siteId: input.siteId,
    siteIngestionKey: input.ingestionKey,
    timeoutMs: 1500,
    requestLogReporting: {
      enabled: false
    }
  });

  const siteServer = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const decision = await enforceNodeRequestProtection(request, response, protectionClient);

    if (decision.action === "block") {
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "x-secuai-protection-action": decision.action,
      "x-secuai-protection-mode": decision.mode,
      "x-secuai-fail-open": String(decision.failOpen),
      "x-secuai-monitored": String(decision.monitored)
    });
    response.end(
      JSON.stringify({
        ok: true,
        protection: decision
      })
    );
  });

  await new Promise<void>((resolve, reject) => {
    siteServer.once("error", reject);
    siteServer.listen(sitePort, "127.0.0.1", () => {
      const address = siteServer.address();
      currentSiteServerPort =
        typeof address === "object" && address ? address.port : sitePort;
      siteServer.removeListener("error", reject);
      resolve();
    });
  });

  return siteServer;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function triggerSiteRequest(
  context: SiteRequestContext
): Promise<{ status: number; json: JsonObject }> {
  const search = context.queryString ? `?${context.queryString}` : "";
  const response = await fetch(`http://127.0.0.1:${currentSiteServerPort}${context.path}${search}`, {
    method: context.method,
    headers: {
      host: context.host,
      ...(context.clientIp ? { "x-forwarded-for": context.clientIp } : {}),
      ...(context.userAgent ? { "user-agent": context.userAgent } : {}),
      ...(context.referer ? { referer: context.referer } : {})
    }
  });
  const text = await response.text();
  const json = (text ? JSON.parse(text) : {}) as JsonObject;

  return {
    status: response.status,
    json
  };
}

async function assertLifecycleStep(input: {
  label: string;
  expectedAction: SiteProtectionAction;
  expectedMode: SiteProtectionMode;
  expectBlockedIpReason: boolean;
  expectSiteStatus: 200 | 403;
  client: ReturnType<typeof createSiteProtectionClient>;
  siteId: string;
  ingestionKey: string;
  context: SiteRequestContext;
}): Promise<void> {
  const protection = await directProtectionCheck(input.siteId, input.ingestionKey, input.context);
  assert.equal(protection.mode, input.expectedMode, `${input.label} mode mismatch`);
  assert.equal(protection.action, input.expectedAction, `${input.label} action mismatch`);
  assert.equal(
    protection.reasons.includes("blocked_ip"),
    input.expectBlockedIpReason,
    `${input.label} blocked_ip reason mismatch`
  );

  const middlewareDecision = await input.client.checkRequest(input.context);
  assertProtectionConsistency(input.label, protection, middlewareDecision);

  const siteResponse = await triggerSiteRequest(input.context);
  assert.equal(siteResponse.status, input.expectSiteStatus);

  if (input.expectSiteStatus === 403) {
    assert.equal(siteResponse.json.success, false);
    assert.equal((siteResponse.json.error as JsonObject).code, "REQUEST_BLOCKED");
    assert.deepEqual(
      (((siteResponse.json.error as JsonObject).details ?? {}) as JsonObject).reasons,
      protection.reasons
    );
    assert.equal(
      (((siteResponse.json.error as JsonObject).details ?? {}) as JsonObject).mode,
      protection.mode
    );
    return;
  }

  assert.equal(siteResponse.json.ok, true);
  assert.deepEqual(
    normalizeDecision(siteResponse.json.protection as SiteProtectionDecision),
    normalizeProtection(protection)
  );
}

function buildLifecycleRequestContext(siteDomain: string): SiteRequestContext {
  return {
    method: "GET",
    host: siteDomain,
    path: "/pricing",
    queryString: "plan=starter",
    clientIp: lifecycleClientIp,
    userAgent: "Mozilla/5.0 (SecuAI Lifecycle Smoke)",
    referer: "https://example.com/landing",
    occurredAt: new Date().toISOString()
  };
}

async function main(): Promise<void> {
  console.log("SecuAI blocked entity lifecycle smoke starting");
  console.log(`Platform API: ${platformBaseUrl}`);

  await waitForApiReady();
  const provisioned = await provisionDemoSite();
  const client = createSiteProtectionClient({
    platformBaseUrl,
    siteId: provisioned.siteId,
    siteIngestionKey: provisioned.ingestionKey,
    timeoutMs: 1500,
    requestLogReporting: {
      enabled: false
    }
  });
  const siteServer = await startDemoSiteServer({
    siteId: provisioned.siteId,
    ingestionKey: provisioned.ingestionKey
  });
  const context = buildLifecycleRequestContext(provisioned.siteDomain);

  try {
    await assertLifecycleStep({
      label: "initial allow",
      expectedAction: "allow",
      expectedMode: "monitor",
      expectBlockedIpReason: false,
      expectSiteStatus: 200,
      client,
      siteId: provisioned.siteId,
      ingestionKey: provisioned.ingestionKey,
      context
    });
    console.log("initial allow verified");

    const blockedEntityId = await createBlockedIp(
      provisioned.token,
      provisioned.siteId,
      lifecycleClientIp
    );

    await assertLifecycleStep({
      label: "monitor after blocked entity",
      expectedAction: "monitor",
      expectedMode: "monitor",
      expectBlockedIpReason: true,
      expectSiteStatus: 200,
      client,
      siteId: provisioned.siteId,
      ingestionKey: provisioned.ingestionKey,
      context
    });
    console.log("monitor after blocked entity verified");

    await updateSecurityPolicy(provisioned.token, provisioned.siteId, "protect");

    await assertLifecycleStep({
      label: "block in protect mode",
      expectedAction: "block",
      expectedMode: "protect",
      expectBlockedIpReason: true,
      expectSiteStatus: 403,
      client,
      siteId: provisioned.siteId,
      ingestionKey: provisioned.ingestionKey,
      context
    });
    console.log("block in protect mode verified");

    await deleteBlockedEntity(provisioned.token, blockedEntityId);

    await assertLifecycleStep({
      label: "allow after blocked entity removal",
      expectedAction: "allow",
      expectedMode: "protect",
      expectBlockedIpReason: false,
      expectSiteStatus: 200,
      client,
      siteId: provisioned.siteId,
      ingestionKey: provisioned.ingestionKey,
      context
    });
    console.log("allow after blocked entity removal verified");

    console.log("SecuAI blocked entity lifecycle smoke completed");
  } finally {
    await closeServer(siteServer);
  }
}

main().catch((error) => {
  console.error("SecuAI blocked entity lifecycle smoke failed");

  if (error instanceof SmokeError && error.details) {
    console.error(error.message, error.details);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
