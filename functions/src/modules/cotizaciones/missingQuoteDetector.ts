import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { isTerminalSolicitud } from "./quotationPolicy";
import { mexicoDayKey } from "../agentOperations/time";
import { verifyQuotationEvidence } from "../agentOperations/quotationEvidence";
import { draftRepeatedCauseProposal } from "../agentOperations/proposals";
import { onSchedule } from "firebase-functions/v2/scheduler";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const PAGE_SIZE = 100;
const EXPECTED_MS = 10 * 60_000;
const clean = (value: unknown) => String(value ?? "").trim();

/** Bounded read-only diagnosis plus an idempotent incident; it never enqueues without an origin user. */
export async function scanMissingQuotationPage(nowMs = Date.now()): Promise<{ scanned: number; incidents: number; wrapped: boolean }> {
  const cursorRef = db.collection("agentScannerState").doc("missing-quotation-v1");
  const cursor = await cursorRef.get();
  const afterId = clean(cursor.get("afterId"));
  let query: FirebaseFirestore.Query = db.collection("solicitudes").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
  if (afterId) query = query.startAfter(afterId);
  const page = await query.get();
  if (page.empty) {
    await cursorRef.set({ afterId: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { scanned: 0, incidents: 0, wrapped: true };
  }
  let incidents = 0;
  for (const doc of page.docs) {
    const solicitud: any = doc.data() || {};
    const rootId = clean(solicitud.rootId);
    const iqFolio = clean(solicitud.iqFolio || solicitud.iqId);
    const ocUploadId = clean(solicitud.ocCommercialMetadataUploadId || solicitud.ocFiscalMetadataUploadId);
    if (!rootId || !iqFolio || !ocUploadId || isTerminalSolicitud(solicitud)) continue;
    const confirmedAt = solicitud.iqConfirmedAt?.toMillis?.() || solicitud.cotizacionAutoGenerateUpdatedAt?.toMillis?.() || solicitud.updatedAt?.toMillis?.() || 0;
    if (confirmedAt && confirmedAt + EXPECTED_MS > nowMs) continue;
    const quote = await db.collection("uploads").where("rootId", "==", rootId).where("solicitudId", "==", doc.id).where("documentType", "==", "COTIZACION").where("active", "==", true).limit(1).get();
    let cause = "Folio IQ confirmado y OC procesada, pero no existe cotización activa.";
    const jobId = clean(solicitud.cotizacionAutoGenerateJobId);
    const expectedJobId = createHash("sha256").update([doc.id, iqFolio, ocUploadId].join("|")).digest("hex");
    if (!quote.empty) {
      try {
        await verifyQuotationEvidence({ rootId, solicitudId: doc.id, jobId: expectedJobId, uploadId: quote.docs[0].id, iqFolio, ocUploadId });
        continue;
      } catch (error) { cause = `Cotización activa sin expediente verificable: ${clean((error as Error).message).slice(0, 120)}`; }
    }
    const incidentId = createHash("sha256").update(JSON.stringify([rootId, doc.id, iqFolio, ocUploadId, cause])).digest("hex");
    const incidentRef = db.collection("agentIncidents").doc(`missing-quote-${incidentId}`);
    const created = await db.runTransaction(async tx => {
      const current = await tx.get(incidentRef);
      if (current.exists) return false;
      tx.create(incidentRef, { rootId, reportDay: mexicoDayKey(new Date(nowMs)), agentId: "expediente", entityType: "solicitud", entityId: doc.id, status: "OPEN", cause, evidence: [`solicitudes/${doc.id}`, `IQ:${iqFolio}`, `OC:${ocUploadId}`, ...(jobId ? [`solicitudQuotationJobs/${jobId}`] : [])], action: "DIAGNOSE_ONLY", createdAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (created) {
      incidents++;
      await draftRepeatedCauseProposal(rootId, cause).catch(error => console.error("MISSING_QUOTATION_PROPOSAL_FAILED", error));
    }
  }
  await cursorRef.set({ afterId: page.docs[page.docs.length - 1].id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { scanned: page.size, incidents, wrapped: false };
}

export const detectMissingSolicitudQuotations = onSchedule({ schedule: "every 5 minutes", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 540, memory: "256MiB", maxInstances: 1 }, async () => {
  await scanMissingQuotationPage();
});
