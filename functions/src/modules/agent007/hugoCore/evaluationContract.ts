export const PHASE7_EVAL_SCHEMA_VERSION = "hugo-phase7-eval-v1";

export type AppropriateEffect =
  | "APPROPRIATE_CHANGE"
  | "APPROPRIATE_STABILITY"
  | "INAPPROPRIATE_CHANGE"
  | "MISSED_BENEFICIAL_CHANGE"
  | "INCONCLUSIVE"
  | "PROVIDER_ERROR";

export type ExperienceActionability = "ACTIONABLE" | "INFORMATIVE_ONLY" | "IRRELEVANT" | "AMBIGUOUS";
export type HugoTaskClass = "MODEL_NOT_REQUIRED" | "GENERATION_ONLY" | "STRUCTURED_REASONING" | "OPEN_REASONING" | "HUMAN_REQUIRED";
export type CanonicalProviderError = "RATE_LIMIT" | "TIMEOUT" | "MAX_TOKENS" | "INVALID_RESPONSE" | "SERVICE_UNAVAILABLE" | "AUTH_ERROR" | "CONTENT_FILTER" | "UNKNOWN_PROVIDER_ERROR";

export function normalizeProviderError(raw?: string | null): CanonicalProviderError | null {
  const value = String(raw || "").toUpperCase();
  if (!value) return null;
  if (["COMMAND_HANDLED", "POLICY_HANDLED", "EMULATOR_DISABLED"].includes(value)) return null;
  if (/429|RESOURCE_EXHAUSTED|RATE_LIMIT/.test(value)) return "RATE_LIMIT";
  if (/TIMEOUT|ABORT/.test(value)) return "TIMEOUT";
  if (/MAX_TOKENS|LENGTH/.test(value)) return "MAX_TOKENS";
  if (/401|403|AUTH|PERMISSION/.test(value)) return "AUTH_ERROR";
  if (/SAFETY|CONTENT_FILTER|BLOCKED/.test(value)) return "CONTENT_FILTER";
  if (/INVALID|PARSE|SCHEMA/.test(value)) return "INVALID_RESPONSE";
  if (/UNAVAILABLE|HTTP_5\d\d|NO_FINAL_RESPONSE/.test(value)) return "SERVICE_UNAVAILABLE";
  return "UNKNOWN_PROVIDER_ERROR";
}

export function shouldRetryProviderError(raw: string | null | undefined, completedRetries: number, maxRetries = 2): boolean {
  const canonical = normalizeProviderError(raw);
  return completedRetries < maxRetries && canonical != null && ["RATE_LIMIT", "TIMEOUT", "SERVICE_UNAVAILABLE"].includes(canonical);
}

export function classifyAppropriateEffect(input: {
  providerError?: string | null;
  shouldChange: boolean;
  beforeAcceptable: boolean;
  afterAcceptable: boolean;
  materiallyChanged: boolean;
  counterexampleSafe: boolean;
}): AppropriateEffect {
  if (normalizeProviderError(input.providerError)) return "PROVIDER_ERROR";
  if (!input.counterexampleSafe) return "INAPPROPRIATE_CHANGE";
  if (input.shouldChange) {
    if (!input.beforeAcceptable && input.afterAcceptable && input.materiallyChanged) return "APPROPRIATE_CHANGE";
    if (!input.afterAcceptable || !input.materiallyChanged) return "MISSED_BENEFICIAL_CHANGE";
    return "INCONCLUSIVE";
  }
  if (input.beforeAcceptable && input.afterAcceptable && !input.materiallyChanged) return "APPROPRIATE_STABILITY";
  if (input.beforeAcceptable && !input.afterAcceptable) return "INAPPROPRIATE_CHANGE";
  return "INCONCLUSIVE";
}
