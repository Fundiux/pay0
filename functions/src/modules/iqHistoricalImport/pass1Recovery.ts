import { canonicalJson, deterministicId, type P4Action, type P4Manifest } from "./domain";

export const P4_EXECUTION_PROVENANCE_FIELD = "p4ExecutionProvenance" as const;

export type P4ExecutionProvenance = {
  contractVersion: "P4_V8_PASS1_RECOVERY_1";
  manifestId: string;
  runId: string;
  actionId: string;
  operation: "RECONCILE";
  businessFingerprint: string;
  previous: P4Action["reconciliationOf"] | null;
};

export type P4ParentAssessment = {
  classification: "CURRENT_IMPORT_PARENT" | "PREEXISTING_CANONICAL_PARENT" | "PARENT_REVIEW_REQUIRED";
  valid: boolean;
  parentBalanceMutation: boolean;
  relationAlreadyReflected: boolean;
  reasons: string[];
};

const text=(value:unknown)=>String(value??"").trim();
const cents=(value:unknown)=>Math.round(Number(value)*100);
const finite=(value:unknown)=>Number.isFinite(Number(value));
const iso=(value:unknown):string=>{
  if(value&&typeof value==="object"&&typeof (value as {toDate?:unknown}).toDate==="function")return (value as {toDate:()=>Date}).toDate().toISOString();
  const parsed=Date.parse(text(value));return Number.isFinite(parsed)?new Date(parsed).toISOString():"";
};
const sameMoney=(left:unknown,right:unknown)=>finite(left)&&finite(right)&&cents(left)===cents(right);
const optionalExact=(actual:unknown,expected:unknown)=>!text(actual)||!text(expected)||text(actual)===text(expected);
const normalized=(value:unknown):unknown=>{
  if(value instanceof Date)return value.toISOString();
  if(value&&typeof value==="object"&&typeof (value as {toDate?:unknown}).toDate==="function")return (value as {toDate:()=>Date}).toDate().toISOString();
  if(Array.isArray(value))return value.map(normalized);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,row])=>[key,normalized(row)]));
  return value;
};
const businessFingerprint=(action:P4Action,row:Record<string,unknown>)=>deterministicId(canonicalJson(Object.fromEntries(action.mutableFields.filter(field=>field in row).map(field=>[field,normalized(row[field])]))));

export function executionProvenance(action:P4Action,manifestId:string,runId:string,committedBusinessState:Record<string,unknown>=action.after):P4ExecutionProvenance{
  return {contractVersion:"P4_V8_PASS1_RECOVERY_1",manifestId,runId,actionId:action.actionId,operation:"RECONCILE",businessFingerprint:businessFingerprint(action,committedBusinessState),previous:action.reconciliationOf||null};
}

export function hasExecutionProvenance(current:Record<string,unknown>,manifest:P4Manifest,action:P4Action):boolean{
  const marker=(current[P4_EXECUTION_PROVENANCE_FIELD]||{}) as Record<string,unknown>;
  return text(marker.contractVersion)==="P4_V8_PASS1_RECOVERY_1"&&text(marker.manifestId)===manifest.manifestId&&text(marker.actionId)===action.actionId&&text(marker.operation)==="RECONCILE"&&text(marker.businessFingerprint)===businessFingerprint(action,current);
}

export function previewExecutionProvenanceRepair(action:P4Action,current:Record<string,unknown>,manifestId:string,runId:string,certifiedExpected:Record<string,unknown>=action.after){
  const expected=executionProvenance(action,manifestId,runId,certifiedExpected),actual=current[P4_EXECUTION_PROVENANCE_FIELD]||null;
  const metadata=new Set(["rootId","source","importRunId","importVersion","importManifestId","canonicalIqProfileId","canonicalIqGroupId","observedThroughProfileIds","originalIqEntityId","financialComponentId","p4ActionId","importedAt","originalIqTimestamp","historicalEventAt","historicalEventDate","historicalTimeSourceField","historicalTimeSourceTimezone","historicalTimeSemanticType","historicalDateAvailability",P4_EXECUTION_PROVENANCE_FIELD]),businessFields=action.mutableFields.filter(field=>!metadata.has(field)&&field in action.after);
  const equal=(left:unknown,right:unknown)=>{const expectedIso=typeof right==="string"?iso(right):"",actualIso=expectedIso?iso(left):"";return expectedIso?actualIso===expectedIso:canonicalJson(left)===canonicalJson(right);};
  const businessFieldMutations=businessFields.filter(field=>field in certifiedExpected&&!equal(current[field],certifiedExpected[field]));
  const exact=canonicalJson(actual)===canonicalJson(expected),contradictory=actual!==null&&!exact;
  return {classification:businessFieldMutations.length?"BUSINESS_STATE_CONFLICT":exact?"NO_CHANGE":contradictory?"PROVENANCE_CONFLICT":"ADMINISTRATIVE_PROVENANCE_REPAIR_REQUIRED",targetPath:action.targetPath,actionId:action.actionId,entityType:action.entityType,iqEntityId:action.iqEntityId,missingFields:exact||contradictory?[]:[P4_EXECUTION_PROVENANCE_FIELD],administrativePatch:businessFieldMutations.length||exact||contradictory?{}:{[P4_EXECUTION_PROVENANCE_FIELD]:expected},businessFieldMutations,protectedBusinessFields:businessFields,expectedBusinessFieldMutations:businessFieldMutations.length};
}

