import assert from 'node:assert/strict';

import {
  cleanupBrowser,
  launchBrowser,
  requireWebSocket,
  resolveChromeDebugPort,
  waitForHttpOk
} from './smoke-helpers.mjs';

const API_BASE_URL = process.env.SECUAI_API_BASE_URL || 'http://127.0.0.1:3201';
const WEB_BASE_URL = process.env.SECUAI_WEB_BASE_URL || 'http://127.0.0.1:3200';
const DEFAULT_CHROME_DEBUG_PORT = 9224;

async function openCdpTarget(chromeDebugPort) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 15000) {
    try {
      const response = await fetch(`http://127.0.0.1:${chromeDebugPort}/json/new?about:blank`, {
        method: 'PUT'
      });

      if (!response.ok) {
        throw new Error(`Failed to create CDP target: ${response.status}`);
      }

      const target = await response.json();
      return target.webSocketDebuggerUrl;
    } catch (error) {
      if (Date.now() - startedAt >= 15000) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Timed out waiting for CDP target on port ${chromeDebugPort}.`);
}

async function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const consoleErrors = [];
  const runtimeFailures = [];
  let nextId = 1;

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  ws.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);

    if (payload.id) {
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
      return;
    }

    if (payload.method === 'Runtime.consoleAPICalled' && payload.params?.type === 'error') {
      consoleErrors.push(
        payload.params.args
          .map((item) => item.value || item.description || '')
          .join(' ')
      );
    }

    if (payload.method === 'Runtime.exceptionThrown') {
      runtimeFailures.push(
        `Runtime exception: ${payload.params?.exceptionDetails?.text || 'unknown'}`
      );
    }

    if (payload.method === 'Network.loadingFailed') {
      const errorText = String(payload.params?.errorText || '');
      const blockedReason = String(payload.params?.blockedReason || '');

      if (errorText !== 'net::ERR_ABORTED' && !blockedReason.includes('favicon')) {
        runtimeFailures.push(`Network failed: ${errorText}`);
      }
    }

    if (
      payload.method === 'Network.responseReceived' &&
      payload.params?.response?.status >= 400 &&
      !String(payload.params.response.url || '').includes('favicon')
    ) {
      runtimeFailures.push(
        `HTTP ${payload.params.response.status}: ${String(payload.params.response.url || '')}`
      );
    }
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

  function isTransientNavigationError(error) {
    return String(error?.message || error).includes('Inspected target navigated or closed');
  }

  return {
    async init() {
      await send('Page.enable');
      await send('Runtime.enable');
      await send('Network.enable');
    },
    async evaluate(expression) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const result = await send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true
          });
          return result.result?.value;
        } catch (error) {
          if (!isTransientNavigationError(error) || attempt === 9) {
            throw error;
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      throw new Error('Runtime.evaluate exhausted retry attempts.');
    },
    async navigate(url) {
      await send('Page.navigate', { url });
    },
    async waitFor(expression, timeoutMs = 20000) {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        let value;

        try {
          value = await this.evaluate(expression);
        } catch (error) {
          if (!isTransientNavigationError(error)) {
            throw error;
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }

        if (value) {
          return value;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      throw new Error(`Timed out waiting for expression: ${expression}`);
    },
    assertNoBrowserErrors() {
      if (consoleErrors.length > 0) {
        throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
      }

      if (runtimeFailures.length > 0) {
        throw new Error(`Runtime/network failures: ${runtimeFailures.join(' | ')}`);
      }
    },
    close() {
      ws.close();
    }
  };
}

async function setInputValue(client, selector, value) {
  const updated = await client.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});

    if (!input) {
      return false;
    }

    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);

  if (!updated) {
    throw new Error(`Input not found: ${selector}`);
  }
}

async function clickElement(client, selector) {
  const clicked = await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});

    if (!element) {
      return false;
    }

    element.click();
    return true;
  })()`);

  if (!clicked) {
    throw new Error(`Element not found: ${selector}`);
  }
}

