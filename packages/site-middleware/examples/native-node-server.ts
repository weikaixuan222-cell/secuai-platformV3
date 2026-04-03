import { createServer } from "node:http";

import {
  createSiteProtectionClient,
  enforceNodeRequestProtection
} from "../src/index.js";

const protectionClient = createSiteProtectionClient({
  platformBaseUrl: process.env.SECUAI_PLATFORM_URL ?? "http://127.0.0.1:3201",
  siteId: process.env.SECUAI_SITE_ID ?? "00000000-0000-0000-0000-000000000000",
  siteIngestionKey: process.env.SECUAI_SITE_INGESTION_KEY ?? "replace-with-site-key",
  timeoutMs: 1500,
  requestLogReporting: {
    enabled: process.env.SECUAI_REPORT_REQUEST_LOGS !== "false",
    scope: process.env.SECUAI_REPORT_REQUEST_LOG_SCOPE === "all" ? "all" : "monitor",
    timeoutMs: 1500
  }
});

const server = createServer(async (request, response) => {
  const decision = await enforceNodeRequestProtection(request, response, protectionClient);

  if (decision.action === "block") {
    return;
  }

  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "x-secuai-protection-action": decision.action,
    "x-secuai-fail-open": String(decision.failOpen),
    "x-secuai-monitored": String(decision.monitored)
  });
  response.end(
    JSON.stringify({
      ok: true,
      protection: decision
    })
  );
});

server.listen(8080, "127.0.0.1", () => {
  console.log("Example site listening on http://127.0.0.1:8080");
});
