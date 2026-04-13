import {
  cleanupBrowser,
  launchBrowser,
  requireWebSocket,
  resolveChromeDebugPort,
  waitForConditionWithAction,
  waitForHttpOk
} from './smoke-helpers.mjs';
import { shouldDelayPolicyRequest } from './dashboard-policies-smoke-helpers.mjs';

const API_BASE_URL = process.env.SECUAI_API_BASE_URL || 'http://127.0.0.1:3201';
const WEB_BASE_URL = process.env.SECUAI_WEB_BASE_URL || 'http://127.0.0.1:3200';
const DEFAULT_CHROME_DEBUG_PORT = 9223;

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

async function reportRequestLog(siteContext, body) {
  await requestJson(`${API_BASE_URL}/api/v1/request-logs`, {
    method: 'POST',
    headers: {
      'x-site-ingestion-key': siteContext.ingestionKey
    },
    body: JSON.stringify({
      siteId: siteContext.siteId,
      occurredAt: new Date().toISOString(),
      method: 'GET',
      host: siteContext.siteDomain,
      statusCode: 200,
      clientIp: '203.0.113.120',
      userAgent: 'Mozilla/5.0 policy-smoke',
      scheme: 'https',
      ...body
    })
  });
}

async function bootstrapAttackEvent(authHeaders, siteContext, tenantId) {
  await reportRequestLog(siteContext, {
    path: '/checkout',
    queryString: 'id=1 UNION SELECT password FROM users'
  });

  await requestJson(`${API_BASE_URL}/api/v1/detection/run`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      tenantId,
      limit: 100
    })
  });

  const attackEvents = await requestJson(
    `${API_BASE_URL}/api/v1/attack-events?tenantId=${tenantId}&siteId=${siteContext.siteId}&eventType=sql_injection&limit=20`,
    {
      headers: authHeaders
    }
  );

  const attackEvent = attackEvents.items?.[0];

  if (!attackEvent) {
    throw new Error('Policy smoke bootstrap did not generate an attack event.');
  }

  return Number(attackEvent.id);
}

async function bootstrapPolicySmokeData() {
  const suffix = Date.now();
  const email = `policy-smoke-${suffix}@example.com`;
  const password = 'StrongPass123';

  await requestJson(`${API_BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      displayName: `Policy Smoke ${suffix}`
    })
  });

  const loginData = await requestJson(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password
    })
  });

  const token = loginData.token;
  const authHeaders = {
    Authorization: `Bearer ${token}`
  };

  const tenantData = await requestJson(`${API_BASE_URL}/api/v1/tenants`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: `Policy Tenant ${suffix}`,
      slug: `policy-${suffix}`
    })
  });
  const tenantId = tenantData.tenant.id;

  const siteData = await requestJson(`${API_BASE_URL}/api/v1/sites`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      tenantId,
      name: `Policy Site ${suffix}`,
      domain: `policy-${suffix}.example.com`
    })
  });

  const siteId = siteData.site.id;
  const policyData = await requestJson(
    `${API_BASE_URL}/api/v1/sites/${siteId}/security-policy`,
    {
      headers: authHeaders
    }
  );
  const blockedList = await requestJson(
    `${API_BASE_URL}/api/v1/sites/${siteId}/blocked-entities`,
    {
      headers: authHeaders
    }
  );
  const attackEventId = await bootstrapAttackEvent(
    authHeaders,
    {
      siteId,
      siteDomain: siteData.site.domain,
      ingestionKey: siteData.ingestionKey
    },
    tenantId
  );

  return {
    token,
    tenantId,
    siteId,
    siteDomain: siteData.site.domain,
    ingestionKey: siteData.ingestionKey,
    attackEventId,
    initialPolicy: policyData.securityPolicy,
    initialBlockedCount: blockedList.items.length,
    authHeaders
  };
}

async function bootstrapNoSitePolicySmokeData() {
  const suffix = Date.now();
  const email = `policy-empty-smoke-${suffix}@example.com`;
  const password = 'StrongPass123';

  await requestJson(`${API_BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      displayName: `Policy Empty Smoke ${suffix}`
    })
  });

  const loginData = await requestJson(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password
    })
  });

  const token = loginData.token;
  const authHeaders = {
    Authorization: `Bearer ${token}`
  };

  const tenantData = await requestJson(`${API_BASE_URL}/api/v1/tenants`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: `Policy Empty Tenant ${suffix}`,
      slug: `policy-empty-${suffix}`
    })
  });

  return {
    token,
    tenantId: tenantData.tenant.id,
    authHeaders
  };
}

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
  const consoleErrors = [];
  const runtimeFailures = [];
  const allowedHttpFailures = [];
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

    if (
      payload.method === 'Runtime.consoleAPICalled' &&
      payload.params?.type === 'error'
    ) {
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
      const responseStatus = payload.params.response.status;
      const responseUrl = String(payload.params.response.url || '');
      const allowlisted = allowedHttpFailures.some((failureRule) =>
        failureRule.statusCode === responseStatus &&
        responseUrl.includes(failureRule.urlPart)
      );

      if (allowlisted) {
        return;
      }

      runtimeFailures.push(
        `HTTP ${responseStatus}: ${responseUrl}`
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
    allowHttpFailure(statusCode, urlPart) {
      allowedHttpFailures.push({ statusCode, urlPart });
    },
    close() {
      ws.close();
    }
  };
}

