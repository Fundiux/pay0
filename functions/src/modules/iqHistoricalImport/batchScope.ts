import { canonicalJson, deterministicId, type P4Action, type P4Manifest } from "./domain";
import { isReviewAction, isWriteAction, P4_PROTECTED_REVIEW_IQ_IDS } from "./phasedExecution";

export const P4_SCOPE_SELECTOR_VERSION = "P4_SCOPE_V8_3";
export const P4_SCOPE_TIMEZONE = "America/Mexico_City";
export const P4_SCOPE_MAX_BUDGET = Object.freeze({ maxActions: 25, maxWrites: 100, maxDurationMs: 480_000, maxErrors: 5, maxConcurrent: 1, maxRetries: 3 });

export type P4ScopeType = "CANARY" | "CERTIFICATION_WINDOW" | "BATCH_B" | "BATCH_C" | "MONTH_BLOCK";
export type P4ScopeMemberRole = "PRIMARY" | "EXTERNAL_DEPENDENCY";
export type P4ScopeRequest = { type:P4ScopeType; range?:{start:string;end:string;timezone:string}; month?:string; block?:"01_10"|"11_20"|"21_END" };
export type P4HistoricalBatchEvidence = { certified:boolean; selectorVersion:string; sourceManifestId:string; sourceManifestHash:string; sourceRunId:string; actionIds:string[]; evidenceHash:string };
export type P4ScopeMember = { actionId:string; entityType:P4Action["entityType"]; iqEntityId:string; canonicalGroupId:string; componentId:string|null; operation:string; role:P4ScopeMemberRole; historicalDate:string|null; dependencies:string[]; order:number };
export type P4ScopeDependency = P4ScopeMember & { satisfied:boolean };
export type P4Scope = { version:8; selectorVersion:string; scopeId:string; scopeHash:string; manifestId:string; manifestHash:string; type:P4ScopeType; request:P4ScopeRequest; members:P4ScopeMember[]; externalDependencies:P4ScopeDependency[]; excluded:Array<{actionId:string;iqEntityId:string;reason:string}>; expectedPay0Writes:number; expectedIqWrites:0; expectedExternalEffects:0 };
export type P4ScopeBudget = { maxActions:number; maxWrites:number; maxDurationMs:number; maxErrors:number; maxConcurrent:number; maxRetries:number };

