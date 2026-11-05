import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { randomBytes, createHash } from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getUserRole } from "../../utils/authGuard";
import { logActivityTx } from "../../utils/logActivity";
import { currentAuthority } from "../dispersionDocuments/service";
import { decodePngDataUrl } from "../signatureLinks/callables";
import {
  CASH_RECEIPT_DOCUMENT_LABEL,
  CASH_RECEIPT_DOCUMENT_TYPE,
  CASH_RECEIPT_LINK_TTL_MS,
  CASH_RECEIPT_STATUS,
  CASH_RECEIPT_VERSION,
  cashReceiptAcceptanceText,
  cashReceiptStatusOf,
  cleanText,
  expectedReceiverName,
  isCashDispersion,
  isTerminalDispersionStatus,
  receiverNamesMatch,
  toMoney,
  upperText,
  validateSignerName,
} from "./domain";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const REQUESTS = "dispersionSignatureRequests";
const TOKEN_RE = /^[A-Za-z0-9_-]{24,160}$/;

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function username(user: any, uid: string): string {
  return cleanText(user?.username || user?.displayName || user?.email || uid, 180);
}

function folioOf(dispersion: any, dispersionId: string): string {
  return cleanText(dispersion?.folio || dispersion?.dispersionFolio || dispersionId, 80);
}

function clientNameOf(dispersion: any): string {
  return cleanText(dispersion?.clienteNombre || dispersion?.clientName, 180);
}

function currencyOf(dispersion: any): string {
  return upperText(dispersion?.currency || dispersion?.moneda) || "MXN";
}

function millis(value: any): number {
  return Number(value?.toMillis?.() || 0);
}

function assertSignableDispersion(dispersion: any) {
  if (!isCashDispersion(dispersion)) {
    throw new HttpsError("failed-precondition", "Solo las dispersiones en efectivo llevan firma de recepcion.");
  }
  if (isTerminalDispersionStatus(dispersion?.status) || upperText(dispersion?.status) !== "REGISTRADA") {
    throw new HttpsError("failed-precondition", "La dispersion ya no admite firma de recepcion.");
  }
  if (dispersion?.fundingSource?.holderType === "USER") {
    throw new HttpsError("failed-precondition", "Los retiros de utilidad no usan firma de recepcion.");
  }
  if (!(toMoney(dispersion?.amount) > 0)) {
    throw new HttpsError("failed-precondition", "La dispersion no tiene un monto valido.");
  }
}

async function recoverAbandonedReservation(ref: FirebaseFirestore.DocumentReference) {
  await db.runTransaction(async (tx) => {
    const row = (await tx.get(ref)).data();
    if (row?.status !== "PROCESSING" || millis(row.processingAt) > Date.now() - 120_000) return;
    const upload = row.uploadId ? (await tx.get(db.collection("uploads").doc(row.uploadId))).data() : null;
    if (upload?.status === "READY" || upload?.active === true) return;
    tx.update(ref, { status: "PENDING", uploadId: FieldValue.delete(), processingAt: FieldValue.delete() });
  });
}

/**
 * Creates a one-time public link so whoever receives the cash can sign.
 * The link freezes the amount and the expected receiver; any newer link for the
 * same dispersion cancels the previous pending ones.
 */
