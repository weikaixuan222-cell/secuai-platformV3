import { withTransaction } from "../db/client.js";
import type { AttackEventRow, AttackSeverity, RequestLogRow } from "../db/types.js";
import { analyzeHeuristicRisk } from "../lib/aiAnalyzerClient.js";
import { buildAiRiskResultInput } from "../lib/aiRiskResults.js";
import { createAiRiskResult } from "../repositories/aiRiskResultsRepository.js";
import {
  createAttackEvent,
  hasRecentAttackEventForClient
} from "../repositories/attackEventsRepository.js";
import {
  countRecentRequestsBySiteAndIp,
  listPendingRequestLogs,
  markRequestLogProcessed
} from "../repositories/requestLogsRepository.js";
import {
  findThreatSignalMatch,
  isSuspiciousUserAgentAllowed,
  SQLI_RULE_TOKENS,
  SUSPICIOUS_USER_AGENTS,
  XSS_RULE_TOKENS
} from "./requestThreatSignals.js";

const HIGH_FREQUENCY_WINDOW_SECONDS = 60;
const HIGH_FREQUENCY_THRESHOLD = 5;
const HIGH_FREQUENCY_DEDUP_WINDOW_SECONDS = 300;

type StructuredAttackEventDetails = {
  matchedField: string;
  matchedRule: string;
  matchedSnippet: string;
  reason: string;
  clientIp?: string;
  matchedTokens?: string[];
  recentRequestCount?: number;
  threshold?: number;
  windowSeconds?: number;
};

type DetectionFinding = {
  eventType: string;
  ruleCode: string;
  severity: AttackSeverity;
  summary: string;
  details: StructuredAttackEventDetails;
};

export type DetectionRunResult = {
  processedCount: number;
  eventCount: number;
  logsWithFindings: number;
  aiSuccessCount: number;
  aiFailureCount: number;
};

async function detectFindings(log: RequestLogRow): Promise<DetectionFinding[]> {
  const findings: DetectionFinding[] = [];
  const textFields = [
    { name: "path", value: log.path },
    { name: "queryString", value: log.query_string },
    { name: "userAgent", value: log.user_agent },
    { name: "referer", value: log.referer }
  ];

  const sqliMatch = findThreatSignalMatch(textFields, SQLI_RULE_TOKENS);

  if (sqliMatch) {
    findings.push({
      eventType: "sql_injection",
      ruleCode: "mvp-sqli-keyword",
      severity: "high",
      summary: "Potential SQL injection keywords detected in the request.",
      details: {
        matchedField: sqliMatch.field,
        matchedRule: "mvp-sqli-keyword",
        matchedSnippet: sqliMatch.token,
        reason: "The request matched known SQL injection keyword patterns.",
        matchedTokens: sqliMatch.matchedTokens,
        clientIp: log.client_ip ?? undefined
      }
    });
  }

  const xssMatch = findThreatSignalMatch(textFields, XSS_RULE_TOKENS);

  if (xssMatch) {
    findings.push({
      eventType: "xss_payload",
      ruleCode: "mvp-xss-payload",
      severity: "high",
      summary: "Potential XSS payload detected in the request.",
      details: {
        matchedField: xssMatch.field,
        matchedRule: "mvp-xss-payload",
        matchedSnippet: xssMatch.token,
        reason: "The request matched common XSS payload fragments.",
        matchedTokens: xssMatch.matchedTokens,
        clientIp: log.client_ip ?? undefined
      }
    });
  }

  const suspiciousUserAgentMatch = findThreatSignalMatch(
    [{ name: "userAgent", value: log.user_agent }],
    SUSPICIOUS_USER_AGENTS
  );

  if (suspiciousUserAgentMatch && !isSuspiciousUserAgentAllowed(log.user_agent)) {
    findings.push({
      eventType: "suspicious_user_agent",
      ruleCode: "mvp-suspicious-user-agent",
      severity: "medium",
      summary: "Suspicious scanning tool user-agent detected.",
      details: {
        matchedField: suspiciousUserAgentMatch.field,
        matchedRule: "mvp-suspicious-user-agent",
        matchedSnippet: suspiciousUserAgentMatch.token,
        reason: "The user-agent matched a known scanning or enumeration tool.",
        matchedTokens: suspiciousUserAgentMatch.matchedTokens,
        clientIp: log.client_ip ?? undefined
      }
    });
  }

  if (log.client_ip) {
    const recentRequestCount = await countRecentRequestsBySiteAndIp(
      log.site_id,
      log.client_ip,
      log.occurred_at,
      HIGH_FREQUENCY_WINDOW_SECONDS
    );

    if (recentRequestCount >= HIGH_FREQUENCY_THRESHOLD) {
      findings.push({
        eventType: "high_frequency_access",
        ruleCode: "mvp-high-frequency-access",
        severity: "medium",
        summary: "Abnormally high request frequency detected from the same client IP.",
        details: {
          matchedField: "clientIp",
          matchedRule: "mvp-high-frequency-access",
          matchedSnippet: log.client_ip,
          reason: "The same client IP exceeded the simplified request threshold within the detection window.",
          clientIp: log.client_ip,
          recentRequestCount,
          threshold: HIGH_FREQUENCY_THRESHOLD,
          windowSeconds: HIGH_FREQUENCY_WINDOW_SECONDS
        }
      });
    }
  }

  return findings;
}

