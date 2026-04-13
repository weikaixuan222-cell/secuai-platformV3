import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveDockerComposeCommand } from './docker-compose-command.mjs';

const cwd = process.cwd();
const isWindows = process.platform === 'win32';
const host = process.env.HOST ?? '127.0.0.1';
const apiPort = process.env.API_PORT ?? '3201';
const webPort = process.env.WEB_PORT ?? '3200';
const postgresPort = process.env.POSTGRES_PORT ?? '55432';
const redisPort = process.env.REDIS_PORT ?? '6379';
const databaseUrl =
  process.env.DATABASE_URL ??
  `postgresql://secuai:secuai_dev_password@127.0.0.1:${postgresPort}/secuai`;
const apiUrl = `http://${host}:${apiPort}`;
const webUrl = `http://${host}:${webPort}`;
const dockerComposeCommand = resolveDockerComposeCommand();

/** @type {import('node:child_process').ChildProcess[]} */
const childProcesses = [];

function createCommand(command, args) {
  if (!isWindows) {
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
        POSTGRES_PORT: postgresPort,
        REDIS_PORT: redisPort,
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

function startLongRunningProcess(command, args, extraEnv = {}) {
  const childSpec = createCommand(command, args);
  const child = spawn(childSpec.command, childSpec.args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      POSTGRES_PORT: postgresPort,
      REDIS_PORT: redisPort,
      DATABASE_URL: databaseUrl,
      ...extraEnv
    }
  });

  childProcesses.push(child);
  child.once('error', (error) => {
    console.error(error.stack || error.message || String(error));
    shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (signal || code !== 0) {
      console.error(
        `[start-demo-stack] 子进程异常退出：${command} ${args.join(' ')} code=${code ?? 'null'} signal=${signal ?? 'null'}`
      );
      shutdown(code ?? 1);
    }
  });

  return child;
}

async function waitForHttpReady(url, label) {
  const timeoutMs = 90_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`[start-demo-stack] ${label} 已就绪：${url}`);
        return;
      }
    } catch {
      // 服务尚未完成启动，继续轮询
    }

    await delay(1_000);
  }

  throw new Error(`${label} 未在 ${timeoutMs / 1000} 秒内就绪：${url}`);
}

function terminateChild(child) {
  if (!child.pid || child.killed) {
    return;
  }

  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore'
    });
    return;
  }

  child.kill('SIGTERM');
}

function shutdown(exitCode = 0) {
  for (const child of childProcesses) {
    terminateChild(child);
  }

  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  console.log('[start-demo-stack] 启动最小演示栈...');
  console.log(`[start-demo-stack] PostgreSQL 端口：${postgresPort}`);
  console.log(`[start-demo-stack] Redis 端口：${redisPort}`);
  console.log(`[start-demo-stack] API 地址：${apiUrl}`);
  console.log(`[start-demo-stack] Web 地址：${webUrl}`);

  console.log(
    `[start-demo-stack] Docker Compose 命令：${dockerComposeCommand.command} ${dockerComposeCommand.args.join(' ')}`
  );

  await runCommand(
    dockerComposeCommand.command,
    [...dockerComposeCommand.args, 'up', '-d', 'postgres', 'redis']
  );
  await runCommand('npm', ['run', 'db:schema', '--workspace', '@secuai/api']);

  startLongRunningProcess('npm', ['run', 'dev', '--workspace', '@secuai/api'], {
    HOST: host,
    PORT: apiPort,
    DB_SSL_MODE: process.env.DB_SSL_MODE ?? 'disable',
    AI_ANALYZER_URL: process.env.AI_ANALYZER_URL ?? 'http://127.0.0.1:8000',
    AI_ANALYZER_TIMEOUT_MS: process.env.AI_ANALYZER_TIMEOUT_MS ?? '1500',
    AI_ANALYZER_MAX_RETRIES: process.env.AI_ANALYZER_MAX_RETRIES ?? '1'
  });
  await waitForHttpReady(`${apiUrl}/health`, 'API');

  startLongRunningProcess('npm', ['run', 'dev', '--workspace', '@secuai/web'], {
    HOSTNAME: host,
    PORT: webPort,
    API_URL: apiUrl,
    SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE:
      process.env.SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE ?? '1'
  });
  await waitForHttpReady(`${webUrl}/login`, 'Web');

  console.log('[start-demo-stack] 最小演示栈已启动。按 Ctrl+C 可同时关闭 API 与 Web。');

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  shutdown(1);
});
