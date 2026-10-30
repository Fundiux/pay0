import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { isTerminalSolicitud } from "./quotationPolicy";
import { mexicoDayKey } from "../agentOperations/time";
import { verifyQuotationEvidence } from "../agentOperations/quotationEvidence";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { assertAuthorized } from "../../utils/authGuard";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const PAGE_SIZE = 100;
const EXPECTED_MS = 10 * 60_000;
const clean = (value: unknown) => String(value ?? "").trim();
const DETECTOR_ID = "missing-quotation-v2";
const controlRef = db.collection("agentScannerControls").doc(DETECTOR_ID);

/** No control or audit means PAUSED. A future activation must be recorded for one root by a current superadmin. */
function activeScope(control: FirebaseFirestore.DocumentSnapshot, audit: FirebaseFirestore.DocumentSnapshot,
  user: FirebaseFirestore.DocumentSnapshot, rootControl: FirebaseFirestore.DocumentSnapshot, nowMs: number): string | null {
  const rootId = clean(control.get("rootId")), uid = clean(control.get("approvedBy"));
  const activationId = clean(control.get("activationId"));
  const activatedAt = control.get("activatedAt")?.toMillis?.();
  const expiresAt = control.get("expiresAt")?.toMillis?.();
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(rootId) || !/^[A-Za-z0-9_-]{10,128}$/.test(uid) ||
      !/^[a-f0-9]{32}$/.test(activationId) || control.get("state") !== "ACTIVE" || control.get("killSwitch") !== false ||
      !Number.isFinite(activatedAt) || !Number.isFinite(expiresAt) || activatedAt > nowMs || expiresAt <= nowMs || expiresAt - activatedAt > 86_400_000 ||
      audit.get("detectorId") !== DETECTOR_ID || audit.get("activationId") !== activationId || audit.get("rootId") !== rootId ||
      audit.get("approvedBy") !== uid || audit.get("status") !== "ACTIVE" || audit.get("authorization") !== "EXPLICIT_SUPERADMIN" ||
      audit.get("revokedAt") || audit.get("activatedAt")?.toMillis?.() !== activatedAt || audit.get("expiresAt")?.toMillis?.() !== expiresAt ||
      user.id !== uid || clean(user.get("rootId")) !== rootId || rootControl.get("killSwitch") === true) return null;
  try { assertAuthorized({ uid }, user.data(), { allowedRoles: ["superadmin"], requiredModule: "solicitudes", requiredAction: "view" }); }
  catch { return null; }
  return rootId;
}

async function readActivation(nowMs: number) {
  const control = await controlRef.get();
  const activationId = clean(control.get("activationId")), rootId = clean(control.get("rootId")), uid = clean(control.get("approvedBy"));
  if (control.get("state") !== "ACTIVE" || !/^[a-f0-9]{32}$/.test(activationId) ||
      !/^[A-Za-z0-9_-]{10,128}$/.test(rootId) || !/^[A-Za-z0-9_-]{10,128}$/.test(uid)) return null;
  const auditRef = db.collection("agentScannerActivations").doc(`${DETECTOR_ID}-${activationId}`);
  const userRef = db.collection("users").doc(uid), rootControlRef = db.collection("agentControls").doc(rootId);
  const [audit, user, rootControl] = await Promise.all([auditRef.get(), userRef.get(), rootControlRef.get()]);
  return activeScope(control, audit, user, rootControl, nowMs) ? { rootId, auditRef, userRef, rootControlRef } : null;
}

/** Dormant until an audited, root-scoped superadmin activation exists. */
export async function scanMissingQuotationPage(nowMs = Date.now()): Promise<{ scanned: number; incidents: number; wrapped: boolean; paused: boolean }> {
  const activation = await readActivation(nowMs);
  if (!activation) return { scanned: 0, incidents: 0, wrapped: false, paused: true };
  const { rootId: activeRootId, auditRef, userRef, rootControlRef } = activation;
  const cursorRef = db.collection("agentScannerState").doc(`${DETECTOR_ID}-${activeRootId}`);
  const stillActive = async (tx: FirebaseFirestore.Transaction) => {
    const [control, audit, user, rootControl] = await Promise.all([
      tx.get(controlRef), tx.get(auditRef), tx.get(userRef), tx.get(rootControlRef),
    ]);
    return activeScope(control, audit, user, rootControl, Date.now()) === activeRootId;
  };
  const cursor = await cursorRef.get();
  const afterId = clean(cursor.get("afterId"));
  let query: FirebaseFirestore.Query = db.collection("solicitudes").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
  if (afterId) query = query.startAfter(afterId);
  const page = await query.get();
  if (page.empty) {
    const updated = await db.runTransaction(async tx => {
      if (!await stillActive(tx)) return false;
      tx.set(cursorRef, { afterId: null, rootId: activeRootId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    return { scanned: 0, incidents: 0, wrapped: updated, paused: !updated };
  }
  let incidents = 0;
  for (const doc of page.docs) {
    const solicitud: any = doc.data() || {};
    const rootId = clean(solicitud.rootId);
    const iqFolio = clean(solicitud.iqFolio || solicitud.iqId);
    const ocUploadId = clean(solicitud.ocCommercialMetadataUploadId || solicitud.ocFiscalMetadataUploadId);
    if (rootId !== activeRootId || !iqFolio || !ocUploadId || isTerminalSolicitud(solicitud)) continue;
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
      if (!await stillActive(tx)) return null;
      const current = await tx.get(incidentRef);
      if (current.exists) return false;
      tx.create(incidentRef, { rootId, reportDay: mexicoDayKey(new Date(nowMs)), agentId: "expediente", entityType: "solicitud", entityId: doc.id, status: "OPEN", cause, evidence: [`solicitudes/${doc.id}`, `IQ:${iqFolio}`, `OC:${ocUploadId}`, ...(jobId ? [`solicitudQuotationJobs/${jobId}`] : [])], action: "DIAGNOSE_ONLY", createdAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (created === null) return { scanned: 0, incidents, wrapped: false, paused: true };
    if (created) incidents++;
  }
  const updated = await db.runTransaction(async tx => {
    if (!await stillActive(tx)) return false;
    tx.set(cursorRef, { afterId: page.docs[page.docs.length - 1].id, rootId: activeRootId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
  return { scanned: page.size, incidents, wrapped: false, paused: !updated };
}

export const detectMissingSolicitudQuotations = onSchedule({ schedule: "every 5 minutes", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 540, memory: "256MiB", maxInstances: 1 }, async () => {
  await scanMissingQuotationPage();
});
