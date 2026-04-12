import {
  cleanupBrowser,
  launchBrowser,
  requireWebSocket,
  resolveChromeDebugPort,
  waitForHttpOk
} from './smoke-helpers.mjs';

const API_BASE_URL = process.env.SECUAI_API_BASE_URL || 'http://127.0.0.1:3201';
const WEB_BASE_URL = process.env.SECUAI_WEB_BASE_URL || 'http://127.0.0.1:3200';
const DEFAULT_CHROME_DEBUG_PORT = 9222;
const STRICT_MODE =
  process.argv.includes('--strict') || process.env.SECUAI_SMOKE_STRICT === '1';
const DETAIL_ROUTE_ERROR_PROBE_ID = `detail-route-probe-${Date.now()}`;

function isExpectedBrowserErrorLog(message) {
  return (
    message.includes(`Event detail route error smoke trigger: ${DETAIL_ROUTE_ERROR_PROBE_ID}`) ||
    message.includes('Attack event detail route render failed:') ||
    message.includes('The above error occurred in the <EventDetailRouteErrorProbe> component') ||
    (
      message.includes('Cannot update a component') &&
      message.includes('EventDetailRouteErrorProbe')
    ) ||
    (
      message.includes('The above error occurred in the <RedirectErrorBoundary> component') &&
      message.includes('EventDetailRouteErrorProbe')
    )
  );
}

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

async function createSite(authHeaders, tenantId, name, domain) {
  const data = await requestJson(`${API_BASE_URL}/api/v1/sites`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      tenantId,
      name,
      domain
    })
  });

  return {
    siteId: data.site.id,
    siteDomain: data.site.domain,
    ingestionKey: data.ingestionKey
  };
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
      clientIp: '203.0.113.77',
      userAgent: 'Mozilla/5.0 secuai-smoke',
      scheme: 'https',
      ...body
    })
  });
}

