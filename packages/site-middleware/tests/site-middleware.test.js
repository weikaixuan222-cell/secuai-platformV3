import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  createSiteProtectionClient,
  enforceNodeRequestProtection
} from "../dist/src/index.js";

function startMockPlatformServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function createProtectionClient(baseUrl, timeoutMs = 1000) {
  return createSiteProtectionClient({
    platformBaseUrl: baseUrl,
    siteId: "11111111-1111-4111-8111-111111111111",
    siteIngestionKey: "test-site-key",
    timeoutMs
  });
}

function createMatchedBlockedEntity(id = 91) {
  return {
    id,
    entityType: "ip",
    entityValue: "203.0.113.10",
    source: "manual",
    attackEventId: null,
    originKind: "manual",
    expiresAt: null
  };
}

function createApiMatchedBlockedEntity(id = 91, attackEventId = null) {
  return {
    id: String(id),
    entityType: "ip",
    entityValue: "203.0.113.10",
    source: "manual",
    attackEventId: attackEventId === null ? null : String(attackEventId),
    originKind: attackEventId === null ? "manual" : "event_disposition",
    expiresAt: null
  };
}

async function readJsonBody(request) {
  let body = "";

  for await (const chunk of request) {
    body += chunk.toString();
  }

  return JSON.parse(body || "{}");
}

async function waitForCondition(assertion, timeoutMs = 2000) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  throw lastError;
}

test("checkRequest 返回 allow / monitor / block 三种决策", async () => {
  const { server, baseUrl } = await startMockPlatformServer(async (request, response) => {
    const payload = await readJsonBody(request);
    const headers = request.headers;

    assert.equal(request.url, "/api/v1/protection/check");
    assert.equal(headers["x-site-ingestion-key"], "test-site-key");
    assert.equal(payload.siteId, "11111111-1111-4111-8111-111111111111");

    const action =
      payload.path === "/blocked"
        ? "block"
        : payload.path === "/monitor"
          ? "monitor"
          : "allow";

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(
      JSON.stringify({
        success: true,
        data: {
          siteId: payload.siteId,
          protection: {
            mode: action === "block" ? "protect" : "monitor",
            action,
            reasons: action === "allow" ? [] : ["blocked_ip"],
            matchedBlockedEntity:
              action === "allow"
                ? null
                : createApiMatchedBlockedEntity(action === "block" ? 93 : 92)
          }
        }
      })
    );
  });

  try {
    const client = createProtectionClient(baseUrl);

    const allowDecision = await client.checkRequest({
      method: "GET",
      host: "example.com",
      path: "/"
    });
    const monitorDecision = await client.checkRequest({
      method: "GET",
      host: "example.com",
      path: "/monitor"
    });
    const blockDecision = await client.checkRequest({
      method: "GET",
      host: "example.com",
      path: "/blocked"
    });

    assert.deepEqual(allowDecision, {
      action: "allow",
      mode: "monitor",
      reasons: [],
      monitored: false,
      failOpen: false
    });
    assert.deepEqual(monitorDecision, {
      action: "monitor",
      mode: "monitor",
      reasons: ["blocked_ip"],
      matchedBlockedEntity: createMatchedBlockedEntity(92),
      monitored: true,
      failOpen: false
    });
    assert.deepEqual(blockDecision, {
      action: "block",
      mode: "protect",
      reasons: ["blocked_ip"],
      matchedBlockedEntity: createMatchedBlockedEntity(93),
      monitored: false,
      failOpen: false
    });
  } finally {
    await closeServer(server);
  }
});

