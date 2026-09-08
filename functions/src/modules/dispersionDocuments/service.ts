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
import { getEffectiveUserModules, isCanonicalUserActive } from "../users/authorization";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function requireAuthLike(request: any): string {
  const uid = request?.auth?.uid;
  if (!uid) {
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

function canUploadDispersionDocs(user: any): boolean {
  const role = getRole(user);
  if (!isCanonicalUserActive(user)) return false;
  if (role === "superadmin") return true;
  return getEffectiveUserModules(user)?.wallet?.dispersiones === true;
}

async function canAccessDispersion(user: any, uid: string, rootId: string, dispersion: any): Promise<boolean> {
  const role = getRole(user);
  const dispersionRootId = String(dispersion?.rootId || "").trim();
  const dispersionAdminId = String(dispersion?.adminId || "").trim();
  const dispersionOperadorId = String(dispersion?.operadorId || "").trim();
  const dispersionCreatedBy = String(dispersion?.createdBy || "").trim();

  if (dispersionRootId && dispersionRootId !== rootId) return false;

  if (role === "superadmin") return true;
  if (role === "admin" && (dispersionAdminId === uid || dispersionCreatedBy === uid)) return true;
  if (role === "operador" && (dispersionOperadorId === uid || dispersionCreatedBy === uid)) return true;

  const clientId = cleanText(dispersion?.clienteId || dispersion?.clientId || "");
  if (!clientId) return false;

  const accessSnap = await db.doc(`userClientAccess/${uid}/clients/${clientId}`).get();
  if (!accessSnap.exists) return false;

  const access: any = accessSnap.data() || {};
  if (access.active !== true) return false;

  const accessRootId = cleanText(access.rootId);
  if (accessRootId && accessRootId !== rootId) return false;

  const permissions = access.permissions || {};
  return permissions.operate === true || permissions.operateDispersiones === true;
}

async function loadDispersionOrThrow(input: {
  dispersionId: string;
  uid: string;
  user: any;
  rootId: string;
}) {
  const dispersionRef = db.collection("clientDispersions").doc(input.dispersionId);
  const dispersionSnap = await dispersionRef.get();

  if (!dispersionSnap.exists) {
    throw new HttpsError("not-found", "Dispersion no encontrada.");
  }

  const dispersion = dispersionSnap.data() || {};

  if (!(await canAccessDispersion(input.user, input.uid, input.rootId, dispersion))) {
    throw new HttpsError("permission-denied", "Dispersion fuera de alcance.");
  }

  return {
    dispersionRef,
    dispersion,
  };
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

  if (!canUploadDispersionDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para subir comprobantes.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const data = request.data || {};

  const dispersionId = cleanText(data.dispersionId);
  const originalName = cleanText(data.originalName || data.filename);
  const contentType = pickContentType(data);
  const sizeBytes = Number(data.sizeBytes || 0);
  const documentType = normalizeDispersionDocumentType(data.documentType || "COMPROBANTE_DISPERSION");
  const documentTypeLabel = getDispersionDocumentTypeLabel(documentType);

  if (!dispersionId || !originalName) {
    throw new HttpsError("invalid-argument", "dispersionId y originalName son obligatorios.");
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new HttpsError("invalid-argument", "Tamano de archivo invalido.");
  }

  if (sizeBytes > MAX_DISPERSION_DOCUMENT_SIZE_BYTES) {
    throw new HttpsError("invalid-argument", "El archivo excede el limite de 1 MB.");
  }

  const { dispersion } = await loadDispersionOrThrow({
    dispersionId,
    uid,
    user,
    rootId,
  });

  const safeName = sanitizeFilename(originalName);
  const uploadId = db.collection("uploads").doc().id;
  const storagePath = `roots/${rootId}/dispersiones/${dispersionId}/docs/${documentType}/${uploadId}-${safeName}`;
  const dispersionFolio = pickDispersionFolio(dispersion, dispersionId);
  const clienteId = pickClientId(dispersion);
  const clienteNombre = pickClientName(dispersion);
  const beneficiaryNombre = pickBeneficiaryName(dispersion);

  await db.collection("uploads").doc(uploadId).set({
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
    createdUsername: getUsername(user, uid),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
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

  if (!canUploadDispersionDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para finalizar comprobantes.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const data = request.data || {};

  const uploadId = cleanText(data.uploadId);
  const storagePathIn = cleanText(data.storagePath);

  if (!uploadId) {
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

  await loadDispersionOrThrow({
    dispersionId,
    uid,
    user,
    rootId,
  });

  if (storagePathIn && storagePathIn !== cleanText(upload.storagePath)) {
    throw new HttpsError("invalid-argument", "storagePath no coincide con el registro.");
  }

  try {
    const bucket = admin.storage().bucket();
    const [exists] = await bucket.file(cleanText(upload.storagePath)).exists();

    if (!exists) {
      throw new HttpsError("failed-precondition", "El archivo no existe en Storage.");
    }
  } catch (e: any) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("internal", "No se pudo verificar el archivo en Storage.");
  }

  const documentType = normalizeDispersionDocumentType(upload.documentType);
  let finalVersion = 1;

  await db.runTransaction(async (tx) => {
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
      finalizedBy: uid,
      finalizedUsername: getUsername(user, uid),
      finalizedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

        logActivityTx(tx, db, {
      event: "DOCUMENTO_DISPERSION_SUBIDO",
      rootId,
      adminId: upload.adminId || rootId,
      actorUid: uid,
      actorUsername: getUsername(user, uid),
      actorRole: getRole(user),
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

  if (!canUploadDispersionDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para desactivar comprobantes.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const uploadId = cleanText(request?.data?.uploadId);

  if (!uploadId) {
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

  await loadDispersionOrThrow({
    dispersionId,
    uid,
    user,
    rootId,
  });

  await uploadRef.update({
    active: false,
    status: "INACTIVE",
    deactivatedBy: uid,
    deactivatedUsername: getUsername(user, uid),
    deactivatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

    await logActivity({
    event: "DOCUMENTO_DISPERSION_DESACTIVADO",
    rootId,
    adminId: upload.adminId || rootId,
    actorUid: uid,
    actorUsername: getUsername(user, uid),
    actorRole: getRole(user),
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
