import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSiteProtectionClient,
  enforceNodeRequestProtection,
  extractNodeRequestContext
} from "../src/index.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);
const packageRootDir = resolve(currentDir, "..");
const envFilePath = resolve(packageRootDir, ".env");
const defaultSiteId = "00000000-0000-0000-0000-000000000000";
const defaultIngestionKey = "replace-with-site-key";

function loadEnvFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  const fileContent = readFileSync(filePath, "utf8");

  for (const rawLine of fileContent.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
  }

  return true;
}

function isPlaceholderSiteId(value: string): boolean {
  return value === defaultSiteId;
}

function isPlaceholderIngestionKey(value: string): boolean {
  return value === defaultIngestionKey;
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`;
  }

  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function printStartupGuide(sitePort: number): void {
  console.log("SecuAI 站点侧接入 demo 已启动");
  console.log(`演示地址: http://127.0.0.1:${sitePort}`);
  console.log("建议先在 /dashboard/policies 完成当前站点的策略配置与封禁名单准备。");
  console.log("演示请求示例:");
  console.log(`  curl http://127.0.0.1:${sitePort}/`);
  console.log(
    `  curl "http://127.0.0.1:${sitePort}/login?id=1" -H "x-forwarded-for: 203.0.113.77"`
  );
  console.log(
    `  curl "http://127.0.0.1:${sitePort}/login?id=1" -H "x-forwarded-for: 203.0.113.77" -H "user-agent: sqlmap/1.8.4"`
  );
  console.log("说明:");
  console.log("  - allow / monitor 时会返回 200 JSON，并带 protection 结果。");
  console.log("  - block 时会返回 403 JSON，错误码为 REQUEST_BLOCKED。");
}

const loadedEnvFile = loadEnvFile(envFilePath);
const platformBaseUrl = process.env.SECUAI_PLATFORM_URL ?? "http://127.0.0.1:3201";
const siteId = process.env.SECUAI_SITE_ID ?? defaultSiteId;
const siteIngestionKey = process.env.SECUAI_SITE_INGESTION_KEY ?? defaultIngestionKey;
const sitePort = Number(process.env.SECUAI_SITE_PORT ?? "8080");
const requestLogReportingEnabled = process.env.SECUAI_REPORT_REQUEST_LOGS !== "false";
const requestLogReportingScope =
  process.env.SECUAI_REPORT_REQUEST_LOG_SCOPE === "all" ? "all" : "monitor";

const protectionClient = createSiteProtectionClient({
  platformBaseUrl,
  siteId,
  siteIngestionKey,
  timeoutMs: 1500,
  requestLogReporting: {
    enabled: requestLogReportingEnabled,
    scope: requestLogReportingScope,
    timeoutMs: 1500
  }
});

const server = createServer(async (request, response) => {
  const requestContext = extractNodeRequestContext(request);
  const decision = await enforceNodeRequestProtection(request, response, protectionClient);

  console.log(
    `[SecuAI demo] ${requestContext.method} ${requestContext.path}${
      requestContext.queryString ? `?${requestContext.queryString}` : ""
    } -> ${decision.action}`,
    {
      mode: decision.mode,
      reasons: decision.reasons,
      monitored: decision.monitored,
      failOpen: decision.failOpen,
      clientIp: requestContext.clientIp
    }
  );

  if (decision.action === "block") {
    return;
  }

  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "x-secuai-protection-action": decision.action,
    "x-secuai-fail-open": String(decision.failOpen),
    "x-secuai-monitored": String(decision.monitored)
  });
  response.end(
    JSON.stringify({
      ok: true,
      message:
        decision.action === "monitor"
          ? "请求已放行，并被标记为 monitor。"
          : decision.failOpen
            ? "平台当前走 fail-open，请检查 protection/check 连通性。"
            : "请求已按 allow 结果放行。",
      request: {
        method: requestContext.method,
        host: requestContext.host,
        path: requestContext.path,
        queryString: requestContext.queryString ?? null,
        clientIp: requestContext.clientIp ?? null,
        userAgent: requestContext.userAgent ?? null,
        referer: requestContext.referer ?? null
      },
      protection: decision
    })
  );
});

server.listen(sitePort, "127.0.0.1", () => {
  console.log(
    loadedEnvFile
      ? `已从 ${envFilePath} 读取环境变量。`
      : "未找到 packages/site-middleware/.env，当前仅使用进程环境变量。"
  );
  console.log("当前接入配置:");
  console.log(`  SECUAI_PLATFORM_URL=${platformBaseUrl}`);
  console.log(`  SECUAI_SITE_ID=${siteId}`);
  console.log(`  SECUAI_SITE_INGESTION_KEY=${maskSecret(siteIngestionKey)}`);
  console.log(`  SECUAI_SITE_PORT=${sitePort}`);
  console.log(`  SECUAI_REPORT_REQUEST_LOGS=${String(requestLogReportingEnabled)}`);
  console.log(`  SECUAI_REPORT_REQUEST_LOG_SCOPE=${requestLogReportingScope}`);

  if (isPlaceholderSiteId(siteId) || isPlaceholderIngestionKey(siteIngestionKey)) {
    console.warn(
      "警告: 当前 siteId 或 ingestion key 仍是占位值。若直接发请求，通常只会得到 fail-open 或平台认证失败结果。"
    );
    console.warn("请先复制 packages/site-middleware/.env.example 为 .env，并填入真实 site 配置。");
  }

  printStartupGuide(sitePort);
});