test("enforceNodeRequestProtection 按 scope=monitor 异步上报 monitor 日志，allow/block 不上报", async () => {
  const reportedLogs = [];
  const { server: platformServer, baseUrl } = await startMockPlatformServer(
    async (request, response) => {
      const payload = await readJsonBody(request);

      if (request.url === "/api/v1/request-logs") {
        reportedLogs.push(payload);
        response.writeHead(201, {
          "Content-Type": "application/json; charset=utf-8"
        });
        response.end(
          JSON.stringify({
            success: true,
            data: {
              requestLog: {
                id: reportedLogs.length
              }
            }
          })
        );
        return;
      }

      const action =
        payload.path === "/blocked"
          ? "block"
          : payload.path === "/monitor"
            ? "monitor"
            : "allow";

      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8"
      });
      response.end(
        JSON.stringify({
          success: true,
          data: {
            protection: {
              mode: action === "block" ? "protect" : "monitor",
              action,
              reasons: action === "allow" ? [] : ["blocked_ip"],
              matchedBlockedEntity:
                action === "allow" ? null : createApiMatchedBlockedEntity(95)
            }
          }
        })
      );
    }
  );

  const client = createSiteProtectionClient({
    platformBaseUrl: baseUrl,
    siteId: "11111111-1111-4111-8111-111111111111",
    siteIngestionKey: "test-site-key",
    requestLogReporting: {
      enabled: true,
      scope: "monitor"
    }
  });
  const { server: siteServer, baseUrl: siteBaseUrl } = await startMockPlatformServer(
    async (request, response) => {
      const decision = await enforceNodeRequestProtection(request, response, client);

      if (decision.action !== "block") {
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "x-secuai-protection-action": decision.action
        });
        response.end(JSON.stringify({ ok: true, protection: decision }));
      }
    }
  );

  try {
    const allowResponse = await fetch(`${siteBaseUrl}/allow`, {
      headers: {
        host: "example.com",
        "x-forwarded-for": "203.0.113.10"
      }
    });
    const monitorResponse = await fetch(`${siteBaseUrl}/monitor?debug=true`, {
      headers: {
        host: "example.com",
        "x-forwarded-for": "203.0.113.11",
        "user-agent": "sqlmap/1.8.4"
      }
    });
    const blockResponse = await fetch(`${siteBaseUrl}/blocked`, {
      headers: {
        host: "example.com",
        "x-forwarded-for": "203.0.113.12"
      }
    });

    assert.equal(allowResponse.status, 200);
    assert.equal(monitorResponse.status, 200);
    assert.equal(blockResponse.status, 403);

    await waitForCondition(() => {
      assert.equal(reportedLogs.length, 1);
    });

    assert.equal(reportedLogs[0].path, "/monitor");
    assert.equal(reportedLogs[0].queryString, "debug=true");
    assert.equal(reportedLogs[0].clientIp, "203.0.113.11");
    assert.equal(
      reportedLogs[0].metadata.siteMiddleware.protectionAction,
      "monitor"
    );
    assert.deepEqual(
      reportedLogs[0].metadata.siteMiddleware.matchedBlockedEntity,
      createMatchedBlockedEntity(95)
    );
  } finally {
    await closeServer(siteServer);
    await closeServer(platformServer);
  }
});

