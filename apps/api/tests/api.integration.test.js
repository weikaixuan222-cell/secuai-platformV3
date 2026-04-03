import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(__dirname, "..");
const repoRoot = resolve(apiDir, "..", "..");
const analyzerDir = resolve(repoRoot, "services", "ai-analyzer");
const schemaPath = resolve(apiDir, "db", "schema.sql");

loadDotenv({ path: resolve(apiDir, ".env") });

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://secuai:secuai_dev_password@127.0.0.1:5432/secuai";
const dbSslMode = process.env.TEST_DB_SSL_MODE ?? process.env.DB_SSL_MODE ?? "disable";
const apiPort = Number(process.env.TEST_API_PORT ?? randomInt(45170, 45220));
const aiPort = Number(process.env.TEST_AI_PORT ?? randomInt(45230, 45280));
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const analyzerBaseUrl = `http://127.0.0.1:${aiPort}`;

const childLogs = {
  api: { stdout: "", stderr: "" },
  analyzer: { stdout: "", stderr: "" }
};

let dbClient;
let apiProcess;
let analyzerProcess;
let scenario;

function createDbClient() {
  return new pg.Client({
    connectionString: databaseUrl,
    ssl: dbSslMode === "require" ? { rejectUnauthorized: false } : false
  });
}

function captureLogs(processRef, key) {
  processRef.stdout?.on("data", (chunk) => {
    childLogs[key].stdout += chunk.toString();
  });

  processRef.stderr?.on("data", (chunk) => {
    childLogs[key].stderr += chunk.toString();
  });
}

function startProcess(command, args, options) {
  const processRef = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });

  processRef.on("error", (error) => {
    childLogs[options.logKey].stderr += `${error.name}: ${error.message}\n`;
  });

  captureLogs(processRef, options.logKey);
  return processRef;
}

async function waitForHttpReady(url, label, timeoutMs = 15_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // wait for service startup
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  throw new Error(
    `${label} did not become ready.\nAPI stdout:\n${childLogs.api.stdout}\nAPI stderr:\n${childLogs.api.stderr}\nAnalyzer stdout:\n${childLogs.analyzer.stdout}\nAnalyzer stderr:\n${childLogs.analyzer.stderr}`
  );
}

async function applySchema() {
  const schemaSql = await readFile(schemaPath, "utf8");
  await dbClient.query(schemaSql);
}

async function apiRequest(path, options = {}) {
  const headers = {
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers ?? {})
  };

  let body;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  return {
    status: response.status,
    json
  };
}

async function registerAndLogin(email) {
  const registerResponse = await apiRequest("/api/v1/auth/register", {
    method: "POST",
    body: {
      email,
      password: "StrongPass123",
      displayName: "Integration User"
    }
  });

  assert.equal(registerResponse.status, 201);

  const loginResponse = await apiRequest("/api/v1/auth/login", {
    method: "POST",
    body: {
      email,
      password: "StrongPass123"
    }
  });

  assert.equal(loginResponse.status, 200);

  return {
    userId: registerResponse.json.data.user.id,
    token: loginResponse.json.data.token
  };
}

async function createTenant(token, name, slug) {
  const response = await apiRequest("/api/v1/tenants", {
    method: "POST",
    token,
    body: { name, slug }
  });

  assert.equal(response.status, 201);
  return response.json.data.tenant;
}

async function createSite(token, tenantId, name, domain) {
  const response = await apiRequest("/api/v1/sites", {
    method: "POST",
    token,
    body: { tenantId, name, domain }
  });

  assert.equal(response.status, 201);
  return response.json.data;
}

async function updateSecurityPolicy(token, siteId, body) {
  const response = await apiRequest(`/api/v1/sites/${siteId}/security-policy`, {
    method: "PUT",
    token,
    body
  });

  assert.equal(response.status, 200);
  return response.json.data.securityPolicy;
}

async function submitRequestLog(ingestionKey, body) {
  const response = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": ingestionKey
    },
    body
  });

  assert.equal(response.status, 201);
  return response.json.data.requestLog;
}

