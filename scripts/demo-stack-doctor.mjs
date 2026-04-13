import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const cwd = process.cwd();
const apiBaseUrl = process.env.SECUAI_API_BASE_URL ?? 'http://127.0.0.1:3201';
const webBaseUrl = process.env.SECUAI_WEB_BASE_URL ?? 'http://127.0.0.1:3200';
const postgresPort = process.env.POSTGRES_PORT ?? '55432';
const redisPort = process.env.REDIS_PORT ?? '6379';
const databaseUrl =
  process.env.DATABASE_URL ??
  `postgresql://secuai:secuai_dev_password@127.0.0.1:${postgresPort}/secuai`;

function checkTcpPort(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port) });

    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.setTimeout(2_000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function checkHttpOk(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // 继续重试，避免刚启动完成时误判
    }

    await delay(500);
  }

  return false;
}

function printFailure(title, steps) {
  console.error(`[demo-stack-doctor] ${title}`);
  for (const step of steps) {
    console.error(`[demo-stack-doctor] - ${step}`);
  }
}

async function main() {
  console.log('[demo-stack-doctor] 开始执行最小排查...');
  console.log(`[demo-stack-doctor] API: ${apiBaseUrl}`);
  console.log(`[demo-stack-doctor] Web: ${webBaseUrl}`);
  console.log(`[demo-stack-doctor] PostgreSQL 端口: ${postgresPort}`);
  console.log(`[demo-stack-doctor] Redis 端口: ${redisPort}`);

  const postgresReady = await checkTcpPort('127.0.0.1', postgresPort);
  const redisReady = await checkTcpPort('127.0.0.1', redisPort);

  if (!postgresReady || !redisReady) {
    printFailure('基础依赖未就绪。', [
      '先执行 npm run dev:demo-stack',
      '如果仍失败，先确认 docker compose up -d postgres redis 或 docker-compose up -d postgres redis 是否成功',
      '再确认 npm run db:schema --workspace @secuai/api 是否成功',
      `当前探测结果：postgres=${postgresReady ? 'ready' : 'down'} redis=${redisReady ? 'ready' : 'down'}`
    ]);
    process.exit(1);
  }

  const apiReady = await checkHttpOk(`${apiBaseUrl}/health`);
  if (!apiReady) {
    printFailure('API 未就绪。', [
      '先确认 npm run dev:demo-stack 没有提前退出',
      '如果 API 仍不可用，先单独执行 npm run db:schema --workspace @secuai/api',
      '再重新执行 npm run dev:demo-stack',
      `当前探测地址：${apiBaseUrl}/health`
    ]);
    process.exit(1);
  }

  const webReady = await checkHttpOk(`${webBaseUrl}/login`);
  if (!webReady) {
    printFailure('Web 未就绪。', [
      '先确认 API /health 已通过',
      '再确认 npm run dev:demo-stack 没有提前退出',
      '如果只有 Web 页面异常，再检查 Web 启动时的 API_URL 是否仍指向 API',
      `当前探测地址：${webBaseUrl}/login`
    ]);
    process.exit(1);
  }

  console.log('[demo-stack-doctor] 基础依赖、API、Web 都已 ready。');
  console.log('[demo-stack-doctor] 如果刚才是 smoke:demo-stack-ready 失败，请只重跑失败项：');
  console.log('[demo-stack-doctor] - npm run smoke:acceptance --workspace @secuai/api');
  console.log('[demo-stack-doctor] - npm run smoke:stage2-minimal-defense --workspace @secuai/api');
  console.log('[demo-stack-doctor] - npm run smoke:dashboard-events --workspace @secuai/web');
  console.log('[demo-stack-doctor] - npm run smoke:dashboard-policies --workspace @secuai/web');
  console.log('[demo-stack-doctor] 不要直接整套命令一起盲目重跑。');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
