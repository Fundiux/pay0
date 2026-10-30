import * as admin from "firebase-admin";
import { randomUUID } from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { IQ_CREDENTIALS_KEY, loadIqAccess } from "../iq/dispersionCreationCallables";
import { fetchIq } from "../iq/iqHttpClient";
import { decideIqDispersionExecutionAccess } from "../iq/dispersionExecutionAccess";
import { currentAuthority, finalizeDispersionDocumentUploadCore, initDispersionDocumentUploadCore } from "./service";
import { fetchIqDispersionReceipt } from "./iqReceiptHttp";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function id(value: unknown): string {
  const result = clean(value);
  if (!result || result.length > 160 || /[\\/\x00-\x1f]/.test(result) || result === "." || result === "..") {
    throw new HttpsError("invalid-argument", "Referencia de dispersion invalida.");
  }
  return result;
}

export const importIqDispersionReceipt = onCall(
  {
    cors: true,
    preserveExternalChanges: true,
    timeoutSeconds: 120,
    memory: "512MiB",
    maxInstances: 2,
    concurrency: 1,
    secrets: [IQ_CREDENTIALS_KEY],
  },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sesion requerida.");
    const uid = id(request.auth.uid);
    const dispersionId = id(request.data?.dispersionId);
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) throw new HttpsError("permission-denied", "Usuario PAY0 no encontrado.");
    const user = userSnap.data() || {};
    const rootId = id(user.rootId || uid);
    const { dispersion } = await currentAuthority(uid, rootId, dispersionId);
    const folio = clean(dispersion.iqDispersionFolio || dispersion.iqDispersionId);
    if (!/^[1-9][0-9]{0,15}$/.test(folio)) {
      throw new HttpsError("failed-precondition", "La dispersion aun no tiene un folio IQ unico.");
    }
    const legs = await db.collection("clientDispersionLegs")
      .where("principalDispersionId", "==", dispersionId).limit(20).get();
    const matches = legs.docs.filter((doc) => {
      const row = doc.data();
      return row.rootId === rootId && clean(row.iqDispersionFolio || row.iqDispersionId) === folio;
    });
    if (matches.length !== 1) throw new HttpsError("failed-precondition", "No hay un tramo IQ unico para el folio.");
    const leg = matches[0].data();
    if (!["CREATED", "CREATED_PENDING_FOLIO"].includes(clean(leg.iqCreationStatus).toUpperCase())) {
      throw new HttpsError("failed-precondition", "El tramo IQ no esta vinculado como creado.");
    }
    if (clean(user.role).toLowerCase() !== "superadmin") {
      const [despachoSnap, iqAccessSnap] = await Promise.all([
        db.doc(`despachos/${id(leg.despachoId)}`).get(),
        db.doc(`iqUserAccess/${uid}`).get(),
      ]);
      const decision = decideIqDispersionExecutionAccess({
        uid, role: clean(user.role), rootId,
        despacho: despachoSnap.data() || {},
        iqAccess: iqAccessSnap.exists ? iqAccessSnap.data() || {} : null,
      });
      if (!decision.allowed) throw new HttpsError("permission-denied", decision.message);
    }

    const currentUploads = await db.collection("uploads")
      .where("rootId", "==", rootId)
      .where("dispersionId", "==", dispersionId)
      .where("documentType", "==", "COMPROBANTE_DISPERSION")
      .where("active", "==", true).get();
    const active = currentUploads.docs.find((doc) => {
      const row = doc.data();
      return row.documentType === "COMPROBANTE_DISPERSION" && row.active === true && row.status === "READY";
    });
    if (active) return { ok: true, status: "ALREADY_ATTACHED", uploadId: active.id };

    const lockRef = db.doc(`iqReceiptImports/${dispersionId}__${folio}`);
    const lockToken = randomUUID();
    let completedUploadId = "";
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(lockRef);
      const row = snap.data() || {};
      if (row.rootId && row.rootId !== rootId) throw new HttpsError("permission-denied", "Importacion fuera de alcance.");
      if (row.status === "READY") {
        completedUploadId = clean(row.uploadId);
        return;
      }
      const started = row.startedAt?.toMillis?.() || 0;
      if (row.status === "PROCESSING" && Date.now() - started < 180_000) {
        throw new HttpsError("already-exists", "La consulta del comprobante ya esta en curso.");
      }
      tx.set(lockRef, {
        rootId, dispersionId, iqFolio: folio, status: "PROCESSING",
        lockToken, startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    if (completedUploadId) {
      const completedSnap = await db.doc(`uploads/${completedUploadId}`).get();
      if (completedSnap.exists && completedSnap.data()?.status === "READY") {
        return { ok: true, status: "ALREADY_ATTACHED", uploadId: completedUploadId };
      }
      throw new HttpsError("failed-precondition", "La importacion anterior requiere revision.");
    }

    let uploadId = "";
    try {
      const access = await loadIqAccess({
        uid, rootId, role: clean(user.role).toLowerCase(),
        username: clean(user.username || user.displayName || user.email || uid),
      }, id(leg.despachoId), "IQ", dispersion);
      const receipt = await fetchIqDispersionReceipt({
        apiOrigin: access.erpUrl,
        username: access.username,
        password: access.password,
        folio,
        fetcher: (url, init) => fetchIq(url, init, { operation: "dispersion-receipt", timeoutMs: 25_000 }),
      });
      if (receipt.status === "NOT_AVAILABLE") {
        await lockRef.set({ status: "NOT_AVAILABLE", lockToken: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { ok: true, status: "NOT_AVAILABLE" };
      }

      const fresh = await currentAuthority(uid, rootId, dispersionId);
      if (clean(fresh.dispersion.iqDispersionFolio || fresh.dispersion.iqDispersionId) !== folio) {
        throw new HttpsError("failed-precondition", "El folio IQ cambio durante la consulta.");
      }
      const init = await initDispersionDocumentUploadCore({
        auth: request.auth,
        data: {
          dispersionId, documentType: "COMPROBANTE_DISPERSION",
          originalName: receipt.filename, contentType: receipt.contentType,
          sizeBytes: receipt.bytes.byteLength,
        },
      });
      uploadId = init.uploadId;
      const bucket = admin.storage().bucket();
      await bucket.file(init.storagePath).save(receipt.bytes, {
        resumable: false,
        metadata: {
          contentType: receipt.contentType,
          metadata: {
            uploadid: uploadId,
            dispersionId,
            documentType: "COMPROBANTE_DISPERSION",
            originalName: receipt.filename,
          },
        },
      });
      await db.doc(`uploads/${uploadId}`).set({
        source: "IQ_IMPORT", sourceIqFolio: folio,
        sourceSha256: receipt.sha256,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await finalizeDispersionDocumentUploadCore({
        auth: request.auth,
        data: { uploadId, storagePath: init.storagePath },
      });
      const batch = db.batch();
      batch.set(lockRef, {
        status: "READY", uploadId, sha256: receipt.sha256,
        lockToken: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(db.doc(`clientDispersions/${dispersionId}`), {
        iqReceiptStatus: "READY", iqReceiptUploadId: uploadId,
        iqReceiptImportedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      const manualLinkRef = db.doc(`iqManualDispersionLinks/${folio}`);
      const manualLinkSnap = await manualLinkRef.get();
      if (manualLinkSnap.exists && manualLinkSnap.data()?.principalId === dispersionId) {
        batch.set(manualLinkRef, { receiptStatus: "IMPORTED", receiptUploadId: uploadId, receiptImportedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      await batch.commit();
      return { ok: true, status: "IMPORTED", uploadId };
    } catch (error) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(lockRef);
        if (snap.data()?.lockToken === lockToken) {
          tx.set(lockRef, { status: "FAILED", lockToken: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      }).catch(() => undefined);
      if (error instanceof HttpsError) throw error;
      const code = error instanceof Error ? error.message : "";
      if (code === "IQ_RECEIPT_HOST_UNVERIFIED") {
        throw new HttpsError("failed-precondition", "IQ devolvio una ubicacion de comprobante no autorizada.");
      }
      if (code === "IQ_RECEIPT_TOO_LARGE" || code === "IQ_RECEIPT_FILE_TYPE_UNSUPPORTED") {
        throw new HttpsError("failed-precondition", "El comprobante IQ no cumple el formato o limite de 1 MB de PAY0.");
      }
      throw new HttpsError("unavailable", "No se pudo importar el comprobante de IQ.");
    }
  },
);
