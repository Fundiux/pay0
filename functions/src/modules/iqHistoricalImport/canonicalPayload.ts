import { P4EngineError, type P4Action } from "./domain";
import { buildHistoricalFolio, historicalFolioEvidence } from "./historicalFolio";

export type P4CanonicalClassification =
  | "SAFE_CANONICAL_RECONCILE"
  | "NO_CHANGE"
  | "CANONICAL_FIELD_REVIEW_REQUIRED"
  | "CURRENT_STATE_CONFLICT";

export type P4CanonicalAssessment = {
  classification: P4CanonicalClassification;
  patch: Record<string, unknown>;
  missingFields: string[];
  reason: string;
};

export type P4BridgeAssessment = P4CanonicalAssessment & { conflicts: string[] };

const text = (value: unknown) => String(value ?? "").trim();
const finiteMoney = (value: unknown, field: string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", `${field} no es un monto canónico válido.`);
  return Math.round(amount * 100) / 100;
};

function applicationStatus(value: unknown): string {
  const status = text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[ -]+/g, "_");
  if (["ACTIVE", "ACTIVA", "ACTIVO", "EN_OPERACION", "CONCILIADO", "CONCILIADA", "APLICADO", "APLICADA"].includes(status)) return "APLICADA";
  if (["CANCELLED", "CANCELADA", "CANCELADO"].includes(status)) return "CANCELADA";
  if (["REVERSED", "REVERSADA", "REVERSADO"].includes(status)) return "REVERSADA";
  if (["REJECTED", "RECHAZADA", "RECHAZADO"].includes(status)) return "RECHAZADA";
  throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", "Status de aplicación no reconocido.");
}

