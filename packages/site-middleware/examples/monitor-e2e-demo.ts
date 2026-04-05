import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";

import {
  createSiteProtectionClient,
  enforceNodeRequestProtection,
  type SiteProtectionDecision
} from "../src/index.js";

type JsonObject = Record<string, unknown>;

type ApiResponse = {
  status: number;
  json: JsonObject;
};

type RequestLogSummary = {
  id: number;
  path: string;
  clientIp: string | null;
  userAgent: string | null;
  processedForDetection: boolean;
};

type AttackEventSummary = {
  id: number;
  requestLogId: number;
  eventType: string;
  severity: string;
  summary: string;
};

type AiRiskResultSummary = {
  id: number;
  requestLogId: number;
  attackEventId: number;
  riskScore: number;
  riskLevel: string;
  modelName: string;
  modelVersion: string;
  factors?: {
    reasons?: unknown;
  };
  rawResponse?: {
    reasons?: unknown;
  };
};

const platformBaseUrl = (process.env.SECUAI_PLATFORM_URL ?? "http://127.0.0.1:3201").replace(
  /\/+$/,
  ""
);
const demoClientIp = process.env.SECUAI_DEMO_CLIENT_IP ?? "198.51.100.77";
const demoHost = process.env.SECUAI_DEMO_HOST ?? "demo-site.local";
const sitePort = Number(process.env.SECUAI_DEMO_SITE_PORT ?? "0");
const demoPath = "/login";
const demoUserAgent = "sqlmap/1.8.4";
const demoStamp = Date.now().toString();
const demoEmail = `middleware-demo-${demoStamp}@example.com`;
const demoTenantSlug = `middleware-demo-${demoStamp}`;
const demoDomain = `middleware-demo-${demoStamp}.example.com`;

let currentSiteServerPort = sitePort;

class DemoError extends Error {
  constructor(message: string, readonly details?: JsonObject) {
    super(message);
  }
}

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
): Promise<{ status: number; json: JsonObject }> {
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
    throw new DemoError(`${label} failed.`, {
      status: response.status,
      response: response.json
    });
  }

  return response.json.data as T;
}

async function waitForCondition<T>(
  loader: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 10_000
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await loader();

      if (predicate(value)) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  throw new DemoError(`${label} did not become ready in time.`, {
    timeoutMs,
    lastError: lastError instanceof Error ? lastError.message : String(lastError ?? "")
  });
}

async function waitForApiReady(timeoutMs = 10_000): Promise<void> {
  await waitForCondition(
    async () => {
      const response = await fetch(`${platformBaseUrl}/health`);
      return response.ok;
    },
    (value) => value,
    "API health check",
    timeoutMs
  );
}

async function provisionDemoSite(): Promise<{
  token: string;
  tenantId: string;
  siteId: string;
  ingestionKey: string;
}> {
  console.log("1) 构造站点接入所需租户、站点和 monitor 策略");

  const registerData = expectSuccess<{
    user: { id: string };
  }>(
    await apiRequest("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: demoEmail,
        password: "StrongPass123",
        displayName: "Middleware Demo"
      }
    }),
    "register demo user"
  );
  console.log(`   已注册演示用户: ${registerData.user.id}`);

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
        name: "Middleware Demo Tenant",
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
        name: "Middleware Demo Site",
        domain: demoDomain
      }
    }),
    "create demo site"
  );

  expectSuccess<{ securityPolicy: JsonObject }>(
    await apiRequest(`/api/v1/sites/${siteData.site.id}/security-policy`, {
      method: "PUT",
      token: loginData.token,
      body: {
        mode: "monitor",
        blockSqlInjection: true,
        blockXss: true,
        blockSuspiciousUserAgent: true,
        enableRateLimit: true,
        rateLimitThreshold: 100,
        autoBlockHighRisk: false,
        highRiskScoreThreshold: 90
      }
    }),
    "update demo security policy"
  );

  expectSuccess<{ blockedEntity: JsonObject }>(
    await apiRequest(`/api/v1/sites/${siteData.site.id}/blocked-entities`, {
      method: "POST",
      token: loginData.token,
      body: {
        entityType: "ip",
        entityValue: demoClientIp,
        reason: "Monitor E2E demo blocked IP"
      }
    }),
    "create demo blocked entity"
  );

  return {
    token: loginData.token,
    tenantId: tenantData.tenant.id,
    siteId: siteData.site.id,
    ingestionKey: siteData.ingestionKey
  };
}