test("scope=all 时 allow 和 monitor 都会异步上报 request_logs", async () => {
  const reportedLogs = [];
  const { server, baseUrl } = await startMockPlatformServer(async (request, response) => {
    const payload = await readJsonBody(request);

    if (request.url === "/api/v1/request-logs") {
      reportedLogs.push(payload);
      response.writeHead(201, {
        "Content-Type": "application/json; charset=utf-8"
      });
      response.end(JSON.stringify({ success: true, data: { requestLog: { id: 1 } } }));
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(
      JSON.stringify({
        success: true,
        data: {
          protection: {
            mode: "monitor",
            action: payload.path === "/monitor" ? "monitor" : "allow",
            reasons: payload.path === "/monitor" ? ["blocked_xss"] : [],
            matchedBlockedEntity:
              payload.path === "/monitor"
                ? {
                    id: "96",
                    entityType: "ip",
                    entityValue: "203.0.113.22",
                    source: "automatic",
                    attackEventId: "51",
                    originKind: "event_disposition",
                    expiresAt: "2030-01-01T00:00:00.000Z"
                  }
                : null
          }
        }
      })
    );
  });

  try {
    const client = createSiteProtectionClient({
      platformBaseUrl: baseUrl,
      siteId: "11111111-1111-4111-8111-111111111111",
      siteIngestionKey: "test-site-key",
      requestLogReporting: {
        enabled: true,
        scope: "all"
      }
    });

    const allowDecision = await client.checkRequest({
      method: "GET",
      host: "example.com",
      path: "/allow",
      clientIp: "203.0.113.21"
    });
    const monitorDecision = await client.checkRequest({
      method: "GET",
      host: "example.com",
      path: "/monitor",
      queryString: "q=1",
      clientIp: "203.0.113.22"
    });

    client.reportRequestLogAsync(
      {
        method: "GET",
        host: "example.com",
        path: "/allow",
        clientIp: "203.0.113.21"
      },
      allowDecision
    );
    client.reportRequestLogAsync(
      {
        method: "GET",
        host: "example.com",
        path: "/monitor",
        queryString: "q=1",
        clientIp: "203.0.113.22"
      },
      monitorDecision
    );

    await waitForCondition(() => {
      assert.equal(reportedLogs.length, 2);
    });

    assert.deepEqual(
      reportedLogs.map((item) => item.path).sort(),
      ["/allow", "/monitor"]
    );
    assert.deepEqual(reportedLogs[1].metadata.siteMiddleware.matchedBlockedEntity, {
      id: 96,
      entityType: "ip",
      entityValue: "203.0.113.22",
      source: "automatic",
      attackEventId: 51,
      originKind: "event_disposition",
      expiresAt: "2030-01-01T00:00:00.000Z"
    });
  } finally {
    await closeServer(server);
  }
});

test("平台不可用时默认 fail-open", async () => {
  const client = createProtectionClient("http://127.0.0.1:1", 200);
  const decision = await client.checkRequest({
    method: "GET",
    host: "example.com",
    path: "/"
  });

  assert.equal(decision.action, "allow");
  assert.equal(decision.mode, "fail-open");
  assert.equal(decision.failOpen, true);
  assert.match(decision.failOpenReason, /^platform_unavailable:/);
});

test("enforceNodeRequestProtection 在 block 时直接写出阻断响应", async () => {
  const { server: platformServer, baseUrl } = await startMockPlatformServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(
      JSON.stringify({
        success: true,
        data: {
          siteId: "11111111-1111-4111-8111-111111111111",
          protection: {
            mode: "protect",
            action: "block",
            reasons: ["blocked_sql_injection"],
            matchedBlockedEntity: {
              id: "97",
              entityType: "ip",
              entityValue: "203.0.113.10",
              source: "automatic",
              attackEventId: "71",
              originKind: "event_disposition",
              expiresAt: "2030-01-01T00:00:00.000Z"
            }
          }
        }
      })
    );
  });

  const client = createProtectionClient(baseUrl);
  const { server: siteServer, baseUrl: siteBaseUrl } = await startMockPlatformServer(
    async (request, response) => {
      const decision = await enforceNodeRequestProtection(request, response, client);

      if (decision.action !== "block") {
        response.writeHead(200);
        response.end("ok");
      }
    }
  );

  try {
    const response = await fetch(`${siteBaseUrl}/blocked?id=1`, {
      headers: {
        host: "example.com",
        "x-forwarded-for": "203.0.113.10",
        "user-agent": "sqlmap/1.8.4"
      }
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "REQUEST_BLOCKED");
    assert.deepEqual(body.error.details.reasons, ["blocked_sql_injection"]);
    assert.deepEqual(body.error.details.matchedBlockedEntity, {
      id: 97,
      entityType: "ip",
      entityValue: "203.0.113.10",
      source: "automatic",
      attackEventId: 71,
      originKind: "event_disposition",
      expiresAt: "2030-01-01T00:00:00.000Z"
    });
  } finally {
    await closeServer(siteServer);
    await closeServer(platformServer);
  }
});