export function canonicalHistoricalFields(action: P4Action): Record<string, unknown> {
  if (action.canonicalEvidence && action.canonicalEvidence.readiness !== "CANONICAL_READY") throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", `Action V6 no canónica: ${action.canonicalEvidence.reviewReasons.join(", ")}.`);
  if (!text(action.rootId)) throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", "rootId ausente en action server-side.");
  const adminId=text(action.after.adminId),associatedName=text(action.after.associatedName),identityMappingVersion=text(action.after.identityMappingVersion),identityMappingHash=text(action.after.identityMappingHash);
  if(!adminId||!associatedName||!identityMappingVersion||!identityMappingHash)throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED",`${action.entityType} sin equivalencia operativa demostrable.`);
  const common: Record<string, unknown> = { rootId: action.rootId,adminId,associatedName,identityMappingVersion,identityMappingHash };
  if (action.entityType === "CLIENT") {
    if (!text(action.after.name) || !text(action.after.iqClientId)) throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", "Cliente histórico sin identidad canónica.");
    return common;
  }
  const clientId = text(action.after.clientId);
  if (!clientId) throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", `${action.entityType} sin cliente canónico.`);
  common.clientId = clientId;
  common.clienteId = clientId;
  const clienteNombre = text(action.after.clienteNombre ?? action.canonicalEvidence?.client?.displayName);
  if (["SOLICITUD", "PAYMENT"].includes(action.entityType) && !clienteNombre) throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", `${action.entityType} sin clienteNombre canónico.`);
  if (["SOLICITUD", "PAYMENT"].includes(action.entityType) && clienteNombre) common.clienteNombre = clienteNombre;
  if (action.entityType === "SOLICITUD") {
    const missing = ["status", "companyId", "despachoId", "folio"].filter(field => !text(action.after[field]));
    if (missing.length) throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", `Solicitud sin campos canónicos demostrables: ${missing.join(", ")}.`);
    const expectedFolio = buildHistoricalFolio("SOLICITUD", action.canonicalGroupId, action.iqEntityId);
    if (text(action.after.folio) !== expectedFolio) throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", "Folio histórico de solicitud distinto de la evidencia P4Q.");
    const invoiceStatus=text(action.after.invoiceStatus),fiscalMethod=text(action.after.facturaMetodoPago||action.after.tipoFactura).toUpperCase();
    if(invoiceStatus!=="NO_INVOICE"&&!['PUE','PPD'].includes(fiscalMethod))throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED","FISCAL_METHOD_REVIEW_REQUIRED");
    return { ...common, status:text(action.after.status),companyId:text(action.after.companyId),companyName:text(action.after.companyName??action.after.empresaNombre),empresaNombre:text(action.after.empresaNombre??action.after.companyName),despachoId:text(action.after.despachoId),folio: expectedFolio, canonicalFolio: historicalFolioEvidence("SOLICITUD", action.canonicalGroupId, action.iqEntityId),monto:finiteMoney(action.after.monto,"monto"),moneda:text(action.after.moneda),totalAbonado:finiteMoney(action.after.totalAbonado??0,"totalAbonado"),saldoPendiente:finiteMoney(action.after.saldoPendiente??action.after.monto,"saldoPendiente"),invoiceStatus,...(fiscalMethod?{tipoFactura:fiscalMethod,facturaMetodoPago:fiscalMethod}:{}),...(text(action.after.facturaFolio)?{facturaFolio:text(action.after.facturaFolio)}:{}),...(text(action.after.facturaSerie)?{facturaSerie:text(action.after.facturaSerie)}:{}),...(text(action.after.facturaDisplay)?{facturaDisplay:text(action.after.facturaDisplay)}:{}),...(text(action.after.facturaUuid)?{facturaUuid:text(action.after.facturaUuid),uuidCfdi:text(action.after.uuidCfdi||action.after.facturaUuid)}:{}),fiscalEvidenceSource:text(action.after.fiscalEvidenceSource) };
  }
  if (action.entityType === "PAYMENT") {
    const missing = ["status", "companyId", "despachoId", "folio"].filter(field => !text(action.after[field]));
    if (missing.length) throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", `Pago sin campos canónicos demostrables: ${missing.join(", ")}.`);
    const expectedFolio = buildHistoricalFolio("PAYMENT", action.canonicalGroupId, action.iqEntityId);
    if (text(action.after.folio) !== expectedFolio) throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", "Folio histórico de pago distinto de la evidencia P4Q.");
    const total = finiteMoney(action.after.monto, "montoTotal");
    const applied = finiteMoney(action.after.totalAplicado, "montoAplicado");
    const available = finiteMoney(action.after.saldoDisponible, "montoDisponible");
    if (Math.round((total - applied - available) * 100) !== 0) throw new P4EngineError("P4_FINANCIAL_INVARIANT_FAILED", "montoTotal - montoAplicado != montoDisponible.");
    return { ...common,status:text(action.after.status),companyId:text(action.after.companyId),companyName:text(action.after.companyName??action.after.empresaNombre),empresaNombre:text(action.after.empresaNombre??action.after.companyName),despachoId:text(action.after.despachoId), folio: expectedFolio, canonicalFolio: historicalFolioEvidence("PAYMENT", action.canonicalGroupId, action.iqEntityId), monto:total,totalAplicado:applied,saldoDisponible:available,montoTotal: total, montoAplicado: applied, montoDisponible: available,moneda:text(action.after.moneda) };
  }
  if (!text(action.after.solicitudId) || !text(action.after.pagoId)) throw new P4EngineError("P4_HISTORICAL_CANONICAL_FIELD_REVIEW_REQUIRED", "Aplicación sin parents canónicos.");
  const amount = finiteMoney(action.after.montoAplicado, "montoAplicado");
  return { ...common,solicitudId:text(action.after.solicitudId),pagoId:text(action.after.pagoId), status: applicationStatus(action.after.status ?? action.after.rawIqStatus), montoTotal: amount, montoAplicado: amount,moneda:text(action.after.moneda),...(action.componentId?{financialComponentId:action.componentId}:{}) };
}

