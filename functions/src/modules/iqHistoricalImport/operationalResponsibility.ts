import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { resolveIqPay0Identity } from "../iq/iqPay0Identity";

const text=(value:unknown)=>String(value??"").trim();
export type ResponsibilityResolution={status:"RESOLVED"|"REVIEW_REQUIRED";iqUsername:string;associatedName:string;canonicalIqGroupId:string;adminId:string|null;policyVersion:string|null;policyHash:string|null;reviewCode:string|null};

export async function resolveOperationalResponsibility(input:{rootId:string;iqUsername:string;associatedName:string;canonicalIqGroupId:string;canonicalIqProfileId:string}):Promise<ResponsibilityResolution>{
  const db=getFirestore(),iqUsername=text(input.iqUsername).toUpperCase(),associatedName=text(input.associatedName),base={iqUsername,associatedName,canonicalIqGroupId:input.canonicalIqGroupId};
  const canonical=resolveIqPay0Identity({iqUsername,canonicalIqGroupId:input.canonicalIqGroupId,canonicalIqProfileId:input.canonicalIqProfileId});
  if(!canonical)return{...base,status:"REVIEW_REQUIRED",adminId:null,policyVersion:null,policyHash:null,reviewCode:"OPERATIONAL_IDENTITY_SCOPE_MISMATCH"};
  const pointer=await db.doc(`iqOperationalAssignmentPolicies/${input.rootId}`).get(),version=text(pointer.get("activeVersion"));
  if(!pointer.exists||!version)return{...base,status:"REVIEW_REQUIRED",adminId:null,policyVersion:null,policyHash:null,reviewCode:"OPERATIONAL_IDENTITY_POLICY_NOT_CONFIGURED"};
  const policy=await pointer.ref.collection("versions").doc(version).get(),mappings=(policy.get("mappings")||{}) as Record<string,Record<string,unknown>>,mapping=mappings[iqUsername];
  if(!policy.exists||policy.get("status")!=="ACTIVE"||!mapping)return{...base,status:"REVIEW_REQUIRED",adminId:null,policyVersion:version,policyHash:null,reviewCode:"OPERATIONAL_IDENTITY_REVIEW_REQUIRED"};
  if(text(mapping.canonicalIqGroupId)!==input.canonicalIqGroupId||text(mapping.canonicalIqProfileId)!==input.canonicalIqProfileId)return{...base,status:"REVIEW_REQUIRED",adminId:null,policyVersion:version,policyHash:null,reviewCode:"OPERATIONAL_IDENTITY_SCOPE_MISMATCH"};
  const adminId=text(mapping.adminId),user=adminId?await db.doc(`users/${adminId}`).get():null,data=user?.data()||{};
  if(adminId!==canonical.pay0UserId||!user?.exists||text(data.rootId||adminId)!==input.rootId||data.active===false||data.isActive===false||data.disabled===true||data.deleted===true)return{...base,status:"REVIEW_REQUIRED",adminId:null,policyVersion:version,policyHash:null,reviewCode:"OPERATIONAL_IDENTITY_REVIEW_REQUIRED"};
  const policyHash=createHash("sha256").update(JSON.stringify({version,iqUsername,canonicalIqGroupId:input.canonicalIqGroupId,canonicalIqProfileId:input.canonicalIqProfileId,adminId})).digest("hex");
  return{...base,status:"RESOLVED",adminId,policyVersion:version,policyHash,reviewCode:null};
}
