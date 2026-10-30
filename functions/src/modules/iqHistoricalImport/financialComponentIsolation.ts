import { canonicalJson, deterministicId, type P4Action, type P4Manifest } from "./domain";

export const P4_FINANCIAL_COMPONENT_ISOLATION_VERSION = "P4_V8_FINANCIAL_COMPONENT_ISOLATION_1";

export type P4FinancialComponentIsolation = {
  version: typeof P4_FINANCIAL_COMPONENT_ISOLATION_VERSION;
  manifestId: string;
  componentId: string;
  sourceRunId: string;
  failedActionId: string;
  failedIqEntityId: string;
  errorCode: "P4_APPLICATION_ATOMICITY_BLOCKED";
  actionIds: string[];
  entityIds: Array<{ entityType:P4Action["entityType"]; iqEntityId:string; actionId:string; operation:string }>;
  incomingActionIds: string[];
  outgoingDependencyIds: string[];
  isolationHash: string;
};

export function buildFinancialComponentIsolation(input:{manifest:P4Manifest;sourceRunId:string;failedActionId:string;errorCode:string}):P4FinancialComponentIsolation{
  const {manifest,sourceRunId,failedActionId,errorCode}=input,failed=manifest.actions.find(action=>action.actionId===failedActionId);
  if(!failed||failed.entityType!=="APPLICATION"||!failed.componentId||errorCode!=="P4_APPLICATION_ATOMICITY_BLOCKED")throw Object.assign(new Error("Failed action is not eligible for financial component isolation"),{code:"P4_FINANCIAL_COMPONENT_ISOLATION_NOT_ELIGIBLE"});
  const componentActions=manifest.actions.filter(action=>action.componentId===failed.componentId),actionIds=componentActions.map(action=>action.actionId).sort(),actionSet=new Set(actionIds);
  const incomingActionIds=manifest.actions.filter(action=>action.componentId!==failed.componentId&&(action.dependencies||[]).some(id=>actionSet.has(id))).map(action=>action.actionId).sort();
  const outgoingDependencyIds=[...new Set(componentActions.flatMap(action=>action.dependencies||[]).filter(id=>!actionSet.has(id)))].sort();
  const base:Omit<P4FinancialComponentIsolation,"isolationHash">={version:P4_FINANCIAL_COMPONENT_ISOLATION_VERSION,manifestId:manifest.manifestId,componentId:failed.componentId,sourceRunId,failedActionId,failedIqEntityId:failed.iqEntityId,errorCode:"P4_APPLICATION_ATOMICITY_BLOCKED",actionIds,entityIds:componentActions.map(action=>({entityType:action.entityType,iqEntityId:action.iqEntityId,actionId:action.actionId,operation:action.operation})).sort((a,b)=>a.actionId.localeCompare(b.actionId)),incomingActionIds,outgoingDependencyIds};
  return{...base,isolationHash:deterministicId(canonicalJson(base))};
}
