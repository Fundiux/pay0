import { randomUUID } from "crypto";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import * as admin from "firebase-admin";
import { logActivityTx } from "../../utils/logActivity";
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

const NOTIFICATION_VERSION = 2;
const MAX_NOTIFICATION_RECIPIENTS = 10;
const CLAIM_MS = 120_000;
const MAX_PRE_SEND_ATTEMPTS = 3;
type DeliveryRecipient = { linkId: string; chatId: string; text: string; document: string };
const anyPost = (recipients: DeliveryRecipient[]) => recipients.some(r => r.text !== "READY" || r.document !== "READY");
const completeRecipients = (recipients: DeliveryRecipient[]) => recipients.filter(r => r.text === "SENT" && r.document === "SENT").length;
const notificationResult = (reason: string, sentCount = 0) => ({ ok: true, notified: sentCount > 0, reason, sentCount });

// No latest-path fallback. Stream bounds apply even if object metadata is false.
async function readPinnedNotificationFile(upload: any): Promise<Buffer> {
  const bucket = admin.storage().bucket();
  const generation = String(upload.storageGeneration || "");
  if (!/^[1-9][0-9]*$/.test(generation) || !Number.isSafeInteger(upload.sizeBytes) || upload.sizeBytes <= 0 || upload.sizeBytes > MAX_DISPERSION_DOCUMENT_SIZE_BYTES) throw Error("OBJECT_UNVERIFIED");
  const file = bucket.file(upload.storagePath, { generation });
  const [metadata] = await file.getMetadata();
  if (metadata.name !== upload.storagePath || metadata.bucket !== bucket.name || String(metadata.generation) !== generation || Number(metadata.size) !== upload.sizeBytes || metadata.contentType !== upload.contentType) throw Error("OBJECT_CHANGED");
  const stream = file.createReadStream({ validation: "crc32c" });
  const chunks: Buffer[] = []; let size = 0;
  const timer = setTimeout(() => stream.destroy(Error("READ_TIMEOUT")), 10_000);
  try {
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      size += chunk.length;
      if (size > upload.sizeBytes || size > MAX_DISPERSION_DOCUMENT_SIZE_BYTES) { stream.destroy(); throw Error("OBJECT_TOO_LARGE"); }
      chunks.push(chunk);
    }
    if (size !== upload.sizeBytes) throw Error("OBJECT_SIZE_CHANGED");
    return Buffer.concat(chunks, size);
  } finally { clearTimeout(timer); }
}

// Resolves server-stored authority again before each irreversible send.
async function notificationScope(tx: admin.firestore.Transaction, uploadId: string, expected?: any) {
  const upload = (await tx.get(db.doc(`uploads/${uploadId}`))).data();
  if (!upload || unavailable(upload) || upload.status !== "READY" || upload.active !== true) throw Error("UPLOAD_NOT_READY");
  const rootId = cleanText(upload.rootId), dispersionId = cleanText(upload.dispersionId), actorUid = cleanText(upload.finalizedBy);
  if (![rootId, dispersionId, actorUid].every(validId)) throw Error("AUTHORITY_UNVERIFIED");
  assertUploadIdentity(upload, rootId, dispersionId, uploadId);
  const { dispersion } = await currentAuthority(actorUid, rootId, dispersionId, tx);
  const clientId = cleanText(dispersion.clientId || dispersion.clienteId);
  if (!validId(clientId) || clientId !== cleanText(upload.clientId || upload.clienteId)) throw Error("CLIENT_CHANGED");
  const client = (await tx.get(db.doc(`clients/${clientId}`))).data();
  if (unavailable(client) || client?.rootId !== rootId) throw Error("CLIENT_UNAVAILABLE");
  if (expected && ["rootId", "dispersionId", "storagePath", "storageGeneration", "sizeBytes", "contentType", "finalizedBy"].some(key => upload[key] !== expected[key])) throw Error("OBJECT_CHANGED");
  return { upload, rootId, dispersionId, clientId, userFunded: dispersion.fundingSource?.holderType === "USER" };
}

