import type { CreateAiRiskResultInput, HeuristicAnalyzerResult } from "../db/types.js";

export const AI_RISK_MODEL_NAME = "heuristic-analyzer";
export const AI_RISK_MODEL_VERSION = "v1";

export function buildAiRiskResultInput(input: {
  tenantId: string;
  siteId: string;
  requestLogId?: number;
  attackEventId?: number;
  analysis: HeuristicAnalyzerResult;
}): CreateAiRiskResultInput {
  return {
    tenantId: input.tenantId,
    siteId: input.siteId,
    requestLogId: input.requestLogId,
    attackEventId: input.attackEventId,
    riskScore: input.analysis.riskScore,
    riskLevel: input.analysis.riskLevel,
    explanation: input.analysis.reasons.join(" "),
    factors: {
      reasons: input.analysis.reasons
    },
    rawResponse: {
      modelName: AI_RISK_MODEL_NAME,
      modelVersion: AI_RISK_MODEL_VERSION,
      riskScore: input.analysis.riskScore,
      riskLevel: input.analysis.riskLevel,
      reasons: input.analysis.reasons
    }
  };
}
