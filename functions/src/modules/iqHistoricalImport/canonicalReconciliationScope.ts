import { canonicalJson, deterministicId, type P4Action, type P4Manifest } from "./domain";
import { buildCanonicalReconciliationPreview, P4O_R1_CANARY_SCOPE, P4O_R1_PHASES, type P4CanonicalReconciliationPhase } from "./canonicalReconciliation";

export type P4CanonicalReconciliationScope = "CANARY" | "CERTIFICATION_WINDOW_REMAINING" | "R3_CANARY" | "R3_EXISTING";
export type P4ScopeActionState = "PENDING" | "RECONCILED" | "NO_CHANGE" | "REVIEW" | "FAILED";
export const P4O_R4_SCOPE_ID = "P4O_R4_CERT_WINDOW_2026_09_27_28";
export const P4O_R4_RANGE = Object.freeze({start:"2026-09-27",end:"2026-09-28",timezone:"America/Mexico_City"});
export const P4O_R4_REVIEW_IQ_IDS = Object.freeze(["7565","186637","225628","162839","162841","162842"]);
const FORBIDDEN = ["patch","rootId","folio","status","companyId","despachoId","montoTotal","montoAplicado","montoDisponible","canonicalEvidence","actionId","actionIds","iqEntityId","iqEntityIds","targetPath","targetPaths"];
const TERMINAL = new Set<P4ScopeActionState>(["RECONCILED","NO_CHANGE","REVIEW"]);
const text=(value:unknown)=>String(value??"").trim();

export type P4ScopeRequest={scope:P4CanonicalReconciliationScope;phase:P4CanonicalReconciliationPhase;sourceManifestId:string;evidenceManifestId:string;evidenceManifestHash:string;scopeFingerprint:string;executionAuthorization:string;budget:{maxActions:number;maxWrites:number;maxDurationMs:number;maxErrors:number;maxRetries:number}};

export function validateScopeRequest(data:unknown):P4ScopeRequest{
  const row=(data&&typeof data==="object"?data:{}) as Record<string,unknown>;
  if(FORBIDDEN.some(field=>field in row))throw Object.assign(new Error("El caller no puede seleccionar miembros ni proporcionar payload canónico."),{code:"P4_CANONICAL_RECONCILIATION_CALLER_PAYLOAD_FORBIDDEN"});
  const scope=text(row.scope).toUpperCase() as P4CanonicalReconciliationScope;
  if(!["CANARY","CERTIFICATION_WINDOW_REMAINING","R3_CANARY","R3_EXISTING"].includes(scope))throw Object.assign(new Error("Scope de reconciliación inválido."),{code:"P4_CANONICAL_RECONCILIATION_SCOPE_INVALID"});
  const phase=text(row.phase).toUpperCase() as P4CanonicalReconciliationPhase;
  if(!P4O_R1_PHASES.includes(phase))throw Object.assign(new Error("Fase de reconciliación inválida."),{code:"P4_CANONICAL_RECONCILIATION_SCOPE_INVALID"});
  const raw=(row.budget&&typeof row.budget==="object"?row.budget:{}) as Record<string,unknown>;
  const limit=(key:string,fallback:number,max:number)=>Math.max(1,Math.min(max,Math.trunc(Number(raw[key])||fallback)));
  return{scope,phase,sourceManifestId:text(row.sourceManifestId),evidenceManifestId:text(row.evidenceManifestId),evidenceManifestHash:text(row.evidenceManifestHash),scopeFingerprint:text(row.scopeFingerprint),executionAuthorization:text(row.executionAuthorization),budget:{maxActions:limit("maxActions",10,25),maxWrites:limit("maxWrites",10,25),maxDurationMs:limit("maxDurationMs",45_000,240_000),maxErrors:limit("maxErrors",1,5),maxRetries:limit("maxRetries",2,3)}};
}

export function assertCertificationManifest(manifest:P4Manifest){
  const range=manifest.range as {start?:string;end?:string;timezone?:string};
  if(![6,7].includes(manifest.version)||range?.start!==P4O_R4_RANGE.start||range?.end!==P4O_R4_RANGE.end||range?.timezone!==P4O_R4_RANGE.timezone)throw Object.assign(new Error("Manifest fuera de la ventana certificada."),{code:"P4_CANONICAL_RECONCILIATION_SCOPE_INVALID"});
}

