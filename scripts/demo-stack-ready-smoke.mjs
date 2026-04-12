import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const cwd = process.cwd();
const apiBaseUrl = process.env.SECUAI_API_BASE_URL ?? 'http://127.0.0.1:3201';
const webBaseUrl = process.env.SECUAI_WEB_BASE_URL ?? 'http://127.0.0.1:3200';
const postgresPort = process.env.POSTGRES_PORT ?? '55432';
const databaseUrl =
  process.env.DATABASE_URL ??
  `postgresql://secuai:secuai_dev_password@127.0.0.1:${postgresPort}/secuai`;

function createCommand(command, args) {
  if (process.platform !== 'win32') {
    return { command, args };
  }

  const escaped = [command, ...args]
    .map((part) => (/\s/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part))
    .join(' ');

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', escaped]
  };
}

function runCommand(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const childSpec = createCommand(command, args);
    const child = spawn(childSpec.command, childSpec.args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        SECUAI_API_BASE_URL: apiBaseUrl,
        SECUAI_WEB_BASE_URL: webBaseUrl,
        POSTGRES_PORT: postgresPort,
        DATABASE_URL: databaseUrl,
        ...extraEnv
      }
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'null'}`));
    });
  });
}

async function waitForHttpOk(url, label) {
  const timeoutMs = 60_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`[demo-stack-ready] ${label} 已就绪：${url}`);
        return;
      }
    } catch {
      // 服务尚未完成启动，继续轮询
    }

    await delay(1_000);
  }

  throw new Error(`${label} 未在 ${timeoutMs / 1000} 秒内就绪：${url}`);
}

async function main() {
  console.log('[demo-stack-ready] 开始执行演示前自检...');
  console.log(`[demo-stack-ready] API: ${apiBaseUrl}`);
  console.log(`[demo-stack-ready] Web: ${webBaseUrl}`);
  console.log(`[demo-stack-ready] PostgreSQL 端口: ${postgresPort}`);

  await waitForHttpOk(`${apiBaseUrl}/health`, 'API health');
  await waitForHttpOk(`${webBaseUrl}/login`, 'Web login');

  await runCommand('npm', ['run', 'smoke:acceptance', '--workspace', '@secuai/api']);
  await runCommand('npm', ['run', 'smoke:stage2-minimal-defense', '--workspace', '@secuai/api']);
  await runCommand('npm', ['run', 'smoke:dashboard-events', '--workspace', '@secuai/web']);
  await runCommand('npm', ['run', 'smoke:dashboard-policies', '--workspace', '@secuai/web']);

  console.log('[demo-stack-ready] 演示前自检通过。');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