async function protectionCheck(ingestionKey, body) {
  const response = await apiRequest("/api/v1/protection/check", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": ingestionKey
    },
    body
  });

  assert.equal(response.status, 200);
  return response.json.data.protection;
}

async function provisionScenario() {
  const suffix = Date.now().toString();
  const owner = await registerAndLogin(`owner-${suffix}@example.com`);
  const outsider = await registerAndLogin(`outsider-${suffix}@example.com`);
  const ownerTenant = await createTenant(owner.token, "Owner Company", `owner-${suffix}`);
  const outsiderTenant = await createTenant(outsider.token, "Outsider Company", `outsider-${suffix}`);
  const siteData = await createSite(
    owner.token,
    ownerTenant.id,
    "Main Site",
    `integration-${suffix}.example.com`
  );
  const protectionSiteData = await createSite(
    owner.token,
    ownerTenant.id,
    "Protection Site",
    `protection-${suffix}.example.com`
  );

  for (let index = 0; index < 6; index += 1) {
    const seconds = index.toString().padStart(2, "0");
    await submitRequestLog(siteData.ingestionKey, {
      siteId: siteData.site.id,
      occurredAt: `2026-04-02T10:00:${seconds}.000Z`,
      method: "GET",
      host: "example.com",
      path: "/products",
      queryString: "category=books",
      statusCode: 200,
      clientIp: "203.0.113.10",
      userAgent: "Mozilla/5.0",
      metadata: {
        source: "integration-high-frequency"
      }
    });
  }

  await submitRequestLog(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T10:01:00.000Z",
    method: "GET",
    host: "example.com",
    path: "/login",
    queryString: "id=1 UNION SELECT password FROM users",
    statusCode: 200,
    clientIp: "203.0.113.20",
    userAgent: "Mozilla/5.0",
    metadata: {
      source: "integration-sqli"
    }
  });

  const detectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: owner.token,
    body: {
      tenantId: ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(detectionResponse.status, 200);

  const attackEventsResponse = await apiRequest(
    `/api/v1/attack-events?tenantId=${ownerTenant.id}&limit=20`,
    {
      token: owner.token
    }
  );

  assert.equal(attackEventsResponse.status, 200);

  const aiRiskResultsResponse = await apiRequest(
    `/api/v1/ai-risk-results?tenantId=${ownerTenant.id}&limit=20`,
    {
      token: owner.token
    }
  );

  assert.equal(aiRiskResultsResponse.status, 200);

  const sqlInjectionEvent = attackEventsResponse.json.data.items.find(
    (item) => item.eventType === "sql_injection"
  );

  assert.ok(sqlInjectionEvent, "Expected a sql_injection event in the integration fixture.");

  return {
    owner,
    outsider,
    ownerTenant,
    outsiderTenant,
    site: siteData.site,
    protectionSite: protectionSiteData.site,
    protectionIngestionKey: protectionSiteData.ingestionKey,
    detectionResponse: detectionResponse.json.data,
    attackEvents: attackEventsResponse.json.data.items,
    aiRiskResults: aiRiskResultsResponse.json.data.items,
    sqlInjectionEventId: sqlInjectionEvent.id
  };
}

before(async () => {
  dbClient = createDbClient();
  await dbClient.connect();
  await applySchema();

  analyzerProcess = startProcess(
    "python",
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(aiPort)],
    {
      cwd: analyzerDir,
      env: {
        ...process.env
      },
      logKey: "analyzer"
    }
  );

  await waitForHttpReady(`${analyzerBaseUrl}/health`, "AI analyzer");

  apiProcess = startProcess("node", ["dist/server.js"], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(apiPort),
      HOST: "127.0.0.1",
      DATABASE_URL: databaseUrl,
      DB_SSL_MODE: dbSslMode,
      AI_ANALYZER_URL: analyzerBaseUrl,
      AI_ANALYZER_TIMEOUT_MS: "1500",
      AI_ANALYZER_MAX_RETRIES: "1",
      DETECTION_SUSPICIOUS_UA_ALLOWLIST: ""
    },
    logKey: "api"
  });

  await waitForHttpReady(`${apiBaseUrl}/health`, "API server");
  scenario = await provisionScenario();
});