const semanticOrder=(a:P4Action,b:P4Action)=>[a.entityType,a.canonicalGroupId,a.iqEntityId,a.actionId].join("|").localeCompare([b.entityType,b.canonicalGroupId,b.iqEntityId,b.actionId].join("|"));
export function selectScopeActions(manifest:P4Manifest,scope:P4CanonicalReconciliationScope,phase:P4CanonicalReconciliationPhase,sourceManifestId:string):P4Action[]{
  if(scope==="CANARY"){
    const member=P4O_R1_CANARY_SCOPE[phase];
    return manifest.actions.filter(action=>action.entityType===member.entityType&&action.iqEntityId===member.iqEntityId&&action.canonicalGroupId===member.canonicalGroupId&&action.operation==="RECONCILE"&&action.reconciliationOf?.manifestId===sourceManifestId).sort(semanticOrder);
  }
  if(scope==="R3_CANARY"||scope==="R3_EXISTING"){
    assertCertificationManifest(manifest);
    if(manifest.version!==7)throw Object.assign(new Error("R3 requiere Manifest V7."),{code:"P4_CANONICAL_RECONCILIATION_SCOPE_INVALID"});
    const existing=manifest.actions.filter(action=>action.reconciliationOf?.manifestId===sourceManifestId).sort(semanticOrder);
    if(scope==="R3_EXISTING")return existing.filter(action=>action.entityType===phase);
    const safe=existing.filter(action=>action.operation==="RECONCILE"&&action.canonicalEvidence?.readiness==="CANONICAL_READY");
    if(phase==="CLIENT"){
      const financial=safe.filter(action=>action.entityType!=="CLIENT"),dependencyIds=new Set(financial.flatMap(action=>action.dependencies||[]));
      return safe.filter(action=>action.entityType==="CLIENT"&&dependencyIds.has(action.actionId)).slice(0,1);
    }
    const candidates=safe.filter(action=>action.entityType===phase);
    if(phase==="APPLICATION")return candidates.slice(0,1);
    return ["iq-group-pay0","iq-group-rr"].map(group=>candidates.find(action=>action.canonicalGroupId===group)).filter(Boolean) as P4Action[];
  }
  assertCertificationManifest(manifest);
  return manifest.actions.filter(action=>action.entityType===phase&&action.operation==="RECONCILE"&&action.reconciliationOf?.manifestId===sourceManifestId&&action.canonicalEvidence?.readiness==="CANONICAL_READY"&&!P4O_R4_REVIEW_IQ_IDS.includes(action.iqEntityId)).sort(semanticOrder);
}

export function reviewExclusions(manifest:P4Manifest){
  return manifest.actions.filter(action=>P4O_R4_REVIEW_IQ_IDS.includes(action.iqEntityId)||["CLIENT_REVIEW_REQUIRED","REVIEW_REQUIRED","FINANCIAL_RECONCILIATION_REVIEW"].includes(action.operation)).map(action=>({actionId:action.actionId,entityType:action.entityType,iqEntityId:action.iqEntityId,operation:action.operation,componentId:action.componentId||null,reasons:action.canonicalEvidence?.reviewReasons||[]})).sort((a,b)=>[a.entityType,a.iqEntityId,a.actionId].join("|").localeCompare([b.entityType,b.iqEntityId,b.actionId].join("|")));
}

export function scopeSessionId(rootId:string,sourceManifestId:string,evidenceManifestId:string,scope:P4CanonicalReconciliationScope,phase:P4CanonicalReconciliationPhase){return`p4ors_${deterministicId(P4O_R4_SCOPE_ID,rootId,sourceManifestId,evidenceManifestId,scope,phase).slice(0,24)}`;}
export function scopeActionProgressId(action:P4Action){return deterministicId(P4O_R4_SCOPE_ID,action.actionId,action.targetPath);}
export function scopeBackupId(sessionId:string,action:P4Action){return deterministicId(sessionId,action.actionId,action.targetPath);}

