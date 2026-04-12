import {
  cleanupBrowser,
  launchBrowser,
  requireWebSocket,
  resolveChromeDebugPort,
  waitForHttpOk
} from './smoke-helpers.mjs';

const WEB_BASE_URL = process.env.SECUAI_WEB_BASE_URL || 'http://127.0.0.1:3200';
const DEFAULT_CHROME_DEBUG_PORT = 9224;
const probeId = `probe-${Date.now()}`;
const SMOKE_PATH = `/error-boundary-smoke?trigger=1&probeId=${probeId}`;

async function openCdpTarget(chromeDebugPort) {
  const response = await fetch(
    `http://127.0.0.1:${chromeDebugPort}/json/new?about:blank`,
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

async function runSmoke(chromeDebugPort) {
  const client = await createCdpClient(await openCdpTarget(chromeDebugPort));
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

  const chromeDebugPort = await resolveChromeDebugPort(DEFAULT_CHROME_DEBUG_PORT);
  const { browserProcess, profileDir } = await launchBrowser({
    debugPort: chromeDebugPort,
    profilePrefix: 'secuai-global-error-smoke-'
  });

  try {
    await waitForHttpOk(
      `http://127.0.0.1:${chromeDebugPort}/json/version`,
      'Chrome DevTools'
    );

    const result = await runSmoke(chromeDebugPort);
    assertSmokeResult(result);

    console.log(JSON.stringify({
      ok: true,
      route: SMOKE_PATH,
      result
    }, null, 2));
  } finally {
    await cleanupBrowser({
      browserProcess,
      profileDir
    });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
