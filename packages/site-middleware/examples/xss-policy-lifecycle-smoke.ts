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
const sitePort = Number(process.env.SECUAI_XSS_POLICY_SITE_PORT ?? "0");
const demoStamp = Date.now().toString();
const demoEmail = `xss-policy-smoke-${demoStamp}@example.com`;
const demoTenantSlug = `xss-policy-smoke-${demoStamp}`;
const demoDomain = `xss-policy-smoke-${demoStamp}.example.com`;
const demoClientIp = process.env.SECUAI_XSS_POLICY_CLIENT_IP ?? "198.51.100.92";

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

async function updateSecurityPolicy(
  token: string,
  siteId: string,
  mode: SiteProtectionMode,
  blockXss: boolean
): Promise<void> {
  expectSuccess<{ securityPolicy: JsonObject }>(
    await apiRequest(`/api/v1/sites/${siteId}/security-policy`, {
      method: "PUT",
      token,
      body: {
        mode,
        blockSqlInjection: false,
        blockXss,
        blockSuspiciousUserAgent: false,
        enableRateLimit: false,
        rateLimitThreshold: 100,
        autoBlockHighRisk: false,
        highRiskScoreThreshold: 90
      }
    }),
    `update security policy to ${mode} / blockXss=${blockXss}`
  );
}

async function provisionDemoSite(): Promise<ProvisionedSite> {
  const registerData = expectSuccess<{ user: { id: string } }>(
    await apiRequest("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: demoEmail,
        password: "StrongPass123",
        displayName: "XSS Policy Lifecycle Smoke"
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
        name: "XSS Policy Lifecycle Tenant",
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
        name: "XSS Policy Lifecycle Site",
        domain: demoDomain
      }
    }),
    "create demo site"
  );

  await updateSecurityPolicy(loginData.token, siteData.site.id, "monitor", false);

  return {
    token: loginData.token,
    tenantId: tenantData.tenant.id,
    siteId: siteData.site.id,
    ingestionKey: siteData.ingestionKey,
    siteDomain: demoDomain
  };
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
    matchedBlockedEntity: decision.matchedBlockedEntity ?? null,
    monitored: decision.monitored,
    failOpen: decision.failOpen
  };
}

function normalizeProtection(protection: ProtectionPayload): JsonObject {
  return {
    action: protection.action,
    mode: protection.mode,
    reasons: protection.reasons,
    matchedBlockedEntity: null,
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

function buildXssContext(siteDomain: string): SiteRequestContext {
  return {
    method: "GET",
    host: siteDomain,
    path: "/search",
    queryString: "q=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    clientIp: demoClientIp,
    userAgent: "Mozilla/5.0 (SecuAI XSS Policy Smoke)",
    referer: "https://example.com/search",
    occurredAt: new Date().toISOString()
  };
}

async function verifyAllowWhenRuleDisabled(input: {
  client: ReturnType<typeof createSiteProtectionClient>;
  siteId: string;
  ingestionKey: string;
  context: SiteRequestContext;
}): Promise<void> {
  const protection = await directProtectionCheck(input.siteId, input.ingestionKey, input.context);
  assert.equal(protection.mode, "monitor");
  assert.equal(protection.action, "allow");
  assert.deepEqual(protection.reasons, []);

  const middlewareDecision = await input.client.checkRequest(input.context);
  assertProtectionConsistency("allow with XSS rule disabled", protection, middlewareDecision);
}

async function assertXssStep(input: {
  label: string;
  expectedAction: SiteProtectionAction;
  expectedMode: SiteProtectionMode;
  expectSiteStatus: 200 | 403;
  client: ReturnType<typeof createSiteProtectionClient>;
  siteId: string;
  ingestionKey: string;
  context: SiteRequestContext;
}): Promise<void> {
  const protection = await directProtectionCheck(input.siteId, input.ingestionKey, input.context);
  assert.equal(protection.mode, input.expectedMode, `${input.label} mode mismatch`);
  assert.equal(protection.action, input.expectedAction, `${input.label} action mismatch`);
  assert.deepEqual(protection.reasons, ["blocked_xss"], `${input.label} reasons should stay stable`);

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

async function main(): Promise<void> {
  console.log("SecuAI XSS policy lifecycle smoke starting");
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
  const context = buildXssContext(provisioned.siteDomain);

  try {
    await verifyAllowWhenRuleDisabled({
      client,
      siteId: provisioned.siteId,
      ingestionKey: provisioned.ingestionKey,
      context
    });
    console.log("allow with XSS rule disabled verified");

    await updateSecurityPolicy(provisioned.token, provisioned.siteId, "monitor", true);

    await assertXssStep({
      label: "monitor with XSS rule enabled",
      expectedAction: "monitor",
      expectedMode: "monitor",
      expectSiteStatus: 200,
      client,
      siteId: provisioned.siteId,
      ingestionKey: provisioned.ingestionKey,
      context
    });
    console.log("monitor with XSS rule enabled verified");

    await updateSecurityPolicy(provisioned.token, provisioned.siteId, "protect", true);

    await assertXssStep({
      label: "block in protect mode with XSS rule enabled",
      expectedAction: "block",
      expectedMode: "protect",
      expectSiteStatus: 403,
      client,
      siteId: provisioned.siteId,
      ingestionKey: provisioned.ingestionKey,
      context
    });
    console.log("block in protect mode with XSS rule enabled verified");

    console.log("SecuAI XSS policy lifecycle smoke completed");
  } finally {
    await closeServer(siteServer);
  }
}

main().catch((error) => {
  console.error("SecuAI XSS policy lifecycle smoke failed");

  if (error instanceof SmokeError && error.details) {
    console.error(error.message, error.details);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