async function setupPolicyPageSession(client, context) {
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      localStorage.setItem('secuai_token', ${JSON.stringify(context.token)});
      localStorage.setItem('secuai_tenant_id', ${JSON.stringify(context.tenantId)});
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (resource, options = {}) => {
        const url = typeof resource === 'string' ? resource : resource?.url || '';
        const method = String(options.method || 'GET').toUpperCase();

        if (${shouldDelayPolicyRequest.toString()}(method, url)) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }

        return originalFetch(resource, options);
      };
    `
  });
}

async function runNoSiteEmptyStateSmoke(context, chromeDebugPort) {
  const client = await createCdpClient(await openCdpTarget(chromeDebugPort));
  await client.init();
  await setupPolicyPageSession(client, context);

  await client.navigate(`${WEB_BASE_URL}/dashboard/policies`);
  await client.waitFor(
    `location.pathname === '/dashboard/policies' && (
      Boolean(document.querySelector('[data-testid="policy-no-site-empty-state"]')) ||
      Boolean(document.querySelector('[data-testid="policy-save-button"]')) ||
      Boolean(document.querySelector('[data-testid="policy-site-overview"]')) ||
      Boolean(document.querySelector('[data-testid="policy-feedback-banner"]'))
    )`
  );

  const noSiteState = await client.evaluate(`(() => {
    const policyCard = document.querySelector('[data-testid="policy-no-site-empty-state"]');
    const blockedCard = document.querySelector('[data-testid="blocked-entities-no-site-empty-state"]');
    const simulatorCard = document.querySelector('[data-testid="protection-simulator-no-site-empty-state"]');
    return {
      pageUrl: location.pathname + location.search,
      pageText: document.body?.textContent?.trim() || '',
      policyEmptyText: policyCard?.textContent?.trim() || '',
      blockedEmptyText: blockedCard?.textContent?.trim() || '',
      simulatorEmptyText: simulatorCard?.textContent?.trim() || '',
      hasPolicyAction: Boolean(document.querySelector('[data-testid="policy-no-site-empty-action"]')),
      hasBlockedAction: Boolean(document.querySelector('[data-testid="blocked-entities-no-site-empty-action"]')),
      hasSimulatorAction: Boolean(simulatorCard?.querySelector('a,button')),
      hasOverviewPanel: Boolean(document.querySelector('[data-testid="policy-site-overview"]')),
      hasPolicySaveButton: Boolean(document.querySelector('[data-testid="policy-save-button"]')),
      createButtonDisabled: document.querySelector('[data-testid="blocked-entity-create-button"]')?.disabled === true,
      hasSimulatorSubmitButton: Boolean(document.querySelector('[data-testid="protection-simulator-submit-button"]'))
    };
  })()`);

  client.assertNoBrowserErrors();
  client.close();

  return noSiteState;
}

async function runBrowserSmoke(context, chromeDebugPort) {
  const client = await createCdpClient(await openCdpTarget(chromeDebugPort));
  await client.init();

  await setupPolicyPageSession(client, context);

  const pagePath = `/dashboard/policies?siteId=${encodeURIComponent(context.siteId)}`;
  await client.navigate(`${WEB_BASE_URL}${pagePath}`);
  await client.waitFor(
    `location.pathname === '/dashboard/policies' && new URLSearchParams(location.search).get('siteId') === '${context.siteId}' && Boolean(document.querySelector('[data-testid="policy-save-button"]'))`
  );

  const initialPageState = await client.evaluate(`(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    const siteFilter = document.querySelector('[data-testid="policy-site-filter-select"]');
    const simulatorEmptyState = document.querySelector('[data-testid="protection-simulator-empty-state"]');
    const overviewPanel = document.querySelector('[data-testid="policy-site-overview"]');
    const overviewItems = Array.from(
      document.querySelectorAll('[data-testid="policy-site-overview"] [data-testid="policy-site-overview-item"]')
    ).map((item) => item.textContent?.trim() || '');
    const overviewLatest = document.querySelector('[data-testid="policy-site-overview-latest-activity"]');
    const overviewEventsLink = document.querySelector('[data-testid="policy-site-overview-events-link"]');
    const overviewEventsHint = document.querySelector('[data-testid="policy-site-overview-events-hint"]');
    const overviewModeHint = document.querySelector('[data-testid="policy-site-overview-mode-hint"]');
    const overviewLatestHint = document.querySelector('[data-testid="policy-site-overview-latest-hint"]');
    const overviewCountsHint = document.querySelector('[data-testid="policy-site-overview-counts-hint"]');
    return {
      pageUrl: location.pathname + location.search,
      siteSelectValue: selects[0]?.value || '',
      siteFilterDisabled: siteFilter?.disabled === true,
      siteFilterAriaDisabled: siteFilter?.getAttribute('aria-disabled') || '',
      siteFilterAriaBusy: siteFilter?.getAttribute('aria-busy') || '',
      hasSimulatorEmptyState: Boolean(simulatorEmptyState),
      saveButtonState: document.querySelector('[data-testid="policy-save-button"]')?.dataset.loadingState || '',
      createButtonState: document.querySelector('[data-testid="blocked-entity-create-button"]')?.dataset.loadingState || '',
      hasOverviewPanel: Boolean(overviewPanel),
      overviewText: overviewPanel?.textContent?.trim() || '',
      overviewItems,
      latestActivityText: overviewLatest?.textContent?.trim() || '',
      eventsLinkHref: overviewEventsLink?.getAttribute('href') || '',
      eventsLinkText: overviewEventsLink?.textContent?.trim() || '',
      eventsHintText: overviewEventsHint?.textContent?.trim() || '',
      modeHintText: overviewModeHint?.textContent?.trim() || '',
      latestHintText: overviewLatestHint?.textContent?.trim() || '',
      countsHintText: overviewCountsHint?.textContent?.trim() || ''
    };
  })()`);

  const setInputValue = async (selector, value) => {
    await client.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) {
        return false;
      }

      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor?.set) {
        descriptor.set.call(input, ${JSON.stringify(value)});
      } else {
        input.value = ${JSON.stringify(value)};
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  };

  const waitForDeleteButtonLoading = async (deleteTestId) => {
    const startedAt = Date.now();
    let lastState = null;

    while (Date.now() - startedAt < 20000) {
      lastState = await client.evaluate(`(() => {
        const button = document.querySelector('[data-testid="${deleteTestId}"]');
        const banner = document.querySelector('[data-testid="policy-feedback-banner"]');
        return {
          exists: Boolean(button),
          loadingState: button?.dataset.loadingState || '',
          disabled: button?.disabled === true,
          ariaBusy: button?.getAttribute('aria-busy') || '',
          ariaDisabled: button?.getAttribute('aria-disabled') || '',
          panelAriaBusy:
            document.querySelector('[data-testid="blocked-entities-panel"]')?.getAttribute('aria-busy') || '',
          feedbackState: banner?.dataset.feedbackState || '',
          feedbackText: banner?.textContent?.trim() || ''
        };
      })()`);

      if (
        lastState.loadingState === 'deleting' &&
        lastState.disabled &&
        lastState.ariaBusy === 'true'
      ) {
        return {
          loadingState: lastState.loadingState,
          disabled: lastState.disabled,
          ariaBusy: lastState.ariaBusy,
          ariaDisabled: lastState.ariaDisabled,
          panelAriaBusy: lastState.panelAriaBusy
        };
      }

      if (!lastState.exists && lastState.feedbackState === 'success') {
        throw new Error(
          `Delete button finished before deleting state was observable: ${JSON.stringify(lastState)}`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(
      `Timed out waiting for delete loading state: ${deleteTestId} ${JSON.stringify(lastState)}`
    );
  };

  const protectModeActivated = await waitForConditionWithAction({
    action: () =>
      client.evaluate(`
        document.querySelector('[data-testid="policy-mode-protect"]')?.click();
      `),
    check: () =>
      client.evaluate(
        `document.querySelector('[data-testid="policy-mode-protect"]')?.dataset.selectedState === 'active'`
      ),
    timeoutMs: 20000,
    intervalMs: 150
  });

  if (!protectModeActivated) {
    throw new Error(
      "Timed out waiting for policy mode protect to become active after retrying the click."
    );
  }
  await client.evaluate(`
    document.querySelector('[data-testid="policy-rate-limit-input"]')?.removeAttribute('min');
  `);
  await setInputValue('[data-testid="policy-rate-limit-input"]', '0');
  await client.evaluate(
    `document.querySelector('[data-testid="policy-save-button"]')?.click()`
  );
  await client.waitFor(
    `document.querySelector('[data-testid="policy-feedback-banner"]')?.dataset.feedbackState === 'error' && document.querySelector('[data-testid="policy-feedback-banner"]')?.textContent?.trim().length > 0 && document.querySelector('[data-testid="policy-save-button"]')?.dataset.loadingState === 'idle'`
  );
  const policySaveErrorFeedback = await client.evaluate(`(() => {
    const banner = document.querySelector('[data-testid="policy-feedback-banner"]');
    const button = document.querySelector('[data-testid="policy-save-button"]');
    return {
      state: banner?.dataset.feedbackState || '',
      text: banner?.textContent?.trim() || '',
      role: banner?.getAttribute('role') || '',
      ariaLive: banner?.getAttribute('aria-live') || '',
      saveButtonState: button?.dataset.loadingState || '',
      saveButtonDisabled: button?.disabled === true
    };
  })()`);
  await setInputValue('[data-testid="policy-rate-limit-input"]', '88');
  await setInputValue('[data-testid="policy-high-risk-input"]', '91');
  await client.evaluate(
    `document.querySelector('[data-testid="policy-save-button"]')?.click()`
  );
  await client.waitFor(
    `document.querySelector('[data-testid="policy-save-button"]')?.dataset.loadingState === 'saving' && document.querySelector('[data-testid="policy-save-button"]')?.disabled === true`
  );
  const policySavingState = await client.evaluate(`(() => {
    const button = document.querySelector('[data-testid="policy-save-button"]');
    const siteFilter = document.querySelector('[data-testid="policy-site-filter-select"]');
    const panel = document.querySelector('[data-testid="policy-panel"]');
    return {
      loadingState: button?.dataset.loadingState || '',
      disabled: button?.disabled === true,
      ariaBusy: button?.getAttribute('aria-busy') || '',
      ariaDisabled: button?.getAttribute('aria-disabled') || '',
      siteFilterDisabled: siteFilter?.disabled === true,
      siteFilterAriaBusy: siteFilter?.getAttribute('aria-busy') || '',
      panelAriaBusy: panel?.getAttribute('aria-busy') || ''
    };
  })()`);
  await client.waitFor(
    `document.querySelector('[data-testid="policy-feedback-banner"]')?.dataset.feedbackState === 'success' && document.querySelector('[data-testid="policy-feedback-banner"]')?.textContent?.trim().length > 0 && document.querySelector('[data-testid="policy-save-button"]')?.dataset.loadingState === 'idle'`
  );
  const policySaveFeedback = await client.evaluate(`(() => {
    const banner = document.querySelector('[data-testid="policy-feedback-banner"]');
    return {
      state: banner?.dataset.feedbackState || '',
      text: banner?.textContent?.trim() || '',
      role: banner?.getAttribute('role') || '',
      ariaLive: banner?.getAttribute('aria-live') || ''
    };
  })()`);

  await setInputValue(
    '[data-testid="protection-simulator-ingestion-key-input"]',
    'invalid-ingestion-key'
  );
  client.allowHttpFailure(401, '/api/v1/protection/check');
  await setInputValue(
    '[data-testid="protection-simulator-path-input"]',
    '/products/search'
  );
  await setInputValue(
    '[data-testid="protection-simulator-query-input"]',
    'q=1 union select password from users'
  );
  await setInputValue(
    '[data-testid="protection-simulator-client-ip-input"]',
    '203.0.113.90'
  );
  await setInputValue(
    '[data-testid="protection-simulator-user-agent-input"]',
    'Mozilla/5.0 policy smoke'
  );
  await setInputValue(
    '[data-testid="protection-simulator-referer-input"]',
    'https://example.com/catalog'
  );
  await client.evaluate(
    `document.querySelector('[data-testid="protection-simulator-submit-button"]')?.click()`
  );
  await client.waitFor(
    `document.querySelector('[data-testid="protection-simulator-submit-button"]')?.dataset.loadingState === 'checking' && document.querySelector('[data-testid="protection-simulator-submit-button"]')?.disabled === true`
  );
  const protectionFailureLoadingState = await client.evaluate(`(() => {
    const button = document.querySelector('[data-testid="protection-simulator-submit-button"]');
    const panel = document.querySelector('[data-testid="protection-simulator-panel"]');
    const form = document.querySelector('[data-testid="protection-simulator-form"]');
    const siteFilter = document.querySelector('[data-testid="policy-site-filter-select"]');
    return {
      loadingState: button?.dataset.loadingState || '',
      disabled: button?.disabled === true,
      ariaBusy: button?.getAttribute('aria-busy') || '',
      ariaDisabled: button?.getAttribute('aria-disabled') || '',
      panelAriaBusy: panel?.getAttribute('aria-busy') || '',
      formAriaBusy: form?.getAttribute('aria-busy') || '',
      siteFilterDisabled: siteFilter?.disabled === true
    };
  })()`);
  await client.waitFor(
    `Boolean(document.querySelector('[data-testid="protection-simulator-feedback"]')) && document.querySelector('[data-testid="protection-simulator-submit-button"]')?.dataset.loadingState === 'idle'`
  );
  const protectionFailureFeedback = await client.evaluate(`(() => {
    const feedback = document.querySelector('[data-testid="protection-simulator-feedback"]');
    const button = document.querySelector('[data-testid="protection-simulator-submit-button"]');
    return {
      visible: Boolean(feedback),
      text: feedback?.textContent?.trim() || '',
      role: feedback?.getAttribute('role') || '',
      ariaLive: feedback?.getAttribute('aria-live') || '',
      errorCode: feedback?.dataset.errorCode || '',
      buttonLoadingState: button?.dataset.loadingState || '',
      buttonDisabled: button?.disabled === true,
      hasResult: Boolean(document.querySelector('[data-testid="protection-simulator-result"]'))
    };
  })()`);

  await setInputValue(
    '[data-testid="protection-simulator-ingestion-key-input"]',
    context.ingestionKey
  );
  await client.evaluate(
    `document.querySelector('[data-testid="protection-simulator-submit-button"]')?.click()`
  );
  await client.waitFor(
    `document.querySelector('[data-testid="protection-simulator-submit-button"]')?.dataset.loadingState === 'checking' && document.querySelector('[data-testid="protection-simulator-submit-button"]')?.disabled === true`
  );
  const protectionSuccessLoadingState = await client.evaluate(`(() => {
    const button = document.querySelector('[data-testid="protection-simulator-submit-button"]');
    const panel = document.querySelector('[data-testid="protection-simulator-panel"]');
    const form = document.querySelector('[data-testid="protection-simulator-form"]');
    const siteFilter = document.querySelector('[data-testid="policy-site-filter-select"]');
    return {
      loadingState: button?.dataset.loadingState || '',
      disabled: button?.disabled === true,
      ariaBusy: button?.getAttribute('aria-busy') || '',
      ariaDisabled: button?.getAttribute('aria-disabled') || '',
      panelAriaBusy: panel?.getAttribute('aria-busy') || '',
      formAriaBusy: form?.getAttribute('aria-busy') || '',
      siteFilterDisabled: siteFilter?.disabled === true
    };
  })()`);
  await client.waitFor(
    `Boolean(document.querySelector('[data-testid="protection-simulator-result"]')) && document.querySelector('[data-testid="protection-simulator-submit-button"]')?.dataset.loadingState === 'idle'`
  );
  const protectionSimulatorResult = await client.evaluate(`(() => {
    const result = document.querySelector('[data-testid="protection-simulator-result"]');
    const action = document.querySelector('[data-testid="protection-simulator-action"]');
    const mode = document.querySelector('[data-testid="protection-simulator-mode"]');
    const reasons = document.querySelector('[data-testid="protection-simulator-reasons"]');
    return {
      visible: Boolean(result),
      actionText: action?.textContent?.trim() || '',
      modeText: mode?.textContent?.trim() || '',
      reasonsText: reasons?.textContent?.trim() || ''
    };
  })()`);

  await client.evaluate(
    `document.querySelector('[data-testid="blocked-entity-create-button"]')?.click()`
  );
  await client.waitFor(
    `document.querySelector('[data-testid="policy-feedback-banner"]')?.dataset.feedbackState === 'error' && document.querySelector('[data-testid="policy-feedback-banner"]')?.textContent?.trim().length > 0`
  );
  const blockCreateErrorFeedback = await client.evaluate(`(() => {
    const banner = document.querySelector('[data-testid="policy-feedback-banner"]');
    return {
      state: banner?.dataset.feedbackState || '',
      text: banner?.textContent?.trim() || '',
      role: banner?.getAttribute('role') || '',
      ariaLive: banner?.getAttribute('aria-live') || ''
    };
  })()`);

  await setInputValue('[data-testid="blocked-entity-value-input"]', '203.0.113.88');
  await setInputValue(
    '[data-testid="blocked-entity-reason-input"]',
    'Policy smoke blocked IP'
  );
  await client.evaluate(
    `document.querySelector('[data-testid="blocked-entity-create-button"]')?.click()`
  );
  await client.waitFor(
    `document.querySelector('[data-testid="blocked-entity-create-button"]')?.dataset.loadingState === 'creating' && document.querySelector('[data-testid="blocked-entity-create-button"]')?.disabled === true`
  );
  const blockCreatingState = await client.evaluate(`(() => {
    const button = document.querySelector('[data-testid="blocked-entity-create-button"]');
    const form = document.querySelector('[data-testid="blocked-entity-create-button"]')?.closest('form');
    const panel = document.querySelector('[data-testid="blocked-entities-panel"]');
    return {
      loadingState: button?.dataset.loadingState || '',
      disabled: button?.disabled === true,
      ariaBusy: button?.getAttribute('aria-busy') || '',
      ariaDisabled: button?.getAttribute('aria-disabled') || '',
      formAriaBusy: form?.getAttribute('aria-busy') || '',
      panelAriaBusy: panel?.getAttribute('aria-busy') || ''
    };
  })()`);
  await client.waitFor(
    `document.querySelector('[data-testid="policy-feedback-banner"]')?.dataset.feedbackState === 'success' && document.querySelector('[data-testid="policy-feedback-banner"]')?.textContent?.trim().length > 0 && document.querySelector('[data-testid="blocked-entity-create-button"]')?.dataset.loadingState === 'idle' && Boolean(document.querySelector('[data-testid^="blocked-entity-delete-"]'))`
  );
  const blockCreateSuccessFeedback = await client.evaluate(`(() => {
    const banner = document.querySelector('[data-testid="policy-feedback-banner"]');
    const deleteButton = document.querySelector('[data-testid^="blocked-entity-delete-"]');
    return {
      state: banner?.dataset.feedbackState || '',
      text: banner?.textContent?.trim() || '',
      deleteTestId: deleteButton?.dataset.testid || ''
    };
  })()`);

  const staleDeleteEntityId = Number(
    blockCreateSuccessFeedback.deleteTestId.replace('blocked-entity-delete-', '')
  );
  await requestJson(
    `${API_BASE_URL}/api/v1/blocked-entities/${staleDeleteEntityId}`,
    {
      method: 'DELETE',
      headers: context.authHeaders
    }
  );
  client.allowHttpFailure(
    404,
    `/api/v1/blocked-entities/${staleDeleteEntityId}`
  );
  await client.evaluate(`
    document.querySelector('[data-testid="${blockCreateSuccessFeedback.deleteTestId}"]')?.click();
  `);
  const blockDeleteFailureLoadingState = await waitForDeleteButtonLoading(
    blockCreateSuccessFeedback.deleteTestId
  );
  await client.waitFor(
    `document.querySelector('[data-testid="policy-feedback-banner"]')?.dataset.feedbackState === 'error' && document.querySelector('[data-testid="policy-feedback-banner"]')?.textContent?.trim().length > 0 && document.querySelector('[data-testid="${blockCreateSuccessFeedback.deleteTestId}"]')?.dataset.loadingState === 'idle'`
  );
  const blockDeleteErrorFeedback = await client.evaluate(`(() => {
    const banner = document.querySelector('[data-testid="policy-feedback-banner"]');
    const button = document.querySelector('[data-testid="${blockCreateSuccessFeedback.deleteTestId}"]');
    return {
      state: banner?.dataset.feedbackState || '',
      text: banner?.textContent?.trim() || '',
      role: banner?.getAttribute('role') || '',
      ariaLive: banner?.getAttribute('aria-live') || '',
      hasDeleteButton: Boolean(button),
      deleteButtonState: button?.dataset.loadingState || '',
      deleteButtonDisabled: button?.disabled === true
    };
  })()`);

  await client.navigate(`${WEB_BASE_URL}${pagePath}`);
  await client.waitFor(
    `location.pathname === '/dashboard/policies' && new URLSearchParams(location.search).get('siteId') === '${context.siteId}' && Boolean(document.querySelector('[data-testid="policy-save-button"]'))`
  );

  await setInputValue('[data-testid="blocked-entity-value-input"]', '203.0.113.89');
  await setInputValue(
    '[data-testid="blocked-entity-reason-input"]',
    'Policy smoke blocked IP for delete success'
  );
  await client.evaluate(
    `document.querySelector('[data-testid="blocked-entity-create-button"]')?.click()`
  );
  await client.waitFor(
    `document.querySelector('[data-testid="policy-feedback-banner"]')?.dataset.feedbackState === 'success' && document.querySelector('[data-testid="policy-feedback-banner"]')?.textContent?.trim().length > 0 && document.querySelector('[data-testid="blocked-entity-create-button"]')?.dataset.loadingState === 'idle'`
  );
  const blockDeleteSuccessTarget = await client.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('[data-testid^="blocked-entity-delete-"]'))
      .find((item) => item.dataset.testid !== ${JSON.stringify(blockCreateSuccessFeedback.deleteTestId)});
    return button?.dataset.testid || '';
  })()`);
  if (!blockDeleteSuccessTarget) {
    throw new Error('Blocked-entity delete success target was not found after page reload and recreate.');
  }
  await client.evaluate(`
    document.querySelector('[data-testid="${blockDeleteSuccessTarget}"]')?.click();
  `);
  const blockDeletingState = await waitForDeleteButtonLoading(
    blockDeleteSuccessTarget
  );
  await client.waitFor(
    `document.querySelector('[data-testid="policy-feedback-banner"]')?.dataset.feedbackState === 'success' && document.querySelector('[data-testid="policy-feedback-banner"]')?.textContent?.trim().length > 0 && !document.querySelector('[data-testid="${blockDeleteSuccessTarget}"]')`
  );
  const blockDeleteSuccessFeedback = await client.evaluate(`(() => {
    const banner = document.querySelector('[data-testid="policy-feedback-banner"]');
    return {
      state: banner?.dataset.feedbackState || '',
      text: banner?.textContent?.trim() || '',
      role: banner?.getAttribute('role') || '',
      ariaLive: banner?.getAttribute('aria-live') || '',
      deletedTargetExists: Boolean(document.querySelector('[data-testid="${blockDeleteSuccessTarget}"]'))
    };
  })()`);

  const eventDispositionBlockedEntity = await requestJson(
    `${API_BASE_URL}/api/v1/sites/${context.siteId}/blocked-entities`,
    {
      method: 'POST',
      headers: context.authHeaders,
      body: JSON.stringify({
        entityType: 'ip',
        entityValue: '203.0.113.120',
        reason: 'Policy smoke linked event block',
        source: 'manual',
        expiresAt: null,
        attackEventId: context.attackEventId
      })
    }
  );
  const automaticExpiredBlockedEntity = await requestJson(
    `${API_BASE_URL}/api/v1/sites/${context.siteId}/blocked-entities`,
    {
      method: 'POST',
      headers: context.authHeaders,
      body: JSON.stringify({
        entityType: 'ip',
        entityValue: '203.0.113.121',
        reason: 'Policy smoke automatic expired block',
        source: 'automatic',
        expiresAt: new Date(Date.now() + 1_500).toISOString()
      })
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 2_200));

  await client.navigate(`${WEB_BASE_URL}${pagePath}`);
  await client.waitFor(
    `location.pathname === '/dashboard/policies' && new URLSearchParams(location.search).get('siteId') === '${context.siteId}' && Boolean(document.querySelector('[data-testid="blocked-entity-origin-${eventDispositionBlockedEntity.blockedEntity.id}"]')) && Boolean(document.querySelector('[data-testid="blocked-entity-is-active-${automaticExpiredBlockedEntity.blockedEntity.id}"]'))`
  );

  const blockedEntityTraceabilityState = await client.evaluate(`(() => {
    const eventOrigin = document.querySelector('[data-testid="blocked-entity-origin-${eventDispositionBlockedEntity.blockedEntity.id}"]');
    const eventActive = document.querySelector('[data-testid="blocked-entity-is-active-${eventDispositionBlockedEntity.blockedEntity.id}"]');
    const eventLink = document.querySelector('[data-testid="blocked-entity-revert-link-${eventDispositionBlockedEntity.blockedEntity.id}"]');
    const automaticOrigin = document.querySelector('[data-testid="blocked-entity-origin-${automaticExpiredBlockedEntity.blockedEntity.id}"]');
    const automaticActive = document.querySelector('[data-testid="blocked-entity-is-active-${automaticExpiredBlockedEntity.blockedEntity.id}"]');
    const automaticLink = document.querySelector('[data-testid="blocked-entity-revert-link-${automaticExpiredBlockedEntity.blockedEntity.id}"]');
    return {
      eventOriginText: eventOrigin?.textContent?.trim() || '',
      eventActiveText: eventActive?.textContent?.trim() || '',
      eventLinkHref: eventLink?.getAttribute('href') || '',
      automaticOriginText: automaticOrigin?.textContent?.trim() || '',
      automaticActiveText: automaticActive?.textContent?.trim() || '',
      automaticHasLink: Boolean(automaticLink)
    };
  })()`);

  client.assertNoBrowserErrors();
  client.close();

  return {
    initialPageState,
    policySaveErrorFeedback,
    policySavingState,
    policySaveFeedback,
    protectionFailureLoadingState,
    protectionFailureFeedback,
    protectionSuccessLoadingState,
    protectionSimulatorResult,
    blockCreateErrorFeedback,
    blockCreatingState,
    blockCreateSuccessFeedback,
    blockDeleteFailureLoadingState,
    blockDeleteErrorFeedback,
    blockDeletingState,
    blockDeleteSuccessFeedback,
    blockedEntityTraceabilityState,
    eventDispositionBlockedEntity,
    automaticExpiredBlockedEntity
  };
}

