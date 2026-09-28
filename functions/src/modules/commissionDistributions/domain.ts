import { normalizePagoStatus } from "../pagos/domain";

export function isPostedCommissionPayment(payment: any): payment is Record<string, any> {
  return Boolean(payment && ["CONCILIADO", "APLICADO_PARCIAL", "APLICADO_TOTAL"].includes(normalizePagoStatus(payment.status)) && String(payment.financialPostingStatus || "").toUpperCase() === "POSTED");
}

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
  if (!legs.length || legs.length > 50) throw new Error("La regla admite entre 1 y 50 participaciones.");
  if (legs.filter((leg) => leg.kind === "BASE").length !== 1) {
    throw new Error("La regla debe incluir exactamente una BASE.");
  }
  for (const leg of legs) {
    if (!leg.alias || !leg.beneficiaryId || !leg.methodId || leg.rateBps <= 0) {
      throw new Error("Cada destino requiere alias, porcentaje, beneficiario e instrumento.");
    }
  }
  const keys = legs.map((leg) => `${leg.kind}|${leg.alias}|${leg.methodId}`);
  if (new Set(keys).size !== keys.length) throw new Error("La regla contiene destinos duplicados.");
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
  const amounts = allocateMinorExactly(total, rule.legs.map(leg => leg.rateBps));
  const legs = rule.legs.map((leg, index) => ({ ...leg, ...amounts[index] }));
  const distributedAmountMinor = legs.reduce((sum, leg) => sum + leg.amountMinor, 0);
  return { totalRateBps: rule.totalRateBps, totalAmountMinor: total, distributedAmountMinor, differenceMinor: total - distributedAmountMinor, legs };
}

/** Hamilton allocation with exact integer arithmetic; ties follow persisted array order. */
export function allocateMinorExactly(totalMinor: number, weights: number[]) {
  const total = assertInteger(totalMinor, "Importe en centavos");
  if (total < 0 || !weights.length || weights.some(weight => !Number.isSafeInteger(weight) || weight <= 0)) throw new Error("Importe o distribución inválidos.");
  const divisor = weights.reduce((sum, weight) => sum + BigInt(weight), BigInt(0));
  const rows = weights.map((weight, index) => {
    const numerator = BigInt(total) * BigInt(weight);
    return { index, amountMinor: Number(numerator / divisor), residue: numerator % divisor, roundingMinor: 0 };
  });
  let remaining = total - rows.reduce((sum, row) => sum + row.amountMinor, 0);
  const ranked = [...rows].sort((a, b) => a.residue === b.residue ? a.index - b.index : a.residue > b.residue ? -1 : 1);
  for (const row of ranked) { if (!remaining) break; row.amountMinor += 1; row.roundingMinor = 1; remaining -= 1; }
  return rows.map(({ amountMinor, roundingMinor }) => ({ amountMinor, roundingMinor }));
}

