import 'dotenv/config';

import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { resolveProductionConfig } from './production-config.mjs';

const config = resolveProductionConfig(process.env);

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
      // 服务尚未 ready，继续重试。
    }

    await delay(500);
  }

  return false;
}

function printFailure(title, steps) {
  console.error(`[production-stack-doctor] ${title}`);
  for (const step of steps) {
    console.error(`[production-stack-doctor] - ${step}`);
  }
}

async function main() {
  console.log('[production-stack-doctor] 开始检查生产部署主路径...');
  console.log(`[production-stack-doctor] API: http://${config.apiHost}:${config.apiPort}`);
  console.log(`[production-stack-doctor] Web: http://${config.webHost}:${config.webPort}`);
  console.log(`[production-stack-doctor] PostgreSQL 端口: ${config.postgresPort}`);
  console.log(`[production-stack-doctor] Redis 端口: ${config.redisPort}`);

  const postgresReady = await checkTcpPort('127.0.0.1', config.postgresPort);
  const redisReady = await checkTcpPort('127.0.0.1', config.redisPort);

  if (!postgresReady || !redisReady) {
    printFailure('基础依赖未就绪。', [
      '先执行 npm run prod:prepare',
      `当前探测结果：postgres=${postgresReady ? 'ready' : 'down'} redis=${redisReady ? 'ready' : 'down'}`
    ]);
    process.exit(1);
  }

  const apiReady = await checkHttpOk(`http://${config.apiHost}:${config.apiPort}/health`);
  if (!apiReady) {
    printFailure('API 未就绪。', [
      '先执行 npm run prod:start 或 pm2 restart deploy/pm2/ecosystem.config.cjs --update-env',
      '再检查 pm2 logs secuai-api',
      `当前探测地址：http://${config.apiHost}:${config.apiPort}/health`
    ]);
    process.exit(1);
  }

  const webReady = await checkHttpOk(`http://${config.webHost}:${config.webPort}/login`);
  if (!webReady) {
    printFailure('Web 未就绪。', [
      '先检查 npm run build --workspace @secuai/web 是否成功',
      '再检查 pm2 logs secuai-web',
      `当前探测地址：http://${config.webHost}:${config.webPort}/login`
    ]);
    process.exit(1);
  }

  console.log('[production-stack-doctor] API /health 与 Web /login 均已就绪。');
  console.log('[production-stack-doctor] 如需对外访问，请继续执行 sudo nginx -t 并重载 Nginx。');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
