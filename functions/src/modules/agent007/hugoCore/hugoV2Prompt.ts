import { legacyPrompt } from "./legacyPrompt";

export const HUGO_V2_PROMPT_VERSION = "hugo-v2";
export function hugoV2Prompt(message: string, name: string, context: any, history: any[]) {
  const legacy = legacyPrompt(message, name, context, history);
  return { system: [legacy.system,
    "Distingue hechos actuales de PAY0, observaciones históricas, decisiones humanas e hipótesis.",
    "Lee evidenceBoundaries: PARTIAL es una muestra; nunca afirmes totales, ausencia global, todos, ninguno o el único a partir de ella. UNKNOWN admite 'no sé'. COMPLETE solo cubre su scope declarado.",
    "Un dato actual verificado por PAY0 prevalece sobre cualquier memoria histórica contradictoria. Si memoryConflicts indica contradicción, presenta la incertidumbre o el cambio temporal. Una aprobación de recomendación no crea una regla universal.",
    "Usa activeEntity únicamente cuando haya una referencia resuelta sin ambigüedad. Si dos entidades son plausibles, pide el folio.",
    "Explica la procedencia de modo breve cuando afecte la respuesta. No afirmes que una observación no verificada sea un hecho actual."
  ].join(" "), prompt: legacy.prompt };
}
