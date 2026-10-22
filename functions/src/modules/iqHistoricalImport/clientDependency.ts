import type { P4Action } from "./domain";

const text=(value:unknown)=>String(value??"").trim();
export type CanonicalClientRootStatus="ALREADY_CANONICAL"|"PENDING_RECONCILIATION"|"CONFLICT"|"AMBIGUOUS"|"MISSING_DOCUMENT"|"IDENTITY_CONFLICT";
export type CanonicalClientCandidate={id:string;rootId:string;data:Record<string,unknown>};

export function classifyCanonicalClientRoot(input:{action:P4Action;actions:P4Action[];clients:CanonicalClientCandidate[]}):{status:CanonicalClientRootStatus;clientId:string;expectedRootId:string;currentRootId:string;clientAction?:P4Action;client?:CanonicalClientCandidate;reason:string}{
  const clientId=text(input.action.after.clientId??input.action.after.clienteId),matches=input.clients.filter(client=>client.id===clientId),clientActions=input.actions.filter(action=>action.entityType==="CLIENT"&&action.targetPath===`clients/${clientId}`),client=matches[0],clientAction=clientActions[0],expectedRootId=text(clientAction?.canonicalEvidence?.root?.normalizedValue??clientAction?.rootId),currentRootId=text(client?.rootId);
  const result=(status:CanonicalClientRootStatus,reason:string)=>({status,clientId,expectedRootId,currentRootId,clientAction,client,reason});
  if(!clientId||clientActions.length!==1||matches.length>1)return result("AMBIGUOUS","Canonical client target is absent or ambiguous");
  if(!client)return result("MISSING_DOCUMENT","PAY0 client document does not exist");
  if(!expectedRootId||clientAction!.canonicalEvidence?.readiness!=="CANONICAL_READY")return result("AMBIGUOUS","V6 client root evidence is incomplete");
  if(currentRootId&&currentRootId!==expectedRootId)return result("CONFLICT","Current PAY0 client root contradicts canonical evidence");
  if(currentRootId===expectedRootId)return result("ALREADY_CANONICAL","Current PAY0 client root matches canonical evidence");
  const bridge=clientAction!.reconciliationOf,data=client.data,currentIqId=text(data.originalIqEntityId??data.iqClientId),currentGroup=text(data.canonicalIqGroupId);
  const bridgeExact=clientAction!.operation==="RECONCILE"&&!!bridge&&text(data.source)==="IQ_IMPORT"&&text(data.importManifestId)===text(bridge.manifestId)&&text(data.importRunId)===text(bridge.runId)&&text(data.p4ActionId)===text(bridge.actionId)&&currentIqId===text(clientAction!.iqEntityId)&&currentGroup===text(clientAction!.canonicalGroupId)&&clientAction!.targetPath===`clients/${clientId}`;
  return bridgeExact?result("PENDING_RECONCILIATION","Exact V5 client must reconcile before its dependents"):result("IDENTITY_CONFLICT","Missing root lacks an exact V5 to V6 client bridge");
}

export function buildCanonicalReconciliationOrder(actions:P4Action[]):P4Action[]{
  const selected=actions.filter(action=>action.operation==="RECONCILE"),byId=new Map(selected.map(action=>[action.actionId,action])),remaining=new Set(selected.map(action=>action.actionId)),ordered:P4Action[]=[],rank={CLIENT:0,SOLICITUD:1,PAYMENT:2,APPLICATION:3};
  while(remaining.size){const ready=[...remaining].map(id=>byId.get(id)!).filter(action=>(action.dependencies||[]).every(id=>!remaining.has(id))).sort((a,b)=>rank[a.entityType]-rank[b.entityType]||a.actionId.localeCompare(b.actionId));if(!ready.length)throw new Error("P4_CANONICAL_DEPENDENCY_CYCLE");for(const action of ready){ordered.push(action);remaining.delete(action.actionId);}}
  return ordered;
}
