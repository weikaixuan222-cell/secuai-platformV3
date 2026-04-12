import assert from "node:assert/strict";

import { createSmokeRuntime } from "./smoke-runtime-helpers.mjs";

const runtime = createSmokeRuntime();

function ensureSqlInjectionEvent(items) {
  return items.find((item) => item.eventType === "sql_injection");
}

async function main() {
  await runtime.prepareRuntime({ startAnalyzer: true });

  const suffix = Date.now().toString();
  const { token } = await runtime.registerAndLogin(
    `backend-smoke-${suffix}@example.com`,
    "Main Chain Smoke User"
  );
  const tenant = await runtime.createTenant(
    token,
    "Backend Smoke Tenant",
    `backend-smoke-${suffix}`
  );
  const siteData = await runtime.createSite(
    token,
    tenant.id,
    "Backend Smoke Site",
    `backend-smoke-${suffix}.example.com`
  );

  await runtime.updateSecurityPolicy(token, siteData.site.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 120,
    autoBlockHighRisk: true,
    highRiskScoreThreshold: 70
  });

  for (let index = 0; index < 6; index += 1) {
    const seconds = index.toString().padStart(2, "0");
    await runtime.submitRequestLog(siteData.ingestionKey, {
      siteId: siteData.site.id,
      occurredAt: `2026-04-02T10:00:${seconds}.000Z`,
      method: "GET",
      host: siteData.site.domain,
      path: "/products",
      queryString: "category=books",
      statusCode: 200,
      clientIp: "203.0.113.10",
      userAgent: "Mozilla/5.0",
      metadata: {
        source: "backend-main-chain-smoke-high-frequency"
      }
    });
  }

  const sqlRequest = await runtime.submitRequestLog(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T10:01:00.000Z",
    method: "GET",
    host: siteData.site.domain,
    path: "/login",
    queryString: "id=1 UNION SELECT password FROM users",
    statusCode: 200,
    clientIp: "203.0.113.20",
    userAgent: "Mozilla/5.0",
    metadata: {
      source: "backend-main-chain-smoke-sqli"
    }
  });
  assert.equal(sqlRequest.protection.mode, "monitor");
  assert.equal(sqlRequest.protection.action, "monitor");
  assert.ok(sqlRequest.protection.reasons.includes("blocked_sql_injection"));

  const detectionResult = await runtime.runDetection(token, tenant.id);
  assert.equal(detectionResult.processedCount, 7);
  assert.ok(detectionResult.eventCount >= 2);
  assert.ok(detectionResult.aiSuccessCount >= 2);
  assert.equal(detectionResult.aiFailureCount, 0);

  const attackEvents = await runtime.listAttackEvents(token, tenant.id, siteData.site.id);
  const aiRiskResults = await runtime.listAiRiskResults(token, tenant.id, siteData.site.id);
  const siteSummaries = await runtime.listSiteSummaries(token, tenant.id, siteData.site.id);
  const recentHighRiskEvents = await runtime.listRecentHighRiskEvents(
    token,
    tenant.id,
    siteData.site.id
  );

  const sqlInjectionEvent = ensureSqlInjectionEvent(attackEvents);
  assert.ok(sqlInjectionEvent, "Expected at least one sql_injection event.");
  assert.equal(String(sqlInjectionEvent.requestLogId), String(sqlRequest.requestLog.id));
  assert.equal(sqlInjectionEvent.details?.protectionEnforcement?.mode, "monitor");
  assert.equal(sqlInjectionEvent.details?.protectionEnforcement?.action, "monitor");
  assert.deepEqual(
    sqlInjectionEvent.details?.protectionEnforcement?.reasons,
    sqlRequest.protection.reasons
  );
  assert.equal(
    sqlInjectionEvent.details?.protectionEnforcement?.matchedBlockedEntity ?? null,
    null
  );

  const blockedEntitiesFromEvent = await runtime.listBlockedEntities(token, siteData.site.id, {
    attackEventId: Number(sqlInjectionEvent.id)
  });
  assert.equal(blockedEntitiesFromEvent.length, 1);
  const blockedEntityFromEvent = blockedEntitiesFromEvent[0];
  assert.equal(blockedEntityFromEvent.entityValue, "203.0.113.20");
  assert.equal(blockedEntityFromEvent.source, "automatic");
  assert.equal(blockedEntityFromEvent.originKind, "event_disposition");
  assert.equal(Number(blockedEntityFromEvent.attackEventId), Number(sqlInjectionEvent.id));
  assert.equal(blockedEntityFromEvent.isActive, true);

  const unrelatedBlockedEntity = await runtime.createBlockedEntity(token, siteData.site.id, {
    entityType: "ip",
    entityValue: "203.0.113.21",
    reason: "main-chain-unrelated-blocked-entity-smoke"
  });
  assert.equal(unrelatedBlockedEntity.originKind, "manual");

  const blockedEntities = await runtime.listBlockedEntities(token, siteData.site.id);
  assert.equal(blockedEntities.length, 2);
  const linkedBlockedEntity = blockedEntities.find((item) => String(item.id) === String(blockedEntityFromEvent.id));
  assert.ok(linkedBlockedEntity, "Expected blocked entity list to include the event-linked record.");
  assert.equal(linkedBlockedEntity.originKind, "event_disposition");
  assert.equal(Number(linkedBlockedEntity.attackEventId), Number(sqlInjectionEvent.id));
  assert.equal(blockedEntitiesFromEvent[0].id, blockedEntityFromEvent.id);
  assert.equal(blockedEntitiesFromEvent[0].originKind, "event_disposition");
  assert.equal(Number(blockedEntitiesFromEvent[0].attackEventId), Number(sqlInjectionEvent.id));

  const replayedRequestLog = await runtime.resetRequestLogProcessedForDetectionForSmoke(
    sqlRequest.requestLog.id
  );
  assert.equal(Number(replayedRequestLog.id), Number(sqlRequest.requestLog.id));

  const replayedDetectionResult = await runtime.runDetection(token, tenant.id);
  assert.equal(replayedDetectionResult.processedCount, 1);
  assert.equal(replayedDetectionResult.eventCount, 0);
  assert.equal(replayedDetectionResult.aiSuccessCount, 0);

  const attackEventsAfterReplay = await runtime.listAttackEvents(token, tenant.id, siteData.site.id);
  const replayedSqlInjectionEvents = attackEventsAfterReplay.filter(
    (item) =>
      item.eventType === "sql_injection" &&
      String(item.requestLogId) === String(sqlRequest.requestLog.id)
  );
  assert.equal(replayedSqlInjectionEvents.length, 1);

  const blockedEntitiesAfterReplay = await runtime.listBlockedEntities(token, siteData.site.id);
  const automaticBlockedEntitiesAfterReplay = blockedEntitiesAfterReplay.filter(
    (item) => item.entityValue === "203.0.113.20" && item.source === "automatic"
  );
  assert.equal(automaticBlockedEntitiesAfterReplay.length, 1);
  assert.equal(automaticBlockedEntitiesAfterReplay[0].id, blockedEntityFromEvent.id);

  const attackEventDetail = await runtime.getAttackEventDetail(token, Number(sqlInjectionEvent.id));
  assert.equal(attackEventDetail.attackEvent.id, sqlInjectionEvent.id);
  assert.equal(attackEventDetail.blockedEntities.length, 1);
  assert.equal(attackEventDetail.blockedEntities[0].id, blockedEntityFromEvent.id);
  assert.equal(attackEventDetail.blockedEntities[0].originKind, "event_disposition");
  assert.equal(
    Number(attackEventDetail.blockedEntities[0].attackEventId),
    Number(sqlInjectionEvent.id)
  );
  assert.equal(attackEventDetail.blockedEntities[0].isActive, true);
  assert.equal(attackEventDetail.activeBlockedEntity.id, blockedEntityFromEvent.id);
  assert.equal(attackEventDetail.activeBlockedEntity.originKind, "event_disposition");
  assert.equal(attackEventDetail.activeBlockedEntity.isActive, true);
  assert.deepEqual(attackEventDetail.protectionEnforcement, {
    mode: "monitor",
    action: "monitor",
    reasons: sqlRequest.protection.reasons,
    matchedBlockedEntity: null
  });
  assert.deepEqual(attackEventDetail.dispositionSummary, {
    status: "active",
    blockedEntityCount: 1,
    activeBlockedEntityId: blockedEntityFromEvent.id,
    activeEntityType: "ip",
    activeEntityValue: "203.0.113.20",
    activeSource: "automatic",
    activeOriginKind: "event_disposition",
    activeAttackEventId: Number(sqlInjectionEvent.id)
  });

  const automaticDuplicateBody = {
    entityType: "ip",
    entityValue: "203.0.113.20",
    reason: "main-chain-automatic-duplicate-guard",
    source: "automatic",
    attackEventId: Number(sqlInjectionEvent.id)
  };
  const [automaticDuplicateCreateA, automaticDuplicateCreateB] = await Promise.all([
    runtime.createBlockedEntity(token, siteData.site.id, automaticDuplicateBody),
    runtime.createBlockedEntity(token, siteData.site.id, automaticDuplicateBody)
  ]);
  assert.equal(automaticDuplicateCreateA.id, blockedEntityFromEvent.id);
  assert.equal(automaticDuplicateCreateB.id, blockedEntityFromEvent.id);

  const blockedEntitiesAfterAutomaticDuplicateCreate = await runtime.listBlockedEntities(
    token,
    siteData.site.id
  );
  const automaticBlockedEntitiesForIpAfterDuplicateCreate =
    blockedEntitiesAfterAutomaticDuplicateCreate.filter(
      (item) => item.entityValue === "203.0.113.20" && item.source === "automatic"
    );
  assert.equal(automaticBlockedEntitiesForIpAfterDuplicateCreate.length, 1);
  assert.equal(automaticBlockedEntitiesForIpAfterDuplicateCreate[0].id, blockedEntityFromEvent.id);

  const postDispositionProtection = await runtime.protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T10:02:00.000Z",
    method: "GET",
    host: siteData.site.domain,
    path: "/checkout",
    clientIp: "203.0.113.20",
    userAgent: "Mozilla/5.0"
  });
  assert.equal(postDispositionProtection.mode, "monitor");
  assert.equal(postDispositionProtection.action, "monitor");
  assert.ok(postDispositionProtection.reasons.includes("blocked_ip"));
  assert.equal(postDispositionProtection.matchedBlockedEntity.id, blockedEntityFromEvent.id);
  assert.equal(postDispositionProtection.matchedBlockedEntity.originKind, "event_disposition");
  assert.equal(
    Number(postDispositionProtection.matchedBlockedEntity.attackEventId),
    Number(sqlInjectionEvent.id)
  );

  const repeatedHighRiskRequest = await runtime.submitRequestLog(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T10:03:00.000Z",
    method: "GET",
    host: siteData.site.domain,
    path: "/admin/login",
    queryString: "id=1 UNION SELECT email FROM users",
    statusCode: 200,
    clientIp: "203.0.113.20",
    userAgent: "Mozilla/5.0",
    metadata: {
      source: "backend-main-chain-smoke-repeat-sqli"
    }
  });
  assert.equal(repeatedHighRiskRequest.protection.mode, "monitor");
  assert.equal(repeatedHighRiskRequest.protection.action, "monitor");
  assert.ok(repeatedHighRiskRequest.protection.reasons.includes("blocked_ip"));
  assert.ok(repeatedHighRiskRequest.protection.reasons.includes("blocked_sql_injection"));
  assert.equal(
    repeatedHighRiskRequest.protection.matchedBlockedEntity.id,
    blockedEntityFromEvent.id
  );

  const repeatedDetectionResult = await runtime.runDetection(token, tenant.id);
  assert.equal(repeatedDetectionResult.processedCount, 1);
  assert.ok(repeatedDetectionResult.eventCount >= 1);
  assert.ok(repeatedDetectionResult.aiSuccessCount >= 1);

  const attackEventsAfterRepeat = await runtime.listAttackEvents(token, tenant.id, siteData.site.id);
  const repeatedSqlInjectionEvent = attackEventsAfterRepeat.find(
    (item) =>
      item.eventType === "sql_injection" &&
      String(item.requestLogId) === String(repeatedHighRiskRequest.requestLog.id)
  );
  assert.ok(repeatedSqlInjectionEvent);

  const blockedEntitiesAfterRepeat = await runtime.listBlockedEntities(token, siteData.site.id);
  const automaticBlockedEntitiesForIp = blockedEntitiesAfterRepeat.filter(
    (item) => item.entityValue === "203.0.113.20" && item.source === "automatic"
  );
  assert.equal(automaticBlockedEntitiesForIp.length, 1);
  assert.equal(automaticBlockedEntitiesForIp[0].id, blockedEntityFromEvent.id);
  assert.equal(
    Number(automaticBlockedEntitiesForIp[0].attackEventId),
    Number(sqlInjectionEvent.id)
  );

  const blockedEntitiesFromRepeatedEvent = await runtime.listBlockedEntities(token, siteData.site.id, {
    attackEventId: Number(repeatedSqlInjectionEvent.id)
  });
  assert.equal(blockedEntitiesFromRepeatedEvent.length, 0);

  const deletedAutomaticBlockedEntity = await runtime.deleteBlockedEntity(
    token,
    blockedEntityFromEvent.id
  );
  assert.equal(deletedAutomaticBlockedEntity.deleted, true);
  assert.equal(deletedAutomaticBlockedEntity.blockedEntity.id, blockedEntityFromEvent.id);

  const blockedEntitiesAfterAutoDelete = await runtime.listBlockedEntities(token, siteData.site.id);
  assert.equal(
    blockedEntitiesAfterAutoDelete.filter((item) => item.entityValue === "203.0.113.20").length,
    0
  );

  const recreatedHighRiskRequest = await runtime.submitRequestLog(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T10:03:30.000Z",
    method: "GET",
    host: siteData.site.domain,
    path: "/support/login",
    queryString: "id=1 UNION SELECT token FROM sessions",
    statusCode: 200,
    clientIp: "203.0.113.20",
    userAgent: "Mozilla/5.0",
    metadata: {
      source: "backend-main-chain-smoke-recreate-auto-block"
    }
  });
  assert.equal(recreatedHighRiskRequest.protection.mode, "monitor");
  assert.equal(recreatedHighRiskRequest.protection.action, "monitor");
  assert.ok(recreatedHighRiskRequest.protection.reasons.includes("blocked_sql_injection"));
  assert.equal(recreatedHighRiskRequest.protection.matchedBlockedEntity ?? null, null);

  const recreatedDetectionResult = await runtime.runDetection(token, tenant.id);
  assert.equal(recreatedDetectionResult.processedCount, 1);
  assert.ok(recreatedDetectionResult.eventCount >= 1);
  assert.ok(recreatedDetectionResult.aiSuccessCount >= 1);

  const attackEventsAfterAutoRecreate = await runtime.listAttackEvents(
    token,
    tenant.id,
    siteData.site.id
  );
  const recreatedSqlInjectionEvent = attackEventsAfterAutoRecreate.find(
    (item) =>
      item.eventType === "sql_injection" &&
      String(item.requestLogId) === String(recreatedHighRiskRequest.requestLog.id)
  );
  assert.ok(recreatedSqlInjectionEvent, "Expected a sql_injection event after recreating auto disposition.");

  const blockedEntitiesAfterAutoRecreate = await runtime.listBlockedEntities(token, siteData.site.id, {
    attackEventId: Number(recreatedSqlInjectionEvent.id)
  });
  assert.equal(blockedEntitiesAfterAutoRecreate.length, 1);
  assert.equal(blockedEntitiesAfterAutoRecreate[0].entityValue, "203.0.113.20");
  assert.equal(blockedEntitiesAfterAutoRecreate[0].source, "automatic");
  assert.equal(blockedEntitiesAfterAutoRecreate[0].originKind, "event_disposition");
  assert.equal(blockedEntitiesAfterAutoRecreate[0].isActive, true);
  assert.equal(
    Number(blockedEntitiesAfterAutoRecreate[0].attackEventId),
    Number(recreatedSqlInjectionEvent.id)
  );
  assert.notEqual(blockedEntitiesAfterAutoRecreate[0].id, blockedEntityFromEvent.id);

  const recreatedProtection = await runtime.protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: "2026-04-02T10:03:31.000Z",
    method: "GET",
    host: siteData.site.domain,
    path: "/checkout",
    clientIp: "203.0.113.20",
    userAgent: "Mozilla/5.0"
  });
  assert.equal(recreatedProtection.mode, "monitor");
  assert.equal(recreatedProtection.action, "monitor");
  assert.ok(recreatedProtection.reasons.includes("blocked_ip"));
  assert.equal(
    recreatedProtection.matchedBlockedEntity.id,
    blockedEntitiesAfterAutoRecreate[0].id
  );
  assert.equal(recreatedProtection.matchedBlockedEntity.source, "automatic");
  assert.equal(
    Number(recreatedProtection.matchedBlockedEntity.attackEventId),
    Number(recreatedSqlInjectionEvent.id)
  );

  const expiredAutomaticBlockedEntity = await runtime.expireBlockedEntityForSmoke(
    blockedEntitiesAfterAutoRecreate[0].id
  );
  assert.equal(
    Number(expiredAutomaticBlockedEntity.id),
    Number(blockedEntitiesAfterAutoRecreate[0].id)
  );
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const expiredAutomaticOccurredAt = new Date().toISOString();

  const expiredAutomaticProtection = await runtime.protectionCheck(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: expiredAutomaticOccurredAt,
    method: "GET",
    host: siteData.site.domain,
    path: "/checkout",
    clientIp: "203.0.113.20",
    userAgent: "Mozilla/5.0"
  });
  assert.equal(expiredAutomaticProtection.mode, "monitor");
  assert.equal(expiredAutomaticProtection.action, "allow");
  assert.deepEqual(expiredAutomaticProtection.reasons, []);
  assert.equal(expiredAutomaticProtection.matchedBlockedEntity ?? null, null);

  const postExpiryHighRiskOccurredAt = new Date(Date.now() + 1_000).toISOString();

  const postExpiryHighRiskRequest = await runtime.submitRequestLog(siteData.ingestionKey, {
    siteId: siteData.site.id,
    occurredAt: postExpiryHighRiskOccurredAt,
    method: "GET",
    host: siteData.site.domain,
    path: "/portal/login",
    queryString: "id=1 UNION SELECT password_hash FROM admins",
    statusCode: 200,
    clientIp: "203.0.113.20",
    userAgent: "Mozilla/5.0",
    metadata: {
      source: "backend-main-chain-smoke-expired-auto-block"
    }
  });
  assert.equal(postExpiryHighRiskRequest.protection.mode, "monitor");
  assert.equal(postExpiryHighRiskRequest.protection.action, "monitor");
  assert.ok(postExpiryHighRiskRequest.protection.reasons.includes("blocked_sql_injection"));
  assert.equal(postExpiryHighRiskRequest.protection.matchedBlockedEntity ?? null, null);

  const postExpiryDetectionResult = await runtime.runDetection(token, tenant.id);
  assert.equal(postExpiryDetectionResult.processedCount, 1);
  assert.ok(postExpiryDetectionResult.eventCount >= 1);
  assert.ok(postExpiryDetectionResult.aiSuccessCount >= 1);

  const attackEventsAfterExpiry = await runtime.listAttackEvents(token, tenant.id, siteData.site.id);
  const recreatedAfterExpiryEvent = attackEventsAfterExpiry.find(
    (item) =>
      item.eventType === "sql_injection" &&
      String(item.requestLogId) === String(postExpiryHighRiskRequest.requestLog.id)
  );
  assert.ok(
    recreatedAfterExpiryEvent,
    "Expected a sql_injection event after the automatic disposition expired."
  );

  const blockedEntitiesAfterExpiryRecreate = await runtime.listBlockedEntities(token, siteData.site.id);
  const automaticBlockedEntitiesAfterExpiry = blockedEntitiesAfterExpiryRecreate.filter(
    (item) => item.entityValue === "203.0.113.20" && item.source === "automatic"
  );
  assert.equal(automaticBlockedEntitiesAfterExpiry.length, 2);
  const activeAutomaticBlockedEntitiesAfterExpiry = automaticBlockedEntitiesAfterExpiry.filter(
    (item) => item.isActive
  );
  assert.equal(activeAutomaticBlockedEntitiesAfterExpiry.length, 1);
  assert.equal(
    Number(activeAutomaticBlockedEntitiesAfterExpiry[0].attackEventId),
    Number(recreatedAfterExpiryEvent.id)
  );
  assert.notEqual(
    Number(activeAutomaticBlockedEntitiesAfterExpiry[0].id),
    Number(blockedEntitiesAfterAutoRecreate[0].id)
  );

  const recreatedAfterExpiryOccurredAt = new Date(Date.now() + 2_000).toISOString();

  const recreatedAfterExpiryProtection = await runtime.protectionCheck(
    siteData.ingestionKey,
    {
      siteId: siteData.site.id,
      occurredAt: recreatedAfterExpiryOccurredAt,
      method: "GET",
      host: siteData.site.domain,
      path: "/checkout",
      clientIp: "203.0.113.20",
      userAgent: "Mozilla/5.0"
    }
  );
  assert.equal(recreatedAfterExpiryProtection.mode, "monitor");
  assert.equal(recreatedAfterExpiryProtection.action, "monitor");
  assert.ok(recreatedAfterExpiryProtection.reasons.includes("blocked_ip"));
  assert.equal(
    Number(recreatedAfterExpiryProtection.matchedBlockedEntity.id),
    Number(activeAutomaticBlockedEntitiesAfterExpiry[0].id)
  );
  assert.equal(
    Number(recreatedAfterExpiryProtection.matchedBlockedEntity.attackEventId),
    Number(recreatedAfterExpiryEvent.id)
  );

  const belowThresholdSiteData = await runtime.createSite(
    token,
    tenant.id,
    "Backend Smoke Threshold Guard Site",
    `backend-smoke-threshold-${suffix}.example.com`
  );

  await runtime.updateSecurityPolicy(token, belowThresholdSiteData.site.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 120,
    autoBlockHighRisk: true,
    highRiskScoreThreshold: 95
  });

  const belowThresholdSqlRequest = await runtime.submitRequestLog(belowThresholdSiteData.ingestionKey, {
    siteId: belowThresholdSiteData.site.id,
    occurredAt: "2026-04-02T10:04:00.000Z",
    method: "GET",
    host: belowThresholdSiteData.site.domain,
    path: "/login",
    queryString: "id=1 UNION SELECT password FROM users",
    statusCode: 200,
    clientIp: "203.0.113.30",
    userAgent: "Mozilla/5.0",
    metadata: {
      source: "backend-main-chain-smoke-below-threshold"
    }
  });
  assert.equal(belowThresholdSqlRequest.protection.mode, "monitor");
  assert.equal(belowThresholdSqlRequest.protection.action, "monitor");
  assert.ok(belowThresholdSqlRequest.protection.reasons.includes("blocked_sql_injection"));
  assert.equal(belowThresholdSqlRequest.protection.matchedBlockedEntity ?? null, null);

  const belowThresholdDetectionResult = await runtime.runDetection(token, tenant.id);
  assert.equal(belowThresholdDetectionResult.processedCount, 1);
  assert.ok(belowThresholdDetectionResult.eventCount >= 1);
  assert.ok(belowThresholdDetectionResult.aiSuccessCount >= 1);

  const belowThresholdAttackEvents = await runtime.listAttackEvents(
    token,
    tenant.id,
    belowThresholdSiteData.site.id
  );
  const belowThresholdSqlInjectionEvent = ensureSqlInjectionEvent(belowThresholdAttackEvents);
  assert.ok(
    belowThresholdSqlInjectionEvent,
    "Expected a sql_injection event for the below-threshold site."
  );

  const belowThresholdBlockedEntities = await runtime.listBlockedEntities(
    token,
    belowThresholdSiteData.site.id
  );
  assert.deepEqual(belowThresholdBlockedEntities, []);

  const belowThresholdProtection = await runtime.protectionCheck(
    belowThresholdSiteData.ingestionKey,
    {
      siteId: belowThresholdSiteData.site.id,
      occurredAt: "2026-04-02T10:05:00.000Z",
      method: "GET",
      host: belowThresholdSiteData.site.domain,
      path: "/checkout",
      clientIp: "203.0.113.30",
      userAgent: "Mozilla/5.0"
    }
  );
  assert.equal(belowThresholdProtection.mode, "monitor");
  assert.equal(belowThresholdProtection.action, "allow");
  assert.deepEqual(belowThresholdProtection.reasons, []);
  assert.equal(belowThresholdProtection.matchedBlockedEntity ?? null, null);

  const existingBlockedSiteData = await runtime.createSite(
    token,
    tenant.id,
    "Backend Smoke Existing Block Guard Site",
    `backend-smoke-existing-block-${suffix}.example.com`
  );

  await runtime.updateSecurityPolicy(token, existingBlockedSiteData.site.id, {
    mode: "monitor",
    blockSqlInjection: true,
    blockXss: true,
    blockSuspiciousUserAgent: true,
    enableRateLimit: true,
    rateLimitThreshold: 120,
    autoBlockHighRisk: true,
    highRiskScoreThreshold: 70
  });

  const existingManualBlockedEntity = await runtime.createBlockedEntity(
    token,
    existingBlockedSiteData.site.id,
    {
      entityType: "ip",
      entityValue: "203.0.113.31",
      reason: "backend-main-chain-smoke-existing-manual-block"
    }
  );
  assert.equal(existingManualBlockedEntity.source, "manual");

  const existingBlockedSqlRequest = await runtime.submitRequestLog(
    existingBlockedSiteData.ingestionKey,
    {
      siteId: existingBlockedSiteData.site.id,
      occurredAt: "2026-04-02T10:06:00.000Z",
      method: "GET",
      host: existingBlockedSiteData.site.domain,
      path: "/login",
      queryString: "id=1 UNION SELECT password FROM users",
      statusCode: 200,
      clientIp: "203.0.113.31",
      userAgent: "Mozilla/5.0",
      metadata: {
        source: "backend-main-chain-smoke-existing-block"
      }
    }
  );
  assert.equal(existingBlockedSqlRequest.protection.mode, "monitor");
  assert.equal(existingBlockedSqlRequest.protection.action, "monitor");
  assert.ok(existingBlockedSqlRequest.protection.reasons.includes("blocked_ip"));
  assert.ok(existingBlockedSqlRequest.protection.reasons.includes("blocked_sql_injection"));
  assert.equal(
    existingBlockedSqlRequest.protection.matchedBlockedEntity.id,
    existingManualBlockedEntity.id
  );
  assert.equal(
    existingBlockedSqlRequest.protection.matchedBlockedEntity.source,
    "manual"
  );

  const existingBlockedDetectionResult = await runtime.runDetection(token, tenant.id);
  assert.equal(existingBlockedDetectionResult.processedCount, 1);
  assert.ok(existingBlockedDetectionResult.eventCount >= 1);
  assert.ok(existingBlockedDetectionResult.aiSuccessCount >= 1);

  const existingBlockedEntities = await runtime.listBlockedEntities(
    token,
    existingBlockedSiteData.site.id
  );
  const existingBlockedEntitiesForIp = existingBlockedEntities.filter(
    (item) => item.entityValue === "203.0.113.31"
  );
  const automaticBlockedEntitiesForExistingIp = existingBlockedEntitiesForIp.filter(
    (item) => item.source === "automatic"
  );
  assert.equal(existingBlockedEntitiesForIp.length, 1);
  assert.equal(automaticBlockedEntitiesForExistingIp.length, 0);
  assert.equal(existingBlockedEntitiesForIp[0].id, existingManualBlockedEntity.id);

  const existingBlockedProtection = await runtime.protectionCheck(
    existingBlockedSiteData.ingestionKey,
    {
      siteId: existingBlockedSiteData.site.id,
      occurredAt: "2026-04-02T10:07:00.000Z",
      method: "GET",
      host: existingBlockedSiteData.site.domain,
      path: "/checkout",
      clientIp: "203.0.113.31",
      userAgent: "Mozilla/5.0"
    }
  );
  assert.equal(existingBlockedProtection.mode, "monitor");
  assert.equal(existingBlockedProtection.action, "monitor");
  assert.ok(existingBlockedProtection.reasons.includes("blocked_ip"));
  assert.equal(
    existingBlockedProtection.matchedBlockedEntity.id,
    existingManualBlockedEntity.id
  );
  assert.equal(existingBlockedProtection.matchedBlockedEntity.source, "manual");

  assert.ok(aiRiskResults.length >= 2);
  for (const item of aiRiskResults) {
    assert.equal(item.modelName, "heuristic-analyzer");
    assert.equal(item.modelVersion, "v1");
    assert.equal(Array.isArray(item.factors?.reasons), true);
  }

  assert.equal(siteSummaries.length, 1);
  assert.equal(siteSummaries[0].siteId, siteData.site.id);
  assert.equal(siteSummaries[0].requestLogCount, 7);
  assert.equal(siteSummaries[0].attackEventCount, attackEvents.length);
  assert.equal(siteSummaries[0].aiRiskResultCount, aiRiskResults.length);
  assert.ok(siteSummaries[0].highRiskResultCount >= 1);
  assert.equal(siteSummaries[0].latestRequestLogAt, "2026-04-02T10:01:00.000Z");
  assert.ok(siteSummaries[0].latestAttackEventAt);
  assert.ok(siteSummaries[0].latestAiRiskResultAt);

  assert.deepEqual(recentHighRiskEvents.pagination, {
    limit: 10,
    offset: 0
  });
  assert.ok(recentHighRiskEvents.items.length >= 1);
  assert.equal(recentHighRiskEvents.items[0].siteId, siteData.site.id);
  assert.ok(["high", "critical"].includes(recentHighRiskEvents.items[0].riskLevel));

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl: runtime.config.apiBaseUrl,
        analyzerBaseUrl: runtime.config.analyzerBaseUrl,
        tenantId: tenant.id,
        siteId: siteData.site.id,
        detectionResult,
        sqlRequestProtection: sqlRequest.protection,
        sqlInjectionEventId: sqlInjectionEvent.id,
        sqlInjectionEventProtectionTrace: sqlInjectionEvent.details?.protectionEnforcement ?? null,
        blockedEntityFromEventId: blockedEntityFromEvent.id,
        blockedEntityFromEventOriginKind: blockedEntityFromEvent.originKind ?? null,
        blockedEntityFromEventAttackEventId: blockedEntityFromEvent.attackEventId ?? null,
        blockedEntitiesFromEventCount: blockedEntitiesFromEvent.length,
        automaticDuplicateBlockedEntityIdA: automaticDuplicateCreateA.id,
        automaticDuplicateBlockedEntityIdB: automaticDuplicateCreateB.id,
        automaticBlockedEntityCountForIpAfterDuplicateCreate:
          automaticBlockedEntitiesForIpAfterDuplicateCreate.length,
        replayedDetectionProcessedCount: replayedDetectionResult.processedCount,
        replayedDetectionEventCount: replayedDetectionResult.eventCount,
        replayedDetectionAiSuccessCount: replayedDetectionResult.aiSuccessCount,
        replayedSqlInjectionEventCount: replayedSqlInjectionEvents.length,
        automaticBlockedEntityCountForIpAfterReplay: automaticBlockedEntitiesAfterReplay.length,
        automaticBlockedEntityCountForIpAfterRepeat: automaticBlockedEntitiesForIp.length,
        repeatedSqlInjectionEventId: repeatedSqlInjectionEvent.id,
        blockedEntityAttackEventIdAfterRepeat:
          automaticBlockedEntitiesForIp[0].attackEventId ?? null,
        blockedEntitiesFromRepeatedEventCount: blockedEntitiesFromRepeatedEvent.length,
        recreatedAutomaticBlockedEntityIdAfterDelete:
          blockedEntitiesAfterAutoRecreate[0].id,
        recreatedAutomaticBlockedEntityAttackEventId:
          blockedEntitiesAfterAutoRecreate[0].attackEventId ?? null,
        recreatedAutomaticBlockedEntityCountForIp:
          blockedEntitiesAfterAutoRecreate.filter(
            (item) => item.entityValue === "203.0.113.20" && item.source === "automatic"
          ).length,
        recreatedProtection,
        expiredAutomaticBlockedEntityId: expiredAutomaticBlockedEntity.id,
        expiredAutomaticBlockedEntityExpiresAt: expiredAutomaticBlockedEntity.expiresAt,
        expiredAutomaticProtection,
        recreatedAutomaticBlockedEntityIdAfterExpiry:
          activeAutomaticBlockedEntitiesAfterExpiry[0].id,
        recreatedAutomaticBlockedEntityAttackEventIdAfterExpiry:
          activeAutomaticBlockedEntitiesAfterExpiry[0].attackEventId ?? null,
        recreatedAutomaticBlockedEntityCountForIpAfterExpiry:
          automaticBlockedEntitiesAfterExpiry.length,
        recreatedAutomaticActiveBlockedEntityCountForIpAfterExpiry:
          activeAutomaticBlockedEntitiesAfterExpiry.length,
        recreatedAfterExpiryProtection,
        belowThresholdBlockedEntityCount: belowThresholdBlockedEntities.length,
        belowThresholdProtection,
        existingBlockedEntityCountForIp: existingBlockedEntitiesForIp.length,
        automaticBlockedEntityCountForExistingBlockedIp:
          automaticBlockedEntitiesForExistingIp.length,
        existingBlockedProtection,
        attackEventDetailBlockedEntitiesCount: attackEventDetail.blockedEntities.length,
        attackEventDetailActiveBlockedEntityId: attackEventDetail.activeBlockedEntity?.id ?? null,
        attackEventDetailProtectionEnforcement: attackEventDetail.protectionEnforcement ?? null,
        attackEventDispositionSummary: attackEventDetail.dispositionSummary ?? null,
        postDispositionProtection,
        recentHighRiskEventId: recentHighRiskEvents.items[0].attackEventId,
        siteSummary: siteSummaries[0]
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
