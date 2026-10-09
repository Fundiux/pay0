import { requireClientOperationalAccess } from "../clientDelegations/access";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import * as admin from "firebase-admin";
import { logActivity, logActivityTx } from "../../utils/logActivity";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { sendTelegramDocumentBuffer, sendTelegramMessage } from "../telegram/service";
import {
  MAX_DISPERSION_DOCUMENT_SIZE_BYTES,
  cleanText,
  formatMoney,
  getDispersionDocumentTypeLabel,
  normalizeDispersionDocumentType,
  safeDocId,
  sanitizeFilename,
  toMoney,
} from "./domain";


if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function requireAuthLike(request: any): string {
  const uid = request?.auth?.uid;
  if (!validId(uid)) {
    throw new HttpsError("unauthenticated", "No autenticado.");
  }
  return String(uid);
}

async function getUser(uid: string): Promise<any> {
  const snap = await db.doc(`users/${uid}`).get();
  if (snap.exists) return snap.data() || {};
  return null;
}

function getRole(user: any): string {
  return String(user?.role || "").trim().toLowerCase();
}

function getUsername(user: any, uid: string): string {
  return String(user?.username || user?.displayName || user?.email || uid || "").trim();
}

function getRootIdFromUser(user: any, uid: string): string {
  return String(user?.rootId || uid || "").trim();
}

function validId(value: unknown): value is string {
  return typeof value === "string" && !!value && value.length <= 160 && !/[\\/\x00-\x1f]/.test(value) && value !== "." && value !== "..";
}
function authorizeUser(uid: string, user: any) {
  assertAuthorized({ uid }, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "dispersiones" });
}
function unavailable(row: any) {
  return !row || row.deleted === true || row.isDeleted === true || row.deletedAt != null || row.active === false || ["DELETED", "ELIMINADA", "ELIMINADO"].includes(String(row.status || "").toUpperCase());
}
// Same ownership contract as the document bridge. The source branch does not
// contain dispersionFunding.ts; keep this write-domain boundary local.
async function currentAuthority(uid: string, rootId: string, dispersionId: string, tx?: admin.firestore.Transaction) {
  if (![uid, rootId, dispersionId].every(validId)) throw new HttpsError("invalid-argument", "Referencia invalida.");
  const read = (path: string) => tx ? tx.get(db.doc(path)) : db.doc(path).get();
  const user = (await read(`users/${uid}`)).data();
  authorizeUser(uid, user);
  if (getRootIdFromUser(user, uid) !== rootId) throw new HttpsError("permission-denied", "Usuario fuera de alcance.");
  const dispersion = (await read(`clientDispersions/${dispersionId}`)).data();
  if (unavailable(dispersion) || dispersion?.rootId !== rootId) throw new HttpsError("permission-denied", "Dispersion fuera de alcance.");
  const role = getUserRole(user), source = dispersion.fundingSource;
  const clientId = cleanText(dispersion.clientId || dispersion.clienteId);
  if (source?.holderType === "USER") {
    if (!validId(clientId) || source.sourceClientId !== clientId || !validId(source.ownerUid) || dispersion.ownerUid !== source.ownerUid || (role !== "superadmin" && source.ownerUid !== uid)) {
      throw new HttpsError("permission-denied", "Retiro de utilidad fuera del alcance del titular.");
    }
  } else if (role !== "superadmin") {
    if (!validId(clientId)) throw new HttpsError("permission-denied", "Cliente no disponible.");
    await requireClientOperationalAccess({ uid, role, rootId, clientId, permission: "operateDispersiones", transaction: tx });
  }
  return { user, dispersion };
}
function assertUploadIdentity(upload: any, rootId: string, dispersionId: string, uploadId: string) {
  const prefix = `roots/${rootId}/dispersiones/${dispersionId}/docs/COMPROBANTE_DISPERSION/${uploadId}-`;
  const path = upload.storagePath;
  if (upload.rootId !== rootId || upload.entityType !== "clientDispersions" || upload.dispersionId !== dispersionId || upload.entityId !== dispersionId ||
      upload.documentType !== "COMPROBANTE_DISPERSION" || typeof path !== "string" || !path.startsWith(prefix) || path.length <= prefix.length ||
      /[\\\x00-\x1f]/.test(path) || path.slice(prefix.length).includes("/") || path.split("/").some(x => x === "." || x === "..")) {
    throw new HttpsError("failed-precondition", "Identidad del comprobante invalida.");
  }
}
async function verifyUploadMetadata(upload: any) {
  try {
    const bucket = admin.storage().bucket();
    const [metadata] = await bucket.file(upload.storagePath).getMetadata();
    const size = Number(metadata.size), generation = String(metadata.generation || "");
    if (metadata.name !== upload.storagePath || metadata.bucket !== bucket.name || !/^[1-9][0-9]*$/.test(generation) ||
        !/^[1-9][0-9]*$/.test(String(metadata.metageneration || "")) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_DISPERSION_DOCUMENT_SIZE_BYTES ||
        size !== upload.sizeBytes || metadata.contentType !== upload.contentType ||
        (upload.storageGeneration != null && String(upload.storageGeneration) !== generation)) {
      throw new HttpsError("failed-precondition", "Metadatos del archivo no coinciden con la carga.");
    }
    return { storageGeneration: generation, storageMetageneration: String(metadata.metageneration) };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "No se pudo verificar el archivo en Storage.");
  }
}