export function assessApplicationParent(input:{parentAction:P4Action;applicationAction:P4Action;current:Record<string,unknown>;manifest:P4Manifest}):P4ParentAssessment{
  const {parentAction:parent,applicationAction:application,current,manifest}=input,reasons:string[]=[];
  if(!["SOLICITUD","PAYMENT"].includes(parent.entityType))reasons.push("ENTITY_TYPE");
  const markerValid=hasExecutionProvenance(current,manifest,parent);
  const currentImport=(current.source==="IQ_IMPORT"&&text(current.importManifestId)===manifest.manifestId&&text(current.p4ActionId)===parent.actionId)||markerValid;
  if(currentImport)return{classification:"CURRENT_IMPORT_PARENT",valid:true,parentBalanceMutation:true,relationAlreadyReflected:false,reasons:[]};
  if(!["NO_OP","EXISTING"].includes(parent.operation))reasons.push("OPERATION_NOT_PREEXISTING");
  if(parent.canonicalEvidence?.readiness!=="CANONICAL_READY")reasons.push("CANONICAL_READINESS");
  if(text(current.rootId)!==parent.rootId)reasons.push("ROOT");
  const expectedIq=parent.iqEntityId,actualIq=parent.entityType==="SOLICITUD"?(current.iqId??current.originalIqEntityId):(current.iqPaymentId??current.iqId??current.originalIqEntityId);
  if(text(actualIq)!==expectedIq)reasons.push("IQ_ID");
  const expectedClient=text(parent.after.clientId??parent.after.clienteId),actualClient=text(current.clientId??current.clienteId);
  if(!expectedClient||actualClient!==expectedClient||text(application.after.clientId??application.after.clienteId)!==expectedClient)reasons.push("CLIENT");
  if(!optionalExact(current.canonicalIqGroupId,parent.canonicalGroupId))reasons.push("CANONICAL_GROUP");
  if(!sameMoney(current.monto??current.montoTotal,parent.after.monto??parent.after.montoTotal))reasons.push("TOTAL");
  const plannedAt=iso(parent.historicalTime?.normalizedAt),currentAt=iso(current.historicalEventAt??current.fechaPago??current.reportDateAt);
  if(plannedAt&&currentAt&&plannedAt.slice(0,10)!==currentAt.slice(0,10))reasons.push("HISTORICAL_TIME");
  if(parent.entityType==="SOLICITUD"){
    const total=current.monto??current.montoTotal,applied=current.totalAbonado??current.montoAplicado,pending=current.saldoPendiente;
    if(!sameMoney(applied,parent.after.totalAbonado)||!sameMoney(total,Number(applied||0)+Number(pending??(Number(total)-Number(applied)))))reasons.push("SOLICITUD_BALANCE");
  }else{
    const total=current.monto??current.montoTotal,applied=current.totalAplicado??current.montoAplicado,available=current.saldoDisponible??current.montoDisponible;
    if(!sameMoney(applied,parent.after.totalAplicado)||!sameMoney(available,parent.after.saldoDisponible)||!sameMoney(total,Number(applied||0)+Number(available||0)))reasons.push("PAYMENT_BALANCE");
  }
  return reasons.length?{classification:"PARENT_REVIEW_REQUIRED",valid:false,parentBalanceMutation:false,relationAlreadyReflected:false,reasons}:{classification:"PREEXISTING_CANONICAL_PARENT",valid:true,parentBalanceMutation:false,relationAlreadyReflected:true,reasons:[]};
}
