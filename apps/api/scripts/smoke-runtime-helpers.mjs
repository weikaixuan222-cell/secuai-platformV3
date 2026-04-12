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

function sleep(timeoutMs) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, timeoutMs));
}

function captureLogs(processRef, key, childLogs) {
  processRef.stdout?.on("data", (chunk) => {
    childLogs[key].stdout += chunk.toString();
  });

  processRef.stderr?.on("data", (chunk) => {
    childLogs[key].stderr += chunk.toString();
  });
}

function startProcess(command, args, options, childLogs) {
  const processRef = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });

  processRef.on("error", (error) => {
    childLogs[options.logKey].stderr += `${error.name}: ${error.message}\n`;
  });

  captureLogs(processRef, options.logKey, childLogs);
  return processRef;
}

async function waitForProcessExit(processRef, label, timeoutMs = 5_000) {
  if (!processRef) {
    return;
  }

  await Promise.race([
    new Promise((resolveProcess, rejectProcess) => {
      processRef.once("exit", resolveProcess);
      processRef.once("error", rejectProcess);
    }),
    sleep(timeoutMs).then(() => {
      throw new Error(`${label} did not exit within ${timeoutMs} ms.`);
    })
  ]);
}

async function stopProcess(processRef, label) {
  if (!processRef || processRef.exitCode !== null || processRef.killed) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolveStop) => {
      const killer = spawn("taskkill", ["/pid", String(processRef.pid), "/t", "/f"], {
        stdio: "ignore"
      });

      killer.once("exit", () => resolveStop());
      killer.once("error", () => resolveStop());
    });
  } else {
    processRef.kill("SIGTERM");
  }

  try {
    await waitForProcessExit(processRef, label);
  } catch {
    if (process.platform !== "win32") {
      processRef.kill("SIGKILL");
      await waitForProcessExit(processRef, label, 2_000).catch(() => {});
    }
  }
}