async function assertApiState(context, browserResult) {
  if (
    browserResult.initialPageState.pageUrl !==
      `/dashboard/policies?siteId=${encodeURIComponent(context.siteId)}` ||
    browserResult.initialPageState.siteSelectValue !== context.siteId ||
    browserResult.initialPageState.siteFilterDisabled ||
    browserResult.initialPageState.siteFilterAriaDisabled !== 'false' ||
    browserResult.initialPageState.siteFilterAriaBusy !== 'false' ||
    !browserResult.initialPageState.hasSimulatorEmptyState ||
    !browserResult.initialPageState.hasOverviewPanel ||
    !browserResult.initialPageState.overviewText.includes(context.siteDomain) ||
    browserResult.initialPageState.overviewItems.length < 4 ||
    !browserResult.initialPageState.latestActivityText ||
    !browserResult.initialPageState.modeHintText.includes('监控模式') ||
    !browserResult.initialPageState.latestHintText.includes('request_logs') ||
    !browserResult.initialPageState.latestHintText.includes('ai_risk_results') ||
    !browserResult.initialPageState.countsHintText.includes('attack_events') ||
    !browserResult.initialPageState.countsHintText.includes('high / critical') ||
    !browserResult.initialPageState.eventsLinkText.includes('进入该站点事件列表') ||
    !browserResult.initialPageState.eventsHintText.includes('保留当前站点范围') ||
    !browserResult.initialPageState.eventsHintText.includes('attack_events') ||
    browserResult.initialPageState.eventsLinkHref !==
      `/dashboard/events?siteId=${encodeURIComponent(context.siteId)}`
  ) {
    throw new Error(`Policy page URL/site sync failed: ${JSON.stringify(browserResult.initialPageState)}`);
  }

  if (
    browserResult.policySavingState.loadingState !== 'saving' ||
    browserResult.policySavingState.disabled !== true ||
    browserResult.policySavingState.ariaBusy !== 'true' ||
    browserResult.policySavingState.ariaDisabled !== 'true' ||
    browserResult.policySavingState.siteFilterDisabled !== true ||
    browserResult.policySavingState.siteFilterAriaBusy !== 'true' ||
    browserResult.policySavingState.panelAriaBusy !== 'true'
  ) {
    throw new Error(`Policy save loading state was not observed: ${JSON.stringify(browserResult.policySavingState)}`);
  }

  if (
    browserResult.policySaveErrorFeedback.state !== 'error' ||
    !browserResult.policySaveErrorFeedback.text ||
    browserResult.policySaveErrorFeedback.role !== 'alert' ||
    browserResult.policySaveErrorFeedback.ariaLive !== 'assertive' ||
    browserResult.policySaveErrorFeedback.saveButtonState !== 'idle' ||
    browserResult.policySaveErrorFeedback.saveButtonDisabled
  ) {
    throw new Error(`Policy save failure feedback missing: ${JSON.stringify(browserResult.policySaveErrorFeedback)}`);
  }

  if (
    browserResult.policySaveFeedback.state !== 'success' ||
    !browserResult.policySaveFeedback.text ||
    browserResult.policySaveFeedback.role !== 'status' ||
    browserResult.policySaveFeedback.ariaLive !== 'polite'
  ) {
    throw new Error(`Policy save success feedback missing: ${JSON.stringify(browserResult.policySaveFeedback)}`);
  }

  if (
    browserResult.protectionFailureLoadingState.loadingState !== 'checking' ||
    browserResult.protectionFailureLoadingState.disabled !== true ||
    browserResult.protectionFailureLoadingState.ariaBusy !== 'true' ||
    browserResult.protectionFailureLoadingState.ariaDisabled !== 'true' ||
    browserResult.protectionFailureLoadingState.panelAriaBusy !== 'true' ||
    browserResult.protectionFailureLoadingState.formAriaBusy !== 'true' ||
    browserResult.protectionFailureLoadingState.siteFilterDisabled !== true
  ) {
    throw new Error(`Protection simulator failure loading state was not observed: ${JSON.stringify(browserResult.protectionFailureLoadingState)}`);
  }

  if (
    !browserResult.protectionFailureFeedback.visible ||
    browserResult.protectionFailureFeedback.role !== 'alert' ||
    browserResult.protectionFailureFeedback.ariaLive !== 'assertive' ||
    browserResult.protectionFailureFeedback.errorCode !== 'INVALID_INGESTION_KEY' ||
    !browserResult.protectionFailureFeedback.text.includes('Invalid site ingestion key.') ||
    browserResult.protectionFailureFeedback.buttonLoadingState !== 'idle' ||
    browserResult.protectionFailureFeedback.buttonDisabled !== false ||
    browserResult.protectionFailureFeedback.hasResult
  ) {
    throw new Error(`Protection simulator failure feedback missing: ${JSON.stringify(browserResult.protectionFailureFeedback)}`);
  }

  if (
    browserResult.protectionSuccessLoadingState.loadingState !== 'checking' ||
    browserResult.protectionSuccessLoadingState.disabled !== true ||
    browserResult.protectionSuccessLoadingState.ariaBusy !== 'true' ||
    browserResult.protectionSuccessLoadingState.ariaDisabled !== 'true' ||
    browserResult.protectionSuccessLoadingState.panelAriaBusy !== 'true' ||
    browserResult.protectionSuccessLoadingState.formAriaBusy !== 'true' ||
    browserResult.protectionSuccessLoadingState.siteFilterDisabled !== true
  ) {
    throw new Error(`Protection simulator success loading state was not observed: ${JSON.stringify(browserResult.protectionSuccessLoadingState)}`);
  }

  if (
    !browserResult.protectionSimulatorResult.visible ||
    !browserResult.protectionSimulatorResult.actionText ||
    !browserResult.protectionSimulatorResult.modeText ||
    !browserResult.protectionSimulatorResult.reasonsText.includes('blocked_sql_injection')
  ) {
    throw new Error(`Protection simulator result missing: ${JSON.stringify(browserResult.protectionSimulatorResult)}`);
  }

  if (
    browserResult.blockCreateErrorFeedback.state !== 'error' ||
    !browserResult.blockCreateErrorFeedback.text ||
    browserResult.blockCreateErrorFeedback.role !== 'alert' ||
    browserResult.blockCreateErrorFeedback.ariaLive !== 'assertive'
  ) {
    throw new Error(`Blocked-entity error feedback missing: ${JSON.stringify(browserResult.blockCreateErrorFeedback)}`);
  }

  if (
    browserResult.blockCreatingState.loadingState !== 'creating' ||
    browserResult.blockCreatingState.disabled !== true ||
    browserResult.blockCreatingState.ariaBusy !== 'true' ||
    browserResult.blockCreatingState.ariaDisabled !== 'true' ||
    browserResult.blockCreatingState.formAriaBusy !== 'true' ||
    browserResult.blockCreatingState.panelAriaBusy !== 'true'
  ) {
    throw new Error(`Blocked-entity create loading state was not observed: ${JSON.stringify(browserResult.blockCreatingState)}`);
  }

  if (
    browserResult.blockCreateSuccessFeedback.state !== 'success' ||
    !browserResult.blockCreateSuccessFeedback.text ||
    !browserResult.blockCreateSuccessFeedback.deleteTestId
  ) {
    throw new Error(`Blocked-entity create success feedback missing: ${JSON.stringify(browserResult.blockCreateSuccessFeedback)}`);
  }

  if (
    browserResult.blockDeleteFailureLoadingState.loadingState !== 'deleting' ||
    browserResult.blockDeleteFailureLoadingState.disabled !== true ||
    browserResult.blockDeleteFailureLoadingState.ariaBusy !== 'true' ||
    browserResult.blockDeleteFailureLoadingState.ariaDisabled !== 'true' ||
    browserResult.blockDeleteFailureLoadingState.panelAriaBusy !== 'true'
  ) {
    throw new Error(`Blocked-entity delete failure loading state was not observed: ${JSON.stringify(browserResult.blockDeleteFailureLoadingState)}`);
  }

  if (
    browserResult.blockDeleteErrorFeedback.state !== 'error' ||
    !browserResult.blockDeleteErrorFeedback.text ||
    browserResult.blockDeleteErrorFeedback.role !== 'alert' ||
    browserResult.blockDeleteErrorFeedback.ariaLive !== 'assertive' ||
    !browserResult.blockDeleteErrorFeedback.hasDeleteButton ||
    browserResult.blockDeleteErrorFeedback.deleteButtonState !== 'idle' ||
    browserResult.blockDeleteErrorFeedback.deleteButtonDisabled
  ) {
    throw new Error(`Blocked-entity delete failure feedback missing: ${JSON.stringify(browserResult.blockDeleteErrorFeedback)}`);
  }

  if (
    browserResult.blockDeletingState.loadingState !== 'deleting' ||
    browserResult.blockDeletingState.disabled !== true ||
    browserResult.blockDeletingState.ariaBusy !== 'true' ||
    browserResult.blockDeletingState.ariaDisabled !== 'true' ||
    browserResult.blockDeletingState.panelAriaBusy !== 'true'
  ) {
    throw new Error(`Blocked-entity delete loading state was not observed: ${JSON.stringify(browserResult.blockDeletingState)}`);
  }

  if (
    browserResult.blockDeleteSuccessFeedback.state !== 'success' ||
    !browserResult.blockDeleteSuccessFeedback.text ||
    browserResult.blockDeleteSuccessFeedback.role !== 'status' ||
    browserResult.blockDeleteSuccessFeedback.ariaLive !== 'polite' ||
    browserResult.blockDeleteSuccessFeedback.deletedTargetExists
  ) {
    throw new Error(`Blocked-entity delete success feedback missing: ${JSON.stringify(browserResult.blockDeleteSuccessFeedback)}`);
  }

  if (
    browserResult.blockedEntityTraceabilityState.eventOriginText !== '事件详情页快速封禁' ||
    browserResult.blockedEntityTraceabilityState.eventActiveText !== '生效中' ||
    browserResult.blockedEntityTraceabilityState.eventLinkHref !==
      `/dashboard/events/${context.attackEventId}` ||
    browserResult.blockedEntityTraceabilityState.automaticOriginText !== '自动防护拦截' ||
    browserResult.blockedEntityTraceabilityState.automaticActiveText !== '已失效' ||
    browserResult.blockedEntityTraceabilityState.automaticHasLink
  ) {
    throw new Error(
      `Blocked-entity traceability rendering failed: ${JSON.stringify(browserResult.blockedEntityTraceabilityState)}`
    );
  }

  const policyData = await requestJson(
    `${API_BASE_URL}/api/v1/sites/${context.siteId}/security-policy`,
    {
      headers: context.authHeaders
    }
  );
  const blockedEntityList = await requestJson(
    `${API_BASE_URL}/api/v1/sites/${context.siteId}/blocked-entities`,
    {
      headers: context.authHeaders
    }
  );
  const eventDispositionEntity = blockedEntityList.items.find(
    (item) => item.id === browserResult.eventDispositionBlockedEntity.blockedEntity.id
  );
  const automaticExpiredEntity = blockedEntityList.items.find(
    (item) => item.id === browserResult.automaticExpiredBlockedEntity.blockedEntity.id
  );
  const normalizedEventDispositionAttackEventId =
    eventDispositionEntity?.attackEventId === null ||
    eventDispositionEntity?.attackEventId === undefined
      ? eventDispositionEntity?.attackEventId
      : Number(eventDispositionEntity.attackEventId);

  if (
    policyData.securityPolicy.mode !== 'protect' ||
    policyData.securityPolicy.rateLimitThreshold !== 88 ||
    policyData.securityPolicy.highRiskScoreThreshold !== 91
  ) {
    throw new Error(`Policy API verification failed: ${JSON.stringify(policyData.securityPolicy)}`);
  }

  if (
    blockedEntityList.items.length !== 2 ||
    !eventDispositionEntity ||
    eventDispositionEntity.originKind !== 'event_disposition' ||
    eventDispositionEntity.isActive !== true ||
    normalizedEventDispositionAttackEventId !== context.attackEventId ||
    !automaticExpiredEntity ||
    automaticExpiredEntity.originKind !== 'automatic' ||
    automaticExpiredEntity.isActive !== false ||
    automaticExpiredEntity.attackEventId !== null
  ) {
    throw new Error(`Blocked-entity traceability API verification failed: ${JSON.stringify(blockedEntityList.items)}`);
  }

  return {
    finalPolicy: policyData.securityPolicy,
    finalBlockedCount: blockedEntityList.items.length
  };
}

