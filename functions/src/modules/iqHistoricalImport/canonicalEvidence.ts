import { historicalFolioEvidence } from "./historicalFolio";

export type CanonicalDecision = "EXACT" | "DERIVED_EXACT" | "NOT_REQUIRED" | "REVIEW_REQUIRED";
export type CanonicalFieldEvidence = { source: "IQ" | "PAY0" | "FINANCIAL_GRAPH" | "DERIVATION"; rawValue: unknown; normalizedValue: unknown; derivation: string; decision: CanonicalDecision };
export type CanonicalStatusResult = { decision: CanonicalDecision; status: string | null; reason: string };

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
export const canonicalKey = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

export function canonicalSolicitudStatus(raw: unknown, pendingAmount: number): CanonicalStatusResult {
  const status = canonicalKey(raw).replace(/[ -]+/g, "_");
  if (status === "PENDIENTE_CANCELACION") return { decision: "REVIEW_REQUIRED", status: null, reason: "P4M_PENDING_CANCELLATION" };
  if (["CANCELADA","CANCELADO"].includes(status)) return { decision: "EXACT", status: "CANCELADA", reason: "IQ_TERMINAL_CANCELLED" };
  if (["RECHAZADA","RECHAZADO"].includes(status)) return { decision: "EXACT", status: "RECHAZADA", reason: "IQ_TERMINAL_REJECTED" };
  if (["EN_OPERACION","ACTIVA","ACTIVO"].includes(status)) return Number(pendingAmount) === 0
    ? { decision: "DERIVED_EXACT", status: "COMPLETADA", reason: "IQ_ACTIVE_AND_GRAPH_SETTLED" }
    : { decision: "DERIVED_EXACT", status: "PROCESANDO", reason: "IQ_ACTIVE_AND_GRAPH_PENDING" };
  return { decision: "REVIEW_REQUIRED", status: null, reason: "UNKNOWN_IQ_SOLICITUD_STATUS" };
}

export function canonicalPaymentStatus(input: { operationStatus: unknown; conciliationStatus: unknown; total: number; applied: number; available: number }): CanonicalStatusResult {
  const operation = canonicalKey(input.operationStatus).replace(/[ -]+/g, "_"), conciliation = canonicalKey(input.conciliationStatus).replace(/[ -]+/g, "_");
  if (operation === "PENDIENTE_CANCELACION") return { decision: "REVIEW_REQUIRED", status: null, reason: "P4M_PENDING_CANCELLATION" };
  if (["CANCELADA","CANCELADO"].includes(operation)) return { decision: "EXACT", status: "CANCELADO", reason: "IQ_TERMINAL_CANCELLED" };
  if (["RECHAZADA","RECHAZADO"].includes(operation)) return { decision: "EXACT", status: "RECHAZADO", reason: "IQ_TERMINAL_REJECTED" };
  if (!Number.isFinite(input.total) || !Number.isFinite(input.applied) || !Number.isFinite(input.available) || Math.round((input.total-input.applied-input.available)*100)!==0)
    return { decision: "REVIEW_REQUIRED", status: null, reason: "PAYMENT_MONETARY_INVARIANT_FAILED" };
  if (!(operation === "EN_OPERACION" && ["CONCILIADO","CONCILIADA"].includes(conciliation))) return { decision: "REVIEW_REQUIRED", status: null, reason: "UNKNOWN_IQ_PAYMENT_STATUS" };
  if (input.applied > 0 && input.available === 0) return { decision: "DERIVED_EXACT", status: "APLICADO_TOTAL", reason: "CONCILIATED_GRAPH_FULLY_APPLIED" };
  if (input.applied > 0) return { decision: "DERIVED_EXACT", status: "APLICADO_PARCIAL", reason: "CONCILIATED_GRAPH_PARTIALLY_APPLIED" };
  return { decision: "DERIVED_EXACT", status: "CONCILIADO", reason: "IQ_CONCILIATED_WITHOUT_APPLICATION" };
}

export function canonicalApplicationStatus(raw: unknown): CanonicalStatusResult {
  const status=canonicalKey(raw).replace(/[ -]+/g,"_");
  if (["EN_OPERACION","ACTIVE","ACTIVA","CONCILIADO","CONCILIADA"].includes(status)) return { decision:"EXACT",status:"APLICADA",reason:"IQ_ACTIVE_APPLICATION" };
  if (["CANCELADA","CANCELADO"].includes(status)) return { decision:"EXACT",status:"CANCELADA",reason:"IQ_CANCELLED_APPLICATION" };
  if (["RECHAZADA","RECHAZADO"].includes(status)) return { decision:"EXACT",status:"RECHAZADA",reason:"IQ_REJECTED_APPLICATION" };
  return { decision:"REVIEW_REQUIRED",status:null,reason:"UNKNOWN_IQ_APPLICATION_STATUS" };
}

export function resolveExactCompany(companyName: unknown, candidates: Array<{id:string;name:string;despachoId?:string|null;companyNumber?:number|null}>): CanonicalFieldEvidence {
  const raw=text(companyName),matches=candidates.filter(candidate=>canonicalKey(candidate.name)===canonicalKey(raw));
  return matches.length===1
    ? {source:"PAY0",rawValue:raw,normalizedValue:matches[0],derivation:"EXACT_NORMALIZED_COMPANY_NAME",decision:"DERIVED_EXACT"}
    : {source:"PAY0",rawValue:raw,normalizedValue:null,derivation:matches.length?"AMBIGUOUS_COMPANY_NAME":"COMPANY_NOT_FOUND",decision:"REVIEW_REQUIRED"};
}

export function historicalFolioCandidate(entityType:"SOLICITUD"|"PAYMENT",canonicalGroupId:string,iqId:string): CanonicalFieldEvidence {
  try { const evidence=historicalFolioEvidence(entityType,canonicalGroupId,iqId); return {source:"DERIVATION",rawValue:{canonicalGroupId,iqId},normalizedValue:evidence.value,derivation:"P4Q_HISTORICAL_FOLIO_V1_TYPE_PLUS_CANONICAL_GROUP_PLUS_EXACT_IQ_ID_NO_CREATOR",decision:"DERIVED_EXACT"}; }
  catch { return {source:"DERIVATION",rawValue:{canonicalGroupId,iqId},normalizedValue:null,derivation:"HISTORICAL_FOLIO_NAMESPACE_UNAVAILABLE",decision:"REVIEW_REQUIRED"}; }
}