export function createSmokeRuntime(
  options = {
    apiPort: undefined,
    aiPort: undefined
  }
) {
  const databaseUrl =
    process.env.SMOKE_DATABASE_URL ??
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://secuai:secuai_dev_password@127.0.0.1:5432/secuai";
  const dbSslMode =
    process.env.SMOKE_DB_SSL_MODE ??
    process.env.TEST_DB_SSL_MODE ??
    process.env.DB_SSL_MODE ??
    "disable";
  const apiPort = Number(options.apiPort ?? process.env.SMOKE_API_PORT ?? randomInt(45300, 45350));
  const aiPort = Number(options.aiPort ?? process.env.SMOKE_AI_PORT ?? randomInt(45360, 45410));
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const analyzerBaseUrl = `http://127.0.0.1:${aiPort}`;
  const childLogs = {
    api: { stdout: "", stderr: "" },
    analyzer: { stdout: "", stderr: "" }
  };

  let dbClient;
  let apiProcess;
  let analyzerProcess;

  function createDbClient() {
    return new pg.Client({
      connectionString: databaseUrl,
      ssl: dbSslMode === "require" ? { rejectUnauthorized: false } : false
    });
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
        // 服务尚未就绪时继续轮询。
      }

      await sleep(250);
    }

    throw new Error(
      `${label} did not become ready.\nAPI stdout:\n${childLogs.api.stdout}\nAPI stderr:\n${childLogs.api.stderr}\nAnalyzer stdout:\n${childLogs.analyzer.stdout}\nAnalyzer stderr:\n${childLogs.analyzer.stderr}`
    );
  }

  async function connectDatabase() {
    dbClient = createDbClient();
    await dbClient.connect();
  }

  async function applySchema() {
    const schemaSql = await readFile(schemaPath, "utf8");
    await dbClient.query(schemaSql);
  }

  async function startAnalyzer() {
    analyzerProcess = startProcess(
      "python",
      ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(aiPort)],
      {
        cwd: analyzerDir,
        env: {
          ...process.env
        },
        logKey: "analyzer"
      },
      childLogs
    );

    await waitForHttpReady(`${analyzerBaseUrl}/health`, "AI analyzer");
  }

  async function startApi({ requireAnalyzer = true } = {}) {
    const aiAnalyzerUrl = requireAnalyzer
      ? analyzerBaseUrl
      : process.env.SMOKE_AI_ANALYZER_URL ?? "http://127.0.0.1:9";

    apiProcess = startProcess(
      "node",
      ["dist/server.js"],
      {
        cwd: apiDir,
        env: {
          ...process.env,
          PORT: String(apiPort),
          HOST: "127.0.0.1",
          DATABASE_URL: databaseUrl,
          DB_SSL_MODE: dbSslMode,
          AI_ANALYZER_URL: aiAnalyzerUrl,
          AI_ANALYZER_TIMEOUT_MS: "1500",
          AI_ANALYZER_MAX_RETRIES: "1"
        },
        logKey: "api"
      },
      childLogs
    );

    await waitForHttpReady(`${apiBaseUrl}/health`, "API");
  }

  async function prepareRuntime({ startAnalyzer: shouldStartAnalyzer = true } = {}) {
    await connectDatabase();
    await applySchema();

    if (shouldStartAnalyzer) {
      await startAnalyzer();
    }

    await startApi({ requireAnalyzer: shouldStartAnalyzer });
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

  async function registerAndLogin(email, displayName = "Smoke User") {
    const password = "StrongPass123";
    const registerResponse = await apiRequest("/api/v1/auth/register", {
      method: "POST",
      body: {
        email,
        password,
        displayName
      }
    });

    assert.equal(registerResponse.status, 201);

    const loginResponse = await apiRequest("/api/v1/auth/login", {
      method: "POST",
      body: {
        email,
        password
      }
    });

    assert.equal(loginResponse.status, 200);
    return {
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

  async function getSecurityPolicy(token, siteId) {
    const response = await apiRequest(`/api/v1/sites/${siteId}/security-policy`, {
      token
    });

    assert.equal(response.status, 200);
    return response.json.data.securityPolicy;
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

  async function createBlockedEntity(token, siteId, body) {
    const response = await apiRequest(`/api/v1/sites/${siteId}/blocked-entities`, {
      method: "POST",
      token,
      body
    });

    assert.equal(response.status, 201);
    return response.json.data.blockedEntity;
  }

  async function listBlockedEntities(token, siteId, filters = {}) {
    const params = new URLSearchParams();

    if (filters.attackEventId !== undefined) {
      params.set("attackEventId", String(filters.attackEventId));
    }

    const queryString = params.size > 0 ? `?${params.toString()}` : "";
    const response = await apiRequest(`/api/v1/sites/${siteId}/blocked-entities${queryString}`, {
      token
    });

    assert.equal(response.status, 200);
    return response.json.data.items;
  }

  async function deleteBlockedEntity(token, blockedEntityId) {
    const response = await apiRequest(`/api/v1/blocked-entities/${blockedEntityId}`, {
      method: "DELETE",
      token
    });

    assert.equal(response.status, 200);
    return response.json.data;
  }

  async function expireBlockedEntityForSmoke(blockedEntityId) {
    const result = await dbClient.query(
      `
        UPDATE blocked_entities
        SET expires_at = NOW() + INTERVAL '1 second'
        WHERE id = $1
        RETURNING id, expires_at
      `,
      [blockedEntityId]
    );

    assert.equal(result.rowCount, 1);
    return {
      id: result.rows[0].id,
      expiresAt: result.rows[0].expires_at?.toISOString?.() ?? null
    };
  }

  async function resetRequestLogProcessedForDetectionForSmoke(requestLogId) {
    const result = await dbClient.query(
      `
        UPDATE request_logs
        SET processed_for_detection = FALSE
        WHERE id = $1
        RETURNING id
      `,
      [requestLogId]
    );

    assert.equal(result.rowCount, 1);
    return {
      id: result.rows[0].id
    };
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

  async function submitRequestLog(ingestionKey, body) {
    const response = await apiRequest("/api/v1/request-logs", {
      method: "POST",
      headers: {
        "x-site-ingestion-key": ingestionKey
      },
      body
    });

    assert.equal(response.status, 201);
    return response.json.data;
  }

  async function runDetection(token, tenantId) {
    const response = await apiRequest("/api/v1/detection/run", {
      method: "POST",
      token,
      body: {
        tenantId,
        limit: 50
      }
    });

    assert.equal(response.status, 200);
    return response.json.data;
  }

  async function listAttackEvents(token, tenantId, siteId) {
    const response = await apiRequest(
      `/api/v1/attack-events?tenantId=${tenantId}&siteId=${siteId}&limit=20`,
      { token }
    );

    assert.equal(response.status, 200);
    return response.json.data.items;
  }

  async function getAttackEventDetail(token, attackEventId) {
    const response = await apiRequest(`/api/v1/attack-events/${attackEventId}`, { token });

    assert.equal(response.status, 200);
    return response.json.data;
  }

  async function listAiRiskResults(token, tenantId, siteId) {
    const response = await apiRequest(
      `/api/v1/ai-risk-results?tenantId=${tenantId}&siteId=${siteId}&limit=20`,
      { token }
    );

    assert.equal(response.status, 200);
    return response.json.data.items;
  }

  async function listSiteSummaries(token, tenantId, siteId) {
    const response = await apiRequest(
      `/api/v1/dashboard/site-summaries?tenantId=${tenantId}&siteId=${siteId}`,
      { token }
    );

    assert.equal(response.status, 200);
    return response.json.data.items;
  }

  async function listRecentHighRiskEvents(token, tenantId, siteId) {
    const response = await apiRequest(
      `/api/v1/dashboard/recent-high-risk-events?tenantId=${tenantId}&siteId=${siteId}&limit=10`,
      { token }
    );

    assert.equal(response.status, 200);
    return response.json.data;
  }

  async function shutdown() {
    await stopProcess(apiProcess, "API");
    await stopProcess(analyzerProcess, "AI analyzer");
    await dbClient?.end().catch(() => {});
  }

  return {
    config: {
      apiBaseUrl,
      analyzerBaseUrl,
      apiPort,
      aiPort,
      databaseUrl,
      dbSslMode
    },
    childLogs,
    prepareRuntime,
    apiRequest,
    registerAndLogin,
    createTenant,
    createSite,
    getSecurityPolicy,
    updateSecurityPolicy,
    createBlockedEntity,
    listBlockedEntities,
    deleteBlockedEntity,
    expireBlockedEntityForSmoke,
    resetRequestLogProcessedForDetectionForSmoke,
    protectionCheck,
    submitRequestLog,
    runDetection,
    listAttackEvents,
    getAttackEventDetail,
    listAiRiskResults,
    listSiteSummaries,
    listRecentHighRiskEvents,
    shutdown
  };
}
