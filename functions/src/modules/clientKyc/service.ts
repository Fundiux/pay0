// H4_D85_A10_A45_CLIENT_KYC_CANONICAL
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../sharedCallables/helpers";

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g," ").trim();
}

export async function upsertClientKycRfcIntake(params: {
  clientId: string;
  rootId: string;
  clientName: string;
  rfc: string;
  source: "CSF" | "CLIENT_CATALOG";
  sourceIntakeId?: string | null;
  actorUid: string;
  actorName: string;
}) {
  const rfc = clean(params.rfc).toUpperCase();
  if(!rfc) return null;

  const ref = db.doc(`clientKyc/${params.clientId}`);
  const snap = await ref.get();

  const base = {
    rootId: params.rootId,
    clientId: params.clientId,
    clientName: clean(params.clientName),
    rfc,
    status: "RFC_RECEIVED",
    stage: "INTAKE",
    source: params.source,
    sourceIntakeId: clean(params.sourceIntakeId) || null,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: params.actorUid,
    updatedByName: params.actorName,
  };

  if(snap.exists){
    await ref.set(base,{merge:true});
  }else{
    await ref.set({
      ...base,
      startedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: params.actorUid,
      createdByName: params.actorName,
      sourceDocumentId: null,
      checks: {},
      riskLevel: "PENDING",
      alerts: [],
    });
  }

  return {
    status: "RFC_RECEIVED",
    rfc,
  };
}

export async function attachClientKycCsfDocument(params: {
  clientId: string;
  rootId: string;
  entityDocumentId: string;
  intakeId: string;
  actorUid: string;
  actorName: string;
}) {
  const ref = db.doc(`clientKyc/${params.clientId}`);
  await ref.set({
    rootId: params.rootId,
    clientId: params.clientId,
    status: "RFC_RECEIVED",
    stage: "INTAKE",
    source: "CSF",
    sourceIntakeId: params.intakeId,
    sourceDocumentId: params.entityDocumentId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: params.actorUid,
    updatedByName: params.actorName,
  },{merge:true});
}
