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
      // 等待服务启动完成后再继续轮询。
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

test("detection 幂等：同一 request_log 重复进入 detection 时，不应重复生成 attack_event 或自动处置记录", async () => {
  const suffix = Date.now().toString();
  const siteData = await createSite(
    scenario.owner.token,
    scenario.ownerTenant.id,
    "Detection Idempotency Site",
    `detection-idempotency-${suffix}.example.com`
  );

  await updateSecurityPolicy(scenario.owner.token, siteData.site.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 100,
    autoBlockHighRisk: true,
    highRiskScoreThreshold: 70
  });

  const requestLogResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": siteData.ingestionKey
    },
    body: {
      siteId: siteData.site.id,
      occurredAt: "2026-04-02T16:00:00.000Z",
      method: "GET",
      host: siteData.site.domain,
      path: "/login",
      queryString: "id=1 UNION SELECT password FROM users",
      statusCode: 200,
      clientIp: "198.51.100.121",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(requestLogResponse.status, 201);

  const firstDetectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: scenario.owner.token,
    body: {
      tenantId: scenario.ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(firstDetectionResponse.status, 200);
  assert.equal(firstDetectionResponse.json.data.processedCount, 1);
  assert.ok(firstDetectionResponse.json.data.eventCount >= 1);

  const attackEventsAfterFirstRun = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&siteId=${siteData.site.id}&eventType=sql_injection&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(attackEventsAfterFirstRun.status, 200);
  assert.equal(attackEventsAfterFirstRun.json.data.items.length, 1);

  const sqlInjectionEvent = attackEventsAfterFirstRun.json.data.items[0];

  const blockedEntitiesAfterFirstRun = await apiRequest(
    `/api/v1/sites/${siteData.site.id}/blocked-entities?attackEventId=${sqlInjectionEvent.id}`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(blockedEntitiesAfterFirstRun.status, 200);
  assert.equal(blockedEntitiesAfterFirstRun.json.data.items.length, 1);

  await dbClient.query(
    `
      UPDATE request_logs
      SET processed_for_detection = FALSE
      WHERE id = $1
    `,
    [requestLogResponse.json.data.requestLog.id]
  );

  const secondDetectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: scenario.owner.token,
    body: {
      tenantId: scenario.ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(secondDetectionResponse.status, 200);
  assert.equal(secondDetectionResponse.json.data.processedCount, 1);
  assert.equal(secondDetectionResponse.json.data.eventCount, 0);

  const attackEventsAfterSecondRun = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&siteId=${siteData.site.id}&eventType=sql_injection&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(attackEventsAfterSecondRun.status, 200);
  assert.equal(attackEventsAfterSecondRun.json.data.items.length, 1);
  assert.equal(attackEventsAfterSecondRun.json.data.items[0].id, sqlInjectionEvent.id);

  const blockedEntitiesAfterSecondRun = await apiRequest(
    `/api/v1/sites/${siteData.site.id}/blocked-entities`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(blockedEntitiesAfterSecondRun.status, 200);
  const automaticBlockedEntitiesForIp = blockedEntitiesAfterSecondRun.json.data.items.filter(
    (item) => item.entityValue === "198.51.100.121" && item.source === "automatic"
  );
  assert.equal(automaticBlockedEntitiesForIp.length, 1);
  assert.equal(
    automaticBlockedEntitiesForIp[0].attackEventId,
    sqlInjectionEvent.id
  );
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

test("AI 风险结果幂等：同一 attack_event 不应出现重复 ai_risk_results", async () => {
  const attackEventDetailResponse = await apiRequest(
    `/api/v1/attack-events/${scenario.sqlInjectionEventId}`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(attackEventDetailResponse.status, 200);

  const aiRiskResultsBeforeResponse = await apiRequest(
    `/api/v1/ai-risk-results?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&attackEventId=${scenario.sqlInjectionEventId}&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(aiRiskResultsBeforeResponse.status, 200);
  assert.equal(aiRiskResultsBeforeResponse.json.data.items.length, 1);
  await assert.rejects(
    dbClient.query(
      `
        INSERT INTO ai_risk_results (
          tenant_id,
          site_id,
          request_log_id,
          attack_event_id,
          model_name,
          model_version,
          risk_score,
          risk_level,
          explanation,
          factors,
          raw_response
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        scenario.ownerTenant.id,
        scenario.site.id,
        Number(attackEventDetailResponse.json.data.requestLog.id),
        Number(scenario.sqlInjectionEventId),
        "heuristic-analyzer",
        "v1",
        93,
        "critical",
        "AI 幂等性测试重复写入。",
        JSON.stringify({ reasons: ["AI 幂等性测试重复写入。"] }),
        JSON.stringify({
          modelName: "heuristic-analyzer",
          modelVersion: "v1",
          riskScore: 93,
          riskLevel: "critical",
          reasons: ["AI 幂等性测试重复写入。"]
        })
      ]
    ),
    (error) => error?.code === "23505"
  );

  const aiRiskResultsAfterResponse = await apiRequest(
    `/api/v1/ai-risk-results?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&attackEventId=${scenario.sqlInjectionEventId}&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(aiRiskResultsAfterResponse.status, 200);
  assert.equal(aiRiskResultsAfterResponse.json.data.items.length, 1);
  assert.equal(
    aiRiskResultsAfterResponse.json.data.items[0].id,
    aiRiskResultsBeforeResponse.json.data.items[0].id
  );
});

test("AI 高风险自动处置：满足站点策略阈值后，自动写入关联 blocked entity 并影响后续 protection/check", async () => {
  const suffix = Date.now().toString();
  const siteData = await createSite(
    scenario.owner.token,
    scenario.ownerTenant.id,
    "Auto Block High Risk Site",
    `auto-block-high-risk-${suffix}.example.com`
  );

  await updateSecurityPolicy(scenario.owner.token, siteData.site.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 100,
    autoBlockHighRisk: true,
    highRiskScoreThreshold: 70
  });

  const requestLogResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": siteData.ingestionKey
    },
    body: {
      siteId: siteData.site.id,
      occurredAt: "2026-04-02T15:00:00.000Z",
      method: "GET",
      host: siteData.site.domain,
      path: "/login",
      queryString: "id=1 UNION SELECT password FROM users",
      statusCode: 200,
      clientIp: "198.51.100.120",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(requestLogResponse.status, 201);
  assert.equal(requestLogResponse.json.data.protection.mode, "monitor");
  assert.equal(requestLogResponse.json.data.protection.action, "monitor");
  assert.ok(
    requestLogResponse.json.data.protection.reasons.includes("blocked_sql_injection")
  );

  const detectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: scenario.owner.token,
    body: {
      tenantId: scenario.ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(detectionResponse.status, 200);
  assert.ok(detectionResponse.json.data.aiSuccessCount >= 1);

  const attackEventsResponse = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&siteId=${siteData.site.id}&eventType=sql_injection&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(attackEventsResponse.status, 200);
  assert.equal(attackEventsResponse.json.data.items.length, 1);

  const sqlInjectionEvent = attackEventsResponse.json.data.items[0];

  const blockedEntitiesResponse = await apiRequest(
    `/api/v1/sites/${siteData.site.id}/blocked-entities?attackEventId=${sqlInjectionEvent.id}`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(blockedEntitiesResponse.status, 200);
  assert.equal(blockedEntitiesResponse.json.data.items.length, 1);
  assert.equal(blockedEntitiesResponse.json.data.items[0].entityValue, "198.51.100.120");
  assert.equal(blockedEntitiesResponse.json.data.items[0].source, "automatic");
  assert.equal(blockedEntitiesResponse.json.data.items[0].originKind, "event_disposition");
  assert.equal(blockedEntitiesResponse.json.data.items[0].isActive, true);
  assert.equal(
    blockedEntitiesResponse.json.data.items[0].attackEventId,
    sqlInjectionEvent.id
  );

  const attackEventDetailResponse = await apiRequest(`/api/v1/attack-events/${sqlInjectionEvent.id}`, {
    token: scenario.owner.token
  });

  assert.equal(attackEventDetailResponse.status, 200);
  assert.equal(attackEventDetailResponse.json.data.blockedEntities.length, 1);
  assert.equal(
    attackEventDetailResponse.json.data.activeBlockedEntity.id,
    blockedEntitiesResponse.json.data.items[0].id
  );
  assert.equal(
    attackEventDetailResponse.json.data.activeBlockedEntity.source,
    "automatic"
  );
  assert.equal(
    attackEventDetailResponse.json.data.dispositionSummary.status,
    "active"
  );

  const protectionDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T15:01:00.000Z",
    method: "GET",
    host: siteData.site.domain,
    path: "/checkout",
    clientIp: "198.51.100.120",
    userAgent: "Mozilla/5.0"
  });

  assert.equal(protectionDecision.mode, "monitor");
  assert.equal(protectionDecision.action, "monitor");
  assert.ok(protectionDecision.reasons.includes("blocked_ip"));
  assert.equal(
    protectionDecision.matchedBlockedEntity.id,
    blockedEntitiesResponse.json.data.items[0].id
  );
  assert.equal(protectionDecision.matchedBlockedEntity.source, "automatic");
  assert.equal(
    protectionDecision.matchedBlockedEntity.attackEventId,
    sqlInjectionEvent.id
  );

  const repeatedHighRiskRequestResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": siteData.ingestionKey
    },
    body: {
      siteId: siteData.site.id,
      occurredAt: "2026-04-02T15:02:00.000Z",
      method: "GET",
      host: siteData.site.domain,
      path: "/admin/login",
      queryString: "id=1 UNION SELECT email FROM users",
      statusCode: 200,
      clientIp: "198.51.100.120",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(repeatedHighRiskRequestResponse.status, 201);
  assert.equal(repeatedHighRiskRequestResponse.json.data.protection.mode, "monitor");
  assert.equal(repeatedHighRiskRequestResponse.json.data.protection.action, "monitor");
  assert.ok(
    repeatedHighRiskRequestResponse.json.data.protection.reasons.includes(
      "blocked_sql_injection"
    )
  );
  assert.ok(
    repeatedHighRiskRequestResponse.json.data.protection.reasons.includes("blocked_ip")
  );
  assert.equal(
    repeatedHighRiskRequestResponse.json.data.protection.matchedBlockedEntity.id,
    blockedEntitiesResponse.json.data.items[0].id
  );

  const repeatedDetectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: scenario.owner.token,
    body: {
      tenantId: scenario.ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(repeatedDetectionResponse.status, 200);
  assert.ok(repeatedDetectionResponse.json.data.eventCount >= 1);
  assert.ok(repeatedDetectionResponse.json.data.aiSuccessCount >= 1);

  const repeatedAttackEventsResponse = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&siteId=${siteData.site.id}&eventType=sql_injection&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(repeatedAttackEventsResponse.status, 200);
  const repeatedSqlInjectionEvent = repeatedAttackEventsResponse.json.data.items.find(
    (item) =>
      String(item.requestLogId) === String(repeatedHighRiskRequestResponse.json.data.requestLog.id)
  );
  assert.ok(repeatedSqlInjectionEvent);

  const blockedEntitiesAfterRepeatResponse = await apiRequest(
    `/api/v1/sites/${siteData.site.id}/blocked-entities`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(blockedEntitiesAfterRepeatResponse.status, 200);
  const automaticBlockedEntitiesForIp = blockedEntitiesAfterRepeatResponse.json.data.items.filter(
    (item) => item.entityValue === "198.51.100.120" && item.source === "automatic"
  );
  assert.equal(automaticBlockedEntitiesForIp.length, 1);
  assert.equal(automaticBlockedEntitiesForIp[0].id, blockedEntitiesResponse.json.data.items[0].id);
  assert.equal(automaticBlockedEntitiesForIp[0].attackEventId, sqlInjectionEvent.id);

  const repeatedEventLinkedBlockedEntitiesResponse = await apiRequest(
    `/api/v1/sites/${siteData.site.id}/blocked-entities?attackEventId=${repeatedSqlInjectionEvent.id}`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(repeatedEventLinkedBlockedEntitiesResponse.status, 200);
  assert.equal(repeatedEventLinkedBlockedEntitiesResponse.json.data.items.length, 0);

  const deleteAutoBlockedEntityResponse = await apiRequest(
    `/api/v1/blocked-entities/${blockedEntitiesResponse.json.data.items[0].id}`,
    {
      method: "DELETE",
      token: scenario.owner.token
    }
  );

  assert.equal(deleteAutoBlockedEntityResponse.status, 200);
  assert.equal(deleteAutoBlockedEntityResponse.json.data.deleted, true);
  assert.equal(
    deleteAutoBlockedEntityResponse.json.data.blockedEntity.id,
    blockedEntitiesResponse.json.data.items[0].id
  );

  const blockedEntitiesAfterAutoDeleteResponse = await apiRequest(
    `/api/v1/sites/${siteData.site.id}/blocked-entities`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(blockedEntitiesAfterAutoDeleteResponse.status, 200);
  assert.deepEqual(blockedEntitiesAfterAutoDeleteResponse.json.data.items, []);

  const recreatedHighRiskRequestResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": siteData.ingestionKey
    },
    body: {
      siteId: siteData.site.id,
      occurredAt: "2026-04-02T15:02:30.000Z",
      method: "GET",
      host: siteData.site.domain,
      path: "/support/login",
      queryString: "id=1 UNION SELECT token FROM sessions",
      statusCode: 200,
      clientIp: "198.51.100.120",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(recreatedHighRiskRequestResponse.status, 201);
  assert.equal(recreatedHighRiskRequestResponse.json.data.protection.mode, "monitor");
  assert.equal(recreatedHighRiskRequestResponse.json.data.protection.action, "monitor");
  assert.ok(
    recreatedHighRiskRequestResponse.json.data.protection.reasons.includes(
      "blocked_sql_injection"
    )
  );
  assert.equal(
    recreatedHighRiskRequestResponse.json.data.protection.matchedBlockedEntity ?? null,
    null
  );

  const recreatedDetectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: scenario.owner.token,
    body: {
      tenantId: scenario.ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(recreatedDetectionResponse.status, 200);
  assert.ok(recreatedDetectionResponse.json.data.eventCount >= 1);
  assert.ok(recreatedDetectionResponse.json.data.aiSuccessCount >= 1);

  const attackEventsAfterAutoRecreateResponse = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&siteId=${siteData.site.id}&eventType=sql_injection&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(attackEventsAfterAutoRecreateResponse.status, 200);
  const recreatedSqlInjectionEvent = attackEventsAfterAutoRecreateResponse.json.data.items.find(
    (item) =>
      String(item.requestLogId) ===
      String(recreatedHighRiskRequestResponse.json.data.requestLog.id)
  );
  assert.ok(
    recreatedSqlInjectionEvent,
    "Expected a new sql_injection event after recreating auto disposition."
  );

  const blockedEntitiesAfterAutoRecreateResponse = await apiRequest(
    `/api/v1/sites/${siteData.site.id}/blocked-entities?attackEventId=${recreatedSqlInjectionEvent.id}`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(blockedEntitiesAfterAutoRecreateResponse.status, 200);
  assert.equal(blockedEntitiesAfterAutoRecreateResponse.json.data.items.length, 1);
  assert.equal(
    blockedEntitiesAfterAutoRecreateResponse.json.data.items[0].entityValue,
    "198.51.100.120"
  );
  assert.equal(
    blockedEntitiesAfterAutoRecreateResponse.json.data.items[0].source,
    "automatic"
  );
  assert.equal(
    blockedEntitiesAfterAutoRecreateResponse.json.data.items[0].originKind,
    "event_disposition"
  );
  assert.equal(
    blockedEntitiesAfterAutoRecreateResponse.json.data.items[0].isActive,
    true
  );
  assert.equal(
    blockedEntitiesAfterAutoRecreateResponse.json.data.items[0].attackEventId,
    recreatedSqlInjectionEvent.id
  );
  assert.notEqual(
    blockedEntitiesAfterAutoRecreateResponse.json.data.items[0].id,
    blockedEntitiesResponse.json.data.items[0].id
  );

  const recreatedProtectionDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T15:02:31.000Z",
    method: "GET",
    host: siteData.site.domain,
    path: "/checkout",
    clientIp: "198.51.100.120",
    userAgent: "Mozilla/5.0"
  });

  assert.equal(recreatedProtectionDecision.mode, "monitor");
  assert.equal(recreatedProtectionDecision.action, "monitor");
  assert.ok(recreatedProtectionDecision.reasons.includes("blocked_ip"));
  assert.equal(
    recreatedProtectionDecision.matchedBlockedEntity.id,
    blockedEntitiesAfterAutoRecreateResponse.json.data.items[0].id
  );
  assert.equal(recreatedProtectionDecision.matchedBlockedEntity.source, "automatic");
  assert.equal(
    recreatedProtectionDecision.matchedBlockedEntity.attackEventId,
    recreatedSqlInjectionEvent.id
  );

  await dbClient.query(
    `
      UPDATE blocked_entities
      SET expires_at = NOW() + INTERVAL '1 second'
      WHERE id = $1
    `,
    [blockedEntitiesAfterAutoRecreateResponse.json.data.items[0].id]
  );

  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const expiredOccurredAt = new Date().toISOString();

  const expiredAutoDispositionProtectionDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: expiredOccurredAt,
    method: "GET",
    host: siteData.site.domain,
    path: "/checkout",
    clientIp: "198.51.100.120",
    userAgent: "Mozilla/5.0"
  });

  assert.equal(expiredAutoDispositionProtectionDecision.mode, "monitor");
  assert.equal(expiredAutoDispositionProtectionDecision.action, "allow");
  assert.deepEqual(expiredAutoDispositionProtectionDecision.reasons, []);
  assert.equal(
    expiredAutoDispositionProtectionDecision.matchedBlockedEntity ?? null,
    null
  );

  const postExpiryRequestOccurredAt = new Date(Date.now() + 1_000).toISOString();

  const postExpiryHighRiskRequestResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": siteData.ingestionKey
    },
    body: {
      siteId: siteData.site.id,
      occurredAt: postExpiryRequestOccurredAt,
      method: "GET",
      host: siteData.site.domain,
      path: "/portal/login",
      queryString: "id=1 UNION SELECT password_hash FROM admins",
      statusCode: 200,
      clientIp: "198.51.100.120",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(postExpiryHighRiskRequestResponse.status, 201);
  assert.equal(postExpiryHighRiskRequestResponse.json.data.protection.mode, "monitor");
  assert.equal(postExpiryHighRiskRequestResponse.json.data.protection.action, "monitor");
  assert.ok(
    postExpiryHighRiskRequestResponse.json.data.protection.reasons.includes(
      "blocked_sql_injection"
    )
  );
  assert.equal(
    postExpiryHighRiskRequestResponse.json.data.protection.matchedBlockedEntity ?? null,
    null
  );

  const postExpiryDetectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: scenario.owner.token,
    body: {
      tenantId: scenario.ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(postExpiryDetectionResponse.status, 200);
  assert.ok(postExpiryDetectionResponse.json.data.eventCount >= 1);
  assert.ok(postExpiryDetectionResponse.json.data.aiSuccessCount >= 1);

  const attackEventsAfterExpiryResponse = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&siteId=${siteData.site.id}&eventType=sql_injection&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(attackEventsAfterExpiryResponse.status, 200);
  const recreatedAfterExpiryEvent = attackEventsAfterExpiryResponse.json.data.items.find(
    (item) =>
      String(item.requestLogId) ===
      String(postExpiryHighRiskRequestResponse.json.data.requestLog.id)
  );
  assert.ok(
    recreatedAfterExpiryEvent,
    "Expected a new sql_injection event after the active automatic disposition expired."
  );

  const blockedEntitiesAfterExpiryRecreateResponse = await apiRequest(
    `/api/v1/sites/${siteData.site.id}/blocked-entities`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(blockedEntitiesAfterExpiryRecreateResponse.status, 200);
  const automaticBlockedEntitiesAfterExpiry =
    blockedEntitiesAfterExpiryRecreateResponse.json.data.items.filter(
      (item) => item.entityValue === "198.51.100.120" && item.source === "automatic"
    );
  assert.equal(automaticBlockedEntitiesAfterExpiry.length, 2);

  const activeAutomaticBlockedEntitiesAfterExpiry =
    automaticBlockedEntitiesAfterExpiry.filter((item) => item.isActive);
  assert.equal(activeAutomaticBlockedEntitiesAfterExpiry.length, 1);
  assert.equal(
    activeAutomaticBlockedEntitiesAfterExpiry[0].attackEventId,
    recreatedAfterExpiryEvent.id
  );
  assert.notEqual(
    activeAutomaticBlockedEntitiesAfterExpiry[0].id,
    blockedEntitiesAfterAutoRecreateResponse.json.data.items[0].id
  );

  const postExpiryProtectionOccurredAt = new Date(Date.now() + 2_000).toISOString();

  const postExpiryRecreatedProtectionDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: postExpiryProtectionOccurredAt,
    method: "GET",
    host: siteData.site.domain,
    path: "/checkout",
    clientIp: "198.51.100.120",
    userAgent: "Mozilla/5.0"
  });

  assert.equal(postExpiryRecreatedProtectionDecision.mode, "monitor");
  assert.equal(postExpiryRecreatedProtectionDecision.action, "monitor");
  assert.ok(postExpiryRecreatedProtectionDecision.reasons.includes("blocked_ip"));
  assert.equal(
    postExpiryRecreatedProtectionDecision.matchedBlockedEntity.id,
    activeAutomaticBlockedEntitiesAfterExpiry[0].id
  );
  assert.equal(
    postExpiryRecreatedProtectionDecision.matchedBlockedEntity.attackEventId,
    recreatedAfterExpiryEvent.id
  );

  const belowThresholdSiteData = await createSite(
    scenario.owner.token,
    scenario.ownerTenant.id,
    "Auto Block High Risk Threshold Guard Site",
    `auto-block-high-risk-threshold-${suffix}.example.com`
  );

  await updateSecurityPolicy(scenario.owner.token, belowThresholdSiteData.site.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 100,
    autoBlockHighRisk: true,
    highRiskScoreThreshold: 95
  });

  const belowThresholdRequestResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": belowThresholdSiteData.ingestionKey
    },
    body: {
      siteId: belowThresholdSiteData.site.id,
      occurredAt: "2026-04-02T15:03:00.000Z",
      method: "GET",
      host: belowThresholdSiteData.site.domain,
      path: "/login",
      queryString: "id=1 UNION SELECT password FROM users",
      statusCode: 200,
      clientIp: "198.51.100.121",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(belowThresholdRequestResponse.status, 201);
  assert.equal(belowThresholdRequestResponse.json.data.protection.mode, "monitor");
  assert.equal(belowThresholdRequestResponse.json.data.protection.action, "monitor");
  assert.ok(
    belowThresholdRequestResponse.json.data.protection.reasons.includes("blocked_sql_injection")
  );
  assert.equal(
    belowThresholdRequestResponse.json.data.protection.matchedBlockedEntity ?? null,
    null
  );

  const belowThresholdDetectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: scenario.owner.token,
    body: {
      tenantId: scenario.ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(belowThresholdDetectionResponse.status, 200);
  assert.ok(belowThresholdDetectionResponse.json.data.eventCount >= 1);
  assert.ok(belowThresholdDetectionResponse.json.data.aiSuccessCount >= 1);

  const belowThresholdAttackEventsResponse = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&siteId=${belowThresholdSiteData.site.id}&eventType=sql_injection&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(belowThresholdAttackEventsResponse.status, 200);
  assert.equal(belowThresholdAttackEventsResponse.json.data.items.length, 1);

  const belowThresholdBlockedEntitiesResponse = await apiRequest(
    `/api/v1/sites/${belowThresholdSiteData.site.id}/blocked-entities`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(belowThresholdBlockedEntitiesResponse.status, 200);
  assert.deepEqual(belowThresholdBlockedEntitiesResponse.json.data.items, []);

  const belowThresholdProtectionDecision = await protectionCheck(
    belowThresholdSiteData.ingestionKey,
    {
      siteId: belowThresholdSiteData.site.id,
      occurredAt: "2026-04-02T15:04:00.000Z",
      method: "GET",
      host: belowThresholdSiteData.site.domain,
      path: "/checkout",
      clientIp: "198.51.100.121",
      userAgent: "Mozilla/5.0"
    }
  );

  assert.equal(belowThresholdProtectionDecision.mode, "monitor");
  assert.equal(belowThresholdProtectionDecision.action, "allow");
  assert.deepEqual(belowThresholdProtectionDecision.reasons, []);
  assert.equal(belowThresholdProtectionDecision.matchedBlockedEntity ?? null, null);

  const existingBlockedSiteData = await createSite(
    scenario.owner.token,
    scenario.ownerTenant.id,
    "Auto Block High Risk Existing Block Site",
    `auto-block-high-risk-existing-block-${suffix}.example.com`
  );

  await updateSecurityPolicy(scenario.owner.token, existingBlockedSiteData.site.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 100,
    autoBlockHighRisk: true,
    highRiskScoreThreshold: 70
  });

  const existingManualBlockedEntityResponse = await apiRequest(
    `/api/v1/sites/${existingBlockedSiteData.site.id}/blocked-entities`,
    {
      method: "POST",
      token: scenario.owner.token,
      body: {
        entityType: "ip",
        entityValue: "198.51.100.122",
        reason: "Auto-block guard existing manual block",
        source: "manual"
      }
    }
  );

  assert.equal(existingManualBlockedEntityResponse.status, 201);
  const existingManualBlockedEntity = existingManualBlockedEntityResponse.json.data.blockedEntity;

  const existingBlockedRequestResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": existingBlockedSiteData.ingestionKey
    },
    body: {
      siteId: existingBlockedSiteData.site.id,
      occurredAt: "2026-04-02T15:05:00.000Z",
      method: "GET",
      host: existingBlockedSiteData.site.domain,
      path: "/login",
      queryString: "id=1 UNION SELECT password FROM users",
      statusCode: 200,
      clientIp: "198.51.100.122",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(existingBlockedRequestResponse.status, 201);
  assert.equal(existingBlockedRequestResponse.json.data.protection.mode, "monitor");
  assert.equal(existingBlockedRequestResponse.json.data.protection.action, "monitor");
  assert.ok(
    existingBlockedRequestResponse.json.data.protection.reasons.includes("blocked_ip")
  );
  assert.ok(
    existingBlockedRequestResponse.json.data.protection.reasons.includes(
      "blocked_sql_injection"
    )
  );
  assert.equal(
    existingBlockedRequestResponse.json.data.protection.matchedBlockedEntity.id,
    existingManualBlockedEntity.id
  );
  assert.equal(
    existingBlockedRequestResponse.json.data.protection.matchedBlockedEntity.source,
    "manual"
  );

  const existingBlockedDetectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: scenario.owner.token,
    body: {
      tenantId: scenario.ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(existingBlockedDetectionResponse.status, 200);
  assert.ok(existingBlockedDetectionResponse.json.data.eventCount >= 1);
  assert.ok(existingBlockedDetectionResponse.json.data.aiSuccessCount >= 1);

  const existingBlockedEntitiesResponse = await apiRequest(
    `/api/v1/sites/${existingBlockedSiteData.site.id}/blocked-entities`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(existingBlockedEntitiesResponse.status, 200);
  const existingBlockedEntitiesForIp = existingBlockedEntitiesResponse.json.data.items.filter(
    (item) => item.entityValue === "198.51.100.122"
  );
  const automaticBlockedEntitiesForExistingIp = existingBlockedEntitiesForIp.filter(
    (item) => item.source === "automatic"
  );
  assert.equal(existingBlockedEntitiesForIp.length, 1);
  assert.equal(automaticBlockedEntitiesForExistingIp.length, 0);
  assert.equal(existingBlockedEntitiesForIp[0].id, existingManualBlockedEntity.id);
  assert.equal(existingBlockedEntitiesForIp[0].source, "manual");

  const existingBlockedProtectionDecision = await protectionCheck(
    existingBlockedSiteData.ingestionKey,
    {
      siteId: existingBlockedSiteData.site.id,
      occurredAt: "2026-04-02T15:06:00.000Z",
      method: "GET",
      host: existingBlockedSiteData.site.domain,
      path: "/checkout",
      clientIp: "198.51.100.122",
      userAgent: "Mozilla/5.0"
    }
  );

  assert.equal(existingBlockedProtectionDecision.mode, "monitor");
  assert.equal(existingBlockedProtectionDecision.action, "monitor");
  assert.ok(existingBlockedProtectionDecision.reasons.includes("blocked_ip"));
  assert.equal(
    existingBlockedProtectionDecision.matchedBlockedEntity.id,
    existingManualBlockedEntity.id
  );
  assert.equal(existingBlockedProtectionDecision.matchedBlockedEntity.source, "manual");
});

test("自动 blocked entity 幂等：重复创建同一活动自动处置时，不应长出第二条活动记录", async () => {
  const suffix = Date.now().toString();
  const siteData = await createSite(
    scenario.owner.token,
    scenario.ownerTenant.id,
    "Automatic Blocked Entity Idempotency Site",
    `automatic-blocked-entity-idempotency-${suffix}.example.com`
  );

  await updateSecurityPolicy(scenario.owner.token, siteData.site.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 100,
    autoBlockHighRisk: false,
    highRiskScoreThreshold: 70
  });

  const requestLogResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": siteData.ingestionKey
    },
    body: {
      siteId: siteData.site.id,
      occurredAt: "2026-04-02T15:07:00.000Z",
      method: "GET",
      host: siteData.site.domain,
      path: "/login",
      queryString: "id=1 UNION SELECT password FROM users",
      statusCode: 200,
      clientIp: "198.51.100.123",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(requestLogResponse.status, 201);

  const detectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: scenario.owner.token,
    body: {
      tenantId: scenario.ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(detectionResponse.status, 200);
  assert.ok(detectionResponse.json.data.eventCount >= 1);

  const attackEventsResponse = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&siteId=${siteData.site.id}&eventType=sql_injection&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(attackEventsResponse.status, 200);
  assert.equal(attackEventsResponse.json.data.items.length, 1);

  const sqlInjectionEvent = attackEventsResponse.json.data.items[0];
  const blockedEntityBody = {
    entityType: "ip",
    entityValue: "198.51.100.123",
    reason: "Automatic blocked entity idempotency guard",
    source: "automatic",
    attackEventId: Number(sqlInjectionEvent.id)
  };

  const [firstCreateResponse, secondCreateResponse] = await Promise.all([
    apiRequest(`/api/v1/sites/${siteData.site.id}/blocked-entities`, {
      method: "POST",
      token: scenario.owner.token,
      body: blockedEntityBody
    }),
    apiRequest(`/api/v1/sites/${siteData.site.id}/blocked-entities`, {
      method: "POST",
      token: scenario.owner.token,
      body: blockedEntityBody
    })
  ]);

  assert.equal(firstCreateResponse.status, 201);
  assert.equal(secondCreateResponse.status, 201);
  assert.equal(
    firstCreateResponse.json.data.blockedEntity.id,
    secondCreateResponse.json.data.blockedEntity.id
  );

  const blockedEntitiesResponse = await apiRequest(
    `/api/v1/sites/${siteData.site.id}/blocked-entities`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(blockedEntitiesResponse.status, 200);
  const automaticBlockedEntitiesForIp = blockedEntitiesResponse.json.data.items.filter(
    (item) => item.entityValue === "198.51.100.123" && item.source === "automatic"
  );
  assert.equal(automaticBlockedEntitiesForIp.length, 1);
  assert.equal(
    automaticBlockedEntitiesForIp[0].id,
    firstCreateResponse.json.data.blockedEntity.id
  );
  assert.equal(
    Number(automaticBlockedEntitiesForIp[0].attackEventId),
    Number(sqlInjectionEvent.id)
  );
  assert.equal(automaticBlockedEntitiesForIp[0].isActive, true);

  const linkedBlockedEntitiesResponse = await apiRequest(
    `/api/v1/sites/${siteData.site.id}/blocked-entities?attackEventId=${sqlInjectionEvent.id}`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(linkedBlockedEntitiesResponse.status, 200);
  assert.equal(linkedBlockedEntitiesResponse.json.data.items.length, 1);
  assert.equal(
    linkedBlockedEntitiesResponse.json.data.items[0].id,
    firstCreateResponse.json.data.blockedEntity.id
  );

  const protectionDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T15:08:00.000Z",
    method: "GET",
    host: siteData.site.domain,
    path: "/checkout",
    clientIp: "198.51.100.123",
    userAgent: "Mozilla/5.0"
  });

  assert.equal(protectionDecision.mode, "monitor");
  assert.equal(protectionDecision.action, "monitor");
  assert.ok(protectionDecision.reasons.includes("blocked_ip"));
  assert.equal(
    protectionDecision.matchedBlockedEntity.id,
    firstCreateResponse.json.data.blockedEntity.id
  );
  assert.equal(protectionDecision.matchedBlockedEntity.source, "automatic");
  assert.equal(
    Number(protectionDecision.matchedBlockedEntity.attackEventId),
    Number(sqlInjectionEvent.id)
  );
});

test("核心查询接口：GET /request-logs, GET /ai-risk-results, GET /attack-events/:id", async () => {
  const requestLogsResponse = await apiRequest(
    `/api/v1/request-logs?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&clientIp=203.0.113.20&method=GET&statusCode=200&processedForDetection=true&limit=20`,
    {
      token: scenario.owner.token
    }
  );
  const filteredAttackEventsResponse = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&eventType=sql_injection&severity=high&startAt=2020-01-01T00:00:00.000Z&endAt=2099-01-01T00:00:00.000Z&limit=20`,
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
  const crossTenantAttackEventsResponse = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&limit=20`,
    {
      token: scenario.outsider.token
    }
  );
  const crossTenantAiRiskResultsResponse = await apiRequest(
    `/api/v1/ai-risk-results?tenantId=${scenario.ownerTenant.id}&limit=20`,
    {
      token: scenario.outsider.token
    }
  );

  assert.equal(requestLogsResponse.status, 200);
  assert.equal(requestLogsResponse.json.data.items.length, 1);
  assert.equal(requestLogsResponse.json.data.items[0].clientIp, "203.0.113.20");
  assert.equal(requestLogsResponse.json.data.items[0].processedForDetection, true);

  assert.equal(filteredAttackEventsResponse.status, 200);
  assert.equal(filteredAttackEventsResponse.json.data.items.length, 1);
  assert.equal(
    filteredAttackEventsResponse.json.data.items[0].id,
    scenario.sqlInjectionEventId
  );
  assert.equal(filteredAttackEventsResponse.json.data.items[0].eventType, "sql_injection");
  assert.equal(filteredAttackEventsResponse.json.data.items[0].severity, "high");

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
  assert.deepEqual(attackEventDetailResponse.json.data.blockedEntities, []);
  assert.equal(attackEventDetailResponse.json.data.activeBlockedEntity ?? null, null);
  assert.deepEqual(
    attackEventDetailResponse.json.data.protectionEnforcement,
    attackEventDetailResponse.json.data.attackEvent.details.protectionEnforcement
  );
  assert.deepEqual(attackEventDetailResponse.json.data.dispositionSummary, {
    status: "none",
    blockedEntityCount: 0,
    activeBlockedEntityId: null,
    activeEntityType: null,
    activeEntityValue: null,
    activeSource: null,
    activeOriginKind: null,
    activeAttackEventId: null
  });

  const createDispositionBlockedEntityResponse = await apiRequest(
    `/api/v1/sites/${scenario.site.id}/blocked-entities`,
    {
      method: "POST",
      token: scenario.owner.token,
      body: {
        entityType: "ip",
        entityValue: "203.0.113.20",
        reason: "Integration attack event disposition",
        source: "manual",
        attackEventId: Number(scenario.sqlInjectionEventId)
      }
    }
  );

  assert.equal(createDispositionBlockedEntityResponse.status, 201);

  const attackEventDetailWithDispositionResponse = await apiRequest(
    `/api/v1/attack-events/${scenario.sqlInjectionEventId}`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(attackEventDetailWithDispositionResponse.status, 200);
  assert.equal(attackEventDetailWithDispositionResponse.json.data.blockedEntities.length, 1);
  assert.equal(
    attackEventDetailWithDispositionResponse.json.data.blockedEntities[0].id,
    createDispositionBlockedEntityResponse.json.data.blockedEntity.id
  );
  assert.equal(
    attackEventDetailWithDispositionResponse.json.data.blockedEntities[0].attackEventId,
    scenario.sqlInjectionEventId
  );
  assert.equal(
    attackEventDetailWithDispositionResponse.json.data.blockedEntities[0].originKind,
    "event_disposition"
  );
  assert.equal(
    attackEventDetailWithDispositionResponse.json.data.blockedEntities[0].isActive,
    true
  );
  assert.equal(
    attackEventDetailWithDispositionResponse.json.data.activeBlockedEntity.id,
    createDispositionBlockedEntityResponse.json.data.blockedEntity.id
  );
  assert.equal(
    attackEventDetailWithDispositionResponse.json.data.activeBlockedEntity.originKind,
    "event_disposition"
  );
  assert.equal(
    attackEventDetailWithDispositionResponse.json.data.activeBlockedEntity.isActive,
    true
  );
  assert.deepEqual(
    attackEventDetailWithDispositionResponse.json.data.protectionEnforcement,
    attackEventDetailWithDispositionResponse.json.data.attackEvent.details.protectionEnforcement
  );
  assert.deepEqual(attackEventDetailWithDispositionResponse.json.data.dispositionSummary, {
    status: "active",
    blockedEntityCount: 1,
    activeBlockedEntityId: createDispositionBlockedEntityResponse.json.data.blockedEntity.id,
    activeEntityType: "ip",
    activeEntityValue: "203.0.113.20",
    activeSource: "manual",
    activeOriginKind: "event_disposition",
    activeAttackEventId: Number(scenario.sqlInjectionEventId)
  });

  const deleteDispositionBlockedEntityResponse = await apiRequest(
    `/api/v1/blocked-entities/${createDispositionBlockedEntityResponse.json.data.blockedEntity.id}`,
    {
      method: "DELETE",
      token: scenario.owner.token
    }
  );

  assert.equal(deleteDispositionBlockedEntityResponse.status, 200);

  const attackEventDetailAfterDispositionDeleteResponse = await apiRequest(
    `/api/v1/attack-events/${scenario.sqlInjectionEventId}`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(attackEventDetailAfterDispositionDeleteResponse.status, 200);
  assert.deepEqual(attackEventDetailAfterDispositionDeleteResponse.json.data.blockedEntities, []);
  assert.equal(attackEventDetailAfterDispositionDeleteResponse.json.data.activeBlockedEntity ?? null, null);
  assert.deepEqual(
    attackEventDetailAfterDispositionDeleteResponse.json.data.protectionEnforcement,
    attackEventDetailAfterDispositionDeleteResponse.json.data.attackEvent.details.protectionEnforcement
  );
  assert.deepEqual(attackEventDetailAfterDispositionDeleteResponse.json.data.dispositionSummary, {
    status: "none",
    blockedEntityCount: 0,
    activeBlockedEntityId: null,
    activeEntityType: null,
    activeEntityValue: null,
    activeSource: null,
    activeOriginKind: null,
    activeAttackEventId: null
  });

  const filteredAiRiskResultsByEventResponse = await apiRequest(
    `/api/v1/ai-risk-results?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&attackEventId=${scenario.sqlInjectionEventId}&requestLogId=${attackEventDetailResponse.json.data.requestLog.id}&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(filteredAiRiskResultsByEventResponse.status, 200);
  assert.equal(filteredAiRiskResultsByEventResponse.json.data.items.length, 1);
  assert.equal(
    filteredAiRiskResultsByEventResponse.json.data.items[0].attackEventId,
    scenario.sqlInjectionEventId
  );
  assert.equal(
    filteredAiRiskResultsByEventResponse.json.data.items[0].requestLogId,
    attackEventDetailResponse.json.data.requestLog.id
  );

  assert.equal(crossTenantDetailResponse.status, 403);
  assert.equal(crossTenantAttackEventsResponse.status, 403);
  assert.equal(crossTenantAiRiskResultsResponse.status, 403);
});

test("dashboard site summaries and recent high-risk events are tenant-scoped", async () => {
  const siteSummariesResponse = await apiRequest(
    `/api/v1/dashboard/site-summaries?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}`,
    {
      token: scenario.owner.token
    }
  );
  const historicalSiteSummariesResponse = await apiRequest(
    `/api/v1/dashboard/site-summaries?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&startAt=2026-04-02T10:01:00.000Z&endAt=2026-04-02T10:01:00.000Z`,
    {
      token: scenario.owner.token
    }
  );
  const invalidRangeSiteSummariesResponse = await apiRequest(
    `/api/v1/dashboard/site-summaries?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&startAt=2026-04-03T00:00:00.000Z&endAt=2026-04-02T00:00:00.000Z`,
    {
      token: scenario.owner.token
    }
  );
  const recentHighRiskEventsResponse = await apiRequest(
    `/api/v1/dashboard/recent-high-risk-events?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&limit=10`,
    {
      token: scenario.owner.token
    }
  );
  const recentHighRiskEventsFirstPageResponse = await apiRequest(
    `/api/v1/dashboard/recent-high-risk-events?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&limit=1&offset=0`,
    {
      token: scenario.owner.token
    }
  );
  const recentHighRiskEventsSecondPageResponse = await apiRequest(
    `/api/v1/dashboard/recent-high-risk-events?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&limit=1&offset=1`,
    {
      token: scenario.owner.token
    }
  );
  const invalidOffsetRecentHighRiskEventsResponse = await apiRequest(
    `/api/v1/dashboard/recent-high-risk-events?tenantId=${scenario.ownerTenant.id}&siteId=${scenario.site.id}&offset=-1`,
    {
      token: scenario.owner.token
    }
  );
  const crossTenantSiteSummariesResponse = await apiRequest(
    `/api/v1/dashboard/site-summaries?tenantId=${scenario.ownerTenant.id}`,
    {
      token: scenario.outsider.token
    }
  );
  const crossTenantRecentHighRiskEventsResponse = await apiRequest(
    `/api/v1/dashboard/recent-high-risk-events?tenantId=${scenario.ownerTenant.id}&limit=10`,
    {
      token: scenario.outsider.token
    }
  );

  assert.equal(siteSummariesResponse.status, 200);
  assert.equal(siteSummariesResponse.json.data.items.length, 1);

  const siteSummary = siteSummariesResponse.json.data.items[0];
  assert.equal(siteSummary.siteId, scenario.site.id);
  assert.equal(siteSummary.siteName, "Main Site");
  assert.equal(siteSummary.siteDomain, scenario.site.domain);
  assert.equal(siteSummary.requestLogCount, 7);
  assert.equal(siteSummary.attackEventCount, scenario.attackEvents.length);
  assert.equal(siteSummary.aiRiskResultCount, scenario.aiRiskResults.length);
  assert.ok(siteSummary.highRiskResultCount >= 1);
  assert.equal(siteSummary.latestRequestLogAt, "2026-04-02T10:01:00.000Z");
  assert.ok(siteSummary.latestAttackEventAt);
  assert.ok(siteSummary.latestAiRiskResultAt);

  assert.equal(historicalSiteSummariesResponse.status, 200);
  assert.equal(historicalSiteSummariesResponse.json.data.items.length, 1);

  const historicalSiteSummary = historicalSiteSummariesResponse.json.data.items[0];
  assert.equal(historicalSiteSummary.siteId, scenario.site.id);
  assert.equal(historicalSiteSummary.requestLogCount, 1);
  assert.equal(historicalSiteSummary.attackEventCount, 0);
  assert.equal(historicalSiteSummary.aiRiskResultCount, 0);
  assert.equal(historicalSiteSummary.highRiskResultCount, 0);
  assert.equal(historicalSiteSummary.latestRequestLogAt, "2026-04-02T10:01:00.000Z");
  assert.equal(historicalSiteSummary.latestAttackEventAt, null);
  assert.equal(historicalSiteSummary.latestAiRiskResultAt, null);

  assert.equal(invalidRangeSiteSummariesResponse.status, 400);
  assert.equal(invalidRangeSiteSummariesResponse.json.error.code, "VALIDATION_ERROR");

  assert.equal(recentHighRiskEventsResponse.status, 200);
  assert.ok(recentHighRiskEventsResponse.json.data.items.length >= 1);
  assert.deepEqual(recentHighRiskEventsResponse.json.data.pagination, {
    limit: 10,
    offset: 0
  });
  assert.equal(recentHighRiskEventsResponse.json.data.items[0].siteId, scenario.site.id);
  assert.equal(recentHighRiskEventsResponse.json.data.items[0].eventType, "sql_injection");
  assert.equal(
    recentHighRiskEventsResponse.json.data.items[0].attackEventId,
    scenario.sqlInjectionEventId
  );
  assert.ok(
    ["high", "critical"].includes(
      recentHighRiskEventsResponse.json.data.items[0].riskLevel
    )
  );

  assert.equal(recentHighRiskEventsFirstPageResponse.status, 200);
  assert.deepEqual(recentHighRiskEventsFirstPageResponse.json.data.pagination, {
    limit: 1,
    offset: 0
  });
  assert.ok(recentHighRiskEventsFirstPageResponse.json.data.items.length <= 1);
  assert.equal(recentHighRiskEventsFirstPageResponse.json.data.items[0].siteId, scenario.site.id);

  assert.equal(recentHighRiskEventsSecondPageResponse.status, 200);
  assert.deepEqual(recentHighRiskEventsSecondPageResponse.json.data.pagination, {
    limit: 1,
    offset: 1
  });
  assert.ok(recentHighRiskEventsSecondPageResponse.json.data.items.length <= 1);

  if (recentHighRiskEventsSecondPageResponse.json.data.items.length === 1) {
    assert.notEqual(
      recentHighRiskEventsSecondPageResponse.json.data.items[0].attackEventId,
      recentHighRiskEventsFirstPageResponse.json.data.items[0].attackEventId
    );
  }

  assert.equal(invalidOffsetRecentHighRiskEventsResponse.status, 400);
  assert.equal(
    invalidOffsetRecentHighRiskEventsResponse.json.error.code,
    "VALIDATION_ERROR"
  );

  assert.equal(crossTenantSiteSummariesResponse.status, 403);
  assert.equal(crossTenantRecentHighRiskEventsResponse.status, 403);
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
    assert.equal(
      monitorResponse.json.data.protection.matchedBlockedEntity.id,
      createBlockedIpResponse.json.data.blockedEntity.id
    );
    assert.equal(
      monitorResponse.json.data.protection.matchedBlockedEntity.originKind,
      "manual"
    );

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
    assert.equal(
      blockedIpResponse.json.error.details.matchedBlockedEntity.id,
      createBlockedIpResponse.json.data.blockedEntity.id
    );
    assert.equal(
      blockedIpResponse.json.error.details.matchedBlockedEntity.originKind,
      "manual"
    );

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

test("编码态 queryString 归一化：monitor 下可检出 SQLi，protect 下可拦截 XSS，正常查询不误报", async () => {
  const suffix = Date.now().toString();
  const siteData = await createSite(
    scenario.owner.token,
    scenario.ownerTenant.id,
    "Encoded Query Site",
    `encoded-query-${suffix}.example.com`
  );

  await updateSecurityPolicy(scenario.owner.token, siteData.site.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 100,
    autoBlockHighRisk: false,
    highRiskScoreThreshold: 90
  });

  const benignDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T13:00:00.000Z",
    method: "GET",
    host: "encoded-query.example.com",
    path: "/search",
    queryString: "category=unionized+selection",
    clientIp: "192.0.2.31",
    userAgent: "Mozilla/5.0"
  });

  assert.equal(benignDecision.action, "allow");
  assert.deepEqual(benignDecision.reasons, []);

  const benignRequestLog = await submitRequestLog(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T13:00:01.000Z",
    method: "GET",
    host: "encoded-query.example.com",
    path: "/search",
    queryString: "category=unionized+selection",
    statusCode: 200,
    clientIp: "192.0.2.31",
    userAgent: "Mozilla/5.0"
  });

  const encodedSqlInjectionResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": siteData.ingestionKey
    },
    body: {
      siteId: siteData.site.id,
      occurredAt: "2026-04-02T13:00:02.000Z",
      method: "GET",
      host: "encoded-query.example.com",
      path: "/login",
      queryString: "id=1+UnIoN+SeLeCt+password+FrOm+users",
      statusCode: 200,
      clientIp: "192.0.2.32",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(encodedSqlInjectionResponse.status, 201);
  assert.equal(encodedSqlInjectionResponse.json.data.protection.action, "monitor");
  assert.ok(
    encodedSqlInjectionResponse.json.data.protection.reasons.includes("blocked_sql_injection")
  );

  await updateSecurityPolicy(scenario.owner.token, siteData.site.id, {
    mode: "protect",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 100,
    autoBlockHighRisk: false,
    highRiskScoreThreshold: 90
  });

  const encodedXssDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T13:00:03.000Z",
    method: "GET",
    host: "encoded-query.example.com",
    path: "/search",
    queryString: "q=%3CSCRIPT%3Ealert%281%29%3C%2FSCRIPT%3E",
    clientIp: "192.0.2.33",
    userAgent: "Mozilla/5.0"
  });

  assert.equal(encodedXssDecision.mode, "protect");
  assert.equal(encodedXssDecision.action, "block");
  assert.ok(encodedXssDecision.reasons.includes("blocked_xss"));

  const detectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: scenario.owner.token,
    body: {
      tenantId: scenario.ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(detectionResponse.status, 200);

  const attackEventsResponse = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&siteId=${siteData.site.id}&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(attackEventsResponse.status, 200);

  const sqlInjectionRequestLogId = String(
    encodedSqlInjectionResponse.json.data.requestLog.id
  );
  const benignRequestLogId = String(benignRequestLog.id);

  assert.ok(
    attackEventsResponse.json.data.items.some(
      (item) =>
        item.eventType === "sql_injection" &&
        String(item.requestLogId) === sqlInjectionRequestLogId
    )
  );
  assert.ok(
    !attackEventsResponse.json.data.items.some(
      (item) => String(item.requestLogId) === benignRequestLogId
    )
  );
});

test("path/queryString normalization boundaries: malformed percent fallback, double-encoded path payload detection, and benign no false positive", async () => {
  const suffix = Date.now().toString();
  const siteData = await createSite(
    scenario.owner.token,
    scenario.ownerTenant.id,
    "Path Normalization Site",
    `path-normalization-${suffix}.example.com`
  );

  await updateSecurityPolicy(scenario.owner.token, siteData.site.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 100,
    autoBlockHighRisk: false,
    highRiskScoreThreshold: 90
  });

  const malformedDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T14:00:00.000Z",
    method: "GET",
    host: "path-normalization.example.com",
    path: "/files/%E0%A4%A",
    queryString: "next=%",
    clientIp: "192.0.2.41",
    userAgent: "Mozilla/5.0"
  });

  assert.equal(malformedDecision.mode, "monitor");
  assert.equal(malformedDecision.action, "allow");
  assert.deepEqual(malformedDecision.reasons, []);

  const benignRequestLog = await submitRequestLog(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T14:00:01.000Z",
    method: "GET",
    host: "path-normalization.example.com",
    path: "/docs/unionized-selection",
    queryString: "topic=javascript-guide",
    statusCode: 200,
    clientIp: "192.0.2.42",
    userAgent: "Mozilla/5.0"
  });

  const encodedPathSqlInjectionResponse = await apiRequest("/api/v1/request-logs", {
    method: "POST",
    headers: {
      "x-site-ingestion-key": siteData.ingestionKey
    },
    body: {
      siteId: siteData.site.id,
      occurredAt: "2026-04-02T14:00:02.000Z",
      method: "GET",
      host: "path-normalization.example.com",
      path: "/login/%2555nion%2520SeLeCt",
      statusCode: 200,
      clientIp: "192.0.2.43",
      userAgent: "Mozilla/5.0"
    }
  });

  assert.equal(encodedPathSqlInjectionResponse.status, 201);
  assert.equal(encodedPathSqlInjectionResponse.json.data.protection.mode, "monitor");
  assert.equal(encodedPathSqlInjectionResponse.json.data.protection.action, "monitor");
  assert.ok(
    encodedPathSqlInjectionResponse.json.data.protection.reasons.includes(
      "blocked_sql_injection"
    )
  );

  await updateSecurityPolicy(scenario.owner.token, siteData.site.id, {
    mode: "protect",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 100,
    autoBlockHighRisk: false,
    highRiskScoreThreshold: 90
  });

  const encodedPathXssDecision = await protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T14:00:03.000Z",
    method: "GET",
    host: "path-normalization.example.com",
    path: "/search/%253Cscript%253Ealert%25281%2529%253C%252Fscript%253E",
    clientIp: "192.0.2.44",
    userAgent: "Mozilla/5.0"
  });

  assert.equal(encodedPathXssDecision.mode, "protect");
  assert.equal(encodedPathXssDecision.action, "block");
  assert.ok(encodedPathXssDecision.reasons.includes("blocked_xss"));

  const detectionResponse = await apiRequest("/api/v1/detection/run", {
    method: "POST",
    token: scenario.owner.token,
    body: {
      tenantId: scenario.ownerTenant.id,
      limit: 50
    }
  });

  assert.equal(detectionResponse.status, 200);

  const attackEventsResponse = await apiRequest(
    `/api/v1/attack-events?tenantId=${scenario.ownerTenant.id}&siteId=${siteData.site.id}&limit=20`,
    {
      token: scenario.owner.token
    }
  );

  assert.equal(attackEventsResponse.status, 200);

  const encodedPathSqlRequestLogId = String(
    encodedPathSqlInjectionResponse.json.data.requestLog.id
  );
  const benignRequestLogId = String(benignRequestLog.id);

  assert.ok(
    attackEventsResponse.json.data.items.some(
      (item) =>
        item.eventType === "sql_injection" &&
        String(item.requestLogId) === encodedPathSqlRequestLogId
    )
  );
  assert.ok(
    !attackEventsResponse.json.data.items.some(
      (item) => String(item.requestLogId) === benignRequestLogId
    )
  );
});
