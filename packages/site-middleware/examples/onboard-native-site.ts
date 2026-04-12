import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

type ApiResponse = {
  status: number;
  json: JsonObject;
};

const platformBaseUrl = (process.env.SECUAI_PLATFORM_URL ?? "http://127.0.0.1:3201").replace(
  /\/+$/u,
  ""
);
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);
const packageRootDir = resolve(currentDir, "..", "..");
const nativeNodeScriptPath = resolve(packageRootDir, "dist", "examples", "native-node-server.js");
const envFilePath = resolve(packageRootDir, ".env");
const demoStamp = Date.now().toString();
const sitePort = Number(process.env.SECUAI_SITE_PORT ?? "8080");
const onboardingEmail = process.env.SECUAI_ONBOARD_EMAIL ?? `native-onboard-${demoStamp}@example.com`;
const onboardingPassword = process.env.SECUAI_ONBOARD_PASSWORD ?? "StrongPass123";
const onboardingDisplayName = process.env.SECUAI_ONBOARD_DISPLAY_NAME ?? "Native Onboarding User";
const tenantName = process.env.SECUAI_ONBOARD_TENANT_NAME ?? "Native Onboarding Tenant";
const tenantSlug = process.env.SECUAI_ONBOARD_TENANT_SLUG ?? `native-onboard-${demoStamp}`;
const siteName = process.env.SECUAI_ONBOARD_SITE_NAME ?? "Native Onboarding Site";
const siteDomain =
  process.env.SECUAI_ONBOARD_SITE_DOMAIN ?? `native-onboard-${demoStamp}.example.com`;

class OnboardingError extends Error {
  constructor(message: string, readonly details?: JsonObject) {
    super(message);
  }
}

async function apiRequest(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: JsonObject;
  } = {}
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
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
    throw new OnboardingError(`${label} failed.`, {
      status: response.status,
      response: response.json
    });
  }

  return response.json.data as T;
}

async function ensureApiReady(): Promise<void> {
  try {
    const response = await fetch(`${platformBaseUrl}/health`);

    if (response.ok) {
      return;
    }
  } catch {}

  throw new OnboardingError("API 未就绪，无法执行 site onboarding。", {
    platformBaseUrl,
    nextSteps: [
      "先执行 npm run dev:demo-stack",
      "如果启动失败，先执行 npm run doctor:demo-stack"
    ]
  });
}

function printSection(title: string): void {
  console.log(`\n[onboard-native-site] ${title}`);
}

function buildEnvFileContent(input: {
  platformBaseUrl: string;
  siteId: string;
  ingestionKey: string;
  sitePort: number;
}): string {
  return [
    `SECUAI_PLATFORM_URL=${input.platformBaseUrl}`,
    `SECUAI_SITE_ID=${input.siteId}`,
    `SECUAI_SITE_INGESTION_KEY=${input.ingestionKey}`,
    `SECUAI_SITE_PORT=${input.sitePort}`,
    "SECUAI_REPORT_REQUEST_LOGS=true",
    "SECUAI_REPORT_REQUEST_LOG_SCOPE=monitor",
    ""
  ].join("\n");
}

async function writeNativeDemoEnvFile(content: string): Promise<void> {
  await writeFile(envFilePath, content, "utf8");
}

async function runNativeDemo(input: {
  platformBaseUrl: string;
  siteId: string;
  ingestionKey: string;
  sitePort: number;
}): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [nativeNodeScriptPath], {
      cwd: packageRootDir,
      stdio: "inherit",
      env: {
        ...process.env,
        SECUAI_PLATFORM_URL: input.platformBaseUrl,
        SECUAI_SITE_ID: input.siteId,
        SECUAI_SITE_INGESTION_KEY: input.ingestionKey,
        SECUAI_SITE_PORT: String(input.sitePort),
        SECUAI_REPORT_REQUEST_LOGS: "true",
        SECUAI_REPORT_REQUEST_LOG_SCOPE: "monitor"
      }
    });

    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0 || code === null) {
        resolvePromise();
        return;
      }

      rejectPromise(new OnboardingError("native demo 启动后异常退出。", { code }));
    });
  });
}

async function main(): Promise<void> {
  await ensureApiReady();

  printSection("开始创建最小真实接入样板所需的用户、tenant 和 site");

  const registerData = expectSuccess<{ user: { id: string } }>(
    await apiRequest("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: onboardingEmail,
        password: onboardingPassword,
        displayName: onboardingDisplayName
      }
    }),
    "register onboarding user"
  );

  const loginData = expectSuccess<{ token: string }>(
    await apiRequest("/api/v1/auth/login", {
      method: "POST",
      body: {
        email: onboardingEmail,
        password: onboardingPassword
      }
    }),
    "login onboarding user"
  );

  const tenantData = expectSuccess<{ tenant: { id: string } }>(
    await apiRequest("/api/v1/tenants", {
      method: "POST",
      token: loginData.token,
      body: {
        name: tenantName,
        slug: tenantSlug
      }
    }),
    "create onboarding tenant"
  );

  const siteData = expectSuccess<{
    site: { id: string; domain: string };
    ingestionKey: string;
  }>(
    await apiRequest("/api/v1/sites", {
      method: "POST",
      token: loginData.token,
      body: {
        tenantId: tenantData.tenant.id,
        name: siteName,
        domain: siteDomain
      }
    }),
    "create onboarding site"
  );

  printSection("site onboarding 已完成");
  console.log(`邮箱: ${onboardingEmail}`);
  console.log(`密码: ${onboardingPassword}`);
  console.log(`tenantId: ${tenantData.tenant.id}`);
  console.log(`siteId: ${siteData.site.id}`);
  console.log(`ingestionKey: ${siteData.ingestionKey}`);
  console.log(`domain: ${siteData.site.domain}`);

  const envFileContent = buildEnvFileContent({
    platformBaseUrl,
    siteId: siteData.site.id,
    ingestionKey: siteData.ingestionKey,
    sitePort
  });

  await writeNativeDemoEnvFile(envFileContent);

  printSection("已自动写入 packages/site-middleware/.env");
  console.log(envFilePath);
  console.log("-----BEGIN SECUAI NATIVE DEMO ENV-----");
  process.stdout.write(envFileContent);
  console.log("-----END SECUAI NATIVE DEMO ENV-----");

  printSection("最短接入顺序");
  console.log("1. npm run dev:demo-stack");
  console.log("2. npm run build --workspace @secuai/site-middleware");
  console.log("3. npm run demo:onboard-native-site --workspace @secuai/site-middleware");
  console.log("4. 当前脚本会自动写入 .env 并拉起 demo:native-node");
  console.log("5. 先验证 allow，再验证 monitor，最后只切 policy mode 到 protect 验证 403");

  printSection("如果你只是想先确认整条链路能不能自己跑通");
  console.log("不要混用这条 onboarding 路径和 demo:e2e-monitor。");
  console.log("前者用于拿真实 siteId / ingestionKey，后者用于整链路演示。");

  console.log(`\n[onboard-native-site] userId=${registerData.user.id}`);
  printSection("native demo 即将启动");
  console.log("如需结束本次最小接入验证，直接在当前终端按 Ctrl+C。");
  await runNativeDemo({
    platformBaseUrl,
    siteId: siteData.site.id,
    ingestionKey: siteData.ingestionKey,
    sitePort
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));

  if (error instanceof OnboardingError && error.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }

  process.exit(1);
});
