export type HugoScope = "GLOBAL" | "PAY0";
export type HugoProfile = "OPERATOR" | "PROGRAMMER";
export type HugoTaskState = "RUNNING" | "WAITING" | "DONE" | "ATTENTION" | "ERROR";
export type HugoRisk = "READ" | "WRITE" | "EXTERNAL_SIDE_EFFECT";
export type HugoComplexity = "LOW" | "MEDIUM" | "HIGH";
export type HugoRoutingSignals = { intent: string; profile: HugoProfile; risk: HugoRisk; complexity: HugoComplexity; requiredCapabilities: string[] };

export const HUGO_CAPABILITIES = [
  { id: "pay0.getSolicitud", system: "PAY0", risk: "READ", status: "AVAILABLE" },
  { id: "pay0.searchSolicitudes", system: "PAY0", risk: "READ", status: "AVAILABLE" },
  { id: "pay0.getPago", system: "PAY0", risk: "READ", status: "AVAILABLE" },
  { id: "pay0.searchPagos", system: "PAY0", risk: "READ", status: "AVAILABLE" },
  { id: "pay0.getPaymentComplementStatus", system: "PAY0", risk: "READ", status: "AVAILABLE" },
  { id: "pay0.getOperationalSummary", system: "PAY0", risk: "READ", status: "AVAILABLE" },
  { id: "pay0.getIqCapabilities", system: "PAY0", risk: "READ", status: "AVAILABLE" },
  { id: "pay0.requestIqPaymentComplement", system: "PAY0", risk: "EXTERNAL_SIDE_EFFECT", status: "GATED" },
] as const;

export function normalizeHugoScope(value: unknown): HugoScope {
  return String(value || "").toUpperCase() === "GLOBAL" ? "GLOBAL" : "PAY0";
}

export function classifyHugoProfile(message: string): HugoProfile {
  return /\b(c[oó]digo|repositorio|bug|error\s*500|internal|stack|funci[oó]n|typescript|firebase|deploy|arquitectura|programa|prueba|test)\b/i.test(message)
    ? "PROGRAMMER" : "OPERATOR";
}

export function classifyHugoRoutingSignals(message: string, profile = classifyHugoProfile(message)): HugoRoutingSignals {
  const financialWrite = /\b(dispersa|aplica|paga|reintenta|solicita|env[ií]a|ejecuta)\b/i.test(message);
  const complex = /\b(compara|relaciona|inconsisten|arquitectura|diagn[oó]stic|investiga|varias?\s+fuentes?)\b/i.test(message);
  const pay0Read = /\b(solicitud|pago|rep|complemento|wallet|iq|factura|materialidad)\b/i.test(message);
  return { intent: profile === "PROGRAMMER" ? "PROGRAMMING" : pay0Read ? "PAY0_OPERATION" : complex ? "REASONING" : "CONVERSATION", profile,
    risk: financialWrite ? "EXTERNAL_SIDE_EFFECT" : "READ", complexity: profile === "PROGRAMMER" || complex ? "HIGH" : pay0Read ? "MEDIUM" : "LOW",
    requiredCapabilities: pay0Read ? ["PAY0_READ"] : [] };
}
