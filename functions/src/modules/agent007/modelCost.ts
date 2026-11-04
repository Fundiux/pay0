type TokenUsage = { input?: number; output?: number; cachedInput?: number; reasoning?: number } | null | undefined;
type Price = { inputPerMTok: number; outputPerMTok: number };

/**
 * Tarifas en USD por millón de tokens, configuradas por el operador en
 * HUGO_MODEL_PRICING_JSON, p. ej. {"gemini-2.5-flash":{"inputPerMTok":0.3,"outputPerMTok":2.5}}.
 * No se incluyen tarifas por defecto para no registrar costos inventados: sin tarifa el costo queda en null.
 * El modelo local (Ollama) no tiene costo marginal por llamada.
 */
function configuredPrices(): Record<string, Price> {
  try {
    const parsed = JSON.parse(process.env.HUGO_MODEL_PRICING_JSON || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

export function estimateModelCostUsd(provider: string | null | undefined, model: string | null | undefined, usage: TokenUsage): number | null {
  if (provider === "OLLAMA_LOCAL") return 0;
  if (!usage) return null;
  const price = configuredPrices()[String(model || "")];
  if (!price || !Number.isFinite(price.inputPerMTok) || !Number.isFinite(price.outputPerMTok)) return null;
  const input = Number(usage.input || 0), output = Number(usage.output || 0) + Number(usage.reasoning || 0);
  return Math.round(((input * price.inputPerMTok + output * price.outputPerMTok) / 1_000_000) * 1e6) / 1e6;
}
