import type { IqPlanKind } from "./planner";

const text=(value:unknown)=>String(value??"").trim();
const has=(row:Record<string,unknown>,keys:string[])=>keys.some(key=>text(row[key]));

export type EntityRoutingAssessment={expected:IqPlanKind;inferred:IqPlanKind|null;status:"VERIFIED"|"AMBIGUOUS"|"MISMATCH";evidence:string[]};

export function assessIqEntityRouting(expected:IqPlanKind,row:Record<string,unknown>):EntityRoutingAssessment{
  const evidence:string[]=[],candidates=new Set<IqPlanKind>();
  const invoiceParent=has(row,["invoice_id","invoiceId","solicitud_iq_id"]),paymentParent=has(row,["deposit_id","depositId","payment_id","paymentId"]);
  if(invoiceParent&&paymentParent){candidates.add("APPLICATION");evidence.push("BOTH_FINANCIAL_PARENTS");}
  if(has(row,["application_id","applicationId","applied_amount","application_amount"])) {candidates.add("APPLICATION");evidence.push("APPLICATION_FIELDS");}
  if(has(row,["deposit_id","depositId","voucher","voucher_id","deposit_date","bank_account","conciliation_status"])) {candidates.add("PAYMENT");evidence.push("DEPOSIT_FIELDS");}
  if(has(row,["invoice_id","invoiceId","invoice_type","invoiceType","purchase_order","purchase_order_id","cfdi_uuid","uuid_cfdi"])) {candidates.add("SOLICITUD");evidence.push("INVOICE_FIELDS");}
  if(has(row,["rfc","tax_id"])&&has(row,["name","business_name","razon_social"])&&!has(row,["amount","sum","total","monto"])) {candidates.add("CLIENT");evidence.push("CLIENT_IDENTITY_FIELDS");}
  if(candidates.has("APPLICATION")){candidates.delete("PAYMENT");candidates.delete("SOLICITUD");}
  const inferred=candidates.size===1?[...candidates][0]:null;
  if(inferred&&inferred!==expected)return{expected,inferred,status:"MISMATCH",evidence};
  if(!inferred)return{expected,inferred:null,status:"AMBIGUOUS",evidence:[...evidence,"INSUFFICIENT_OR_CONFLICTING_SEMANTICS"]};
  return{expected,inferred,status:"VERIFIED",evidence};
}
