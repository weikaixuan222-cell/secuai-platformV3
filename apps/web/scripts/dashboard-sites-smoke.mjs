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
const DEFAULT_CHROME_DEBUG_PORT = 9225;

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const payload = await response.json();

  if (!response.ok || payload.success === false) {
    const error = payload.error || {};
    throw new Error(
      `${options.method || 'GET'} ${url} failed: ${error.code || response.status} ${error.message || ''}`.trim()
    );
  }

  return payload.data;
}

async function bootstrapSiteManagementContext() {
  const suffix = Date.now();
  const email = `site-smoke-${suffix}@example.com`;
  const password = 'StrongPass123';

  await requestJson(`${API_BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      displayName: `Site Smoke ${suffix}`
    })
  });

  const loginData = await requestJson(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password
    })
  });

  return {
    token: loginData.token,
    tenantId: loginData.memberships[0].tenantId
  };
}

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
      await send('Network.enable');
    },
    send,
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
  await waitForHttpOk(`${WEB_BASE_URL}/dashboard/sites`, 'Web site management page');

  const context = await bootstrapSiteManagementContext();
  const chromeDebugPort = await resolveChromeDebugPort(DEFAULT_CHROME_DEBUG_PORT);
  const browser = await launchBrowser({
    debugPort: chromeDebugPort,
    profilePrefix: 'secuai-site-management-'
  });

  try {
    const client = await createCdpClient(await openCdpTarget(chromeDebugPort));
    await client.init();

    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        localStorage.setItem('secuai_token', ${JSON.stringify(context.token)});
        localStorage.setItem('secuai_tenant_id', ${JSON.stringify(context.tenantId)});
      `
    });

    await client.navigate(`${WEB_BASE_URL}/dashboard/sites`);
    await client.waitFor(
      `location.pathname === '/dashboard/sites' &&
       document.querySelector('[data-testid="site-management-page"]')?.dataset.hydrated === 'true'`
    );

    const initialState = await client.evaluate(`(() => ({
      pageUrl: location.pathname + location.search,
      hasEmptyState: Boolean(document.querySelector('[data-testid="site-list-empty-state"]')),
      modeText: document.querySelector('[data-testid="site-form-mode"]')?.textContent?.trim() || '',
      hasDeleteSection: Boolean(document.querySelector('[data-testid="site-delete-section"]'))
    }))()`);

    assert.equal(initialState.pageUrl, '/dashboard/sites');
    assert.equal(initialState.hasEmptyState, true);
    assert.equal(initialState.hasDeleteSection, false);
    assert.equal(initialState.modeText.length > 0, true);

    await clickElement(client, '[data-testid="site-submit-button"]');
    await client.waitFor(
      `Boolean(document.querySelector('[data-testid="site-name-error"]')) &&
       Boolean(document.querySelector('[data-testid="site-domain-error"]'))`
    );

    const emptyErrors = await client.evaluate(`(() => ({
      name: document.querySelector('[data-testid="site-name-error"]')?.textContent?.trim() || '',
      domain: document.querySelector('[data-testid="site-domain-error"]')?.textContent?.trim() || ''
    }))()`);

    assert.equal(emptyErrors.name.length > 0, true);
    assert.equal(emptyErrors.domain.length > 0, true);

    const suffix = Date.now();
    await setInputValue(client, '[data-testid="site-name-input"]', `Smoke Site ${suffix}`);
    await setInputValue(client, '[data-testid="site-domain-input"]', `smoke-${suffix}.example.com`);
    await clickElement(client, '[data-testid="site-submit-button"]');

    await client.waitFor(
      `location.pathname === '/dashboard/sites' &&
       Boolean(new URLSearchParams(location.search).get('siteId')) &&
       document.querySelector('[data-testid="site-feedback-banner"]')?.dataset.feedbackState === 'success' &&
       Boolean(document.querySelector('[data-testid="site-next-step-panel"]'))`
    );

    const createdState = await client.evaluate(`(() => {
      const siteId = new URLSearchParams(location.search).get('siteId') || '';
      return {
        siteId,
        ingestionKey: document.querySelector('[data-testid="site-ingestion-key-output"]')?.textContent?.trim() || '',
        policyHref: document.querySelector('[data-testid="site-next-policy-link"]')?.getAttribute('href') || '',
        eventsHref: document.querySelector('[data-testid="site-next-events-link"]')?.getAttribute('href') || '',
        hasDeleteSection: Boolean(document.querySelector('[data-testid="site-delete-section"]')),
        hasStatusSelect: Boolean(document.querySelector('[data-testid="site-status-select"]'))
      };
    })()`);

    assert.equal(createdState.siteId.length > 0, true);
    assert.equal(createdState.ingestionKey.length > 0, true);
    assert.equal(
      createdState.policyHref,
      `/dashboard/policies?siteId=${encodeURIComponent(createdState.siteId)}`
    );
    assert.equal(
      createdState.eventsHref,
      `/dashboard/events?siteId=${encodeURIComponent(createdState.siteId)}`
    );
    assert.equal(createdState.hasDeleteSection, true);
    assert.equal(createdState.hasStatusSelect, true);

    await setInputValue(client, '[data-testid="site-name-input"]', `Smoke Site Updated ${suffix}`);
    await setInputValue(client, '[data-testid="site-domain-input"]', `updated-smoke-${suffix}.example.com`);
    await client.evaluate(`(() => {
      const select = document.querySelector('[data-testid="site-status-select"]');
      if (!select) return false;
      select.value = 'inactive';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await clickElement(client, '[data-testid="site-submit-button"]');

    await client.waitFor(
      `document.querySelector('[data-testid="site-feedback-banner"]')?.dataset.feedbackState === 'success' &&
       document.querySelector('[data-testid="site-status-select"]')?.value === 'inactive' &&
       document.querySelector('[data-selected-state="active"]')?.textContent?.includes('updated-smoke-${suffix}.example.com')`
    );

    const updatedState = await client.evaluate(`(() => ({
      selectedText: document.querySelector('[data-selected-state="active"]')?.textContent?.trim() || '',
      statusValue: document.querySelector('[data-testid="site-status-select"]')?.value || '',
      deleteVisible: Boolean(document.querySelector('[data-testid="site-delete-button"]'))
    }))()`);

    assert.equal(updatedState.selectedText.includes(`updated-smoke-${suffix}.example.com`), true);
    assert.equal(updatedState.selectedText.includes('inactive'), true);
    assert.equal(updatedState.statusValue, 'inactive');
    assert.equal(updatedState.deleteVisible, true);

    await clickElement(client, '[data-testid="site-delete-button"]');
    await client.waitFor(`Boolean(document.querySelector('[data-testid="site-delete-confirmation"]'))`);
    await clickElement(client, '[data-testid="site-delete-confirm-button"]');

    await client.waitFor(
      `location.pathname === '/dashboard/sites' &&
       location.search === '' &&
       document.querySelector('[data-testid="site-feedback-banner"]')?.dataset.feedbackState === 'success' &&
       Boolean(document.querySelector('[data-testid="site-list-empty-state"]')) &&
       !document.querySelector('[data-testid="site-delete-section"]')`
    );

    const deletedState = await client.evaluate(`(() => ({
      pageUrl: location.pathname + location.search,
      hasEmptyState: Boolean(document.querySelector('[data-testid="site-list-empty-state"]')),
      hasDeleteSection: Boolean(document.querySelector('[data-testid="site-delete-section"]')),
      formMode: document.querySelector('[data-testid="site-form-mode"]')?.textContent?.trim() || ''
    }))()`);

    assert.equal(deletedState.pageUrl, '/dashboard/sites');
    assert.equal(deletedState.hasEmptyState, true);
    assert.equal(deletedState.hasDeleteSection, false);
    assert.equal(deletedState.formMode.length > 0, true);

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
