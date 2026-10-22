import type { P4Action, P4BalanceResult } from "./domain";
import { canonicalApplicationStatus, canonicalPaymentStatus, canonicalSolicitudStatus, resolveExactCompany } from "./canonicalEvidence";
import { historicalFolioEvidence } from "./historicalFolio";
import { getCanonicalClientDisplayName } from "../clients/domain";
import { classifyCanonicalClientRoot, type CanonicalClientCandidate, type CanonicalClientRootStatus } from "./clientDependency";

const text=(value:unknown)=>String(value??"").replace(/\s+/g," ").trim();
const first=(row:Record<string,unknown>,names:string[])=>names.map(name=>text(row[name])).find(Boolean)||"";
const finiteOrNull=(value:unknown)=>{const number=Number(value);return Number.isFinite(number)?number:null;};
const reviewOperations=new Set(["CANONICAL_DEPENDENCY_PENDING","REVIEW_REQUIRED","CLIENT_REVIEW_REQUIRED","FINANCIAL_RECONCILIATION_REVIEW","HISTORICAL_DATE_REVIEW_REQUIRED"]);

export type P4CompanyCandidate={id:string;name:string;despachoId:string|null;companyNumber:number|null};
export type P4ClientCandidate=CanonicalClientCandidate;

export function resolveCanonicalClientName(input:{action:P4Action;actions:P4Action[];clients:P4ClientCandidate[]}):{clientId:string;name:string;rootId:string;derivation:string;decision:"DERIVED_EXACT"|"DEPENDENCY_PENDING"|"REVIEW_REQUIRED";rootStatus:CanonicalClientRootStatus}{
  const clientId=text(input.action.after.clientId)||(input.action.entityType==="CLIENT"?input.action.targetPath.split("/")[1]:"");
  if(input.action.entityType==="CLIENT"){const name=getCanonicalClientDisplayName(input.action.after,"");return{clientId,name,rootId:input.action.rootId,derivation:name?"CANONICAL_CLIENT_ACTION":"MISSING_CLIENT_NAME",decision:name?"DERIVED_EXACT":"REVIEW_REQUIRED",rootStatus:"ALREADY_CANONICAL"};}
  const root=classifyCanonicalClientRoot(input),client=root.client,name=root.status==="ALREADY_CANONICAL"&&client?getCanonicalClientDisplayName(client.data,""):"";
  if(root.status==="ALREADY_CANONICAL")return{clientId:root.clientId,name,rootId:root.currentRootId,derivation:name?"PAY0_CLIENT_DOCUMENT":"MISSING_CLIENT_NAME",decision:name?"DERIVED_EXACT":"REVIEW_REQUIRED",rootStatus:root.status};
  if(root.status==="PENDING_RECONCILIATION")return{clientId:root.clientId,name:"",rootId:root.expectedRootId,derivation:"CLIENT_ROOT_PENDING_RECONCILIATION",decision:"DEPENDENCY_PENDING",rootStatus:root.status};
  return{clientId:root.clientId,name:"",rootId:root.currentRootId||root.expectedRootId,derivation:`CLIENT_ROOT_${root.status}`,decision:"REVIEW_REQUIRED",rootStatus:root.status};
}

