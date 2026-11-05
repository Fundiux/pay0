import { createHash } from "crypto";
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { logActivityTx } from "../../utils/logActivity";
import { cancellationNeedsPaymentReview } from "../../utils/solicitudCancellationState";
import { finalizeSolicitudDocumentVersionTx } from "../solicitudDocuments/lifecycle";
import { iqCancellationReceiptAction } from "./cancellationReceiptDomain";
import { fetchIqCancellationReceipt } from "./cancellationReceiptHttp";
import { iqCancellationReconcileAction } from "./cancellationReconcileDomain";
import { fetchIq } from "./iqHttpClient";
import { loginIqHttpDirect, type IqHttpAuthSession } from "./iqHttpAuth";
import { IQ_CANCELLATION_CREDENTIALS_KEY, loadSolicitudIqProfile } from "./solicitudCancellationService";
import { iqApiOrigin } from "./solicitudHttpCancellation";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const DOCUMENT_TYPE = "ACUSE_CANCELACION_CFDI";
const MAX_SCAN = 500;
const MAX_LOOKUPS = 50;
const LOOKUP_SPACING_MS = 400;

const text = (value: unknown) => String(value ?? "").trim();
const millis = (value: any) => value?.toMillis?.() ?? 0;

export async function saveIqCancellationReceipt(solicitudId: string, solicitud: Record<string, any>, iqFolio: string, receipt: { bytes: Buffer; contentType: string; extension: string; sha256: string }) {
  const rootId = text(solicitud.rootId);
  const uploadId = createHash("sha256").update(`${rootId}:${solicitudId}:${iqFolio}:${DOCUMENT_TYPE}`).digest("hex");
  const ref = db.collection("uploads").doc(uploadId);
  const previous = (await ref.get()).data();
  const solicitudRef = db.doc(`solicitudes/${solicitudId}`);
  if (previous?.status === "READY" && previous.active === true) {
    await solicitudRef.set({ iqCancellationReceiptStatus: "READY", iqCancellationReceiptUploadId: uploadId, iqCancellationReceiptError: null, iqCancellationReceiptCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
    return;
  }
  if (previous && previous.status !== "PENDING") throw new Error("IQ_ACUSE_DOCUMENT_REPLACED");
  const folio = text(solicitud.folio || solicitudId);
  const filename = `ACUSE-CANCELACION-${folio}.${receipt.extension}`;
  const storagePath = `roots/${rootId}/solicitudes/${solicitudId}/docs/${DOCUMENT_TYPE}/${uploadId}-${filename}`;
  await admin.storage().bucket().file(storagePath).save(receipt.bytes, {
    resumable: false, contentType: receipt.contentType,
    metadata: { metadata: { uploadid: uploadId, sha256: receipt.sha256, iqfolio: iqFolio } },
  });
  await ref.set({
    rootId, adminId: solicitud.adminId || rootId,
    clienteId: solicitud.clienteId || solicitud.clientId || null,
    clienteNombre: solicitud.clienteNombre || solicitud.clientName || null,
    companyId: solicitud.companyId || null, empresaNombre: solicitud.empresaNombre || solicitud.companyName || null,
    entityType: "solicitudes", entityId: solicitudId, solicitudId,
    solicitudFolio: solicitud.folio || null, documentType: DOCUMENT_TYPE,
    documentTypeLabel: "Acuse de Cancelacion CFDI",
    originalName: filename, filename, contentType: receipt.contentType, sizeBytes: receipt.bytes.length,
    storagePath, sha256: receipt.sha256, integrityHashAlgorithm: "SHA-256", integritySealStatus: "HASH_SERVER_GENERATED",
    generatedBySystem: true, generatedByModule: "iq", iqFolio, status: "PENDING", active: false, version: null,
    createdBy: "system", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  await db.runTransaction(async tx => {
    await finalizeSolicitudDocumentVersionTx({
      tx, db, rootId, solicitudId, documentType: DOCUMENT_TYPE, uploadId, uploadRef: ref, mode: "update",
      readyPatch: { finalizedBy: "system", finalizedAt: FieldValue.serverTimestamp(), integritySealStatus: "SEALED", integritySealedAt: FieldValue.serverTimestamp(), integritySealedBy: "system" },
    });
    tx.set(solicitudRef, { iqCancellationReceiptStatus: "READY", iqCancellationReceiptUploadId: uploadId, iqCancellationReceiptError: null, iqCancellationReceiptCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
    logActivityTx(tx, db, { event: "IQ_ACUSE_CANCELACION_IMPORTADO", rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: solicitudId, referenceFolio: solicitud.folio || null, referenceType: "solicitud",
      description: `Acuse de cancelacion de ${folio} importado de IQ. FOLIO IQ: ${iqFolio}.` });
  });
}

async function sessionFor(solicitud: Record<string, any>, sessions: Map<string, IqHttpAuthSession>) {
  const profile = await loadSolicitudIqProfile({ solicitud, rootId: text(solicitud.rootId) });
  let session = sessions.get(profile.profileId);
  if (!session) {
    session = await loginIqHttpDirect({ apiOrigin: iqApiOrigin(), credentials: { username: profile.username, password: profile.password }, requiredPermissions: "NONE" });
    sessions.set(profile.profileId, session);
  }
  return session;
}

async function iqInvoiceRow(session: IqHttpAuthSession, iqFolio: string) {
  const url = new URL("/invoices", session.apiOrigin);
  url.searchParams.set("filter[id]", iqFolio);
  url.searchParams.set("limit", "5");
  url.searchParams.set("offset", "0");
  const response = await fetchIq(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${session.accessToken}` } }, { operation: "cancellation_reconcile" });
  if (!response.ok) throw new Error(`IQ_CANCELLATION_LOOKUP_HTTP_${response.status}`);
  const rows = await response.json() as Array<Record<string, unknown>>;
  const matches = Array.isArray(rows) ? rows.filter(row => text(row.id) === iqFolio) : [];
  if (matches.length !== 1) throw new Error("IQ_CANCELLATION_ROW_NOT_FOUND");
  return matches[0];
}

// Once a solicitud has its invoice the status monitor stops, so this run is what
// closes those cancellations. It only reads IQ and only moves an open request.
export async function applyIqCancellationReconcile(ref: FirebaseFirestore.DocumentReference, row: Record<string, unknown>, iqFolio: string) {
  await db.runTransaction(async tx => {
    const solicitud = (await tx.get(ref)).data();
    if (!solicitud || !["REQUESTED", "OUTCOME_UNKNOWN"].includes(text(solicitud.iqCancellationStatus))) return;
    const action = iqCancellationReconcileAction({ cancellationStatus: solicitud.iqCancellationStatus, operationStatus: row.operation_status, requestedAtMs: millis(solicitud.iqCancellationRequestedAt) });
    const applications = action === "CONFIRM" ? await tx.get(db.collection("pagoAplicaciones").where("rootId", "==", text(solicitud.rootId)).where("solicitudId", "==", ref.id)) : null;
    const appliedPayments = applications?.docs.filter(row => text(row.data().status).toUpperCase() === "APLICADA").length ?? 0;
    const now = FieldValue.serverTimestamp();
    const folio = text(solicitud.folio || ref.id);
    const audit = (event: string, description: string) => logActivityTx(tx, db, { event, rootId: text(solicitud.rootId), actorUid: "SYSTEM", actorRole: "system",
      referenceId: ref.id, referenceFolio: solicitud.folio || null, referenceType: "solicitud", description });
    if (action === "CONFIRM" && cancellationNeedsPaymentReview(solicitud, appliedPayments)) {
      tx.set(ref, { iqCancellationStatus: "CONFIRMED_REVIEW_REQUIRED", iqCancelledAt: now, iqCancelledFolio: iqFolio, iqLastOperationStatus: text(row.operation_status) || "CANCELADA", iqStatusUpdatedAt: now }, { merge: true });
      logActivityTx(tx, db, { event: "IQ_CANCELACION_REQUIERE_REVISION", rootId: text(solicitud.rootId), actorUid: "SYSTEM", actorRole: "system", referenceId: ref.id, referenceFolio: solicitud.folio || null, referenceType: "solicitud",
        amount: Number(solicitud.totalAbonado || 0), description: `IQ canceló ${folio}, pero tiene abonos por ${Number(solicitud.totalAbonado || 0)}: requiere revisión. FOLIO IQ: ${iqFolio}.` });
    } else if (action === "CONFIRM") {
      tx.set(ref, { status: "CANCELADA", cancelledBy: text(solicitud.iqCancellationRequestedBy) || "system", cancelledAt: now, iqOperationStatus: "CANCELADA", iqCancellationStatus: "CONFIRMED",
        iqCancelledAt: now, iqCancelledFolio: iqFolio, iqLastOperationStatus: text(row.operation_status) || "CANCELADA", iqStatusUpdatedAt: now }, { merge: true });
      audit("IQ_SOLICITUD_CANCELADA", `Solicitud ${folio} cancelada en IQ. FOLIO IQ: ${iqFolio}`);
    } else if (action === "PROMOTE") {
      tx.set(ref, { iqCancellationStatus: "REQUESTED", iqCancellationRequestedAt: now }, { merge: true });
    } else if (action === "REJECT") {
      const comment = text(row.rejection_comments).slice(0, 500) || null;
      tx.set(ref, { iqCancellationStatus: "REJECTED", iqCancellationRejectionComment: comment, iqCancellationRejectedAt: now }, { merge: true });
      audit("IQ_CANCELACION_RECHAZADA", `IQ no aceptó cancelar ${folio}. FOLIO IQ: ${iqFolio}.${comment ? ` Motivo: ${comment}` : ""}`);
    } else if (action === "NOT_APPLIED") {
      tx.set(ref, { iqCancellationStatus: "NOT_APPLIED" }, { merge: true });
      audit("IQ_CANCELACION_NO_APLICADA", `La cancelación de ${folio} no llegó a IQ; se puede volver a solicitar. FOLIO IQ: ${iqFolio}.`);
    }
  });
}

export async function reconcileIqCancellations(sessions: Map<string, IqHttpAuthSession>) {
  const open = await db.collection("solicitudes").where("iqCancellationStatus", "in", ["REQUESTED", "OUTCOME_UNKNOWN"]).limit(MAX_LOOKUPS).get();
  for (const row of open.docs) {
    const solicitud = row.data();
    const iqFolio = text(solicitud.iqCancellationFolio || solicitud.iqFolio || solicitud.iqId);
    if (!text(solicitud.rootId) || !iqFolio || solicitud.isDeleted === true) continue;
    try {
      const session = await sessionFor(solicitud, sessions);
      await applyIqCancellationReconcile(row.ref, await iqInvoiceRow(session, iqFolio), iqFolio);
    } catch (error) {
      console.error("IQ_CANCELLATION_RECONCILE_FAILED", row.id, text(error instanceof Error ? error.message : error).slice(0, 200));
    }
    await new Promise(resolve => setTimeout(resolve, LOOKUP_SPACING_MS));
  }
}

export async function runIqCancellationReceiptCheck() {
  const sessions = new Map<string, IqHttpAuthSession>();
  await reconcileIqCancellations(sessions);
  const snap = await db.collection("solicitudes").where("iqCancellationStatus", "in", ["REQUESTED", "CONFIRMED", "CONFIRMED_REVIEW_REQUIRED"]).limit(MAX_SCAN).get();
  const lookups: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const row of snap.docs) {
    const action = iqCancellationReceiptAction(row.data());
    if (action === "LOOKUP") lookups.push(row);
    if (action === "NOT_APPLICABLE" && row.data().iqCancellationReceiptStatus !== "NOT_APPLICABLE") {
      await row.ref.set({ iqCancellationReceiptStatus: "NOT_APPLICABLE" }, { merge: true });
    }
  }
  lookups.sort((a, b) => millis(a.data().iqCancellationReceiptCheckedAt) - millis(b.data().iqCancellationReceiptCheckedAt));

  for (const row of lookups.slice(0, MAX_LOOKUPS)) {
    const solicitud = row.data();
    const iqFolio = text(solicitud.iqFolio ?? solicitud.iqId);
    try {
      const session = await sessionFor(solicitud, sessions);
      const receipt = await fetchIqCancellationReceipt({
        apiOrigin: session.apiOrigin, accessToken: session.accessToken, iqFolio,
        fetcher: (url, init) => fetchIq(url, init, { operation: "cancellation_receipt" }),
      });
      if (receipt.status === "AVAILABLE") await saveIqCancellationReceipt(row.id, solicitud, iqFolio, receipt);
      else await row.ref.set({ iqCancellationReceiptStatus: "PENDING", iqCancellationReceiptError: null, iqCancellationReceiptCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
    } catch (error) {
      const message = text(error instanceof Error ? error.message : error).slice(0, 200);
      console.error("IQ_ACUSE_CHECK_FAILED", row.id, message);
      await row.ref.set({ iqCancellationReceiptStatus: "ERROR", iqCancellationReceiptError: message, iqCancellationReceiptCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    await new Promise(resolve => setTimeout(resolve, LOOKUP_SPACING_MS));
  }
}

export const checkIqCancellationReceiptsDaily = onSchedule({ schedule: "15 19 * * 1-5", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 540, memory: "512MiB", secrets: [IQ_CANCELLATION_CREDENTIALS_KEY], retryCount: 0, maxInstances: 1, concurrency: 1 }, () => runIqCancellationReceiptCheck());
