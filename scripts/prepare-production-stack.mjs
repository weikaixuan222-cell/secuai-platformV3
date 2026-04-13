import 'dotenv/config';

import { spawn } from 'node:child_process';

import { resolveDockerComposeCommand } from './docker-compose-command.mjs';
import { resolveProductionConfig } from './production-config.mjs';

const cwd = process.cwd();
const isWindows = process.platform === 'win32';
const dockerComposeCommand = resolveDockerComposeCommand();
const config = resolveProductionConfig(process.env);

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
        POSTGRES_PORT: config.postgresPort,
        REDIS_PORT: config.redisPort,
        DATABASE_URL: config.databaseUrl,
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

async function main() {
  console.log('[prepare-production-stack] 启动 PostgreSQL 与 Redis...');
  await runCommand(dockerComposeCommand.command, [
    ...dockerComposeCommand.args,
    'up',
    '-d',
    'postgres',
    'redis'
  ]);

  console.log('[prepare-production-stack] 执行数据库 schema...');
  await runCommand('npm', ['run', 'db:schema', '--workspace', '@secuai/api']);

  console.log('[prepare-production-stack] 构建 API...');
  await runCommand('npm', ['run', 'build', '--workspace', '@secuai/api']);

  console.log('[prepare-production-stack] 构建 Web...');
  await runCommand('npm', ['run', 'build', '--workspace', '@secuai/web']);

  console.log('[prepare-production-stack] 生产构建准备完成。');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