function pickDispersionFolio(dispersion: any, dispersionId: string): string {
  return cleanText(
    dispersion?.folio ||
    dispersion?.dispersionFolio ||
    dispersion?.sequenceDisplay ||
    dispersionId
  );
}

function pickClientId(dispersion: any): string {
  return cleanText(dispersion?.clienteId || dispersion?.clientId || "");
}

function pickClientName(dispersion: any): string {
  return cleanText(
    dispersion?.clienteNombre ||
    dispersion?.clientName ||
    dispersion?.clientDisplayName ||
    "Cliente"
  );
}

function pickBeneficiaryName(dispersion: any): string {
  return cleanText(
    dispersion?.beneficiaryNombre ||
    dispersion?.beneficiaryName ||
    dispersion?.beneficiarioNombre ||
    "Beneficiario"
  );
}

function pickContentType(data: any): string {
  return cleanText(data?.contentType) || "application/octet-stream";
}

async function getClientRecipients(clientId: string): Promise<Array<{
  telegramUserId: string;
  chatId: string;
  telegramUsername: string;
}>> {
  const cleanClientId = cleanText(clientId);
  if (!cleanClientId) return [];

  const snap = await db
    .collection("clientTelegramUsers")
    .where("clientId", "==", cleanClientId)
    .where("active", "==", true)
    .get();

  const rows: Array<{
    telegramUserId: string;
    chatId: string;
    telegramUsername: string;
  }> = [];

  snap.forEach((doc) => {
    const data = doc.data() || {};
    const chatId = cleanText(data.chatId);
    if (!chatId) return;

    rows.push({
      telegramUserId: cleanText(data.telegramUserId || doc.id),
      chatId,
      telegramUsername: cleanText(data.telegramUsername || ""),
    });
  });

  return rows;
}

async function sendUploadFileToTelegram(input: {
  botToken: string;
  chatId: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  caption: string;
}) {
  const bucket = admin.storage().bucket();
  const storageFile = bucket.file(input.storagePath);
  const [exists] = await storageFile.exists();

  if (!exists) {
    throw new Error(`Archivo no encontrado en Storage: ${input.storagePath}`);
  }

  const [buffer] = await storageFile.download();

  return await sendTelegramDocumentBuffer(
    input.botToken,
    input.chatId,
    input.fileName || "comprobante",
    buffer,
    input.contentType || "application/octet-stream",
    input.caption.slice(0, 1024)
  );
}

export async function initDispersionDocumentUploadCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  authorizeUser(uid, user);

  const rootId = getRootIdFromUser(user, uid);
  const data = request.data || {};

  const dispersionId = cleanText(data.dispersionId);
  const originalName = cleanText(data.originalName || data.filename);
  const contentType = pickContentType(data);
  const sizeBytes = Number(data.sizeBytes || 0);
  const documentType = normalizeDispersionDocumentType(data.documentType || "COMPROBANTE_DISPERSION");
  const documentTypeLabel = getDispersionDocumentTypeLabel(documentType);

  if (!validId(dispersionId) || !originalName) {
    throw new HttpsError("invalid-argument", "dispersionId y originalName son obligatorios.");
  }

  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new HttpsError("invalid-argument", "Tamano de archivo invalido.");
  }

  if (sizeBytes > MAX_DISPERSION_DOCUMENT_SIZE_BYTES) {
    throw new HttpsError("invalid-argument", "El archivo excede el limite de 1 MB.");
  }

  const safeName = sanitizeFilename(originalName);
  const uploadId = db.collection("uploads").doc().id;
  const storagePath = `roots/${rootId}/dispersiones/${dispersionId}/docs/${documentType}/${uploadId}-${safeName}`;
  await db.runTransaction(async tx => {
  const { dispersion, user: currentUser } = await currentAuthority(uid, rootId, dispersionId, tx);
  const dispersionFolio = pickDispersionFolio(dispersion, dispersionId);
  const clienteId = pickClientId(dispersion);
  const clienteNombre = pickClientName(dispersion);
  const beneficiaryNombre = pickBeneficiaryName(dispersion);

  tx.create(db.collection("uploads").doc(uploadId), {
    rootId,
    adminId: dispersion.adminId || rootId,
    operadorId: dispersion.operadorId || null,

    clienteId,
    clienteNombre,
    clientId: clienteId,
    clientName: clienteNombre,

    beneficiaryId: dispersion.beneficiaryId || null,
    beneficiaryNombre,
    methodId: dispersion.methodId || null,
    amount: toMoney(dispersion.amount),

    entityType: "clientDispersions",
    entityId: dispersionId,
    dispersionId,
    dispersionFolio,

    documentType,
    documentTypeLabel,
    originalName,
    filename: safeName,
    contentType,
    sizeBytes,
    storagePath,

    status: "PENDING",
    active: false,
    version: null,

    createdBy: uid,
    createdUsername: getUsername(currentUser, uid),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  });

  return {
    ok: true,
    uploadId,
    storagePath,
    documentType,
  };
}

export async function finalizeDispersionDocumentUploadCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  authorizeUser(uid, user);

  const rootId = getRootIdFromUser(user, uid);
  const data = request.data || {};

  const uploadId = cleanText(data.uploadId);
  const storagePathIn = cleanText(data.storagePath);

  if (!validId(uploadId)) {
    throw new HttpsError("invalid-argument", "uploadId requerido.");
  }

  const uploadRef = db.collection("uploads").doc(uploadId);
  const uploadSnap = await uploadRef.get();

  if (!uploadSnap.exists) {
    throw new HttpsError("not-found", "Upload no existe.");
  }

  const upload = uploadSnap.data() || {};

  if (String(upload.rootId || "") !== rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  const dispersionId = cleanText(upload.dispersionId || upload.entityId);

  if (!dispersionId) {
    throw new HttpsError("failed-precondition", "Upload sin dispersionId.");
  }

  if (!validId(uploadId) || !validId(dispersionId)) throw new HttpsError("invalid-argument", "Referencia invalida.");
  await currentAuthority(uid, rootId, dispersionId);
  assertUploadIdentity(upload, rootId, dispersionId, uploadId);
  if (storagePathIn && storagePathIn !== upload.storagePath) throw new HttpsError("invalid-argument", "storagePath no coincide con el registro.");
  const verifiedMetadata = await verifyUploadMetadata(upload);

  const documentType = normalizeDispersionDocumentType(upload.documentType);
  let finalVersion = 1;

  await db.runTransaction(async (tx) => {
    // Re-read the target before changing any active version. A repeated finalize
    // must not replace itself, increment its version, or revive a retired upload.
    const currentSnap = await tx.get(uploadRef);
    if (!currentSnap.exists) {
      throw new HttpsError("not-found", "Upload no existe.");
    }
    const current = currentSnap.data() || {};
    const { user: currentUser } = await currentAuthority(uid, rootId, dispersionId, tx);
    assertUploadIdentity(current, rootId, dispersionId, uploadId);
    if (cleanText(current.rootId) !== rootId) {
      throw new HttpsError("permission-denied", "No autorizado.");
    }
    if (cleanText(current.dispersionId || current.entityId) !== dispersionId ||
        cleanText(current.storagePath) !== cleanText(upload.storagePath) ||
        current.documentType !== upload.documentType || current.entityType !== upload.entityType ||
        (current.storageGeneration !== upload.storageGeneration && current.storageGeneration !== verifiedMetadata.storageGeneration) || current.entityId !== upload.entityId ||
        current.sizeBytes !== upload.sizeBytes || current.contentType !== upload.contentType) {
      throw new HttpsError("failed-precondition", "El comprobante cambio. Vuelve a cargarlo.");
    }
    if (current.deleted === true || current.isDeleted === true || current.deletedAt != null) {
      throw new HttpsError("failed-precondition", "El comprobante ya no puede finalizarse.");
    }
    const currentStatus = cleanText(current.status).toUpperCase();
    if (currentStatus === "READY" && current.active === true) {
      if (!Number.isSafeInteger(current.version) || current.version < 1) {
        throw new HttpsError("failed-precondition", "Version de comprobante invalida.");
      }
      finalVersion = current.version;
      return;
    }
    if (currentStatus !== "PENDING" || current.active !== false) {
      throw new HttpsError("failed-precondition", "El comprobante ya no puede finalizarse.");
    }
    const activeQuery = db
      .collection("uploads")
      .where("rootId", "==", rootId)
      .where("dispersionId", "==", dispersionId)
      .where("documentType", "==", documentType)
      .where("active", "==", true);

    const activeSnap = await tx.get(activeQuery);

    let maxVersion = 0;
    activeSnap.docs.forEach((doc) => {
      const row: any = doc.data() || {};
      const currentVersion = Number(row.version || 0);
      if (currentVersion > maxVersion) maxVersion = currentVersion;

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
      ...verifiedMetadata,
      finalizedBy: uid,
      finalizedUsername: getUsername(currentUser, uid),
      finalizedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

        logActivityTx(tx, db, {
      event: "DOCUMENTO_DISPERSION_SUBIDO",
      rootId,
      adminId: upload.adminId || rootId,
      actorUid: uid,
      actorUsername: getUsername(currentUser, uid),
      actorRole: getRole(currentUser),
      entityType: "clientDispersions",
      entityId: dispersionId,
      referenceId: dispersionId,
      referenceFolio: upload.dispersionFolio || dispersionId,
      referenceType: "dispersionDocument",
      amount: Number(upload.amount || 0),
      description: `Comprobante de dispersion ${upload.dispersionFolio || dispersionId} subido.`,
      createdBy: uid,
      extra: {
        source: "docs",
        clientId: upload.clienteId || upload.clientId || null,
        clienteId: upload.clienteId || upload.clientId || null,
        clientName: upload.clienteNombre || upload.clientName || null,
        clienteNombre: upload.clienteNombre || upload.clientName || null,
        beneficiaryId: upload.beneficiaryId || null,
        beneficiaryNombre: upload.beneficiaryNombre || null,
        documentType,
        documentTypeLabel: upload.documentTypeLabel || getDispersionDocumentTypeLabel(documentType),
        uploadId,
      },
    });
  });

  return {
    ok: true,
    uploadId,
    status: "READY",
    active: true,
    version: finalVersion,
  };
}

export async function deactivateDispersionDocumentCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  authorizeUser(uid, user);

  const rootId = getRootIdFromUser(user, uid);
  const uploadId = cleanText(request?.data?.uploadId);

  if (!validId(uploadId)) {
    throw new HttpsError("invalid-argument", "uploadId requerido.");
  }

  const uploadRef = db.collection("uploads").doc(uploadId);
  const uploadSnap = await uploadRef.get();

  if (!uploadSnap.exists) {
    throw new HttpsError("not-found", "Comprobante no existe.");
  }

  const upload = uploadSnap.data() || {};

  if (String(upload.rootId || "") !== rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  const dispersionId = cleanText(upload.dispersionId || upload.entityId);

  await db.runTransaction(async tx => {
  const current = (await tx.get(uploadRef)).data();
  const { user: currentUser } = await currentAuthority(uid, rootId, dispersionId, tx);
  if (!current) throw new HttpsError("not-found", "Comprobante no existe.");
  assertUploadIdentity(current, rootId, dispersionId, uploadId);
  for (const key of ["rootId", "dispersionId", "entityId", "entityType", "storagePath", "storageGeneration", "documentType"]) {
    if (current[key] !== upload[key]) throw new HttpsError("failed-precondition", "El comprobante cambio.");
  }
  if (current.status === "INACTIVE" && current.active === false) return;
  if (unavailable(current) || current.status !== "READY" || current.active !== true) throw new HttpsError("failed-precondition", "Comprobante no vigente.");
  tx.update(uploadRef, {
    active: false,
    status: "INACTIVE",
    deactivatedBy: uid,
    deactivatedUsername: getUsername(currentUser, uid),
    deactivatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

    logActivityTx(tx, db, {
    event: "DOCUMENTO_DISPERSION_DESACTIVADO",
    rootId,
    adminId: upload.adminId || rootId,
    actorUid: uid,
    actorUsername: getUsername(currentUser, uid),
    actorRole: getRole(currentUser),
    entityType: "clientDispersions",
    entityId: dispersionId,
    referenceId: dispersionId,
    referenceFolio: upload.dispersionFolio || dispersionId,
    referenceType: "dispersionDocument",
    description: `Comprobante de dispersion ${upload.dispersionFolio || dispersionId} desactivado.`,
    createdBy: uid,
    extra: {
      source: "docs",
      clientId: upload.clienteId || upload.clientId || null,
      clienteId: upload.clienteId || upload.clientId || null,
      clientName: upload.clienteNombre || upload.clientName || null,
      clienteNombre: upload.clienteNombre || upload.clientName || null,
      beneficiaryId: upload.beneficiaryId || null,
      beneficiaryNombre: upload.beneficiaryNombre || null,
      documentType: upload.documentType || null,
      documentTypeLabel: upload.documentTypeLabel || null,
      uploadId,
    },
  });

  });

  return {
    ok: true,
    uploadId,
    status: "INACTIVE",
  };
}

export async function notifyClientDispersionComprobanteFromUploadId(
  uploadId: string,
  botToken: string
): Promise<{
  ok: boolean;
  notified: boolean;
  reason: string;
  sentCount?: number;
}> {
  const cleanUploadId = cleanText(uploadId);

  if (!cleanUploadId) {
    return { ok: true, notified: false, reason: "missing_upload_id" };
  }

  const uploadSnap = await db.collection("uploads").doc(cleanUploadId).get();

  if (!uploadSnap.exists) {
    return { ok: true, notified: false, reason: "upload_not_found" };
  }

  const upload = uploadSnap.data() || {};
  const documentType = normalizeDispersionDocumentType(upload.documentType);

  if (documentType !== "COMPROBANTE_DISPERSION") {
    return { ok: true, notified: false, reason: "not_dispersion_document" };
  }

  if (cleanText(upload.status).toUpperCase() !== "READY" || upload.active !== true) {
    return { ok: true, notified: false, reason: "upload_not_ready" };
  }

  const rootId = cleanText(upload.rootId);
  const dispersionId = cleanText(upload.dispersionId || upload.entityId);
  const clientId = cleanText(upload.clienteId || upload.clientId);

  if (!rootId || !dispersionId || !clientId) {
    return { ok: true, notified: false, reason: "missing_scope" };
  }

  const eventId = safeDocId(`COMPROBANTE_DISPERSION_CLIENTE_${clientId}_${dispersionId}_${cleanUploadId}`);
  const eventRef = db.collection("telegramClientNotificationEvents").doc(eventId);
  const eventSnap = await eventRef.get();

  if (eventSnap.exists) {
    const event = eventSnap.data() || {};
    const status = cleanText(event.status).toUpperCase();

    if (status === "SENT" || status === "PENDING") {
      return { ok: true, notified: false, reason: "duplicate" };
    }
  }

  const recipients = await getClientRecipients(clientId);

  await eventRef.set(
    {
      eventId,
      type: "COMPROBANTE_DISPERSION_CLIENTE",
      status: "PENDING",
      rootId,
      clientId,
      clientName: cleanText(upload.clienteNombre || upload.clientName || "Cliente"),
      dispersionId,
      dispersionFolio: cleanText(upload.dispersionFolio || dispersionId),
      beneficiaryId: cleanText(upload.beneficiaryId),
      beneficiaryNombre: cleanText(upload.beneficiaryNombre || "Beneficiario"),
      totalAmount: toMoney(upload.amount),
      uploadId: cleanUploadId,
      storagePath: cleanText(upload.storagePath),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (recipients.length === 0) {
    await eventRef.set(
      {
        status: "SKIPPED",
        reason: "client_without_telegram_recipients",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, notified: false, reason: "client_without_telegram_recipients" };
  }

  const clientName = cleanText(upload.clienteNombre || upload.clientName || "Cliente");
  const beneficiaryNombre = cleanText(upload.beneficiaryNombre || "Beneficiario");
  const dispersionFolio = cleanText(upload.dispersionFolio || dispersionId);
  const amount = toMoney(upload.amount);

  const message =
    "PAY0 comprobante disponible\n\n" +
    `Comprobante de dispersion ${dispersionFolio} para ${clientName} por un total de ${formatMoney(amount)}.\n` +
    `Beneficiario: ${beneficiaryNombre}\n\n` +
    "Archivo enviado directo por Telegram.";

  let sentCount = 0;
  const errors: string[] = [];

  for (const recipient of recipients) {
    try {
      await sendTelegramMessage(
        botToken,
        recipient.chatId,
        message
      );

      await sendUploadFileToTelegram({
        botToken,
        chatId: recipient.chatId,
        storagePath: cleanText(upload.storagePath),
        fileName: cleanText(upload.originalName || upload.filename || "comprobante"),
        contentType: cleanText(upload.contentType || "application/octet-stream"),
        caption: "Comprobante",
      });

      sentCount += 1;
    } catch (error: any) {
      const errMessage = String(error?.message || error || "unknown");
      errors.push(errMessage);

      logger.error("notifyClientDispersionComprobanteFromUploadId recipient error", {
        clientId,
        dispersionId,
        telegramUserId: recipient.telegramUserId,
        message: errMessage,
      });
    }
  }

  await eventRef.set(
    {
      status: sentCount > 0 ? "SENT" : "FAILED",
      reason: sentCount > 0 ? "sent" : "send_failed",
      sentCount,
      errors,
      sentAt: sentCount > 0 ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

    await logActivity({
    event: "TELEGRAM_COMPROBANTE_DISPERSION_CLIENTE_ENVIADO",
    rootId,
    actorUid: "system",
    actorName: "Sistema",
    actorUsername: "Sistema",
    actorRole: "system",
    entityType: "clientDispersions",
    entityId: dispersionId,
    referenceId: dispersionId,
    referenceFolio: dispersionFolio || dispersionId,
    referenceType: "telegramDispersionComprobante",
    amount,
    description: "Comprobante de dispersion enviado al cliente por Telegram",
    createdBy: "system",
    extra: {
      source: "telegram",
      clientId,
      clienteId: clientId,
      clientName,
      clienteNombre: clientName,
      beneficiaryNombre,
      uploadId: cleanUploadId,
      sentCount,
      message: "Comprobante de dispersion enviado al cliente por Telegram",
    },
  });

  return {
    ok: true,
    notified: sentCount > 0,
    reason: sentCount > 0 ? "sent" : "send_failed",
    sentCount,
  };
}