function assertNoSiteState(noSiteState) {
  if (
    noSiteState.pageUrl !== '/dashboard/policies' ||
    !noSiteState.policyEmptyText ||
    !noSiteState.blockedEmptyText ||
    !noSiteState.simulatorEmptyText ||
    !noSiteState.hasPolicyAction ||
    !noSiteState.hasBlockedAction ||
    !noSiteState.hasSimulatorAction ||
    noSiteState.hasPolicySaveButton ||
    noSiteState.createButtonDisabled !== true ||
    noSiteState.hasSimulatorSubmitButton
  ) {
    throw new Error(`Policy no-site empty state verification failed: ${JSON.stringify(noSiteState)}`);
  }
}

async function main() {
  requireWebSocket();
  await waitForHttpOk(`${API_BASE_URL}/health`, 'API');
  await waitForHttpOk(`${WEB_BASE_URL}/login`, 'Web');

  const smokeContext = await bootstrapPolicySmokeData();
  const noSiteContext = await bootstrapNoSitePolicySmokeData();
  const chromeDebugPort = await resolveChromeDebugPort(DEFAULT_CHROME_DEBUG_PORT);
  const { browserProcess, profileDir } = await launchBrowser({
    debugPort: chromeDebugPort,
    profilePrefix: 'secuai-policy-smoke-'
  });

  try {
    await waitForHttpOk(
      `http://127.0.0.1:${chromeDebugPort}/json/version`,
      'Chrome DevTools'
    );

    const noSiteState = await runNoSiteEmptyStateSmoke(noSiteContext, chromeDebugPort);
    assertNoSiteState(noSiteState);

    const browserResult = await runBrowserSmoke(smokeContext, chromeDebugPort);
    const apiResult = await assertApiState(smokeContext, browserResult);

    console.log(JSON.stringify({
      ok: true,
      smokeContext: {
        siteId: smokeContext.siteId,
        siteDomain: smokeContext.siteDomain,
        tenantId: smokeContext.tenantId,
        noSiteTenantId: noSiteContext.tenantId,
        attackEventId: smokeContext.attackEventId,
        hasIngestionKey: Boolean(smokeContext.ingestionKey),
        initialPolicyMode: smokeContext.initialPolicy.mode,
        initialBlockedCount: smokeContext.initialBlockedCount
      },
      noSiteState,
      browserResult,
      apiResult
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
