import { spawn } from 'node:child_process';

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

function runCommand(command, args) {
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
        DATABASE_URL: databaseUrl
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

function printStep(index, title, items) {
  console.log(`[demo-standard] ${index}. ${title}`);
  for (const item of items) {
    console.log(`[demo-standard]    - ${item}`);
  }
}

async function main() {
  console.log('[demo-standard] 开始执行标准演示流程入口...');
  console.log('[demo-standard] 先执行统一自检，确保演示栈已经 ready。');

  try {
    await runCommand('npm', ['run', 'smoke:demo-stack-ready']);
  } catch {
    console.error('[demo-standard] 标准演示入口中止：统一自检未通过。');
    console.error('[demo-standard] 先执行 npm run doctor:demo-stack，再只重跑失败项。');
    process.exit(1);
  }

  console.log('[demo-standard] 统一自检已通过，按以下固定顺序完成演示：');

  printStep(1, '打开策略页', [
    `浏览器打开 ${webBaseUrl}/dashboard/policies`,
    '确认当前站点安全总览、策略配置、封禁名单、protection simulator 都能正常显示'
  ]);

  printStep(2, '展示 monitor -> protect', [
    '在 simulator 中使用同一条请求输入，先展示 monitor 下的 monitor 结果',
    '再切换到 protect，展示同一输入在 protect 下变成 block'
  ]);

  printStep(3, '展示事件与处置回看', [
    `浏览器打开 ${webBaseUrl}/dashboard/events`,
    '进入事件详情页，说明当前处置对象、当前防护轨迹、关联事件归属',
    '再回到策略页，说明 originKind、isActive、attackEventId 的回看关系'
  ]);

  printStep(4, '展示站点侧最小 enforcement', [
    '执行 npm run smoke:stage2-minimal-defense --workspace @secuai/api',
    '说明 allow / monitor / protect 一致性，以及 blocked_ip、blocked_rate_limit、blockSqlInjection、blockXss 的闭环'
  ]);

  printStep(5, '演示收尾', [
    '如果演示继续联调，保持 dev:demo-stack 终端常驻',
    '如果演示结束，回到 dev:demo-stack 所在终端按 Ctrl+C 统一回收',
    '如果中途失败，先执行 npm run doctor:demo-stack'
  ]);

  console.log('[demo-standard] 标准演示顺序已输出。');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