async function shouldSkipFinding(log: RequestLogRow, finding: DetectionFinding): Promise<boolean> {
  if (finding.eventType !== "high_frequency_access" || !log.client_ip) {
    return false;
  }

  return hasRecentAttackEventForClient({
    siteId: log.site_id,
    eventType: finding.eventType,
    clientIp: log.client_ip,
    referenceTime: new Date(),
    windowSeconds: HIGH_FREQUENCY_DEDUP_WINDOW_SECONDS
  });
}

function buildAnalyzerPayload(log: RequestLogRow, attackEvent: AttackEventRow): {
  request_log: Record<string, unknown>;
  attack_event: Record<string, unknown>;
} {
  return {
    request_log: {
      method: log.method,
      host: log.host,
      path: log.path,
      query_string: log.query_string,
      status_code: log.status_code,
      client_ip: log.client_ip,
      user_agent: log.user_agent,
      referer: log.referer,
      metadata: log.metadata
    },
    attack_event: {
      event_type: attackEvent.event_type,
      severity: attackEvent.severity,
      summary: attackEvent.summary,
      details: attackEvent.details
    }
  };
}

async function persistDetectionResult(
  log: RequestLogRow,
  findings: DetectionFinding[]
): Promise<AttackEventRow[]> {
  return withTransaction(async (client) => {
    const createdEvents: AttackEventRow[] = [];

    for (const finding of findings) {
      const attackEvent = await createAttackEvent(
        {
          tenantId: log.tenant_id,
          siteId: log.site_id,
          requestLogId: log.id,
          eventType: finding.eventType,
          ruleCode: finding.ruleCode,
          severity: finding.severity,
          summary: finding.summary,
          details: finding.details
        },
        client
      );

      createdEvents.push(attackEvent);
    }

    await markRequestLogProcessed(log.id, client);
    return createdEvents;
  });
}

async function persistAiRiskResultForEvent(log: RequestLogRow, attackEvent: AttackEventRow): Promise<void> {
  const analysis = await analyzeHeuristicRisk(buildAnalyzerPayload(log, attackEvent));

  await createAiRiskResult(
    buildAiRiskResultInput({
      tenantId: log.tenant_id,
      siteId: log.site_id,
      requestLogId: log.id,
      attackEventId: attackEvent.id,
      analysis
    })
  );
}

async function processSingleLog(log: RequestLogRow): Promise<{
  createdEventCount: number;
  aiSuccessCount: number;
  aiFailureCount: number;
}> {
  const rawFindings = await detectFindings(log);
  const findings: DetectionFinding[] = [];

  for (const finding of rawFindings) {
    if (await shouldSkipFinding(log, finding)) {
      continue;
    }

    findings.push(finding);
  }

  const createdEvents = await persistDetectionResult(log, findings);
  let aiSuccessCount = 0;
  let aiFailureCount = 0;

  for (const attackEvent of createdEvents) {
    try {
      await persistAiRiskResultForEvent(log, attackEvent);
      aiSuccessCount += 1;
    } catch (error) {
      aiFailureCount += 1;

      console.error("AI risk scoring failed after attack event persistence.", {
        requestLogId: log.id,
        attackEventId: attackEvent.id,
        tenantId: log.tenant_id,
        siteId: log.site_id,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error)
      });
    }
  }

  return {
    createdEventCount: createdEvents.length,
    aiSuccessCount,
    aiFailureCount
  };
}

export async function runAttackDetection(input: {
  tenantIds: string[];
  limit?: number;
}): Promise<DetectionRunResult> {
  const pendingLogs = await listPendingRequestLogs({
    tenantIds: input.tenantIds,
    limit: input.limit
  });

  let eventCount = 0;
  let logsWithFindings = 0;
  let aiSuccessCount = 0;
  let aiFailureCount = 0;

  for (const log of pendingLogs) {
    const result = await processSingleLog(log);
    eventCount += result.createdEventCount;
    aiSuccessCount += result.aiSuccessCount;
    aiFailureCount += result.aiFailureCount;

    if (result.createdEventCount > 0) {
      logsWithFindings += 1;
    }
  }

  return {
    processedCount: pendingLogs.length,
    eventCount,
    logsWithFindings,
    aiSuccessCount,
    aiFailureCount
  };
}
