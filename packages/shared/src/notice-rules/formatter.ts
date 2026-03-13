import type { ComplianceResult, ForecastResult } from "./types.js";

export function formatAdvisoryMessage(result: ComplianceResult): string {
  return result.advisoryMessage;
}

export function formatForecastExplanation(result: ForecastResult): string {
  return result.explanation;
}