const text=(value:unknown)=>String(value??"").trim();
const isoDate=(value:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(text(value))?text(value):"";
const forbiddenKeys=new Set(["actionId","actionIds","targetPath","targetPaths","componentId","cursor","iqEntityId","patch","amount","clientId","dependencies"]);

export function validateScopeRequest(input:unknown):P4ScopeRequest{
  const row=(input&&typeof input==="object"?input:{}) as Record<string,unknown>;
  for(const key of forbiddenKeys)if(key in row)throw Object.assign(new Error(`Caller scope field forbidden: ${key}`),{code:"P4_SCOPE_CALLER_SELECTION_FORBIDDEN"});
  const type=text(row.type).toUpperCase() as P4ScopeType;
  if(!["CANARY","CERTIFICATION_WINDOW","BATCH_B","BATCH_C","MONTH_BLOCK"].includes(type))throw Object.assign(new Error("Scope type invalid"),{code:"P4_SCOPE_TYPE_INVALID"});
  if(type==="CERTIFICATION_WINDOW"){
    const range=(row.range&&typeof row.range==="object"?row.range:{}) as Record<string,unknown>,start=isoDate(range.start),end=isoDate(range.end),timezone=text(range.timezone);
    if(!start||!end||start>end||timezone!==P4_SCOPE_TIMEZONE)throw Object.assign(new Error("Scope range invalid"),{code:"P4_SCOPE_RANGE_INVALID"});
    return{type,range:{start,end,timezone}};
  }
  if(type==="MONTH_BLOCK"){
    const month=text(row.month),block=text(row.block) as P4ScopeRequest["block"];
    if(!/^2026-(0[1-9]|1[0-2])$/.test(month)||!["01_10","11_20","21_END"].includes(block||""))throw Object.assign(new Error("Month block invalid"),{code:"P4_SCOPE_RANGE_INVALID"});
    return{type,month,block};
  }
  return{type};
}

export function scopeBudget(input:unknown):P4ScopeBudget{
  const row=(input&&typeof input==="object"?input:{}) as Record<string,unknown>;
  const bounded=(key:keyof P4ScopeBudget,fallback:number)=>Math.max(1,Math.min(P4_SCOPE_MAX_BUDGET[key],Math.trunc(Number(row[key])||fallback)));
  return{maxActions:bounded("maxActions",P4_SCOPE_MAX_BUDGET.maxActions),maxWrites:bounded("maxWrites",P4_SCOPE_MAX_BUDGET.maxWrites),maxDurationMs:bounded("maxDurationMs",45_000),maxErrors:bounded("maxErrors",1),maxConcurrent:bounded("maxConcurrent",1),maxRetries:bounded("maxRetries",1)};
}

function requestRange(request:P4ScopeRequest):{start:string;end:string}|null{
  if(request.type==="CERTIFICATION_WINDOW")return request.range!;
  if(request.type!=="MONTH_BLOCK")return null;
  const startDay=request.block==="01_10"?"01":request.block==="11_20"?"11":"21";
  const next=new Date(`${request.month}-01T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);next.setUTCDate(0);
  const endDay=request.block==="01_10"?"10":request.block==="11_20"?"20":String(next.getUTCDate()).padStart(2,"0");
  return{start:`${request.month}-${startDay}`,end:`${request.month}-${endDay}`};
}

function terminal(action:P4Action):boolean{
  const raw=canonicalJson(action.canonicalEvidence?.status?.rawValue??action.canonicalEvidence?.status??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
  return ["RECHAZADA","RECHAZADO","CANCELADA","CANCELADO","ELIMINADA","ELIMINADO"].some(value=>raw.includes(value));
}

function assertHistoricalEvidence(manifest:P4Manifest,request:P4ScopeRequest,evidence?:P4HistoricalBatchEvidence):Set<string>{
  if(!evidence?.certified||evidence.selectorVersion!==P4_SCOPE_SELECTOR_VERSION||evidence.sourceManifestId===""||evidence.sourceRunId==="")throw Object.assign(new Error(`Certified historical evidence missing for ${request.type}`),{code:"P4_SCOPE_HISTORICAL_EVIDENCE_INCOMPLETE"});
  const content={selectorVersion:evidence.selectorVersion,sourceManifestId:evidence.sourceManifestId,sourceManifestHash:evidence.sourceManifestHash,sourceRunId:evidence.sourceRunId,actionIds:[...new Set(evidence.actionIds)].sort()};
  const expected=deterministicId(canonicalJson(content));if(evidence.evidenceHash!==expected)throw Object.assign(new Error("Historical evidence hash mismatch"),{code:"P4_SCOPE_HISTORICAL_EVIDENCE_INVALID"});
  const ids=new Set(content.actionIds);if(!ids.size||[...ids].some(id=>!manifest.actions.some(action=>action.actionId===id)))throw Object.assign(new Error("Historical evidence references absent actions"),{code:"P4_SCOPE_HISTORICAL_EVIDENCE_INVALID"});
  return ids;
}

export function buildExecutionScope(input:{manifest:P4Manifest;request:P4ScopeRequest;historicalEvidence?:P4HistoricalBatchEvidence;completedActionIds?:Set<string>;isolatedComponentIds?:Set<string>}):P4Scope{
  const {manifest,request}=input,completed=input.completedActionIds||new Set<string>(),isolated=input.isolatedComponentIds||new Set<string>(),byId=new Map(manifest.actions.map(action=>[action.actionId,action]));
  let primaryIds:Set<string>;
  if(request.type==="BATCH_B"||request.type==="BATCH_C")primaryIds=assertHistoricalEvidence(manifest,request,input.historicalEvidence);
  else if(request.type==="CANARY")primaryIds=new Set();
  else {const range=requestRange(request)!;primaryIds=new Set(manifest.actions.filter(action=>{const date=isoDate(action.historicalTime?.normalizedDate);return !!date&&date>=range.start&&date<=range.end;}).map(action=>action.actionId));}
  const roles=new Map<string,P4ScopeMemberRole>();for(const id of primaryIds)roles.set(id,"PRIMARY");
  const visit=(id:string)=>{const action=byId.get(id);if(!action)return;for(const dep of action.dependencies||[]){if(completed.has(dep)||roles.has(dep))continue;roles.set(dep,"EXTERNAL_DEPENDENCY");visit(dep);}};for(const id of primaryIds)visit(id);
  const excluded:Array<{actionId:string;iqEntityId:string;reason:string}>=[];
  const selected=[...roles].map(([id,role])=>({action:byId.get(id)!,role})).filter(row=>{
    const reason=completed.has(row.action.actionId)?"COMPLETED":row.action.componentId&&isolated.has(row.action.componentId)?"FINANCIAL_COMPONENT_REVIEW":P4_PROTECTED_REVIEW_IQ_IDS.has(row.action.iqEntityId)?"PROTECTED_REVIEW":isReviewAction(row.action)?"REVIEW":terminal(row.action)?"TERMINAL":!isWriteAction(row.action)?"NO_CHANGE":"";
    if(reason){excluded.push({actionId:row.action.actionId,iqEntityId:row.action.iqEntityId,reason});return false;}return true;
  });
  const unresolvedExternalIds=new Set(selected.filter(row=>row.role==="EXTERNAL_DEPENDENCY"&&!completed.has(row.action.actionId)&&isWriteAction(row.action)).map(row=>row.action.actionId));
  const dependsOnUnresolvedExternal=(action:P4Action,seen=new Set<string>()):boolean=>{if(seen.has(action.actionId))return false;seen.add(action.actionId);return(action.dependencies||[]).some(id=>unresolvedExternalIds.has(id)||!!byId.get(id)&&dependsOnUnresolvedExternal(byId.get(id)!,seen));};
  const executable=selected.filter(row=>{if(row.role==="EXTERNAL_DEPENDENCY")return false;if(dependsOnUnresolvedExternal(row.action)){excluded.push({actionId:row.action.actionId,iqEntityId:row.action.iqEntityId,reason:"EXTERNAL_DEPENDENCY_PENDING"});return false;}return true;});
  const entityRank={CLIENT:0,SOLICITUD:1,PAYMENT:2,APPLICATION:3};
  executable.sort((a,b)=>entityRank[a.action.entityType]-entityRank[b.action.entityType]||a.action.canonicalGroupId.localeCompare(b.action.canonicalGroupId)||a.action.actionId.localeCompare(b.action.actionId));
  const members=executable.map((row,index):P4ScopeMember=>({actionId:row.action.actionId,entityType:row.action.entityType,iqEntityId:row.action.iqEntityId,canonicalGroupId:row.action.canonicalGroupId,componentId:row.action.componentId||null,operation:row.action.operation,role:row.role,historicalDate:row.action.historicalTime?.normalizedDate||null,dependencies:[...(row.action.dependencies||[])].sort(),order:index}));
  const externalDependencies=selected.filter(row=>row.role==="EXTERNAL_DEPENDENCY").sort((a,b)=>entityRank[a.action.entityType]-entityRank[b.action.entityType]||a.action.actionId.localeCompare(b.action.actionId)).map((row,index):P4ScopeDependency=>({actionId:row.action.actionId,entityType:row.action.entityType,iqEntityId:row.action.iqEntityId,canonicalGroupId:row.action.canonicalGroupId,componentId:row.action.componentId||null,operation:row.action.operation,role:row.role,historicalDate:row.action.historicalTime?.normalizedDate||null,dependencies:[...(row.action.dependencies||[])].sort(),order:index,satisfied:completed.has(row.action.actionId)||!isWriteAction(row.action)}));
  const semantic={selectorVersion:P4_SCOPE_SELECTOR_VERSION,manifestId:manifest.manifestId,manifestHash:manifest.manifestHash,type:request.type,request,members,externalDependencies,excluded:[...excluded].sort((a,b)=>a.actionId.localeCompare(b.actionId))};
  const scopeHash=deterministicId(canonicalJson(semantic)),scopeId=`p4s_${scopeHash.slice(0,24)}`;
  return{version:8,selectorVersion:P4_SCOPE_SELECTOR_VERSION,scopeId,scopeHash,manifestId:manifest.manifestId,manifestHash:manifest.manifestHash,type:request.type,request,members,externalDependencies,excluded:semantic.excluded,expectedPay0Writes:members.length,expectedIqWrites:0,expectedExternalEffects:0};
}

export function assertScopeApproval(input:{scope:P4Scope;manifest:P4Manifest;scopeId:unknown;scopeHash:unknown;manifestHash:unknown;selectorVersion:unknown}){
  if(input.scope.manifestId!==input.manifest.manifestId||input.scope.manifestHash!==input.manifest.manifestHash||text(input.manifestHash)!==input.manifest.manifestHash)throw Object.assign(new Error("Manifest approval mismatch"),{code:"P4_SCOPE_MANIFEST_MISMATCH"});
  if(text(input.scopeId)!==input.scope.scopeId||text(input.scopeHash)!==input.scope.scopeHash||text(input.selectorVersion)!==P4_SCOPE_SELECTOR_VERSION)throw Object.assign(new Error("Scope approval mismatch"),{code:"P4_SCOPE_APPROVAL_MISMATCH"});
}

export function scopeQueue(scope:P4Scope,manifest:P4Manifest):P4Action[]{const byId=new Map(manifest.actions.map(action=>[action.actionId,action]));return scope.members.map(member=>byId.get(member.actionId)).filter((action):action is P4Action=>!!action);}

export function scopeCanaryQueue(scope:P4Scope,manifest:P4Manifest,completed:Set<string>):P4Action[]{
  const queue=scopeQueue(scope,manifest);
  const candidate=queue.find(action=>!completed.has(action.actionId)&&(action.dependencies||[]).every(id=>completed.has(id)));
  return candidate?[candidate]:[];
}
