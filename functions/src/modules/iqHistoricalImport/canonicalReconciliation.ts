import { canonicalJson, deterministicId, type P4Action, type P4Manifest } from "./domain";
import { assessV5V6Reconciliation } from "./canonicalPayload";

export type P4CanonicalReconciliationPhase = "CLIENT" | "SOLICITUD" | "PAYMENT" | "APPLICATION";
export const P4O_R1_SCOPE_ID = "P4O_R1_CANARY_2026_10";
export const P4O_R1_PHASES: P4CanonicalReconciliationPhase[] = ["CLIENT", "SOLICITUD", "PAYMENT", "APPLICATION"];
export const P4O_R1_CANARY_SCOPE: Readonly<Record<P4CanonicalReconciliationPhase,{entityType:P4CanonicalReconciliationPhase;iqEntityId:string;canonicalGroupId:string}>> = Object.freeze({
  CLIENT:{entityType:"CLIENT",iqEntityId:"1151",canonicalGroupId:"iq-group-rr"}, SOLICITUD:{entityType:"SOLICITUD",iqEntityId:"146375",canonicalGroupId:"iq-group-pay0"},
  PAYMENT:{entityType:"PAYMENT",iqEntityId:"176838",canonicalGroupId:"iq-group-pay0"}, APPLICATION:{entityType:"APPLICATION",iqEntityId:"162892",canonicalGroupId:"iq-group-pay0"},
});
export const P4O_R1_PROTECTED_FIELDS = Object.freeze(["originalIqEntityId","canonicalIqGroupId","historicalEventAt","createdAt","fechaPago","reportDateAt","appliedAt","importedAt","financialComponentId","solicitudId","pagoId","monto","moneda","importManifestId","importRunId","p4ActionId","source"]);
const FORBIDDEN_CALLER_FIELDS = ["patch","rootId","folio","status","companyId","despachoId","montoTotal","montoAplicado","montoDisponible","canonicalEvidence","actionId","iqEntityId","targetPath"];
const text=(value:unknown)=>String(value??"").trim();
const stable=(value:unknown)=>canonicalJson(value&&typeof value==="object"&&typeof (value as {toDate?:unknown}).toDate==="function"?(value as {toDate:()=>Date}).toDate().toISOString():value);

export function validateReconciliationRequest(data:unknown):{phase:P4CanonicalReconciliationPhase;sourceManifestId:string;evidenceManifestId:string;evidenceManifestHash:string;previewHash:string}{
  const row=(data&&typeof data==="object"?data:{}) as Record<string,unknown>;
  if(FORBIDDEN_CALLER_FIELDS.some(field=>field in row))throw Object.assign(new Error("El caller no puede proporcionar payload canónico ni seleccionar targets."),{code:"P4_CANONICAL_RECONCILIATION_CALLER_PAYLOAD_FORBIDDEN"});
  const phase=text(row.phase).toUpperCase() as P4CanonicalReconciliationPhase;if(!P4O_R1_PHASES.includes(phase))throw Object.assign(new Error("Fase de reconciliación inválida."),{code:"P4_CANONICAL_RECONCILIATION_SCOPE_INVALID"});
  return{phase,sourceManifestId:text(row.sourceManifestId),evidenceManifestId:text(row.evidenceManifestId),evidenceManifestHash:text(row.evidenceManifestHash),previewHash:text(row.previewHash)};
}
export function reconciliationId(rootId:string,sourceManifestId:string,evidenceManifestId:string){return`p4or_${deterministicId(P4O_R1_SCOPE_ID,rootId,sourceManifestId,evidenceManifestId).slice(0,24)}`;}
export function selectScopedAction(manifest:P4Manifest,phase:P4CanonicalReconciliationPhase):P4Action{
  const scope=P4O_R1_CANARY_SCOPE[phase],matches=manifest.actions.filter(action=>action.entityType===scope.entityType&&action.iqEntityId===scope.iqEntityId&&action.canonicalGroupId===scope.canonicalGroupId&&action.operation==="RECONCILE");
  if(matches.length!==1)throw Object.assign(new Error(`Scope ${phase} no resolvió una action exacta.`),{code:"P4_CANONICAL_RECONCILIATION_SCOPE_INVALID"});
  const action=matches[0];if(action.canonicalEvidence?.readiness!=="CANONICAL_READY"||!action.reconciliationOf)throw Object.assign(new Error("Action fuera del contrato canónico reconciliable."),{code:"P4_CANONICAL_RECONCILIATION_REVIEW_REQUIRED"});return action;
}
export function buildCanonicalReconciliationPreview(action:P4Action,current:Record<string,unknown>){
  const assessment=assessV5V6Reconciliation(action,current);if(!["SAFE_CANONICAL_RECONCILE","NO_CHANGE"].includes(assessment.classification))return{assessment,patch:{},changedFields:[],preservedFields:[],beforeFingerprint:fingerprint(current),afterFingerprint:fingerprint(current),previewHash:"",queryEligible:false};
  const patch=Object.fromEntries(Object.entries(assessment.patch).filter(([field])=>!P4O_R1_PROTECTED_FIELDS.includes(field)));
  const after={...current,...patch},changedFields=Object.keys(patch).filter(field=>stable(current[field])!==stable(patch[field])).sort(),preservedFields=Object.keys(current).filter(field=>stable(current[field])===stable(after[field])).sort();
  const beforeFingerprint=fingerprint(current),afterFingerprint=fingerprint(after),previewHash=deterministicId(P4O_R1_SCOPE_ID,action.actionId,action.targetPath,beforeFingerprint,afterFingerprint,canonicalJson(action.canonicalEvidence));
  return{assessment:{...assessment,classification:changedFields.length?"SAFE_CANONICAL_RECONCILE":"NO_CHANGE"},patch:Object.fromEntries(changedFields.map(field=>[field,patch[field]])),changedFields,preservedFields,beforeFingerprint,afterFingerprint,previewHash,queryEligible:queryEligible(action,after)};
}
export function fingerprint(row:Record<string,unknown>){return deterministicId(canonicalJson(row));}
export function queryEligible(action:P4Action,row:Record<string,unknown>){if(text(row.rootId)!==action.rootId)return false;if(action.entityType==="CLIENT")return true;if(!text(row.clientId??row.clienteId))return false;if(action.entityType==="SOLICITUD")return /^SIQ[RP]\d+$/.test(text(row.folio))&&!!text(row.companyId)&&!!text(row.despachoId);if(action.entityType==="PAYMENT")return /^PIQ[RP]\d+$/.test(text(row.folio))&&!!text(row.companyId)&&!!text(row.despachoId);return !!text(row.solicitudId)&&!!text(row.pagoId)&&text(row.status)==="APLICADA";}
export function priorPhases(phase:P4CanonicalReconciliationPhase){return P4O_R1_PHASES.slice(0,P4O_R1_PHASES.indexOf(phase));}
export function reconciliationSessionStatus(input:{authorizedPhases:P4CanonicalReconciliationPhase[];completedPhases:string[];failedPhases?:string[];completedPhase?:P4CanonicalReconciliationPhase;currentStatus?:string}){
  if(input.currentStatus==="ROLLED_BACK")return"ROLLED_BACK";
  const completed=new Set([...input.completedPhases,...(input.completedPhase?[input.completedPhase]:[])]),failed=new Set(input.failedPhases||[]);
  if(failed.size)return"FAILED";
  return input.authorizedPhases.every(phase=>completed.has(phase))?"COMPLETED":"IN_PROGRESS";
}