export const createDispersionCashSignatureLink = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = cleanText(request.auth?.uid, 128);
    if (!uid) throw new HttpsError("unauthenticated", "Usuario no autenticado.");
    const dispersionId = cleanText(request.data?.dispersionId, 128);
    if (!dispersionId) throw new HttpsError("invalid-argument", "dispersionId requerido.");

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
    const user: any = userSnap.data() || {};
    const rootId = cleanText(user.rootId || uid, 128);

    const token = randomBytes(32).toString("base64url");
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + CASH_RECEIPT_LINK_TTL_MS);
    let folio = dispersionId;
    let alreadySigned = false;

    await db.runTransaction(async (tx) => {
      const { dispersion, user: currentUser } = await currentAuthority(uid, rootId, dispersionId, tx);
      assertSignableDispersion(dispersion);
      if (cashReceiptStatusOf(dispersion) === CASH_RECEIPT_STATUS.SIGNED) alreadySigned = true;
      folio = folioOf(dispersion, dispersionId);

      const pending = await tx.get(
        db.collection(REQUESTS).where("rootId", "==", rootId).where("dispersionId", "==", dispersionId).where("status", "==", "PENDING"),
      );
      pending.docs.forEach((doc) => {
        tx.update(doc.ref, { status: "CANCELLED", cancelledAt: FieldValue.serverTimestamp(), cancelledBy: uid, replacedByToken: token });
      });

      tx.set(db.collection(REQUESTS).doc(token), {
        kind: "DISPERSION_EFECTIVO",
        rootId,
        dispersionId,
        dispersionFolio: folio,
        clienteId: cleanText(dispersion.clienteId || dispersion.clientId, 128) || null,
        clienteNombre: clientNameOf(dispersion) || null,
        expectedReceiverName: expectedReceiverName(dispersion) || null,
        amount: toMoney(dispersion.amount),
        currency: currencyOf(dispersion),
        acceptanceVersion: CASH_RECEIPT_VERSION,
        status: "PENDING",
        createdBy: uid,
        createdUsername: username(currentUser, uid),
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
        usedAt: null,
      });

      logActivityTx(tx, db, {
        event: "DISPERSION_FIRMA_EFECTIVO_LINK_CREADO",
        rootId,
        adminId: dispersion.adminId || rootId,
        actorUid: uid,
        actorUsername: username(currentUser, uid),
        actorRole: String(getUserRole(currentUser) || ""),
        entityType: "clientDispersions",
        entityId: dispersionId,
        referenceId: dispersionId,
        referenceFolio: folio,
        referenceType: "DISPERSION",
        amount: toMoney(dispersion.amount),
        description: `Link de firma de recepcion de efectivo creado para la dispersion ${folio}.`,
        createdBy: uid,
        extra: { cancelledPendingLinks: pending.size, alreadySigned },
      });
    });

    const origin = cleanText(request.data?.origin, 240);
    const path = `/firma/efectivo/${encodeURIComponent(token)}`;
    return {
      ok: true,
      token,
      folio,
      alreadySigned,
      expiresAtMillis: expiresAt.toMillis(),
      url: origin ? `${origin.replace(/\/$/, "")}${path}` : path,
    };
  },
);

/** Public read for the signing page: shows what is being signed, never who created the link. */
export const getDispersionCashSignatureRequest = onCall(
  { cors: true, timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const token = cleanText(request.data?.token, 160);
    if (!TOKEN_RE.test(token)) throw new HttpsError("not-found", "Link de firma invalido.");
    const ref = db.collection(REQUESTS).doc(token);
    await recoverAbandonedReservation(ref);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Link de firma invalido.");
    const row: any = snap.data() || {};
    if (row.status !== "PENDING") throw new HttpsError("failed-precondition", "Este link ya fue usado o cancelado.");
    if (millis(row.expiresAt) < Date.now()) throw new HttpsError("deadline-exceeded", "Este link ya expiro.");

    return {
      ok: true,
      dispersionFolio: row.dispersionFolio || null,
      clienteNombre: row.clienteNombre || null,
      expectedReceiverName: row.expectedReceiverName || null,
      amount: toMoney(row.amount),
      currency: upperText(row.currency) || "MXN",
      acceptanceText: cashReceiptAcceptanceText({ amount: row.amount, currency: row.currency, folio: row.dispersionFolio }),
      acceptanceVersion: CASH_RECEIPT_VERSION,
      expiresAtMillis: millis(row.expiresAt),
    };
  },
);

/**
 * Stores the signature as the dispersion's FIRMA_RECEPCION_EFECTIVO document and
 * marks the cash receipt as signed. The only input the signer controls is their
 * name and the drawing; amount and beneficiary come from the dispersion.
 */