export function buildScopePreview(input:{manifest:P4Manifest;scope:P4CanonicalReconciliationScope;phase:P4CanonicalReconciliationPhase;sourceManifestId:string;currentByPath:Map<string,Record<string,unknown>|null>;progressByActionId?:Map<string,P4ScopeActionState>}){
  const actions=selectScopeActions(input.manifest,input.scope,input.phase,input.sourceManifestId);
  const rows=actions.map(action=>{
    const current=input.currentByPath.get(action.targetPath);
    if(!current)return{actionId:action.actionId,entityType:action.entityType,iqEntityId:action.iqEntityId,canonicalGroupId:action.canonicalGroupId,targetPath:action.targetPath,rootId:action.rootId,source:null,currentStatus:null,expectedAdminId:text(action.after.adminId)||null,currentAdminId:null,classification:"REVIEW" as const,proposedAction:"UNAVAILABLE" as const,reason:"MISSING_DOCUMENT",changedFields:[],canonicalPatch:{},queryEligible:false,previewHash:"",dependencies:action.dependencies||[],progress:input.progressByActionId?.get(action.actionId)||"PENDING"};
    if(text(current.rootId)&&text(current.rootId)!==action.rootId)return{actionId:action.actionId,entityType:action.entityType,iqEntityId:action.iqEntityId,canonicalGroupId:action.canonicalGroupId,targetPath:action.targetPath,rootId:action.rootId,source:text(current.source),currentStatus:text(current.status),expectedAdminId:text(action.after.adminId)||null,currentAdminId:text(current.adminId)||null,classification:"REVIEW" as const,proposedAction:"CONFLICT" as const,reason:"CLIENT_ROOT_CONFLICT",changedFields:[],canonicalPatch:{},queryEligible:false,previewHash:"",dependencies:action.dependencies||[],progress:input.progressByActionId?.get(action.actionId)||"PENDING"};
    const preview=buildCanonicalReconciliationPreview(action,current);
    const classification=preview.assessment.classification==="NO_CHANGE"?"NO_CHANGE":preview.assessment.classification==="SAFE_CANONICAL_RECONCILE"?"DIRECT_PATCH":"REVIEW";
    const proposedAction=classification==="NO_CHANGE"?"NO_CHANGE":classification==="DIRECT_PATCH"?"ASSIGN":"REVIEW_REQUIRED";
    return{actionId:action.actionId,entityType:action.entityType,iqEntityId:action.iqEntityId,canonicalGroupId:action.canonicalGroupId,targetPath:action.targetPath,rootId:action.rootId,source:text(current.source),currentStatus:text(current.status),expectedAdminId:text(action.after.adminId)||null,currentAdminId:text(current.adminId)||null,classification,proposedAction,reason:preview.assessment.reason||null,changedFields:preview.changedFields,canonicalPatch:preview.patch,queryEligible:preview.queryEligible,previewHash:preview.previewHash,beforeFingerprint:preview.beforeFingerprint,afterFingerprint:preview.afterFingerprint,dependencies:action.dependencies||[],progress:input.progressByActionId?.get(action.actionId)||"PENDING"};
  });
  const counts=rows.reduce<Record<string,number>>((out,row)=>{out[row.classification]=(out[row.classification]||0)+1;return out;},{});
  const scopeFingerprint=deterministicId(P4O_R4_SCOPE_ID,input.scope,input.phase,input.manifest.manifestId,input.manifest.manifestHash,canonicalJson(rows.map(row=>({actionId:row.actionId,targetPath:row.targetPath,dependencies:row.dependencies}))));
  return{scopeId:P4O_R4_SCOPE_ID,scopeFingerprint,actions:rows,counts,selected:rows.length,expectedPatches:rows.filter(row=>row.classification==="DIRECT_PATCH").length,expectedBackups:rows.filter(row=>row.classification==="DIRECT_PATCH").length,expectedSideEffects:{iqWrites:0,externalEffects:0},excluded:reviewExclusions(input.manifest)};
}

export function assertPatchContract(action:P4Action,changedFields:string[]){
  if(action.entityType==="CLIENT"&&changedFields.some(field=>!["rootId","adminId","associatedName","identityMappingVersion","identityMappingHash"].includes(field)))throw Object.assign(new Error("CLIENT propuso campos fuera del contrato R4."),{code:"P4_CANONICAL_RECONCILIATION_PATCH_FAILED"});
  const protectedFields=["originalIqEntityId","canonicalIqGroupId","historicalEventAt","createdAt","fechaPago","reportDateAt","appliedAt","importedAt","financialComponentId","solicitudId","pagoId","monto","moneda","importManifestId","importRunId","p4ActionId","source","owner","ownerId","createdBy","managedByUserId"];
  if(changedFields.some(field=>protectedFields.includes(field)))throw Object.assign(new Error("Patch intentó modificar un campo protegido."),{code:"P4_CANONICAL_RECONCILIATION_PATCH_FAILED"});
}

export function phaseStatus(states:P4ScopeActionState[]){if(states.some(state=>state==="FAILED"))return"FAILED";if(states.every(state=>TERMINAL.has(state)))return"COMPLETED";return"IN_PROGRESS";}
export function pendingScopeActions(actions:P4Action[],progressByActionId:Map<string,P4ScopeActionState>){return actions.filter(action=>!TERMINAL.has(progressByActionId.get(action.actionId) as P4ScopeActionState));}
export function requiresPostClientPlan(scope:P4CanonicalReconciliationScope,phase:P4CanonicalReconciliationPhase){return scope==="CERTIFICATION_WINDOW_REMAINING"&&phase==="CLIENT";}