export type UserCommissionMode = "CONTRACT_COMMISSION_POINTS" | "USER_EARNINGS_PERCENTAGE";
export type UserCommissionDestination = { beneficiaryId: string; methodId: string; shareBps: number };
export function validateUserCommissionDestinations(contractRateBps: number, mode: UserCommissionMode, destinations: UserCommissionDestination[]) {
  const contract = assertInteger(contractRateBps, "Comisión contractual");
  if (contract < 0 || contract > 10000 || (mode === "CONTRACT_COMMISSION_POINTS" && contract === 0)) throw new Error("No se pudo resolver un porcentaje contractual comparable; utiliza la modalidad sobre lo ganado.");
  if (!["CONTRACT_COMMISSION_POINTS", "USER_EARNINGS_PERCENTAGE"].includes(mode)) throw new Error("Modalidad inválida.");
  if (!Array.isArray(destinations) || !destinations.length || destinations.length > 50) throw new Error("Selecciona de 1 a 50 cuentas.");
  const rows = destinations.map(row => ({ beneficiaryId: String(row.beneficiaryId || "").trim(), methodId: String(row.methodId || "").trim(), shareBps: assertInteger(row.shareBps, "Porcentaje/puntos") }));
  if (rows.some(row => !row.beneficiaryId || row.beneficiaryId.includes("/") || !row.methodId || row.methodId.includes("/") || row.shareBps <= 0)) throw new Error("Cada destino requiere beneficiario, instrumento y una participación positiva.");
  if (new Set(rows.map(row => row.methodId)).size !== rows.length) throw new Error("No repitas una cuenta en la distribución.");
  const expectedBps = mode === "CONTRACT_COMMISSION_POINTS" ? contract : 10000;
  if (rows.reduce((sum, row) => sum + row.shareBps, 0) !== expectedBps) throw new Error(`La suma debe ser exactamente ${(expectedBps / 100).toFixed(2)}${mode === "CONTRACT_COMMISSION_POINTS" ? " puntos" : "%"}.`);
  return { distributionMode: mode, contractRateBps: contract, destinations: rows };
}

export function calculateUserCommissionDestinations(earnedMinor: number, contractRateBps: number, mode: UserCommissionMode, destinations: UserCommissionDestination[]) {
  const validated = validateUserCommissionDestinations(contractRateBps, mode, destinations);
  const allocated = allocateMinorExactly(earnedMinor, validated.destinations.map(row => row.shareBps));
  return { ...validated, earnedMinor, destinations: validated.destinations.map((row, index) => ({ ...row, ...allocated[index] })), differenceMinor: 0 };
}

/** Read the already-posted USER earning; do not derive a new award from client commission. */
export function canonicalUserCommission(snapshot: any, ownerUid: string) {
  if (!snapshot || snapshot.operationFlags?.userEarningsEnabled === false || snapshot.operationFlags?.generatesUserEarnings === false) throw new Error("El pago no genera utilidad de usuarios.");
  const assignments = snapshot.assignmentSnapshot || {};
  const cost = (value: any) => value && value.active !== false && Number(value.rate ?? value.assignedCost ?? value.baseCost) > 0 ? value : null;
  const client = cost(assignments.clientCost), despacho = cost(assignments.despachoCost), admin = cost(assignments.adminCost), operador = cost(assignments.operadorCost);
  const candidates = [
    { uid: snapshot.rootId, amount: snapshot.resultSnapshot?.superadminEarningAmount, low: despacho, high: admin || operador || client },
    { uid: snapshot.adminId && snapshot.adminId !== snapshot.rootId ? snapshot.adminId : null, amount: snapshot.resultSnapshot?.adminEarningAmount, low: admin, high: operador || client },
    { uid: snapshot.operadorId, amount: snapshot.resultSnapshot?.operadorEarningAmount, low: operador, high: client },
  ].filter(row => row.uid === ownerUid);
  if (candidates.length !== 1) throw new Error("El usuario no tiene una utilidad inequívoca en el snapshot.");
  const row = candidates[0], amount = Number(row.amount);
  const earnedMinor = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(earnedMinor) || earnedMinor < 0) throw new Error("Utilidad contabilizada inválida.");
  let contractRateBps: number | null = null;
  const base = (value: any) => String(value?.calculationBaseType || "TOTAL").toUpperCase();
  const percent = (value: any) => value && String(value.pricingMode || "PERCENT").toUpperCase() === "PERCENT";
  if (percent(row.low) && percent(row.high) && base(row.low) === base(row.high)) {
    const rate = (value: any) => Number(value.rate ?? value.assignedCost ?? value.baseCost);
    const difference = Math.round((rate(row.high) - rate(row.low)) * 100);
    if (difference > 0 && difference <= 10000) contractRateBps = difference;
  }
  return { ownerUid, earnedMinor, contractRateBps, calculationBaseType: contractRateBps ? base(row.high) : null };
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