export async function notifyClientDispersionComprobanteFromUploadId(uploadId: string, botToken: string): Promise<{ ok: boolean; notified: boolean; reason: string; sentCount?: number }> {
  const invocationDeadline = Date.now() + 45_000;
  const cleanUploadId = cleanText(uploadId);
  if (!validId(cleanUploadId)) return notificationResult("missing_upload_id");
  const initial = (await db.doc(`uploads/${cleanUploadId}`).get()).data();
  if (!initial) return notificationResult("upload_not_found");
  const rootId = cleanText(initial.rootId), dispersionId = cleanText(initial.dispersionId || initial.entityId), clientId = cleanText(initial.clientId || initial.clienteId);
  if (![rootId, dispersionId, clientId].every(validId)) return notificationResult("missing_scope");
  // Preserve the historical key; validate its entire identity to deny truncation collisions.
  const eventId = safeDocId(`COMPROBANTE_DISPERSION_CLIENTE_${clientId}_${dispersionId}_${cleanUploadId}`);
  const eventRef = db.doc(`telegramClientNotificationEvents/${eventId}`), attemptId = randomUUID();
  const claim: { upload?: any; recipients?: DeliveryRecipient[]; reason?: string; sentCount?: number } = await db.runTransaction(async tx => {
    const existing = (await tx.get(eventRef)).data();
    if (existing && (existing.rootId !== rootId || existing.clientId !== clientId || existing.dispersionId !== dispersionId || existing.uploadId !== cleanUploadId)) return { reason: "event_identity_conflict" };
    if (existing?.status === "SENT") return { reason: "duplicate" };
    if (existing && existing.deliveryVersion !== NOTIFICATION_VERSION) {
      // Preserve old state/errors: they cannot prove that no POST reached Telegram.
      tx.update(eventRef, { reviewRequired: true, reviewReason: "LEGACY_DELIVERY_UNCERTAIN", updatedAt: FieldValue.serverTimestamp() });
      return { reason: "legacy_delivery_uncertain" };
    }
    if (existing && !["PENDING", "PRE_SEND_FAILED"].includes(existing.status)) return { reason: cleanText(existing.reason || existing.status).toLowerCase(), sentCount: existing.sentCount || 0 };
    if (existing?.status === "PENDING") {
      if (existing.leaseUntilMs > Date.now()) return { reason: "in_progress" };
      if (anyPost(existing.recipients || [])) {
        tx.update(eventRef, { status: "UNKNOWN", reason: "EXPIRED_AFTER_SEND_STARTED", reviewRequired: true, updatedAt: FieldValue.serverTimestamp() });
        return { reason: "delivery_unknown" };
      }
    }
    let scope: Awaited<ReturnType<typeof notificationScope>>;
    try { scope = await notificationScope(tx, cleanUploadId); }
    catch {
      tx.set(eventRef, { rootId, clientId, dispersionId, uploadId: cleanUploadId, deliveryVersion: NOTIFICATION_VERSION,
        status: "NEEDS_REVIEW", reason: "CURRENT_AUTHORITY_UNAVAILABLE", reviewRequired: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { reason: "current_authority_unavailable" };
    }
    if (existing && (existing.storagePath !== scope.upload.storagePath || existing.storageGeneration !== scope.upload.storageGeneration)) {
      tx.update(eventRef, { status: "NEEDS_REVIEW", reason: "BOUND_OBJECT_CHANGED", reviewRequired: true, updatedAt: FieldValue.serverTimestamp() });
      return { reason: "bound_object_changed" };
    }
    if (existing && (!Number.isSafeInteger(existing.attempt) || existing.attempt < 1)) {
      tx.update(eventRef, { status: "NEEDS_REVIEW", reason: "ATTEMPT_EVIDENCE_INVALID", reviewRequired: true });
      return { reason: "attempt_evidence_invalid" };
    }
    const attempt = Number(existing?.attempt || 0) + 1;
    const base = { deliveryVersion: NOTIFICATION_VERSION, eventId, type: "COMPROBANTE_DISPERSION_CLIENTE", rootId, clientId, dispersionId, uploadId: cleanUploadId, storagePath: scope.upload.storagePath, storageGeneration: scope.upload.storageGeneration || null, updatedAt: FieldValue.serverTimestamp() };
    const hold = (reason: string) => { tx.set(eventRef, { ...base, status: "NEEDS_REVIEW", reason, reviewRequired: true }, { merge: true }); return { reason: reason.toLowerCase() }; };
    if (scope.rootId !== rootId || scope.clientId !== clientId || scope.dispersionId !== dispersionId) return { reason: "scope_changed" };
    // Candidate only: recipient policy is awaiting user decision. No rollout until resolved.
    if (scope.userFunded) return hold("USER_RECIPIENT_POLICY_PENDING");
    if (!/^[1-9][0-9]*$/.test(String(scope.upload.storageGeneration || ""))) return hold("GENERATION_UNVERIFIED");
    if (!cleanText(botToken)) return hold("TRANSPORT_NOT_CONFIGURED");
    if (attempt > MAX_PRE_SEND_ATTEMPTS) return hold("PRE_SEND_ATTEMPTS_EXHAUSTED");
    let recipients: DeliveryRecipient[] = existing?.recipients;
    if (!existing) {
      const links = await tx.get(db.collection("clientTelegramUsers").where("clientId", "==", clientId).where("active", "==", true).limit(MAX_NOTIFICATION_RECIPIENTS + 1));
      if (links.docs.length > MAX_NOTIFICATION_RECIPIENTS) return hold("RECIPIENT_LIMIT_EXCEEDED");
      recipients = []; const chats = new Set<string>();
      for (const doc of links.docs) {
        const link = doc.data(), chatId = cleanText(link.chatId);
        if (link.rootId !== rootId || link.clientId !== clientId || link.active !== true || !/^-?[0-9]{1,20}$/.test(chatId) || !validId(doc.id)) continue;
        if (!chats.has(chatId)) { recipients.push({ linkId: doc.id, chatId, text: "READY", document: "READY" }); chats.add(chatId); }
      }
      if (!recipients.length) { tx.create(eventRef, { ...base, status: "SKIPPED", reason: "CLIENT_WITHOUT_AUTHORIZED_RECIPIENTS", recipients: [], sentCount: 0 }); return { reason: "client_without_telegram_recipients" }; }
    }
    if (!Array.isArray(recipients) || !recipients.length || recipients.length > MAX_NOTIFICATION_RECIPIENTS || anyPost(recipients)) return hold("DELIVERY_EVIDENCE_INVALID");
    tx.set(eventRef, { ...base, status: "PENDING", reason: "CLAIMED", attemptId, attempt, leaseUntilMs: Date.now() + CLAIM_MS, recipients, sentCount: 0, createdAt: existing?.createdAt || FieldValue.serverTimestamp() }, { merge: true });
    return { upload: scope.upload, recipients };
  });
  if (!("upload" in claim) || !claim.upload || !claim.recipients) return notificationResult(claim.reason || "not_claimed", "sentCount" in claim ? Number(claim.sentCount) : 0);
  const upload = claim.upload, recipients = claim.recipients;
  const finish = async (status: string, reason: string) => db.runTransaction(async tx => {
    const row = (await tx.get(eventRef)).data();
    if (row?.attemptId !== attemptId || row.status !== "PENDING") return;
    const currentRecipients: DeliveryRecipient[] = row.recipients;
    const sentCount = completeRecipients(currentRecipients);
    tx.update(eventRef, { status, reason, sentCount, reviewRequired: ["UNKNOWN", "PARTIAL_UNKNOWN", "NEEDS_REVIEW"].includes(status), updatedAt: FieldValue.serverTimestamp(), ...(status === "SENT" ? { sentAt: FieldValue.serverTimestamp() } : {}) });
    if (status === "SENT") logActivityTx(tx, db, { event: "TELEGRAM_COMPROBANTE_DISPERSION_CLIENTE_ENVIADO", rootId, actorUid: "system", actorRole: "system", entityType: "clientDispersions", entityId: dispersionId, referenceId: dispersionId, referenceType: "telegramDispersionComprobante", description: "Comprobante de dispersion enviado al cliente por Telegram", extra: { clientId, uploadId: cleanUploadId, sentCount } });
  });
  let buffer: Buffer;
  try { buffer = await readPinnedNotificationFile(upload); }
  catch { await finish("PRE_SEND_FAILED", "OBJECT_READ_FAILED_BEFORE_POST"); return notificationResult("pre_send_failed"); }
  const message = "PAY0 comprobante disponible\n\n" + `Comprobante de dispersion ${cleanText(upload.dispersionFolio || dispersionId)} para ${cleanText(upload.clienteNombre || upload.clientName || "Cliente")} por un total de ${formatMoney(toMoney(upload.amount))}.\n` + `Beneficiario: ${cleanText(upload.beneficiaryNombre || "Beneficiario")}\n\nArchivo enviado directo por Telegram.`;
  for (let index = 0; index < recipients.length; index++) {
    for (const stage of ["text", "document"] as const) {
      try {
        await db.runTransaction(async tx => {
          const row = (await tx.get(eventRef)).data();
          if (row?.attemptId !== attemptId || row.status !== "PENDING" || row.leaseUntilMs <= Date.now() || Date.now() >= invocationDeadline) throw Error("CLAIM_LOST");
          const scope = await notificationScope(tx, cleanUploadId, upload);
          if (scope.userFunded || scope.clientId !== clientId) throw Error("SCOPE_CHANGED");
          const recipient = row.recipients[index] as DeliveryRecipient;
          const link = (await tx.get(db.doc(`clientTelegramUsers/${recipient.linkId}`))).data();
          if (!link || link.active !== true || link.rootId !== rootId || link.clientId !== clientId || cleanText(link.chatId) !== recipient.chatId) throw Error("RECIPIENT_REVOKED");
          if (recipient[stage] !== "READY") throw Error("STAGE_ALREADY_STARTED");
          const next = row.recipients.map((r: DeliveryRecipient, i: number) => i === index ? { ...r, [stage]: "IN_FLIGHT" } : r);
          tx.update(eventRef, { recipients: next, leaseUntilMs: Date.now() + CLAIM_MS, updatedAt: FieldValue.serverTimestamp() });
        });
      } catch { await finish("NEEDS_REVIEW", "AUTHORITY_OR_CLAIM_CHANGED_BEFORE_POST"); return notificationResult("delivery_review_required", completeRecipients(recipients)); }
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let result: any;
        try {
          const send = stage === "text" ? sendTelegramMessage(botToken, recipients[index].chatId, message)
            : sendTelegramDocumentBuffer(botToken, recipients[index].chatId, cleanText(upload.originalName || upload.filename || "comprobante"), buffer, upload.contentType, "Comprobante");
          result = await Promise.race([send, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("DELIVERY_TIMEOUT")), Math.min(15_000, Math.max(1, invocationDeadline - Date.now()))); })]);
        } finally { if (timer) clearTimeout(timer); }
        // Timeout cannot abort the existing shared sender. Persist UNKNOWN and never resend;
        // a late external success does not turn the uncertain stage into safe retry.
        if (result?.ok !== true) throw Error("DELIVERY_NOT_CONFIRMED");
        await db.runTransaction(async tx => {
          const row = (await tx.get(eventRef)).data();
          if (row?.attemptId !== attemptId || row.status !== "PENDING" || row.recipients[index][stage] !== "IN_FLIGHT") throw Error("CLAIM_LOST_AFTER_POST");
          const next = row.recipients.map((r: DeliveryRecipient, i: number) => i === index ? { ...r, [stage]: "SENT" } : r);
          tx.update(eventRef, { recipients: next, sentCount: completeRecipients(next), updatedAt: FieldValue.serverTimestamp() });
        });
        recipients[index][stage] = "SENT";
      } catch {
        // Includes transport failures, unstructured Telegram errors and failed receipt writes.
        // Never log exception strings: they can contain tokens or Telegram response payloads.
        await finish(anyPost(recipients) ? "PARTIAL_UNKNOWN" : "UNKNOWN", "DELIVERY_UNCERTAIN");
        return notificationResult("delivery_unknown", completeRecipients(recipients));
      }
    }
  }
  await finish("SENT", "SENT");
  return notificationResult("sent", recipients.length);
}