export function assessCanonicalReconciliation(action: P4Action, current: Record<string, unknown>): P4CanonicalAssessment {
  const exact = current.source === "IQ_IMPORT" && current.importManifestId && current.importRunId && current.p4ActionId === action.actionId &&
    current.originalIqEntityId === action.iqEntityId && text(current.canonicalIqGroupId) === action.canonicalGroupId;
  if (!exact) return { classification: "CURRENT_STATE_CONFLICT", patch: {}, missingFields: [], reason: "Provenance/action mismatch" };
  try {
    const canonical = canonicalHistoricalFields(action);
    const patch = Object.fromEntries(Object.entries(canonical).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value)));
    return { classification: Object.keys(patch).length ? "SAFE_CANONICAL_RECONCILE" : "NO_CHANGE", patch, missingFields: [], reason: Object.keys(patch).length ? "Canonical patch derivable from manifest action" : "Canonical payload already present" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/: ([^.]+)\.?$/);
    return { classification: "CANONICAL_FIELD_REVIEW_REQUIRED", patch: {}, missingFields: match ? match[1].split(", ").map(text) : [], reason: message };
  }
}

export function assessV5V6Reconciliation(action: P4Action, current: Record<string, unknown>): P4BridgeAssessment {
  const conflicts:string[]=[];const bridge=action.reconciliationOf;
  if(!bridge||current.source!=="IQ_IMPORT"||text(current.importManifestId)!==bridge.manifestId||text(current.importRunId)!==bridge.runId||text(current.p4ActionId)!==bridge.actionId)conflicts.push("PROVENANCE");
  if(text(current.originalIqEntityId)!==action.iqEntityId)conflicts.push("IQ_ID");
  if(text(current.canonicalIqGroupId)!==action.canonicalGroupId)conflicts.push("CANONICAL_GROUP");
  const pairs:Array<[string,unknown,unknown]>=[["CLIENT",current.clientId??current.clienteId,action.after.clientId],["AMOUNT",current.monto??current.montoAplicado,action.after.monto??action.after.montoAplicado],["CURRENCY",current.moneda,action.after.moneda],["SOLICITUD_PARENT",current.solicitudId,action.after.solicitudId],["PAYMENT_PARENT",current.pagoId,action.after.pagoId],["COMPONENT",current.financialComponentId,action.componentId]];
  for(const [name,left,right] of pairs)if(text(left)&&text(right)&&text(left)!==text(right))conflicts.push(name);
  const iso=(value:unknown)=>{if(value&&typeof value==="object"&&typeof (value as {toDate?:unknown}).toDate==="function")return((value as {toDate:()=>Date}).toDate()).toISOString();const parsed=Date.parse(text(value));return Number.isFinite(parsed)?new Date(parsed).toISOString():text(value);};
  const currentTime=iso(current.historicalEventAt),plannedTime=iso(action.historicalTime?.normalizedAt);if(currentTime&&plannedTime&&currentTime!==plannedTime)conflicts.push("HISTORICAL_TIME");
  if(conflicts.length)return{classification:"CURRENT_STATE_CONFLICT",patch:{},missingFields:[],reason:"P4P_V5_V6_RECONCILIATION_CONFLICT",conflicts};
  try{const canonical=canonicalHistoricalFields(action),patch=Object.fromEntries(Object.entries({...action.after,...canonical}).filter(([key,value])=>JSON.stringify(current[key])!==JSON.stringify(value)));return{classification:Object.keys(patch).length?"SAFE_CANONICAL_RECONCILE":"NO_CHANGE",patch,missingFields:[],reason:Object.keys(patch).length?"V5 identity matches V6 canonical action":"Canonical payload already present",conflicts:[]};}
  catch(error){return{classification:"CANONICAL_FIELD_REVIEW_REQUIRED",patch:{},missingFields:[],reason:error instanceof Error?error.message:String(error),conflicts:[]};}
}