export function enrichCanonicalV6(input:{actions:P4Action[];rawByKey:Map<string,Record<string,unknown>>;companies:P4CompanyCandidate[];clients:P4ClientCandidate[];balances:Map<string,P4BalanceResult>}):void{
  for(const action of [...input.actions].sort((a,b)=>(a.entityType==="CLIENT"?0:1)-(b.entityType==="CLIENT"?0:1))){
    const raw=input.rawByKey.get(`${action.canonicalGroupId}:${action.entityType}:${action.iqEntityId}`)||{},reasons:string[]=[];
    const canonicalRootId=text(action.rootId);
    if(!canonicalRootId)reasons.push("MISSING_ROOT");
    const clientResolution=resolveCanonicalClientName({action,actions:input.actions,clients:input.clients}),clientId=clientResolution.clientId;
    if(action.entityType!=="CLIENT"&&clientResolution.decision!=="DERIVED_EXACT")reasons.push(clientResolution.decision==="DEPENDENCY_PENDING"?"CLIENT_ROOT_PENDING_RECONCILIATION":"CANONICAL_CLIENT_NAME_REVIEW_REQUIRED");
    let company:Record<string,unknown>={source:"PAY0",rawValue:null,normalizedValue:null,derivation:"NOT_REQUIRED",decision:"NOT_REQUIRED"};
    let despacho:Record<string,unknown>={source:"PAY0",rawValue:null,normalizedValue:null,derivation:"NOT_REQUIRED",decision:"NOT_REQUIRED"};
    let folio:Record<string,unknown>={kind:"NOT_REQUIRED",decision:"NOT_REQUIRED"};
    let status:Record<string,unknown>={source:"IQ",rawValue:null,normalizedValue:null,derivation:"NOT_REQUIRED",decision:"NOT_REQUIRED"};
    let monetary:Record<string,unknown>={source:"FINANCIAL_GRAPH",derivation:"NOT_REQUIRED",decision:"NOT_REQUIRED"};
    if(action.entityType!=="CLIENT"){
      const companyName=first(raw,["company","company_name","companyName","empresa","empresa_nombre","empresaNombre"]),resolved=resolveExactCompany(companyName,input.companies);
      company=resolved as unknown as Record<string,unknown>;const match=resolved.normalizedValue as P4CompanyCandidate|null;
      if(resolved.decision==="REVIEW_REQUIRED")reasons.push(resolved.derivation==="AMBIGUOUS_COMPANY_NAME"?"AMBIGUOUS_COMPANY":"MISSING_REQUIRED_RELATION");
      else {despacho={source:"PAY0",rawValue:match?.despachoId||null,normalizedValue:match?.despachoId||null,derivation:"PAY0_COMPANY_RELATION",decision:match?.despachoId?"DERIVED_EXACT":"REVIEW_REQUIRED"};if(!match?.despachoId)reasons.push("AMBIGUOUS_DESPACHO");action.after={...action.after,companyId:match?.id,companyName:match?.name,empresaNombre:match?.name,despachoId:match?.despachoId,companyNumber:match?.companyNumber,empresaNumero:match?.companyNumber};}
      const balances=action.componentId?input.balances.get(action.componentId):undefined;
      if(action.entityType==="SOLICITUD"){
        try{folio=historicalFolioEvidence("SOLICITUD",action.canonicalGroupId,action.iqEntityId);}catch{reasons.push("INVALID_HISTORICAL_FOLIO");}
        const balance=balances?.solicitudes[action.iqEntityId],mapped=canonicalSolicitudStatus(first(raw,["operation_status","status","estado"]),balance?balance.pendingMinor/100:Number(action.after.saldoPendiente));status={source:"IQ_AND_FINANCIAL_GRAPH",rawValue:first(raw,["operation_status","status","estado"]),normalizedValue:mapped.status,derivation:mapped.reason,decision:mapped.decision};if(mapped.decision==="REVIEW_REQUIRED")reasons.push(mapped.reason==="P4M_PENDING_CANCELLATION"?"PENDING_CANCELLATION":"UNKNOWN_STATUS");if(mapped.status)action.after={...action.after,status:mapped.status,folio:(folio as {value?:unknown}).value,clientId,clienteId:clientId,...(clientResolution.name?{clienteNombre:clientResolution.name}:{})};if(balance)monetary={source:"FINANCIAL_GRAPH",total:balance.totalMinor/100,applied:balance.appliedMinor/100,available:balance.pendingMinor/100,currency:first(raw,["currency","moneda"])||"MXN",derivation:"CONNECTED_COMPONENT_BALANCE",decision:"DERIVED_EXACT"};
      }else if(action.entityType==="PAYMENT"){
        try{folio=historicalFolioEvidence("PAYMENT",action.canonicalGroupId,action.iqEntityId);}catch{reasons.push("INVALID_HISTORICAL_FOLIO");}
        const balance=balances?.payments[action.iqEntityId],total=balance?balance.totalMinor/100:finiteOrNull(action.after.monto),applied=balance?balance.appliedMinor/100:finiteOrNull(action.after.totalAplicado),available=balance?balance.availableMinor/100:finiteOrNull(action.after.saldoDisponible),numbersReady=total!==null&&applied!==null&&available!==null,mapped=canonicalPaymentStatus({operationStatus:first(raw,["operation_status","status","estado"]),conciliationStatus:first(raw,["conciliation_status","conciliationStatus","conciliacion"]),total:total??0,applied:applied??0,available:available??0});status={source:"IQ_AND_FINANCIAL_GRAPH",rawValue:{operation:first(raw,["operation_status","status","estado"]),conciliation:first(raw,["conciliation_status","conciliationStatus","conciliacion"])},normalizedValue:mapped.status,derivation:mapped.reason,decision:numbersReady?mapped.decision:"REVIEW_REQUIRED"};if(!numbersReady)reasons.push("MONETARY_EVIDENCE_UNAVAILABLE");else if(mapped.decision==="REVIEW_REQUIRED")reasons.push(mapped.reason==="P4M_PENDING_CANCELLATION"?"PENDING_CANCELLATION":mapped.reason==="PAYMENT_MONETARY_INVARIANT_FAILED"?"MONETARY_INVARIANT":"UNKNOWN_STATUS");if(numbersReady&&applied>total)reasons.push("MONETARY_INVARIANT");if(numbersReady&&mapped.status)action.after={...action.after,status:mapped.status,folio:(folio as {value?:unknown}).value,clientId,clienteId:clientId,...(clientResolution.name?{clienteNombre:clientResolution.name}:{}),monto:total,totalAplicado:applied,saldoDisponible:available};const invariantMinor=numbersReady?Math.round((total-applied-available)*100):null;monetary={source:"IQ_AND_FINANCIAL_GRAPH",total,applied,available,currency:first(raw,["currency","moneda"])||"MXN",invariantMinor,derivation:"IQ_TOTAL_PLUS_CONNECTED_COMPONENT_APPLICATIONS",decision:numbersReady&&invariantMinor===0&&applied<=total?"DERIVED_EXACT":"REVIEW_REQUIRED"};
      }else{
        const mapped=canonicalApplicationStatus(first(raw,["operation_status","status","estado","conciliation_status"])),applicationAmount=finiteOrNull(action.after.montoAplicado);status={source:"IQ",rawValue:first(raw,["operation_status","status","estado","conciliation_status"]),normalizedValue:mapped.status,derivation:mapped.reason,decision:mapped.decision};if(mapped.decision==="REVIEW_REQUIRED")reasons.push("UNKNOWN_STATUS");if(applicationAmount===null)reasons.push("MONETARY_EVIDENCE_UNAVAILABLE");if(mapped.status&&applicationAmount!==null)action.after={...action.after,status:mapped.status,clientId,clienteId:clientId};monetary={source:"IQ",total:applicationAmount,applied:applicationAmount,available:0,currency:first(raw,["currency","moneda"])||"MXN",derivation:"EXACT_APPLICATION_AMOUNT",decision:applicationAmount===null?"REVIEW_REQUIRED":"EXACT"};
      }
    }
    if(reviewOperations.has(action.operation)&&!reasons.length)reasons.push(action.operation);
    action.canonicalEvidence={readiness:reasons.length?"CANONICAL_REVIEW_REQUIRED":"CANONICAL_READY",reviewReasons:[...new Set(reasons)].sort(),root:{source:"SERVER_ROOT",rawValue:null,normalizedValue:canonicalRootId||null,derivation:"AUTHORIZED_CALLER_ROOT",decision:canonicalRootId?"EXACT":"REVIEW_REQUIRED"},client:{source:"PAY0",rawValue:null,normalizedValue:clientId||null,displayName:clientResolution.name||null,clientRootId:clientResolution.rootId||null,derivation:clientResolution.derivation,decision:action.entityType==="CLIENT"&&clientId?"DERIVED_EXACT":clientResolution.decision},company,despacho,folio,status,monetary,temporal:action.historicalTime||{},graph:{componentId:action.componentId||null,dependencies:action.dependencies||[],invoiceId:action.matchingEvidence.invoiceId||null,paymentId:action.matchingEvidence.paymentId||null}};
    if(reasons.length&&!reviewOperations.has(action.operation)&&action.operation!=="SKIP_PURGED"){const dependencyOnly=reasons.every(reason=>reason==="CLIENT_ROOT_PENDING_RECONCILIATION");action.operation=dependencyOnly?"CANONICAL_DEPENDENCY_PENDING":"REVIEW_REQUIRED";action.reason=dependencyOnly?"Canonical client root dependency must reconcile and verify first":`Canonical V6 review: ${reasons.join(",")}`;action.after={};}
    else if(reviewOperations.has(action.operation))action.after={};
  }
  for(const action of input.actions.filter(candidate=>candidate.entityType==="APPLICATION"&&candidate.canonicalEvidence?.readiness==="CANONICAL_READY")){const evidence=action.canonicalEvidence;if(!evidence)continue;const parents=(action.dependencies||[]).map(id=>input.actions.find(candidate=>candidate.actionId===id)).filter((candidate):candidate is P4Action=>!!candidate&&["SOLICITUD","PAYMENT"].includes(candidate.entityType));if(parents.length!==2||parents.some(parent=>parent.canonicalEvidence?.readiness!=="CANONICAL_READY")){action.operation="REVIEW_REQUIRED";action.reason="Canonical V6 review: PARENT_NOT_CANONICAL";action.after={};action.canonicalEvidence={...evidence,readiness:"CANONICAL_REVIEW_REQUIRED",reviewReasons:["PARENT_NOT_CANONICAL"]};}}
}