async function bootstrapSmokeData() {
  const suffix = Date.now();
  const email = `web-smoke-${suffix}@example.com`;
  const password = 'StrongPass123';

  await requestJson(`${API_BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      displayName: `Web Smoke ${suffix}`
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
      name: `Smoke Tenant ${suffix}`,
      slug: `smoke-${suffix}`
    })
  });
  const tenantId = tenantData.tenant.id;

  const firstSite = await createSite(
    authHeaders,
    tenantId,
    `Smoke Shop ${suffix}`,
    `smoke-shop-${suffix}.example.com`
  );
  const secondSite = await createSite(
    authHeaders,
    tenantId,
    `Smoke Blog ${suffix}`,
    `smoke-blog-${suffix}.example.com`
  );

  await reportRequestLog(firstSite, {
    path: '/api/orders',
    queryString: 'id=1 UNION SELECT password FROM users'
  });
  await reportRequestLog(secondSite, {
    path: '/search',
    queryString: 'q=%3Cscript%3Ealert(1)%3C%2Fscript%3E'
  });

  await requestJson(`${API_BASE_URL}/api/v1/detection/run`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      tenantId,
      limit: 100
    })
  });

  const [firstEvents, secondEvents, recentHighRiskEvents] = await Promise.all([
    requestJson(
      `${API_BASE_URL}/api/v1/attack-events?tenantId=${tenantId}&siteId=${firstSite.siteId}&eventType=sql_injection&limit=20`,
      { headers: authHeaders }
    ),
    requestJson(
      `${API_BASE_URL}/api/v1/attack-events?tenantId=${tenantId}&siteId=${secondSite.siteId}&eventType=xss_payload&limit=20`,
      { headers: authHeaders }
    ),
    requestJson(
      `${API_BASE_URL}/api/v1/dashboard/recent-high-risk-events?tenantId=${tenantId}&siteId=${firstSite.siteId}&limit=8&offset=0`,
      { headers: authHeaders }
    )
  ]);

  const firstAttackEvent = firstEvents.items?.[0];
  const secondAttackEvent = secondEvents.items?.[0];

  if (!firstAttackEvent || !secondAttackEvent) {
    throw new Error('Smoke data bootstrap did not generate the expected attack events.');
  }

  const dashboardCardEvent = recentHighRiskEvents.items?.[0];
  const dashboardCardSkipReason = dashboardCardEvent
    ? ''
    : 'Skipped Dashboard recent-high-risk card assertion because /api/v1/dashboard/recent-high-risk-events returned no items for the first smoke site. This usually means AI analyzer is unavailable or no high/critical AI risk result was generated yet.';

  if (!dashboardCardEvent && STRICT_MODE) {
    throw new Error(
      `Strict mode requires Dashboard recent-high-risk card data, but none was returned. ${dashboardCardSkipReason} Start services/ai-analyzer on 127.0.0.1:8000 and ensure detection produces a high/critical ai_risk_results record before rerunning with --strict or SECUAI_SMOKE_STRICT=1.`
    );
  }

  return {
    token,
    tenantId,
    firstSiteId: firstSite.siteId,
    firstAttackEventId: String(firstAttackEvent.id),
    secondSiteId: secondSite.siteId,
    secondAttackEventId: String(secondAttackEvent.id),
    dashboardCardContext: dashboardCardEvent
      ? {
          attackEventId: String(dashboardCardEvent.attackEventId),
          siteId: dashboardCardEvent.siteId,
          eventType: dashboardCardEvent.eventType
        }
      : null,
    dashboardCardSkipReason
  };
}

async function openCdpTarget(chromeDebugPort) {
  const response = await fetch(`http://127.0.0.1:${chromeDebugPort}/json/new?about:blank`, {
    method: 'PUT'
  });

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
        request.reject(
          new Error(payload.error.message || JSON.stringify(payload.error))
        );
        return;
      }

      request.resolve(payload.result || {});
      return;
    }

    if (
      payload.method === 'Runtime.consoleAPICalled' &&
      payload.params?.type === 'error'
    ) {
      const message = payload.params.args
          .map((item) => item.value || item.description || '')
          .join(' ');

      if (!isExpectedBrowserErrorLog(message)) {
        consoleErrors.push(message);
      }
    }

    if (payload.method === 'Runtime.exceptionThrown') {
      const exceptionText = payload.params?.exceptionDetails?.text || 'unknown';
      const exceptionDescription =
        payload.params?.exceptionDetails?.exception?.description || '';
      const message = `Runtime exception: ${exceptionText} ${exceptionDescription}`.trim();

      if (!isExpectedBrowserErrorLog(message)) {
        runtimeFailures.push(message);
      }
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
        `HTTP ${payload.params.response.status}: ${payload.params.response.url}`
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
    async waitFor(expression, timeoutMs = 20000) {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const value = await this.evaluate(expression);

        if (value) {
          return value;
        }

        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      const debugState = await this.evaluate(`(() => ({
        url: location.href,
        bodyText: (document.body?.innerText || '').slice(0, 500)
      }))()`);

      throw new Error(
        `Timed out waiting for expression: ${expression}; page=${JSON.stringify(debugState)}`
      );
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

async function runBrowserSmoke(context, chromeDebugPort) {
  const client = await createCdpClient(await openCdpTarget(chromeDebugPort));
  await client.init();

  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      localStorage.setItem('secuai_token', ${JSON.stringify(context.token)});
      localStorage.setItem('secuai_tenant_id', ${JSON.stringify(context.tenantId)});
    `
  });

  const firstListPath = `/dashboard/events?siteId=${encodeURIComponent(context.firstSiteId)}&eventType=sql_injection`;
  const firstDetailPath = `/dashboard/events/${context.firstAttackEventId}?siteId=${encodeURIComponent(context.firstSiteId)}&eventType=sql_injection`;
  const firstDetailProbePath = `${firstDetailPath}&detailRouteErrorProbe=1&detailRouteErrorProbeId=${DETAIL_ROUTE_ERROR_PROBE_ID}`;
  const invalidDetailPath = `/dashboard/events/%20?siteId=${encodeURIComponent(context.firstSiteId)}&eventType=sql_injection`;
  const secondListPath = `/dashboard/events?siteId=${encodeURIComponent(context.secondSiteId)}&eventType=xss_payload`;
  const dashboardPath = `/dashboard?siteId=${encodeURIComponent(context.firstSiteId)}`;
  const dashboardCardDetailPath = context.dashboardCardContext
    ? `/dashboard/events/${context.dashboardCardContext.attackEventId}?siteId=${encodeURIComponent(context.dashboardCardContext.siteId)}&eventType=${encodeURIComponent(context.dashboardCardContext.eventType)}`
    : '';
  const dashboardCardBackPath = context.dashboardCardContext
    ? `/dashboard/events?siteId=${encodeURIComponent(context.dashboardCardContext.siteId)}&eventType=${encodeURIComponent(context.dashboardCardContext.eventType)}`
    : '';

  await client.send('Page.navigate', {
    url: `${WEB_BASE_URL}${firstListPath}`
  });
  await client.waitFor(
    `Boolean(document.querySelector('a[href="${firstDetailPath}"]')) && Array.from(document.querySelectorAll('select'))[0]?.value === '${context.firstSiteId}' && Array.from(document.querySelectorAll('select'))[1]?.value === 'sql_injection'`
  );

  const firstListState = await client.evaluate(`(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    const detailLink = document.querySelector('a[href="${firstDetailPath}"]');
    const filterForm = document.querySelector('[data-testid="events-filter-form"]');
    const applyButton = document.querySelector('[data-testid="events-apply-filters"]');
    const clearButton = document.querySelector('[data-testid="events-clear-filters"]');
    const siteSelect = document.querySelector('#events-site-filter');
    const eventTypeSelect = document.querySelector('#events-type-filter');

    return {
      siteSelectValue: selects[0]?.value || '',
      siteSelectAriaDisabled: siteSelect?.getAttribute('aria-disabled') || '',
      siteSelectAriaBusy: siteSelect?.getAttribute('aria-busy') || '',
      eventTypeValue: selects[1]?.value || '',
      eventTypeAriaDisabled: eventTypeSelect?.getAttribute('aria-disabled') || '',
      eventTypeAriaBusy: eventTypeSelect?.getAttribute('aria-busy') || '',
      rowCount: document.querySelectorAll('table tbody tr').length,
      detailHref: detailLink?.getAttribute('href') || '',
      filterFormBusy: filterForm?.getAttribute('aria-busy') || '',
      applyDisabled: applyButton?.disabled ?? true,
      applyAriaDisabled: applyButton?.getAttribute('aria-disabled') || '',
      applyAriaBusy: applyButton?.getAttribute('aria-busy') || '',
      clearDisabled: clearButton?.disabled ?? true,
      clearAriaDisabled: clearButton?.getAttribute('aria-disabled') || '',
      clearAriaBusy: clearButton?.getAttribute('aria-busy') || ''
    };
  })()`);

  await client.evaluate(
    `document.querySelector('a[href="${firstDetailPath}"]')?.click()`
  );
  await client.waitFor(
    `location.pathname === '/dashboard/events/${context.firstAttackEventId}' && Boolean(document.querySelector('a[href="${firstListPath}"]'))`
  );

  const detailState = await client.evaluate(`(() => {
    const backLink = document.querySelector('a[href="${firstListPath}"]');
    return {
      detailUrl: location.pathname + location.search,
      backHref: backLink?.getAttribute('href') || ''
    };
  })()`);

  // BEGIN UI BLOCK IP TEST
  await client.waitFor(
    `document.querySelector('[data-testid="event-detail-block-ip-button"]')?.textContent?.includes('封禁该 IP')`
  );
  await client.evaluate(`document.querySelector('[data-testid="event-detail-block-ip-button"]')?.click()`);
  await client.waitFor(
    `document.querySelector('[data-testid="event-detail-block-ip-feedback"]')?.textContent?.includes('已加入当前站点封禁名单') && document.querySelector('[data-testid="event-detail-block-ip-button"]')?.disabled === true`
  );

  const blockIpActionState = await client.evaluate(`(() => {
    const feedback = document.querySelector('[data-testid="event-detail-block-ip-feedback"]');
    const feedbackLink = document.querySelector('[data-testid="event-detail-block-ip-feedback-link"]');
    const associatedBlocks = document.querySelector('[data-testid="event-detail-associated-blocks"]');
    const associatedEvent = document.querySelector('[data-testid="event-detail-associated-event"]');
    const associatedEventLink = document.querySelector('[data-testid="event-detail-associated-event-link"]');
    const protectionTrace = document.querySelector('[data-testid="event-detail-protection-trace"]');

    return {
      feedbackText: feedback?.textContent || '',
      feedbackLinkHref: feedbackLink?.getAttribute('href') || '',
      associatedBlocksText: associatedBlocks?.textContent || '',
      associatedEventText: associatedEvent?.textContent || '',
      associatedEventLinkHref: associatedEventLink?.getAttribute('href') || '',
      protectionTraceText: protectionTrace?.textContent || ''
    };
  })()`);
  // END UI BLOCK IP TEST

  await client.send('Page.navigate', {
    url: `${WEB_BASE_URL}${firstDetailProbePath}`
  });
  await client.waitFor(
    `document.querySelector('[data-testid="event-detail-route-error-state"]')?.getAttribute('role') === 'alert' && document.querySelector('[data-testid="event-detail-route-error-retry"]')?.textContent?.includes('重试打开事件详情页') && document.querySelector('[data-testid="event-detail-route-error-retry"]')?.disabled === false`
  );

  const detailRouteErrorState = await client.evaluate(`(() => {
    const errorState = document.querySelector('[data-testid="event-detail-route-error-state"]');
    const retryButton = document.querySelector('[data-testid="event-detail-route-error-retry"]');
    const backLink = document.querySelector('[data-testid="event-detail-back-link"]');
    const shell = document.querySelector('[data-testid="event-detail-page-shell"]');

    return {
      titleText: errorState?.textContent || '',
      role: errorState?.getAttribute('role') || '',
      ariaLive: errorState?.getAttribute('aria-live') || '',
      retryDisabled: retryButton?.disabled ?? true,
      backHref: backLink?.getAttribute('href') || '',
      shellBusy: shell?.getAttribute('aria-busy') || ''
    };
  })()`);

  await client.evaluate(
    `document.querySelector('[data-testid="event-detail-route-error-retry"]')?.click()`
  );
  await client.waitFor(
    `location.pathname === '/dashboard/events/${context.firstAttackEventId}' && document.querySelector('[data-testid="event-detail-back-link"]')?.getAttribute('href') === '${firstListPath}' && Boolean(document.querySelector('[aria-label="事件关键摘要"]'))`
  );

  const recoveredDetailState = await client.evaluate(`(() => {
    const backLink = document.querySelector('[data-testid="event-detail-back-link"]');
    const backHint = document.querySelector('[data-testid="event-detail-back-hint"]');
    const shell = document.querySelector('[data-testid="event-detail-page-shell"]');

    return {
      detailUrl: location.pathname + location.search,
      backHref: backLink?.getAttribute('href') || '',
      backHint: backHint?.textContent || '',
      shellBusy: shell?.getAttribute('aria-busy') || '',
      titleText: document.querySelector('h1')?.textContent || ''
    };
  })()`);

  await client.evaluate(
    `document.querySelector('a[href="${firstListPath}"]')?.click()`
  );
  await client.waitFor(
    `location.pathname === '/dashboard/events' && new URLSearchParams(location.search).get('siteId') === '${context.firstSiteId}' && Array.from(document.querySelectorAll('select'))[1]?.value === 'sql_injection'`
  );

  const returnedListState = await client.evaluate(`(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    return {
      siteSelectValue: selects[0]?.value || '',
      eventTypeValue: selects[1]?.value || '',
      rowCount: document.querySelectorAll('table tbody tr').length
    };
  })()`);

  await client.send('Page.navigate', {
    url: `${WEB_BASE_URL}${invalidDetailPath}`
  });
  await client.waitFor(
    `Boolean(document.querySelector('[data-testid="event-detail-invalid-id-state"]')) && document.querySelector('[data-testid="event-detail-back-link"]')?.getAttribute('href') === '${firstListPath}'`
  );

  const invalidDetailState = await client.evaluate(`(() => {
    const stateCard = document.querySelector('[data-testid="event-detail-invalid-id-state"]');
    const backLink = document.querySelector('[data-testid="event-detail-back-link"]');
    const backHint = document.querySelector('[data-testid="event-detail-back-hint"]');
    return {
      shellTitle: document.querySelector('h1')?.textContent || '',
      titleText: stateCard?.textContent || '',
      role: stateCard?.getAttribute('role') || '',
      backHref: backLink?.getAttribute('href') || '',
      backLabel: backLink?.textContent || '',
      backHint: backHint?.textContent || '',
      ariaBusy: document.querySelector('[data-testid="event-detail-page-shell"]')?.getAttribute('aria-busy') || ''
    };
  })()`);

  await client.evaluate(
    `document.querySelector('[data-testid="event-detail-back-link"]')?.click()`
  );
  await client.waitFor(
    `location.pathname === '/dashboard/events' && new URLSearchParams(location.search).get('siteId') === '${context.firstSiteId}' && new URLSearchParams(location.search).get('eventType') === 'sql_injection' && Array.from(document.querySelectorAll('select'))[0]?.value === '${context.firstSiteId}' && Array.from(document.querySelectorAll('select'))[1]?.value === 'sql_injection'`
  );

  const invalidDetailReturnState = await client.evaluate(`(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    return {
      siteSelectValue: selects[0]?.value || '',
      eventTypeValue: selects[1]?.value || '',
      backUrl: location.pathname + location.search
    };
  })()`);

  await client.send('Page.navigate', {
    url: `${WEB_BASE_URL}${secondListPath}`
  });
  await client.waitFor(
    `new URLSearchParams(location.search).get('siteId') === '${context.secondSiteId}' && Array.from(document.querySelectorAll('select'))[1]?.value === 'xss_payload' && Boolean(document.querySelector('a[href*="siteId=${context.secondSiteId}"][href*="eventType=xss_payload"]'))`
  );

  const secondListState = await client.evaluate(`(() => {
    const selects = Array.from(document.querySelectorAll('select'));
    const detailLink = document.querySelector('a[href*="siteId=${context.secondSiteId}"][href*="eventType=xss_payload"]');
    return {
      siteSelectValue: selects[0]?.value || '',
      eventTypeValue: selects[1]?.value || '',
      rowCount: document.querySelectorAll('table tbody tr').length,
      detailHref: detailLink?.getAttribute('href') || ''
    };
  })()`);

  await client.send('Page.navigate', {
    url: `${WEB_BASE_URL}${dashboardPath}`
  });
  await client.waitFor(
    `document.querySelector('#dashboard-site-filter')?.value === '${context.firstSiteId}' && document.querySelector('[data-testid="dashboard-filter-form"]')?.getAttribute('aria-busy') === 'false'`
  );

  const dashboardFilterState = await client.evaluate(`(() => {
    const filterForm = document.querySelector('[data-testid="dashboard-filter-form"]');
    const siteSelect = document.querySelector('#dashboard-site-filter');

    return {
      siteSelectValue: siteSelect?.value || '',
      siteSelectAriaDisabled: siteSelect?.getAttribute('aria-disabled') || '',
      siteSelectAriaBusy: siteSelect?.getAttribute('aria-busy') || '',
      filterFormBusy: filterForm?.getAttribute('aria-busy') || ''
    };
  })()`);

  let dashboardDetailState = {
    skipped: true,
    skipReason: context.dashboardCardSkipReason,
    detailUrl: '',
    backHref: ''
  };

  if (context.dashboardCardContext) {
    await client.waitFor(
      `Boolean(document.querySelector('a[href="${dashboardCardDetailPath}"]'))`
    );

    await client.evaluate(
      `document.querySelector('a[href="${dashboardCardDetailPath}"]')?.click()`
    );
    await client.waitFor(
      `location.pathname === '/dashboard/events/${context.dashboardCardContext.attackEventId}' && Boolean(document.querySelector('a[href="${dashboardCardBackPath}"]'))`
    );

    dashboardDetailState = await client.evaluate(`(() => {
      const backLink = document.querySelector('a[href="${dashboardCardBackPath}"]');
      return {
        skipped: false,
        skipReason: '',
        detailUrl: location.pathname + location.search,
        backHref: backLink?.getAttribute('href') || ''
      };
    })()`);
  }

  client.assertNoBrowserErrors();
  client.close();

  return {
    firstListState,
    detailState,
    blockIpActionState,
    detailRouteErrorState,
    recoveredDetailState,
    returnedListState,
    invalidDetailState,
    invalidDetailReturnState,
    secondListState,
    dashboardFilterState,
    dashboardDetailState
  };
}

function assertSmokeState(result, context) {
  if (
    result.firstListState.siteSelectValue !== context.firstSiteId ||
    result.firstListState.siteSelectAriaDisabled !== 'false' ||
    result.firstListState.siteSelectAriaBusy !== 'false' ||
    result.firstListState.eventTypeValue !== 'sql_injection' ||
    result.firstListState.eventTypeAriaDisabled !== 'false' ||
    result.firstListState.eventTypeAriaBusy !== 'false' ||
    result.firstListState.rowCount < 1 ||
    result.firstListState.filterFormBusy !== 'false' ||
    result.firstListState.applyDisabled ||
    result.firstListState.applyAriaDisabled !== 'false' ||
    result.firstListState.applyAriaBusy !== 'false' ||
    result.firstListState.clearDisabled ||
    result.firstListState.clearAriaDisabled !== 'false' ||
    result.firstListState.clearAriaBusy !== 'false'
  ) {
    throw new Error(`First site list filter smoke failed: ${JSON.stringify(result.firstListState)}`);
  }

  if (
    result.detailState.detailUrl !==
      `/dashboard/events/${context.firstAttackEventId}?siteId=${encodeURIComponent(context.firstSiteId)}&eventType=sql_injection` ||
    result.detailState.backHref !==
      `/dashboard/events?siteId=${encodeURIComponent(context.firstSiteId)}&eventType=sql_injection`
  ) {
    throw new Error(`Detail return-query smoke failed: ${JSON.stringify(result.detailState)}`);
  }

  if (
    !result.blockIpActionState.feedbackText.includes('已加入当前站点封禁名单') ||
    result.blockIpActionState.feedbackLinkHref !== `/dashboard/policies?siteId=${context.firstSiteId}` ||
    !result.blockIpActionState.associatedBlocksText.includes('事件详情页快速封禁') ||
    !result.blockIpActionState.associatedBlocksText.includes('生效中')
  ) {
    throw new Error(`Block IP traceability smoke failed: ${JSON.stringify(result.blockIpActionState)}`);
  }

  if (
    !result.detailRouteErrorState.titleText.includes('事件详情页打开失败') ||
    result.detailRouteErrorState.role !== 'alert' ||
    result.detailRouteErrorState.ariaLive !== 'assertive' ||
    result.detailRouteErrorState.retryDisabled ||
    result.detailRouteErrorState.backHref !==
      `/dashboard/events?siteId=${encodeURIComponent(context.firstSiteId)}&eventType=sql_injection` ||
    result.detailRouteErrorState.shellBusy !== 'false'
  ) {
    throw new Error(
      `Event detail route error boundary smoke failed: ${JSON.stringify(result.detailRouteErrorState)}`
    );
  }

  if (
    result.recoveredDetailState.detailUrl !==
      `/dashboard/events/${context.firstAttackEventId}?siteId=${encodeURIComponent(context.firstSiteId)}&eventType=sql_injection&detailRouteErrorProbe=1&detailRouteErrorProbeId=${DETAIL_ROUTE_ERROR_PROBE_ID}` ||
    result.recoveredDetailState.backHref !==
      `/dashboard/events?siteId=${encodeURIComponent(context.firstSiteId)}&eventType=sql_injection` ||
    !result.recoveredDetailState.backHint.includes('已保留当前筛选条件') ||
    result.recoveredDetailState.shellBusy !== 'false' ||
    result.recoveredDetailState.titleText !== `事件 #${context.firstAttackEventId}`
  ) {
    throw new Error(
      `Event detail route error recovery smoke failed: ${JSON.stringify(result.recoveredDetailState)}`
    );
  }

  if (
    result.returnedListState.siteSelectValue !== context.firstSiteId ||
    result.returnedListState.eventTypeValue !== 'sql_injection' ||
    result.returnedListState.rowCount < 1
  ) {
    throw new Error(`Returned list smoke failed: ${JSON.stringify(result.returnedListState)}`);
  }

  if (
    result.invalidDetailState.shellTitle !== '事件 ID 无效' ||
    !result.invalidDetailState.titleText.includes('事件 ID 无效') ||
    result.invalidDetailState.role !== 'alert' ||
    result.invalidDetailState.backHref !==
      `/dashboard/events?siteId=${encodeURIComponent(context.firstSiteId)}&eventType=sql_injection` ||
    result.invalidDetailState.backLabel !== '返回当前筛选结果' ||
    !result.invalidDetailState.backHint.includes('已保留当前筛选条件') ||
    result.invalidDetailState.ariaBusy !== 'false'
  ) {
    throw new Error(
      `Invalid detail state smoke failed: ${JSON.stringify(result.invalidDetailState)}`
    );
  }

  if (
    result.invalidDetailReturnState.siteSelectValue !== context.firstSiteId ||
    result.invalidDetailReturnState.eventTypeValue !== 'sql_injection' ||
    result.invalidDetailReturnState.backUrl !==
      `/dashboard/events?siteId=${encodeURIComponent(context.firstSiteId)}&eventType=sql_injection`
  ) {
    throw new Error(
      `Invalid detail return smoke failed: ${JSON.stringify(result.invalidDetailReturnState)}`
    );
  }

  if (
    result.secondListState.siteSelectValue !== context.secondSiteId ||
    result.secondListState.eventTypeValue !== 'xss_payload' ||
    result.secondListState.rowCount < 1 ||
    !result.secondListState.detailHref.includes(`siteId=${context.secondSiteId}`) ||
    !result.secondListState.detailHref.includes('eventType=xss_payload')
  ) {
    throw new Error(`Multi-site smoke failed: ${JSON.stringify(result.secondListState)}`);
  }

  if (
    result.dashboardFilterState.siteSelectValue !== context.firstSiteId ||
    result.dashboardFilterState.siteSelectAriaDisabled !== 'false' ||
    result.dashboardFilterState.siteSelectAriaBusy !== 'false' ||
    result.dashboardFilterState.filterFormBusy !== 'false'
  ) {
    throw new Error(
      `Dashboard site filter aria smoke failed: ${JSON.stringify(result.dashboardFilterState)}`
    );
  }

  if (
    !result.dashboardDetailState.skipped &&
    (
      result.dashboardDetailState.detailUrl !==
        `/dashboard/events/${context.dashboardCardContext.attackEventId}?siteId=${encodeURIComponent(context.dashboardCardContext.siteId)}&eventType=${encodeURIComponent(context.dashboardCardContext.eventType)}` ||
      result.dashboardDetailState.backHref !==
        `/dashboard/events?siteId=${encodeURIComponent(context.dashboardCardContext.siteId)}&eventType=${encodeURIComponent(context.dashboardCardContext.eventType)}`
    )
  ) {
    throw new Error(`Dashboard card query-preservation smoke failed: ${JSON.stringify(result.dashboardDetailState)}`);
  }

  if (
    !result.blockIpActionState.associatedBlocksText.includes(
      `关联事件 #${context.firstAttackEventId}`
    )
  ) {
    throw new Error(
      `Block IP related-event summary smoke failed: ${JSON.stringify(result.blockIpActionState)}`
    );
  }

  if (
    result.blockIpActionState.associatedEventText !==
      `关联事件 #${context.firstAttackEventId}（当前事件）` ||
    result.blockIpActionState.associatedEventLinkHref !== ''
  ) {
    throw new Error(
      `Block IP related-event node smoke failed: ${JSON.stringify(result.blockIpActionState)}`
    );
  }
}

async function main() {
  requireWebSocket();
  await waitForHttpOk(`${API_BASE_URL}/health`, 'API');
  await waitForHttpOk(`${WEB_BASE_URL}/login`, 'Web');

  const smokeContext = await bootstrapSmokeData();
  const chromeDebugPort = await resolveChromeDebugPort(DEFAULT_CHROME_DEBUG_PORT);
  const { browserProcess, profileDir } = await launchBrowser({
    debugPort: chromeDebugPort,
    profilePrefix: 'secuai-web-smoke-'
  });

  try {
    await waitForHttpOk(
      `http://127.0.0.1:${chromeDebugPort}/json/version`,
      'Chrome DevTools'
    );

    const result = await runBrowserSmoke(smokeContext, chromeDebugPort);
    assertSmokeState(result, smokeContext);
    console.log(JSON.stringify({
      ok: true,
      strictMode: STRICT_MODE,
      smokeContext,
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
