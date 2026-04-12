import assert from "node:assert/strict";

import { createSmokeRuntime } from "./smoke-runtime-helpers.mjs";

const runtime = createSmokeRuntime();
const blockedIp = "203.0.113.77";
const expiringBlockedIp = "203.0.113.78";

async function main() {
  await runtime.prepareRuntime({ startAnalyzer: false });

  const suffix = Date.now().toString();
  const { token } = await runtime.registerAndLogin(
    `policy-smoke-${suffix}@example.com`,
    "Policy Smoke User"
  );
  const tenant = await runtime.createTenant(
    token,
    "Policy Smoke Tenant",
    `policy-smoke-${suffix}`
  );
  const siteData = await runtime.createSite(
    token,
    tenant.id,
    "Policy Smoke Site",
    `policy-smoke-${suffix}.example.com`
  );

  const defaultPolicy = await runtime.getSecurityPolicy(token, siteData.site.id);
  assert.equal(defaultPolicy.siteId, siteData.site.id);
  assert.equal(defaultPolicy.mode, "monitor");
  assert.equal(defaultPolicy.blockSqlInjection, true);
  assert.equal(defaultPolicy.enableRateLimit, true);

  const updatedPolicy = await runtime.updateSecurityPolicy(token, siteData.site.id, {
    mode: "protect",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 60,
    autoBlockHighRisk: true,
    highRiskScoreThreshold: 88
  });

  assert.equal(updatedPolicy.mode, "protect");
  assert.equal(updatedPolicy.rateLimitThreshold, 60);
  assert.equal(updatedPolicy.autoBlockHighRisk, true);
  assert.equal(updatedPolicy.highRiskScoreThreshold, 88);

  const blockedEntity = await runtime.createBlockedEntity(token, siteData.site.id, {
    entityType: "ip",
    entityValue: blockedIp,
    reason: "Policy runtime smoke blocked IP",
    source: "manual",
    expiresAt: "2099-01-01T00:00:00.000Z"
  });

  assert.equal(blockedEntity.siteId, siteData.site.id);
  assert.equal(blockedEntity.entityValue, blockedIp);
  assert.equal(blockedEntity.source, "manual");
  assert.equal(blockedEntity.originKind, "manual");
  assert.equal(blockedEntity.isActive, true);

  const blockedEntitiesAfterCreate = await runtime.listBlockedEntities(token, siteData.site.id);
  assert.equal(blockedEntitiesAfterCreate.length, 1);
  assert.equal(blockedEntitiesAfterCreate[0].id, blockedEntity.id);
  assert.equal(blockedEntitiesAfterCreate[0].originKind, "manual");
  assert.equal(blockedEntitiesAfterCreate[0].isActive, true);

  const blockedDecision = await runtime.protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T12:00:00.000Z",
    method: "GET",
    host: siteData.site.domain,
    path: "/login",
    clientIp: blockedIp,
    userAgent: "Mozilla/5.0"
  });

  assert.equal(blockedDecision.mode, "protect");
  assert.equal(blockedDecision.action, "block");
  assert.ok(blockedDecision.reasons.includes("blocked_ip"));
  assert.equal(blockedDecision.matchedBlockedEntity.id, blockedEntity.id);
  assert.equal(blockedDecision.matchedBlockedEntity.originKind, "manual");

  await runtime.updateSecurityPolicy(token, siteData.site.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 60,
    autoBlockHighRisk: true,
    highRiskScoreThreshold: 88
  });

  const monitorDecision = await runtime.protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T12:01:00.000Z",
    method: "GET",
    host: siteData.site.domain,
    path: "/login",
    clientIp: blockedIp,
    userAgent: "Mozilla/5.0"
  });

  assert.equal(monitorDecision.mode, "monitor");
  assert.equal(monitorDecision.action, "monitor");
  assert.ok(monitorDecision.reasons.includes("blocked_ip"));
  assert.equal(monitorDecision.matchedBlockedEntity.id, blockedEntity.id);
  assert.equal(monitorDecision.matchedBlockedEntity.originKind, "manual");

  const deleteResult = await runtime.deleteBlockedEntity(token, blockedEntity.id);
  assert.equal(deleteResult.deleted, true);
  assert.equal(deleteResult.blockedEntity.id, blockedEntity.id);

  const blockedEntitiesAfterDelete = await runtime.listBlockedEntities(token, siteData.site.id);
  assert.equal(blockedEntitiesAfterDelete.length, 0);

  const allowDecision = await runtime.protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T12:02:00.000Z",
    method: "GET",
    host: siteData.site.domain,
    path: "/home",
    clientIp: blockedIp,
    userAgent: "Mozilla/5.0"
  });

  assert.equal(allowDecision.mode, "monitor");
  assert.equal(allowDecision.action, "allow");
  assert.deepEqual(allowDecision.reasons, []);

  const now = Date.now();
  const expiryAt = new Date(now + 1_500).toISOString();

  const expiringBlockedEntity = await runtime.createBlockedEntity(token, siteData.site.id, {
    entityType: "ip",
    entityValue: expiringBlockedIp,
    reason: "Policy runtime smoke expiring blocked IP",
    source: "manual",
    expiresAt: expiryAt
  });

  const blockedEntitiesAfterExpiringCreate = await runtime.listBlockedEntities(token, siteData.site.id);
  assert.equal(blockedEntitiesAfterExpiringCreate.length, 1);
  assert.equal(blockedEntitiesAfterExpiringCreate[0].id, expiringBlockedEntity.id);
  assert.equal(blockedEntitiesAfterExpiringCreate[0].entityValue, expiringBlockedIp);
  assert.equal(blockedEntitiesAfterExpiringCreate[0].expiresAt, expiryAt);
  assert.equal(blockedEntitiesAfterExpiringCreate[0].originKind, "manual");
  assert.equal(blockedEntitiesAfterExpiringCreate[0].isActive, true);

  const activeBeforeExpiryDecision = await runtime.protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: new Date().toISOString(),
    method: "GET",
    host: siteData.site.domain,
    path: "/account",
    clientIp: expiringBlockedIp,
    userAgent: "Mozilla/5.0"
  });

  assert.equal(activeBeforeExpiryDecision.mode, "monitor");
  assert.equal(activeBeforeExpiryDecision.action, "monitor");
  assert.ok(activeBeforeExpiryDecision.reasons.includes("blocked_ip"));
  assert.equal(activeBeforeExpiryDecision.matchedBlockedEntity.id, expiringBlockedEntity.id);
  assert.equal(activeBeforeExpiryDecision.matchedBlockedEntity.originKind, "manual");

  await new Promise((resolve) => setTimeout(resolve, 2_000));

  const expiredAllowDecision = await runtime.protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: new Date().toISOString(),
    method: "GET",
    host: siteData.site.domain,
    path: "/account",
    clientIp: expiringBlockedIp,
    userAgent: "Mozilla/5.0"
  });

  assert.equal(expiredAllowDecision.mode, "monitor");
  assert.equal(expiredAllowDecision.action, "allow");
  assert.deepEqual(expiredAllowDecision.reasons, []);
  assert.equal(expiredAllowDecision.matchedBlockedEntity ?? null, null);

  const blockedEntitiesAfterExpiry = await runtime.listBlockedEntities(token, siteData.site.id);
  assert.equal(blockedEntitiesAfterExpiry.length, 1);
  assert.equal(blockedEntitiesAfterExpiry[0].id, expiringBlockedEntity.id);
  assert.equal(blockedEntitiesAfterExpiry[0].entityValue, expiringBlockedIp);
  assert.equal(blockedEntitiesAfterExpiry[0].isActive, false);

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl: runtime.config.apiBaseUrl,
        tenantId: tenant.id,
        siteId: siteData.site.id,
        defaultPolicyMode: defaultPolicy.mode,
        updatedPolicyMode: updatedPolicy.mode,
        blockedEntityId: blockedEntity.id,
        blockedDecision,
        monitorDecision,
        allowDecision,
        expiringBlockedEntityId: expiringBlockedEntity.id,
        expiringBlockedEntityIsActiveAfterCreate: blockedEntitiesAfterExpiringCreate[0].isActive,
        activeBeforeExpiryDecision,
        expiredAllowDecision,
        expiredBlockedEntityIsActive: blockedEntitiesAfterExpiry[0].isActive
      },
      null,
      2
    )
  );
}

try {
  await main();
} finally {
  await runtime.shutdown();
}
