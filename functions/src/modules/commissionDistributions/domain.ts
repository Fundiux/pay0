export type CommissionRuleLegInput = {
  kind: "BASE" | "COMMISSIONER";
  alias: string;
  rateBps: number;
  beneficiaryId: string;
  methodId: string;
  active?: boolean;
  order?: number;
  deliveryPreference?: "EMAIL" | "WHATSAPP" | "MANUAL" | "NONE";
  deliveryContact?: string | null;
};

export type CommissionRuleInput = {
  totalRateBps: number;
  legs: CommissionRuleLegInput[];
};

export type CommissionCalculationLeg = CommissionRuleLegInput & {
  amountMinor: number;
  roundingMinor: number;
};

export function assertInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} debe ser entero.`);
  return parsed;
}

export function validateCommissionRule(input: CommissionRuleInput): CommissionRuleInput {
  const totalRateBps = assertInteger(input.totalRateBps, "totalRateBps");
  if (totalRateBps <= 0 || totalRateBps > 10_000) {
    throw new Error("La comisión total debe ser mayor a 0 y menor o igual a 100%.");
  }
  const legs = (input.legs || []).filter((leg) => leg.active !== false).map((leg, index) => ({
    ...leg,
    kind: leg.kind === "BASE" ? "BASE" as const : "COMMISSIONER" as const,
    alias: String(leg.alias || "").trim(),
    beneficiaryId: String(leg.beneficiaryId || "").trim(),
    methodId: String(leg.methodId || "").trim(),
    rateBps: assertInteger(leg.rateBps, `legs[${index}].rateBps`),
    order: Number.isFinite(Number(leg.order)) ? Number(leg.order) : index,
    active: true,
  }));
  if (!legs.length) throw new Error("La regla debe incluir BASE y al menos un destino cuando corresponda.");
  if (legs.filter((leg) => leg.kind === "BASE").length !== 1) {
    throw new Error("La regla debe incluir exactamente una BASE.");
  }
  for (const leg of legs) {
    if (!leg.alias || !leg.beneficiaryId || !leg.methodId || leg.rateBps <= 0) {
      throw new Error("Cada destino requiere alias, porcentaje, beneficiario e instrumento.");
    }
  }
  const assigned = legs.reduce((sum, leg) => sum + leg.rateBps, 0);
  if (assigned !== totalRateBps) {
    throw new Error(`La suma configurada es ${(assigned / 100).toFixed(2)}%, pero la comisión total es ${(totalRateBps / 100).toFixed(2)}%.`);
  }
  return { totalRateBps, legs };
}

export function calculateCommissionDistribution(grossMinor: number, input: CommissionRuleInput) {
  const gross = assertInteger(grossMinor, "grossMinor");
  if (gross <= 0) throw new Error("El ingreso debe ser mayor a cero.");
  const rule = validateCommissionRule(input);
  const totalAmountMinor = Math.round((gross * rule.totalRateBps) / 10_000);
  const provisional = rule.legs.map((leg) => {
    const exact = (gross * leg.rateBps) / 10_000;
    const amountMinor = Math.floor(exact);
    return { ...leg, amountMinor, fraction: exact - amountMinor };
  });
  let remainder = totalAmountMinor - provisional.reduce((sum, leg) => sum + leg.amountMinor, 0);
  const ranked = [...provisional].sort((a, b) => b.fraction - a.fraction || (a.order || 0) - (b.order || 0));
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) ranked[index % ranked.length].amountMinor += 1;
  const amountByKey = new Map(ranked.map((leg) => [`${leg.kind}|${leg.alias}|${leg.methodId}`, leg.amountMinor]));
  const legs: CommissionCalculationLeg[] = provisional.map(({ fraction, ...leg }) => {
    const amountMinor = amountByKey.get(`${leg.kind}|${leg.alias}|${leg.methodId}`) || 0;
    return { ...leg, amountMinor, roundingMinor: amountMinor - Math.floor((gross * leg.rateBps) / 10_000) };
  });
  const distributedAmountMinor = legs.reduce((sum, leg) => sum + leg.amountMinor, 0);
  return {
    grossMinor: gross,
    totalRateBps: rule.totalRateBps,
    totalAmountMinor,
    distributedAmountMinor,
    differenceMinor: totalAmountMinor - distributedAmountMinor,
    legs,
  };
}

export function allocatePostedCommission(totalCommissionMinor: number, input: CommissionRuleInput) {
  const total = assertInteger(totalCommissionMinor, "totalCommissionMinor");
  if (total <= 0) throw new Error("La comisión contabilizada debe ser mayor a cero.");
  const rule = validateCommissionRule(input);
  const provisional = rule.legs.map((leg) => {
    const exact = (total * leg.rateBps) / rule.totalRateBps;
    return { ...leg, amountMinor: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = total - provisional.reduce((sum, leg) => sum + leg.amountMinor, 0);
  const ranked = [...provisional].sort((a, b) => b.fraction - a.fraction || (a.order || 0) - (b.order || 0));
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) ranked[index % ranked.length].amountMinor += 1;
  const amountByKey = new Map(ranked.map((leg) => [`${leg.kind}|${leg.alias}|${leg.methodId}`, leg.amountMinor]));
  const legs = provisional.map(({ fraction, ...leg }) => ({ ...leg, amountMinor: amountByKey.get(`${leg.kind}|${leg.alias}|${leg.methodId}`) || 0, roundingMinor: (amountByKey.get(`${leg.kind}|${leg.alias}|${leg.methodId}`) || 0) - Math.floor((total * leg.rateBps) / rule.totalRateBps) }));
  const distributedAmountMinor = legs.reduce((sum, leg) => sum + leg.amountMinor, 0);
  return { totalRateBps: rule.totalRateBps, totalAmountMinor: total, distributedAmountMinor, differenceMinor: total - distributedAmountMinor, legs };
}

export type CommissionLegExecutionState = "PENDING" | "READY" | "PROCESSING" | "COMPLETED" | "BLOCKED" | "UNCERTAIN" | "FAILED";

export function aggregateCommissionStatus(states: CommissionLegExecutionState[]) {
  if (!states.length) return "BLOCKED";
  if (states.every((state) => state === "COMPLETED")) return "COMPLETED";
  if (states.some((state) => state === "UNCERTAIN")) return "UNCERTAIN";
  if (states.some((state) => state === "COMPLETED")) return "PARTIALLY_COMPLETED";
  if (states.some((state) => state === "PROCESSING")) return "PROCESSING";
  if (states.every((state) => state === "READY")) return "READY";
  if (states.some((state) => state === "FAILED")) return "FAILED";
  if (states.some((state) => state === "BLOCKED")) return "BLOCKED";
  return "PENDING";
}

export function evaluateIqLink(input: { status?: string | null; verifiedAtMs?: number | null; nowMs: number; maxAgeMs: number; storedLast4?: string | null; currentLast4?: string | null }) {
  const reasons: string[] = [];
  if (String(input.status || "").toUpperCase() !== "VERIFIED") reasons.push(`IQ_LINK_${String(input.status || "PENDING").toUpperCase()}`);
  if (!input.verifiedAtMs || input.nowMs - input.verifiedAtMs > input.maxAgeMs) reasons.push("IQ_LINK_STALE");
  if (String(input.storedLast4 || "") !== String(input.currentLast4 || "")) reasons.push("IQ_INSTRUMENT_CHANGED");
  return { ready: reasons.length === 0, reasons };
}

export function evaluateCommissionLegSubmission(input: { status: CommissionLegExecutionState; iqFolio?: string | null; postAccepted?: boolean; retryBlocked?: boolean }) {
  if (input.iqFolio || input.status === "COMPLETED") return { allowed: false, reason: "ALREADY_COMPLETED" };
  if (input.status === "UNCERTAIN" || input.postAccepted || input.retryBlocked) return { allowed: false, reason: "OUTCOME_RECONCILIATION_REQUIRED" };
  if (input.status === "PROCESSING") return { allowed: false, reason: "EXECUTION_IN_PROGRESS" };
  if (!["READY", "FAILED"].includes(input.status)) return { allowed: false, reason: "LEG_NOT_READY" };
  return { allowed: true, reason: null };
}

export function recoverCommissionLegFolio(input: { status: CommissionLegExecutionState; recoveredIqFolio?: string | null }) {
  const folio = String(input.recoveredIqFolio || "").trim();
  if (!folio) return { status: input.status, retryBlocked: input.status === "UNCERTAIN" };
  return { status: "COMPLETED" as const, iqFolio: folio, retryBlocked: true };
}

export function decideCommissionPreflight(distributionReasonCodes: string[], legReasonCodes: string[][]) {
  const ready = distributionReasonCodes.length === 0 && legReasonCodes.length > 0 && legReasonCodes.every((reasons) => reasons.length === 0);
  return { status: ready ? "READY_FOR_EXECUTION" as const : "BLOCKED" as const, ready };
}
