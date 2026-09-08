import type { Firestore } from "firebase-admin/firestore";
import { canRunIqAutomationForDispatch, getCanonicalDispatchAutomation } from "./domain";
export type IqDispatchGateResult={ok:boolean;code:string;message:string;despachoId:string;companyId:string|null};
const clean=(x:unknown)=>String(x??"").trim();
export async function evaluateIqDispatchGate(input:{db:Firestore;despachoId:unknown;companyId?:unknown;rootId?:unknown}):Promise<IqDispatchGateResult>{
 const despachoId=clean(input.despachoId),companyId=clean(input.companyId)||null,rootId=clean(input.rootId);const fail=(code:string,message:string):IqDispatchGateResult=>({ok:false,code,message,despachoId,companyId});
 if(!despachoId)return fail("IQ_DISPATCH_REQUIRED","Operacion sin despacho.");const despachoSnap=await input.db.collection("despachos").doc(despachoId).get();if(!despachoSnap.exists)return fail("IQ_DISPATCH_NOT_FOUND","Despacho no encontrado.");const despacho:any=despachoSnap.data()||{};
 if(rootId&&clean(despacho.rootId)&&clean(despacho.rootId)!==rootId)return fail("IQ_DISPATCH_OUT_OF_ROOT","Despacho fuera del root.");if(despacho.active===false)return fail("IQ_DISPATCH_INACTIVE","Despacho inactivo.");const automation=getCanonicalDispatchAutomation(despacho);if(!canRunIqAutomationForDispatch(despacho))return fail("IQ_PROVIDER_NOT_ALLOWED","Despacho no habilitado para IQ: "+automation.automationMode+"/"+(automation.erpProvider||"NONE")+".");
 if(companyId){const companySnap=await input.db.collection("companies").doc(companyId).get();if(!companySnap.exists)return fail("IQ_COMPANY_NOT_FOUND","Empresa no encontrada.");const company:any=companySnap.data()||{};if(company.active===false)return fail("IQ_COMPANY_INACTIVE","Empresa inactiva.");if(rootId&&clean(company.rootId)&&clean(company.rootId)!==rootId)return fail("IQ_COMPANY_OUT_OF_ROOT","Empresa fuera del root.");if(clean(company.despachoId)!==despachoId)return fail("IQ_COMPANY_DISPATCH_MISMATCH","La empresa no pertenece al despacho IQ de la operacion.");}
 return {ok:true,code:"IQ_GATE_OK",message:"Despacho y empresa habilitados para IQ.",despachoId,companyId};
}
export async function isIqDispatchConfigured(input:{db:Firestore;despachoId:unknown;rootId?:unknown}):Promise<boolean>{return (await evaluateIqDispatchGate(input)).ok}
