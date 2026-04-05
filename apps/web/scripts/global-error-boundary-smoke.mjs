import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const WEB_BASE_URL = process.env.SECUAI_WEB_BASE_URL || 'http://127.0.0.1:3200';
const CHROME_DEBUG_PORT = Number(process.env.SECUAI_CHROME_DEBUG_PORT || 9224);
const probeId = `probe-${Date.now()}`;
const SMOKE_PATH = `/error-boundary-smoke?trigger=1&probeId=${probeId}`;

const chromeCandidates = [
  process.env.SECUAI_CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

function requireWebSocket() {
  if (typeof WebSocket === 'undefined') {
    throw new Error('Global WebSocket is unavailable in this Node.js runtime.');
  }
}

async function waitForHttpOk(url, label) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the web app becomes ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`${label} is not ready: ${url}`);
}

async function resolveChromePath() {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known Chrome/Edge executable.
    }
  }

  return '';
}

async function launchChrome() {
  const chromePath = await resolveChromePath();

  if (!chromePath) {
    throw new Error('Chrome/Edge executable was not found.');
  }

  const profileDir = await mkdtemp(path.join(tmpdir(), 'secuai-global-error-smoke-'));
  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ], {
    stdio: 'ignore'
  });

  return {
    chromeProcess,
    profileDir
  };
}

async function cleanupChrome(chromeProcess, profileDir) {
  if (chromeProcess.exitCode === null && !chromeProcess.killed) {
    chromeProcess.kill('SIGKILL');
  }

  try {
    if (chromeProcess.exitCode === null) {
      await Promise.race([
        once(chromeProcess, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]);
    }
  } catch {
    // Continue with best-effort profile cleanup.
  }

  await rm(profileDir, {
    recursive: true,
    force: true
  });
}

async function openCdpTarget() {
  const response = await fetch(
    `http://127.0.0.1:${CHROME_DEBUG_PORT}/json/new?about:blank`,
    {
      method: 'PUT'
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to create CDP target: ${response.status}`);
  }

  const target = await response.json();
  return target.webSocketDebuggerUrl;
}

async function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  ws.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);

    if (!payload.id) {
      return;
    }

    const request = pending.get(payload.id);
    if (!request) {
      return;
    }

    pending.delete(payload.id);

    if (payload.error) {
      request.reject(new Error(payload.error.message || JSON.stringify(payload.error)));
      return;
    }

    request.resolve(payload.result || {});
  });

  function send(method, params = {}) {
    const id = nextId;
    nextId += 1;
    ws.send(JSON.stringify({ id, method, params }));

    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) {
          return;
        }

        pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 20000);
    });
  }

  return {
    async init() {
      await send('Page.enable');
      await send('Runtime.enable');
    },
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      return result.result?.value;
    },
    async navigate(url) {
      await send('Page.navigate', { url });
    },
    async waitFor(expression, timeoutMs = 20000) {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const value = await this.evaluate(expression);

        if (value) {
          return value;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      throw new Error(`Timed out waiting for expression: ${expression}`);
    },
    close() {
      ws.close();
    }
  };
}

async function runSmoke() {
  const client = await createCdpClient(await openCdpTarget());
  await client.init();

  await client.navigate(`${WEB_BASE_URL}${SMOKE_PATH}`);
  await client.waitFor(
    `document.querySelector('[data-testid="global-error-retry"]')?.textContent?.includes('重试加载当前页面') && document.querySelector('[data-testid="global-error-retry"]')?.getAttribute('data-retry-ready') === 'true' && document.querySelector('[data-testid="global-error-retry"]')?.disabled === false`
  );

  const errorState = await client.evaluate(`(() => ({
    title: document.querySelector('[data-testid="global-error-title"]')?.textContent?.trim() || '',
    description: document.querySelector('[data-testid="global-error-description"]')?.textContent?.trim() || '',
    message: document.querySelector('[data-testid="global-error-message"]')?.textContent?.trim() || '',
    retryText: document.querySelector('[data-testid="global-error-retry"]')?.textContent?.trim() || '',
    role: document.querySelector('[data-testid="global-error-message"]')?.getAttribute('role') || '',
    ariaLive: document.querySelector('[data-testid="global-error-message"]')?.getAttribute('aria-live') || ''
  }))()`);

  await client.evaluate(`
    document.querySelector('[data-testid="global-error-retry"]')?.click();
  `);

  await client.waitFor(
    `document.querySelector('[data-testid="error-boundary-smoke-title"]')?.textContent?.includes('错误边界已恢复')`
  );

  const recoveredState = await client.evaluate(`(() => ({
    title: document.querySelector('[data-testid="error-boundary-smoke-title"]')?.textContent?.trim() || '',
    description: document.querySelector('[data-testid="error-boundary-smoke-description"]')?.textContent?.trim() || '',
    loginHref: document.querySelector('[data-testid="error-boundary-smoke-login-link"]')?.getAttribute('href') || '',
    pageUrl: location.pathname + location.search
  }))()`);

  client.close();

  return {
    errorState,
    recoveredState
  };
}

function assertSmokeResult(result) {
  const hasExpectedErrorMessage =
    result.errorState.message === 'Global error boundary smoke trigger' ||
    (
      result.errorState.message.includes('An error occurred in the Server Components render') &&
      result.errorState.message.includes('digest')
    );

  if (
    result.errorState.title !== '控制台页面加载失败' ||
    !result.errorState.description.includes('重试加载当前页面') ||
    !hasExpectedErrorMessage ||
    result.errorState.retryText !== '重试加载当前页面' ||
    result.errorState.role !== 'alert' ||
    result.errorState.ariaLive !== 'assertive'
  ) {
    throw new Error(`Global error page state verification failed: ${JSON.stringify(result.errorState)}`);
  }

  if (
    result.recoveredState.title !== '错误边界已恢复' ||
    !result.recoveredState.description.includes(probeId) ||
    !result.recoveredState.description.includes('仅用于开发环境下验证') ||
    result.recoveredState.loginHref !== '/login' ||
    result.recoveredState.pageUrl !== SMOKE_PATH
  ) {
    throw new Error(`Global error recovery verification failed: ${JSON.stringify(result.recoveredState)}`);
  }
}

async function main() {
  requireWebSocket();
  await waitForHttpOk(`${WEB_BASE_URL}/login`, 'Web');

  const { chromeProcess, profileDir } = await launchChrome();

  try {
    await waitForHttpOk(
      `http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`,
      'Chrome DevTools'
    );

    const result = await runSmoke();
    assertSmokeResult(result);

    console.log(JSON.stringify({
      ok: true,
      route: SMOKE_PATH,
      result
    }, null, 2));
  } finally {
    await cleanupChrome(chromeProcess, profileDir);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
