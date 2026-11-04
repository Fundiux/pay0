import { createHash } from "crypto";
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { logActivityTx } from "../../utils/logActivity";
import { finalizeSolicitudDocumentVersionTx } from "../solicitudDocuments/lifecycle";
import { iqCancellationReceiptAction } from "./cancellationReceiptDomain";
import { fetchIqCancellationReceipt } from "./cancellationReceiptHttp";
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

export async function runIqCancellationReceiptCheck() {
  const snap = await db.collection("solicitudes").where("iqCancellationStatus", "in", ["REQUESTED", "CONFIRMED"]).limit(MAX_SCAN).get();
  const lookups: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const row of snap.docs) {
    const action = iqCancellationReceiptAction(row.data());
    if (action === "LOOKUP") lookups.push(row);
    if (action === "NOT_APPLICABLE" && row.data().iqCancellationReceiptStatus !== "NOT_APPLICABLE") {
      await row.ref.set({ iqCancellationReceiptStatus: "NOT_APPLICABLE" }, { merge: true });
    }
  }
  lookups.sort((a, b) => millis(a.data().iqCancellationReceiptCheckedAt) - millis(b.data().iqCancellationReceiptCheckedAt));

  const sessions = new Map<string, IqHttpAuthSession>();
  for (const row of lookups.slice(0, MAX_LOOKUPS)) {
    const solicitud = row.data();
    const iqFolio = text(solicitud.iqFolio ?? solicitud.iqId);
    try {
      const profile = await loadSolicitudIqProfile({ solicitud, rootId: text(solicitud.rootId) });
      let session = sessions.get(profile.profileId);
      if (!session) {
        session = await loginIqHttpDirect({ apiOrigin: iqApiOrigin(), credentials: { username: profile.username, password: profile.password }, requiredPermissions: "NONE" });
        sessions.set(profile.profileId, session);
      }
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