export const submitDispersionCashSignature = onCall(
  { cors: true, timeoutSeconds: 90, memory: "1GiB" },
  async (request) => {
    const token = cleanText(request.data?.token, 160);
    if (!TOKEN_RE.test(token)) throw new HttpsError("invalid-argument", "Link de firma invalido.");
    let signerName = "";
    try {
      signerName = validateSignerName(request.data?.signerName);
    } catch {
      throw new HttpsError("invalid-argument", "Escribe el nombre completo de quien recibe el efectivo.");
    }
    if (request.data?.acceptedReceipt !== true) {
      throw new HttpsError("failed-precondition", "Debes confirmar que recibiste el efectivo para firmar.");
    }
    const png = await decodePngDataUrl(request.data?.signatureDataUrl);

    const tokenRef = db.collection(REQUESTS).doc(token);
    await recoverAbandonedReservation(tokenRef);
    const tokenSnap = await tokenRef.get();
    if (!tokenSnap.exists) throw new HttpsError("not-found", "Link de firma invalido.");
    const tokenRow: any = tokenSnap.data() || {};
    if (tokenRow.status !== "PENDING") throw new HttpsError("failed-precondition", "Este link ya fue usado o cancelado.");
    if (millis(tokenRow.expiresAt) < Date.now()) throw new HttpsError("deadline-exceeded", "Este link ya expiro.");

    const dispersionId = cleanText(tokenRow.dispersionId, 128);
    const rootId = cleanText(tokenRow.rootId, 128);
    const actorUid = cleanText(tokenRow.createdBy, 128);
    if (!dispersionId || !rootId || !actorUid) throw new HttpsError("failed-precondition", "El link no conserva su dispersion.");

    // The creator must still be allowed to operate this dispersion today.
    const { dispersion } = await currentAuthority(actorUid, rootId, dispersionId);
    assertSignableDispersion(dispersion);
    if (toMoney(dispersion.amount) !== toMoney(tokenRow.amount) || currencyOf(dispersion) !== upperText(tokenRow.currency)) {
      throw new HttpsError("failed-precondition", "El monto de la dispersion cambio. Solicita un nuevo enlace.");
    }

    const folio = folioOf(dispersion, dispersionId);
    const amount = toMoney(dispersion.amount);
    const currency = currencyOf(dispersion);
    const expected = expectedReceiverName(dispersion);
    const receiverMatches = receiverNamesMatch(expected, signerName);
    const acceptance = {
      signerName,
      expectedReceiverName: expected || null,
      receiverMatches,
      amount,
      currency,
      acceptanceText: cashReceiptAcceptanceText({ amount, currency, folio }),
      acceptanceVersion: CASH_RECEIPT_VERSION,
      acceptedReceipt: true,
    };
    const documentSha256 = sha256(png);
    const uploadId = db.collection("uploads").doc().id;
    const filename = `firma-recepcion-efectivo-${folio}.png`.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `roots/${rootId}/dispersiones/${dispersionId}/docs/${CASH_RECEIPT_DOCUMENT_TYPE}/${uploadId}-${filename}`;

    // Reserve the one-time token before writing evidence so two concurrent
    // submissions cannot both publish a signature.
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(tokenRef)).data();
      if (current?.status !== "PENDING" || millis(current?.expiresAt) < Date.now())
        throw new HttpsError("failed-precondition", "Este enlace ya fue utilizado o esta siendo procesado.");
      if (current.rootId !== rootId || current.dispersionId !== dispersionId || current.createdBy !== actorUid)
        throw new HttpsError("permission-denied", "El enlace cambio de ambito.");
      tx.update(tokenRef, { status: "PROCESSING", uploadId, processingAt: FieldValue.serverTimestamp() });
    });

    let finalVersion = 1;
    try {
      const file = admin.storage().bucket().file(storagePath);
      await file.save(png, {
        contentType: "image/png",
        resumable: false,
        metadata: {
          metadata: {
            uploadid: uploadId,
            dispersionId,
            documentType: CASH_RECEIPT_DOCUMENT_TYPE,
            sha256: documentSha256,
            integrityHashAlgorithm: "SHA-256",
            integritySealVersion: "PAY0-MATERIALIDAD-V1",
          },
        },
      });
      const [metadata] = await file.getMetadata();
      const storageGeneration = metadata?.generation != null ? String(metadata.generation) : null;

      const uploadRef = db.collection("uploads").doc(uploadId);
      await uploadRef.set({
        rootId,
        adminId: dispersion.adminId || rootId,
        operadorId: dispersion.operadorId || null,
        clienteId: cleanText(dispersion.clienteId || dispersion.clientId, 128) || null,
        clienteNombre: clientNameOf(dispersion) || null,
        clientId: cleanText(dispersion.clienteId || dispersion.clientId, 128) || null,
        clientName: clientNameOf(dispersion) || null,
        beneficiaryId: dispersion.beneficiaryId || null,
        beneficiaryNombre: expected || null,
        methodId: dispersion.methodId || null,
        amount,
        entityType: "clientDispersions",
        entityId: dispersionId,
        dispersionId,
        dispersionFolio: folio,
        documentType: CASH_RECEIPT_DOCUMENT_TYPE,
        documentTypeLabel: CASH_RECEIPT_DOCUMENT_LABEL,
        originalName: filename,
        filename,
        contentType: "image/png",
        sizeBytes: png.length,
        storagePath,
        storageGeneration,
        sha256: documentSha256,
        integrityHashAlgorithm: "SHA-256",
        integritySealStatus: "HASH_SERVER_GENERATED",
        integritySealVersion: "PAY0-MATERIALIDAD-V1",
        source: "PUBLIC_SIGNATURE_LINK",
        signatureCapture: {
          source: "PUBLIC_LINK",
          ...acceptance,
          acceptanceSha256: sha256(Buffer.from(JSON.stringify(acceptance), "utf8")),
          observedIp: cleanText(request.rawRequest?.ip, 80) || null,
          userAgent: cleanText(request.rawRequest?.get?.("user-agent"), 300) || null,
          capturedAt: FieldValue.serverTimestamp(),
        },
        status: "PENDING",
        active: false,
        version: null,
        createdBy: actorUid,
        createdUsername: signerName,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await db.runTransaction(async (tx) => {
        const current = (await tx.get(tokenRef)).data();
        if (current?.status !== "PROCESSING" || current.uploadId !== uploadId)
          throw new HttpsError("failed-precondition", "La reserva de firma cambio.");
        const { dispersion: live, user: liveActor } = await currentAuthority(actorUid, rootId, dispersionId, tx);
        assertSignableDispersion(live);
        if (toMoney(live.amount) !== amount || currencyOf(live) !== currency)
          throw new HttpsError("failed-precondition", "La dispersion cambio mientras se registraba la firma.");

        const activeSnap = await tx.get(
          db.collection("uploads")
            .where("rootId", "==", rootId)
            .where("dispersionId", "==", dispersionId)
            .where("documentType", "==", CASH_RECEIPT_DOCUMENT_TYPE)
            .where("active", "==", true),
        );
        let maxVersion = 0;
        activeSnap.docs.forEach((doc) => {
          const row: any = doc.data() || {};
          maxVersion = Math.max(maxVersion, Number(row.version || 0));
          // Earlier signatures stay on file as history; only one is current.
          tx.update(doc.ref, {
            active: false,
            status: "REPLACED",
            replacedByUploadId: uploadId,
            replacedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
        finalVersion = maxVersion + 1;

        tx.update(uploadRef, {
          status: "READY",
          active: true,
          version: finalVersion,
          finalizedBy: actorUid,
          finalizedUsername: signerName,
          finalizedAt: FieldValue.serverTimestamp(),
          integritySealStatus: "SEALED",
          integritySealedAt: FieldValue.serverTimestamp(),
          integritySealedBy: actorUid,
          integritySealedUsername: signerName,
          updatedAt: FieldValue.serverTimestamp(),
        });

        tx.set(db.doc(`clientDispersions/${dispersionId}`), {
          cashReceiptStatus: CASH_RECEIPT_STATUS.SIGNED,
          cashReceipt: {
            status: CASH_RECEIPT_STATUS.SIGNED,
            version: finalVersion,
            uploadId,
            signerName,
            expectedReceiverName: expected || null,
            receiverMatches,
            amount,
            currency,
            acceptanceVersion: CASH_RECEIPT_VERSION,
            signedAt: FieldValue.serverTimestamp(),
            linkCreatedBy: actorUid,
            token,
          },
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        tx.update(tokenRef, {
          status: "SIGNED",
          usedAt: FieldValue.serverTimestamp(),
          uploadId,
          signerName,
          receiverMatches,
          updatedAt: FieldValue.serverTimestamp(),
        });

        logActivityTx(tx, db, {
          event: "DISPERSION_FIRMA_EFECTIVO_CAPTURADA",
          rootId,
          adminId: live.adminId || rootId,
          actorUid,
          actorUsername: username(liveActor, actorUid),
          actorRole: String(getUserRole(liveActor) || ""),
          entityType: "clientDispersions",
          entityId: dispersionId,
          referenceId: dispersionId,
          referenceFolio: folio,
          referenceType: "dispersionDocument",
          amount,
          description: `Firma de recepcion de efectivo capturada para la dispersion ${folio} por ${signerName}` +
            (receiverMatches ? "." : ` (distinto del beneficiario ${expected || "sin nombre"}).`),
          createdBy: actorUid,
          extra: {
            source: "dispersionCashReceipt",
            uploadId,
            version: finalVersion,
            signerName,
            expectedReceiverName: expected || null,
            receiverMatches,
            documentType: CASH_RECEIPT_DOCUMENT_TYPE,
            documentTypeLabel: CASH_RECEIPT_DOCUMENT_LABEL,
            clienteId: cleanText(live.clienteId || live.clientId, 128) || null,
            clienteNombre: clientNameOf(live) || null,
          },
        });
      });
    } catch (error) {
      // A failed unpublished attempt may retry; a sealed signature is never reset.
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(tokenRef)).data();
        if (current?.status === "PROCESSING" && current.uploadId === uploadId)
          tx.update(tokenRef, { status: "PENDING", uploadId: FieldValue.delete(), processingAt: FieldValue.delete() });
      });
      throw error;
    }

    return { ok: true, uploadId, version: finalVersion, receiverMatches, folio };
  },
);