async function run() {
  requireWebSocket();
  await waitForHttpOk(`${API_BASE_URL}/health`, 'API');
  await waitForHttpOk(`${WEB_BASE_URL}/register`, 'Web register page');

  const chromeDebugPort = await resolveChromeDebugPort(DEFAULT_CHROME_DEBUG_PORT);
  const browser = await launchBrowser({
    debugPort: chromeDebugPort,
    profilePrefix: 'secuai-auth-register-'
  });

  try {
    const client = await createCdpClient(await openCdpTarget(chromeDebugPort));
    await client.init();

    await client.navigate(`${WEB_BASE_URL}/register`);
    await client.waitFor(
      `location.pathname === '/register' &&
       document.querySelector('[data-testid="register-form"]')?.dataset.hydrated === 'true'`
    );

    const initialState = await client.evaluate(`(() => ({
      title: document.querySelector('[data-testid="auth-page-title"]')?.textContent?.trim() || '',
      helper: document.querySelector('[data-testid="register-helper-text"]')?.textContent?.trim() || '',
      hasLoginLink: Boolean(document.querySelector('[data-testid="register-login-link"]'))
    }))()`);

    assert.equal(initialState.hasLoginLink, true);
    assert.equal(initialState.title.length > 0, true);
    assert.equal(initialState.helper.length > 0, true);

    await clickElement(client, '[data-testid="register-submit-button"]');
    await client.waitFor(
      `Boolean(document.querySelector('[data-testid="register-display-name-error"]')) &&
       Boolean(document.querySelector('[data-testid="register-email-error"]')) &&
       Boolean(document.querySelector('[data-testid="register-password-error"]'))`
    );

    const emptyErrors = await client.evaluate(`(() => ({
      displayName: document.querySelector('[data-testid="register-display-name-error"]')?.textContent?.trim() || '',
      email: document.querySelector('[data-testid="register-email-error"]')?.textContent?.trim() || '',
      password: document.querySelector('[data-testid="register-password-error"]')?.textContent?.trim() || ''
    }))()`);

    assert.equal(emptyErrors.displayName.length > 0, true);
    assert.equal(emptyErrors.email.length > 0, true);
    assert.equal(emptyErrors.password.length > 0, true);

    const suffix = Date.now();
    const email = `register-smoke-${suffix}@example.com`;
    const password = 'StrongPass123';

    await setInputValue(client, '[data-testid="register-display-name-input"]', `Register Smoke ${suffix}`);
    await setInputValue(client, '[data-testid="register-email-input"]', email);
    await setInputValue(client, '[data-testid="register-password-input"]', password);
    await setInputValue(client, '[data-testid="register-confirm-password-input"]', 'Mismatch123');
    await clickElement(client, '[data-testid="register-submit-button"]');

    await client.waitFor(
      `Boolean(document.querySelector('[data-testid="register-confirm-password-error"]'))`
    );

    const mismatchError = await client.evaluate(
      `document.querySelector('[data-testid="register-confirm-password-error"]')?.textContent?.trim() || ''`
    );
    assert.equal(mismatchError.length > 0, true);

    await setInputValue(client, '[data-testid="register-confirm-password-input"]', password);
    await clickElement(client, '[data-testid="register-submit-button"]');

    await client.waitFor(
      `location.pathname === '/login' &&
       new URLSearchParams(location.search).get('registered') === '1' &&
       Boolean(document.querySelector('[data-testid="login-success-alert"]')) &&
       document.querySelector('[data-testid="login-form"]')?.dataset.hydrated === 'true'`
    );

    const loginReadyState = await client.evaluate(`(() => ({
      successText: document.querySelector('[data-testid="login-success-alert"]')?.textContent?.trim() || '',
      emailValue: document.querySelector('[data-testid="login-email-input"]')?.value || '',
      hasRegisterLink: Boolean(document.querySelector('[data-testid="login-register-link"]'))
    }))()`);

    assert.equal(loginReadyState.successText.length > 0, true);
    assert.equal(loginReadyState.emailValue, email);
    assert.equal(loginReadyState.hasRegisterLink, true);

    await setInputValue(client, '[data-testid="login-password-input"]', password);
    await clickElement(client, '[data-testid="login-submit-button"]');

    await client.waitFor(
      `location.pathname === '/dashboard/events' && document.body.textContent.includes('事件')`
    );

    client.assertNoBrowserErrors();
    client.close();
  } finally {
    await cleanupBrowser(browser);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