async function startDemoSiteServer(input: {
  siteId: string;
  ingestionKey: string;
}): Promise<Server> {
  console.log("2) 启动最小企业网站服务，并接入 site-middleware");

  const protectionClient = createSiteProtectionClient({
    platformBaseUrl,
    siteId: input.siteId,
    siteIngestionKey: input.ingestionKey,
    timeoutMs: 1500,
    requestLogReporting: {
      enabled: true,
      scope: "monitor",
      timeoutMs: 1500
    }
  });

  const siteServer = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    // monitor 模式下业务请求继续放行，同时复用中间件的异步日志上报能力，
    // 确保后端仍沿用现有 request_logs -> detection -> attack_events -> ai_risk_results 主链路。
    const decision = await enforceNodeRequestProtection(request, response, protectionClient);

    if (decision.action === "block") {
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "x-secuai-protection-action": decision.action,
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

  console.log(`   演示站点已启动: http://127.0.0.1:${currentSiteServerPort}`);
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

function expectMonitorDecision(decision: SiteProtectionDecision): void {
  if (decision.action !== "monitor" || decision.mode !== "monitor" || !decision.monitored) {
    throw new DemoError("Expected monitor decision from demo site request.", {
      decision
    });
  }

  if (
    !decision.reasons.includes("blocked_ip") ||
    !decision.reasons.includes("blocked_suspicious_user_agent")
  ) {
    throw new DemoError("Expected blocked_ip and blocked_suspicious_user_agent reasons.", {
      decision
    });
  }
}

async function triggerMonitorRequest(): Promise<SiteProtectionDecision> {
  console.log("3) 构造一条会命中 monitor 的站点请求");

  const response = await fetch(
    `http://127.0.0.1:${currentSiteServerPort}${demoPath}?demo=monitor-hit`,
    {
      method: "GET",
      headers: {
        host: demoHost,
        "x-forwarded-for": demoClientIp,
        "user-agent": "sqlmap/1.8.4"
      }
    }
  );
  const body = (await response.json()) as {
    ok?: boolean;
    protection?: SiteProtectionDecision;
  };

  if (!response.ok || body.ok !== true || !body.protection) {
    throw new DemoError("Demo site request failed.", {
      status: response.status,
      response: body
    });
  }

  expectMonitorDecision(body.protection);
  console.log(`   middleware decision: ${JSON.stringify(body.protection)}`);
  return body.protection;

  console.log("   middleware 决策:", JSON.stringify(body.protection));
}

async function waitForRequestLog(input: {
  token: string;
  tenantId: string;
  siteId: string;
}): Promise<RequestLogSummary> {
  console.log("4) 等待 monitor 命中异步写入 request_logs");

  const logsData = await waitForCondition(
    async () =>
      expectSuccess<{
        items: RequestLogSummary[];
      }>(
        await apiRequest(
          `/api/v1/request-logs?tenantId=${input.tenantId}&siteId=${input.siteId}&clientIp=${demoClientIp}&limit=20`,
          {
            token: input.token
          }
        ),
        "query request logs"
      ),
    (value) =>
      value.items.some(
        (item) =>
          item.path === demoPath &&
          item.clientIp === demoClientIp &&
          item.userAgent === demoUserAgent
      ),
    "monitor request log"
  );

  const log = logsData.items.find(
    (item) =>
      item.path === demoPath && item.clientIp === demoClientIp && item.userAgent === demoUserAgent
  );

  if (!log) {
    throw new DemoError("Monitor request log was not found after polling.");
  }
  console.log(`   request_logs 已写入: id=${log.id}, processed=${log.processedForDetection}`);
  return log;
}

async function runDetectionAndQueryResults(input: {
  token: string;
  tenantId: string;
  siteId: string;
}, requestLog: RequestLogSummary): Promise<void> {
  console.log("5) 触发 detection，并查询 attack_events 和 ai_risk_results");

  const detectionData = expectSuccess<{
    processedCount: number;
    eventCount: number;
    aiSuccessCount: number;
    aiFailureCount: number;
  }>(
    await apiRequest("/api/v1/detection/run", {
      method: "POST",
      token: input.token,
      body: {
        tenantId: input.tenantId,
        limit: 50
      }
    }),
    "run detection"
  );

  if (detectionData.processedCount < 1 || detectionData.eventCount < 1) {
    throw new DemoError("Detection did not process the monitor request log.", {
      requestLogId: requestLog.id,
      detectionData
    });
  }

  if (detectionData.aiSuccessCount < 1) {
    throw new DemoError("AI scoring did not produce any success result.", {
      requestLogId: requestLog.id,
      detectionData
    });
  }

  console.log("   detection 结果:", JSON.stringify(detectionData));

  const attackEvent = await waitForCondition(
    async () => {
      const attackEventsData = expectSuccess<{ items: AttackEventSummary[] }>(
        await apiRequest(
          `/api/v1/attack-events?tenantId=${input.tenantId}&siteId=${input.siteId}&limit=20`,
          {
            token: input.token
          }
        ),
        "query attack events"
      );

      return (
        attackEventsData.items.find(
          (item) =>
            item.requestLogId === requestLog.id && item.eventType === "suspicious_user_agent"
        ) ?? null
      );
    },
    (value) => value !== null,
    "attack event"
  );

  if (!attackEvent) {
    throw new DemoError("Attack event was not found for the monitor request log.", {
      requestLogId: requestLog.id
    });
  }

  const aiRiskResult = await waitForCondition(
    async () => {
      const aiRiskResultsData = expectSuccess<{ items: AiRiskResultSummary[] }>(
        await apiRequest(
          `/api/v1/ai-risk-results?tenantId=${input.tenantId}&siteId=${input.siteId}&limit=20`,
          {
            token: input.token
          }
        ),
        "query ai risk results"
      );

      return (
        aiRiskResultsData.items.find(
          (item) =>
            item.requestLogId === requestLog.id && item.attackEventId === attackEvent.id
        ) ?? null
      );
    },
    (value) => value !== null,
    "ai risk result"
  );

  if (!aiRiskResult) {
    throw new DemoError("AI risk result was not found for the attack event.", {
      requestLogId: requestLog.id,
      attackEventId: attackEvent.id
    });
  }

  if (
    aiRiskResult.modelName !== "heuristic-analyzer" ||
    aiRiskResult.modelVersion !== "v1" ||
    !Array.isArray(aiRiskResult.factors?.reasons) ||
    !Array.isArray(aiRiskResult.rawResponse?.reasons)
  ) {
    throw new DemoError("AI risk result contract validation failed.", {
      aiRiskResult
    });
  }

  const attackEventsData = { items: [attackEvent] };
  const aiRiskResultsData = { items: [aiRiskResult] };

  console.log(`   attack_event: ${JSON.stringify(attackEvent)}`);
  console.log(`   ai_risk_result: ${JSON.stringify(aiRiskResult)}`);

  console.log("   attack_events 首条记录:", JSON.stringify(attackEventsData.items[0]));
  console.log("   ai_risk_results 首条记录:", JSON.stringify(aiRiskResultsData.items[0]));
}

async function main(): Promise<void> {
  console.log("SecuAI monitor 端到端演示开始");
  console.log(`平台 API 地址: ${platformBaseUrl}`);

  await waitForApiReady();
  const provisioned = await provisionDemoSite();
  const siteServer = await startDemoSiteServer({
    siteId: provisioned.siteId,
    ingestionKey: provisioned.ingestionKey
  });

  try {
    await triggerMonitorRequest();
    const requestLog = await waitForRequestLog({
      token: provisioned.token,
      tenantId: provisioned.tenantId,
      siteId: provisioned.siteId
    });
    await runDetectionAndQueryResults({
      token: provisioned.token,
      tenantId: provisioned.tenantId,
      siteId: provisioned.siteId
    }, requestLog);
    console.log("SecuAI monitor 端到端演示完成");
  } finally {
    await closeServer(siteServer);
  }
}

main().catch((error) => {
  console.error("SecuAI monitor 端到端演示失败");
  if (error instanceof DemoError && error.details) {
    console.error(error.message, error.details);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
