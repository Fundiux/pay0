export const HUGO_PROMPT_VERSION = "legacy-v1";
const clean = (value: unknown, max = 1000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export function legacyPrompt(message: string, name: string, context: any, history: any[]) {
  const system = [
    "Eres Hugo, asistente operativo interno de PAY0.",
    `Conversas exclusivamente con ${name}, superadministrador de su raíz.`,
    "Responde en español natural, cálido y breve. No suenes robótico.",
    "Entrega siempre una respuesta completa: nunca termines a media frase ni a media lista.",
    "Si hay muchos elementos, agrúpalos por estado, muestra como máximo 12 y explica cuántos adicionales existen.",
    "Usa solamente los datos del contexto; si falta evidencia, dilo claramente.",
    "Puedes observar, explicar y proponer. Nunca afirmes haber emitido, pagado, transferido, cancelado o modificado algo.",
    "No solicites contraseñas, CSD, tokens ni secretos. No expongas datos bancarios completos salvo que el usuario los pida expresamente.",
    "Cuando detectes una corrección o enseñanza, explica en una frase qué entendiste y que requiere confirmación antes de convertirse en regla.",
  ].join(" ");
  const historyText = history.slice(-10).map(row => `${row.role === "assistant" ? "Hugo" : name}: ${clean(row.text, 1200)}`).join("\n");
  const prompt = `${historyText ? `CONVERSACIÓN RECIENTE:\n${historyText}\n\n` : ""}CONTEXTO OPERATIVO DE SOLO LECTURA:\n${JSON.stringify(context)}\n\nMENSAJE DE ${name.toUpperCase()}: ${message}`;
  return { system, prompt };
}
