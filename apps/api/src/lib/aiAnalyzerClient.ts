import { getAiAnalyzerEnvConfig } from "../config/env.js";
import type { HeuristicAnalyzerResult } from "../db/types.js";

type AnalyzeRequestPayload = {
  request_log: Record<string, unknown>;
  attack_event?: Record<string, unknown>;
};

class AiAnalyzerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const aiAnalyzerConfig = getAiAnalyzerEnvConfig();

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeHeuristicRisk(
  payload: AnalyzeRequestPayload
): Promise<HeuristicAnalyzerResult> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= aiAnalyzerConfig.maxRetries) {
    try {
      const response = await fetchWithTimeout(
        `${aiAnalyzerConfig.aiAnalyzerUrl}/analyze`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        },
        aiAnalyzerConfig.timeoutMs
      );

      if (!response.ok) {
        throw new AiAnalyzerError(
          "AI_ANALYZER_HTTP_ERROR",
          `AI analyzer returned HTTP ${response.status}.`
        );
      }

      const result = (await response.json()) as HeuristicAnalyzerResult;

      if (
        !result ||
        typeof result.riskScore !== "number" ||
        !["low", "medium", "high"].includes(result.riskLevel) ||
        !Array.isArray(result.reasons)
      ) {
        throw new AiAnalyzerError("AI_ANALYZER_INVALID_RESPONSE", "AI analyzer returned an invalid response.");
      }

      return result;
    } catch (error) {
      lastError = error;
      attempt += 1;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new AiAnalyzerError("AI_ANALYZER_FAILED", "AI analyzer request failed.");
}

export { AiAnalyzerError };