after(async () => {
  if (scenario) {
    await dbClient.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
      [scenario.ownerTenant.id, scenario.outsiderTenant.id]
    ]);
    await dbClient.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      [scenario.owner.userId, scenario.outsider.userId]
    ]);
  }

  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill();
  }

  if (analyzerProcess && !analyzerProcess.killed) {
    analyzerProcess.kill();
  }

  if (dbClient) {
    await dbClient.end();
  }
});

test("认证与租户权限：自己 tenant 访问成功，跨租户返回 403", async () => {
  const ownTenantResponse = await apiRequest(
    `/api/v1/request-logs?tenantId=${scenario.ownerTenant.id}&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(ownTenantResponse.status, 200);
  assert.equal(ownTenantResponse.json.success, true);

  const crossTenantResponse = await apiRequest(
    `/api/v1/request-logs?tenantId=${scenario.ownerTenant.id}&limit=20`,
    {
      token: scenario.outsider.token
    }
  );

  assert.equal(crossTenantResponse.status, 403);
  assert.equal(crossTenantResponse.json.error.code, "FORBIDDEN");
});

test("detection 主流程：处理 request_logs、生成 attack_events、更新 processed_for_detection，并对 high_frequency_access 去重", async () => {
  assert.equal(scenario.detectionResponse.processedCount, 7);
  assert.equal(scenario.detectionResponse.aiFailureCount, 0);

  const processedLogsResponse = await apiRequest(
    `/api/v1/request-logs?tenantId=${scenario.ownerTenant.id}&processedForDetection=true&limit=20`,
    {
      token: scenario.owner.token
    }
  );
  const pendingLogsResponse = await apiRequest(
    `/api/v1/request-logs?tenantId=${scenario.ownerTenant.id}&processedForDetection=false&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(processedLogsResponse.status, 200);
  assert.equal(pendingLogsResponse.status, 200);
  assert.equal(processedLogsResponse.json.data.items.length, 7);
  assert.equal(pendingLogsResponse.json.data.items.length, 0);

  const highFrequencyEvents = scenario.attackEvents.filter(
    (event) => event.eventType === "high_frequency_access"
  );

  assert.equal(highFrequencyEvents.length, 1);
  assert.ok(scenario.attackEvents.some((event) => event.eventType === "sql_injection"));
});

test("AI 集成链路：成功写入 ai_risk_results，固定模型元数据，并保留 reasons 数组语义", async () => {
  assert.equal(scenario.detectionResponse.aiSuccessCount, 2);
  assert.equal(scenario.aiRiskResults.length, 2);

  for (const item of scenario.aiRiskResults) {
    assert.equal(item.modelName, "heuristic-analyzer");
    assert.equal(item.modelVersion, "v1");
    assert.equal(Array.isArray(item.factors?.reasons), true);
    assert.equal(Array.isArray(item.rawResponse?.reasons), true);
  }
});

test("核心查询接口：GET /request-logs, GET /ai-risk-results, GET /attack-events/:id", async () => {
  const requestLogsResponse = await apiRequest(
    `/api/v1/request-logs?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&clientIp=203.0.113.20&method=GET&statusCode=200&processedForDetection=true&limit=20`,
    {
      token: scenario.owner.token
    }
  );
  const aiRiskResultsResponse = await apiRequest(
    `/api/v1/ai-risk-results?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&riskLevel=high&limit=20`,
    {
      token: scenario.owner.token
    }
  );
  const attackEventDetailResponse = await apiRequest(
    `/api/v1/attack-events/${scenario.sqlInjectionEventId}`,
    {
      token: scenario.owner.token
    }
  );
  const crossTenantDetailResponse = await apiRequest(
    `/api/v1/attack-events/${scenario.sqlInjectionEventId}`,
    {
      token: scenario.outsider.token
    }
  );

  assert.equal(requestLogsResponse.status, 200);
  assert.equal(requestLogsResponse.json.data.items.length, 1);
  assert.equal(requestLogsResponse.json.data.items[0].clientIp, "203.0.113.20");
  assert.equal(requestLogsResponse.json.data.items[0].processedForDetection, true);

  assert.equal(aiRiskResultsResponse.status, 200);
  assert.ok(aiRiskResultsResponse.json.data.items.length >= 1);
  assert.equal(aiRiskResultsResponse.json.data.items[0].modelName, "heuristic-analyzer");

  assert.equal(attackEventDetailResponse.status, 200);
  assert.equal(attackEventDetailResponse.json.data.attackEvent.id, scenario.sqlInjectionEventId);
  assert.equal(
    attackEventDetailResponse.json.data.attackEvent.requestLogId,
    attackEventDetailResponse.json.data.requestLog.id
  );
  assert.equal(attackEventDetailResponse.json.data.aiRiskResult.modelName, "heuristic-analyzer");
  assert.equal(
    Array.isArray(attackEventDetailResponse.json.data.aiRiskResult.factors?.reasons),
    true
  );

  assert.equal(crossTenantDetailResponse.status, 403);
});

test("站点级防护基础设施：策略读写、IP 封禁增删查、跨租户禁止访问", async () => {
  const defaultPolicyResponse = await apiRequest(
    `/api/v1/sites/${scenario.site.id}/security-policy`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(defaultPolicyResponse.status, 200);
  assert.equal(defaultPolicyResponse.json.data.securityPolicy.siteId, scenario.site.id);
  assert.equal(defaultPolicyResponse.json.data.securityPolicy.mode, "monitor");
  assert.equal(defaultPolicyResponse.json.data.securityPolicy.blockSqlInjection, true);

  const updatePolicyResponse = await apiRequest(
    `/api/v1/sites/${scenario.site.id}/security-policy`,
    {
      method: "PUT",
      token: scenario.owner.token,
      body: {
        mode: "protect",
        blockSqlInjection: true,
        blockXss: true,
        blockSuspiciousUserAgent: true,
        enableRateLimit: true,
        rateLimitThreshold: 60,
        autoBlockHighRisk: true,
        highRiskScoreThreshold: 88
      }
    }
  );

  assert.equal(updatePolicyResponse.status, 200);
  assert.equal(updatePolicyResponse.json.data.securityPolicy.mode, "protect");
  assert.equal(updatePolicyResponse.json.data.securityPolicy.rateLimitThreshold, 60);
  assert.equal(updatePolicyResponse.json.data.securityPolicy.autoBlockHighRisk, true);
  assert.equal(updatePolicyResponse.json.data.securityPolicy.highRiskScoreThreshold, 88);

  const crossTenantPolicyResponse = await apiRequest(
    `/api/v1/sites/${scenario.site.id}/security-policy`,
    {
      token: scenario.outsider.token
    }
  );

  assert.equal(crossTenantPolicyResponse.status, 403);
  assert.equal(crossTenantPolicyResponse.json.error.code, "FORBIDDEN");

  const createBlockedEntityResponse = await apiRequest(
    `/api/v1/sites/${scenario.site.id}/blocked-entities`,
    {
      method: "POST",
      token: scenario.owner.token,
      body: {
        entityType: "ip",
        entityValue: "203.0.113.77",
        reason: "Manual security validation block",
        source: "manual",
        expiresAt: "2099-01-01T00:00:00.000Z"
      }
    }
  );

  assert.equal(createBlockedEntityResponse.status, 201);
  assert.equal(createBlockedEntityResponse.json.data.blockedEntity.siteId, scenario.site.id);
  assert.equal(createBlockedEntityResponse.json.data.blockedEntity.entityType, "ip");
  assert.equal(createBlockedEntityResponse.json.data.blockedEntity.entityValue, "203.0.113.77");
  assert.equal(createBlockedEntityResponse.json.data.blockedEntity.source, "manual");

  const blockedEntityId = createBlockedEntityResponse.json.data.blockedEntity.id;
  const listBlockedEntitiesResponse = await apiRequest(
    `/api/v1/sites/${scenario.site.id}/blocked-entities`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(listBlockedEntitiesResponse.status, 200);
  assert.equal(listBlockedEntitiesResponse.json.data.items.length, 1);
  assert.equal(listBlockedEntitiesResponse.json.data.items[0].id, blockedEntityId);

  const crossTenantBlockedListResponse = await apiRequest(
    `/api/v1/sites/${scenario.site.id}/blocked-entities`,
    {
      token: scenario.outsider.token
    }
  );

  assert.equal(crossTenantBlockedListResponse.status, 403);
  assert.equal(crossTenantBlockedListResponse.json.error.code, "FORBIDDEN");

  const crossTenantDeleteResponse = await apiRequest(
    `/api/v1/blocked-entities/${blockedEntityId}`,
    {
      method: "DELETE",
      token: scenario.outsider.token
    }
  );

  assert.equal(crossTenantDeleteResponse.status, 403);
  assert.equal(crossTenantDeleteResponse.json.error.code, "FORBIDDEN");

  const deleteBlockedEntityResponse = await apiRequest(
    `/api/v1/blocked-entities/${blockedEntityId}`,
    {
      method: "DELETE",
      token: scenario.owner.token
    }
  );

  assert.equal(deleteBlockedEntityResponse.status, 200);
  assert.equal(deleteBlockedEntityResponse.json.data.deleted, true);
  assert.equal(deleteBlockedEntityResponse.json.data.blockedEntity.id, blockedEntityId);

  const emptyBlockedEntitiesResponse = await apiRequest(
    `/api/v1/sites/${scenario.site.id}/blocked-entities`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(emptyBlockedEntitiesResponse.status, 200);
  assert.equal(emptyBlockedEntitiesResponse.json.data.items.length, 0);
});

test("request log 前置防护执行：monitor 模式只标记不拦截，protect 模式对封禁 IP 和基础规则直接拒绝", async () => {
  await updateSecurityPolicy(scenario.owner.token, scenario.protectionSite.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 100,
    autoBlockHighRisk: false,
    highRiskScoreThreshold: 90
  });

  const createBlockedIpResponse = await apiRequest(
    `/api/v1/sites/${scenario.protectionSite.id}/blocked-entities`,
    {
      method: "POST",
      token: scenario.owner.token,
      body: {
        entityType: "ip",
        entityValue: "198.51.100.77",
        reason: "Smoke test monitor blocklist hit",
        source: "manual"
      }
    }
  );

  assert.equal(createBlockedIpResponse.status, 201);

  const monitorResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": scenario.protectionIngestionKey
    },
    body: {
      siteId: scenario.protectionSite.id,
      occurredAt: "2026-04-02T11:00:00.000Z",
      method: "GET",
      host: "protection.example.com",
      path: "/login",
      queryString: "id=1 UNION SELECT password FROM users",
      statusCode: 200,
      clientIp: "198.51.100.77",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(monitorResponse.status, 201);
  assert.equal(monitorResponse.json.data.protection.mode, "monitor");
  assert.equal(monitorResponse.json.data.protection.action, "monitor");
  assert.ok(monitorResponse.json.data.protection.reasons.includes("blocked_ip"));
  assert.ok(monitorResponse.json.data.protection.reasons.includes("blocked_sql_injection"));

  const monitorLogQueryResponse = await apiRequest(
    `/api/v1/request-logs?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.protectionSite.id}&clientIp=198.51.100.77&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(monitorLogQueryResponse.status, 200);
  assert.equal(monitorLogQueryResponse.json.data.items.length, 1);

  await updateSecurityPolicy(scenario.owner.token, scenario.protectionSite.id, {
    mode: "protect",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 100,
    autoBlockHighRisk: false,
    highRiskScoreThreshold: 90
  });

  const blockedIpResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": scenario.protectionIngestionKey
    },
    body: {
      siteId: scenario.protectionSite.id,
      occurredAt: "2026-04-02T11:01:00.000Z",
      method: "GET",
      host: "protection.example.com",
      path: "/products",
      statusCode: 200,
      clientIp: "198.51.100.77",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(blockedIpResponse.status, 403);
  assert.equal(blockedIpResponse.json.error.code, "PROTECTION_BLOCKED");
  assert.ok(blockedIpResponse.json.error.details.reasons.includes("blocked_ip"));

  const blockedIpLogQueryResponse = await apiRequest(
    `/api/v1/request-logs?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.protectionSite.id}&clientIp=198.51.100.77&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(blockedIpLogQueryResponse.status, 200);
  assert.equal(blockedIpLogQueryResponse.json.data.items.length, 1);

  const blockedRuleResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": scenario.protectionIngestionKey
    },
    body: {
      siteId: scenario.protectionSite.id,
      occurredAt: "2026-04-02T11:02:00.000Z",
      method: "GET",
      host: "protection.example.com",
      path: "/search",
      queryString: "q=<script>alert(1)</script>",
      statusCode: 200,
      clientIp: "198.51.100.88",
      userAgent: "sqlmap/1.8.4"
    }
  });

  assert.equal(blockedRuleResponse.status, 403);
  assert.equal(blockedRuleResponse.json.error.code, "PROTECTION_BLOCKED");
  assert.ok(blockedRuleResponse.json.error.details.reasons.includes("blocked_xss"));
  assert.ok(
    blockedRuleResponse.json.error.details.reasons.includes("blocked_suspicious_user_agent")
  );

  const blockedRuleLogQueryResponse = await apiRequest(
    `/api/v1/request-logs?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.protectionSite.id}&clientIp=198.51.100.88&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(blockedRuleLogQueryResponse.status, 200);
  assert.equal(blockedRuleLogQueryResponse.json.data.items.length, 0);
});

test("站点中间件专用防护检查接口：返回 allow/monitor/block 且不写入 request_logs", async () => {
  const suffix = Date.now().toString();
  const siteData = await createSite(
    scenario.owner.token,
    scenario.ownerTenant.id,
    "Middleware Check Site",
    `middleware-check-${suffix}.example.com`
  );

  const allowDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T12:00:00.000Z",
    method: "GET",
    host: "middleware-check.example.com",
    path: "/home",
    clientIp: "192.0.2.10",
    userAgent: "Mozilla/5.0"
  });

  assert.equal(allowDecision.mode, "monitor");
  assert.equal(allowDecision.action, "allow");
  assert.deepEqual(allowDecision.reasons, []);

  const createBlockedEntityResponse = await apiRequest(
    `/api/v1/sites/${siteData.site.id}/blocked-entities`,
    {
      method: "POST",
      token: scenario.owner.token,
      body: {
        entityType: "ip",
        entityValue: "192.0.2.10",
        reason: "Middleware smoke test"
      }
    }
  );

  assert.equal(createBlockedEntityResponse.status, 201);

  const monitorDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T12:01:00.000Z",
    method: "GET",
    host: "middleware-check.example.com",
    path: "/home",
    clientIp: "192.0.2.10",
    userAgent: "Mozilla/5.0"
  });

  assert.equal(monitorDecision.mode, "monitor");
  assert.equal(monitorDecision.action, "monitor");
  assert.deepEqual(monitorDecision.reasons, ["blocked_ip"]);

  await updateSecurityPolicy(scenario.owner.token, siteData.site.id, {
    mode: "protect",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 120,
    autoBlockHighRisk: false,
    highRiskScoreThreshold: 90
  });

  const blockDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T12:02:00.000Z",
    method: "GET",
    host: "middleware-check.example.com",
    path: "/search",
    queryString: "q=<script>alert(1)</script>",
    clientIp: "192.0.2.10",
    userAgent: "sqlmap/1.8.4"
  });

  assert.equal(blockDecision.mode, "protect");
  assert.equal(blockDecision.action, "block");
  assert.ok(blockDecision.reasons.includes("blocked_ip"));
  assert.ok(blockDecision.reasons.includes("blocked_xss"));
  assert.ok(blockDecision.reasons.includes("blocked_suspicious_user_agent"));

  const requestLogsResponse = await apiRequest(
    `/api/v1/request-logs?tenantId=${scenario.ownerTenant.id}&siteId=${siteData.site.id}&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(requestLogsResponse.status, 200);
  assert.equal(requestLogsResponse.json.data.items.length, 0);
});
