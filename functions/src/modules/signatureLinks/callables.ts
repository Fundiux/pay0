import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { randomBytes, createHash } from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { finalizeSolicitudDocumentVersionTx } from "../solicitudDocuments/lifecycle";
import { generateConstanciaRecepcionForSolicitudCore } from "../constancias/service";
import { receiptAcceptance } from "./acceptance";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
function clean(value: unknown, max = 500): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function username(user: any, uid: string): string {
  return clean(user?.username || user?.displayName || user?.email || uid, 180);
}

function role(user: any): string {
  return String(getUserRole(user) || "").toLowerCase();
}

function canAccessSolicitud(user: any, uid: string, rootId: string, solicitud: any): boolean {
  const r = role(user);
  if (r === "superadmin") return clean(solicitud?.rootId, 128) === rootId;
  if (r === "admin") return clean(solicitud?.rootId, 128) === rootId && clean(solicitud?.adminId, 128) === uid;
  if (r === "operador") return clean(solicitud?.rootId, 128) === rootId && clean(solicitud?.createdBy, 128) === uid;
  return false;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function decodePngDataUrl(input: unknown): Promise<Buffer> {
  const value = String(input || "");
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new HttpsError("invalid-argument", "Firma PNG invalida.");
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw new HttpsError("invalid-argument", "Firma PNG invalida.");
  if (buffer.length < 500) throw new HttpsError("invalid-argument", "Firma vacia o invalida.");
  if (buffer.length > 1024 * 1024) throw new HttpsError("invalid-argument", "La firma excede 1 MB.");
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (width < 16 || height < 16 || width > 4096 || height > 4096)
    throw new HttpsError("invalid-argument", "Dimensiones de firma inválidas.");
  try {
    const { PDFDocument } = await import("pdf-lib");
    const document = await PDFDocument.create();
    await document.embedPng(buffer);
  } catch {
    throw new HttpsError("invalid-argument", "El archivo no contiene una imagen PNG válida.");
  }
  return buffer;
}

async function recoverAbandonedReservation(ref: FirebaseFirestore.DocumentReference) {
  await db.runTransaction(async tx => {
    const row = (await tx.get(ref)).data();
    if (row?.status !== "PROCESSING" || Number(row.processingAt?.toMillis?.() || 0) > Date.now() - 120_000) return;
    const upload = row.uploadId ? (await tx.get(db.collection("uploads").doc(row.uploadId))).data() : null;
    if (upload?.status === "READY" || upload?.active === true) return;
    tx.update(ref, { status: "PENDING", uploadId: FieldValue.delete(), processingAt: FieldValue.delete() });
  });
}

export const createSolicitudSignatureLink = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const user = await getMyUser(uid);
    assertAuthorized(request.auth, user, {
      allowedRoles: ["superadmin", "admin", "operador"],
      requiredModule: "solicitudes",
      requiredAction: "uploadDocs",
    });

    const solicitudId = clean(request.data?.solicitudId, 128);
    if (!solicitudId) throw new HttpsError("invalid-argument", "solicitudId requerido.");

    const rootId = clean(user?.rootId || uid, 128);
    const solicitudSnap = await db.collection("solicitudes").doc(solicitudId).get();
    if (!solicitudSnap.exists) throw new HttpsError("not-found", "Solicitud no existe.");
    const solicitud: any = solicitudSnap.data() || {};
    if (!canAccessSolicitud(user, uid, rootId, solicitud)) throw new HttpsError("permission-denied", "No autorizado.");

    const token = randomBytes(32).toString("base64url");
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 1000 * 60 * 60 * 24 * 7);

    await db.collection("signatureRequests").doc(token).set({
      rootId,
      solicitudId,
      solicitudFolio: solicitud.folio || null,
      clienteId: solicitud.clienteId || solicitud.clientId || null,
      clienteNombre: solicitud.clienteNombre || solicitud.clientName || null,
      companyId: solicitud.companyId || null,
      status: "PENDING",
      createdBy: uid,
      createdUsername: username(user, uid),
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      usedAt: null,
    });

    const origin = clean(request.data?.origin, 240);
    const path = `/firma/${encodeURIComponent(token)}`;
    return {
      ok: true,
      token,
      expiresAtMillis: expiresAt.toMillis(),
      url: origin ? `${origin.replace(/\/$/, "")}${path}` : path,
    };
  },
);

export const getSolicitudSignatureRequest = onCall(
  { cors: true, timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const token = clean(request.data?.token, 160);
    if (!/^[A-Za-z0-9_-]{24,160}$/.test(token)) throw new HttpsError("not-found", "Link de firma inválido.");
    const ref = db.collection("signatureRequests").doc(token);
    await recoverAbandonedReservation(ref);
    const snap = await ref.get();
    if (!snap?.exists) throw new HttpsError("not-found", "Link de firma invalido.");
    const row: any = snap.data() || {};
    if (row.status !== "PENDING") throw new HttpsError("failed-precondition", "Este link ya fue usado o cancelado.");
    if (Number(row.expiresAt?.toMillis?.() || 0) < Date.now()) throw new HttpsError("deadline-exceeded", "Este link ya expiro.");

    return {
      ok: true,
      solicitudFolio: row.solicitudFolio || null,
      clienteNombre: row.clienteNombre || null,
      expiresAtMillis: Number(row.expiresAt?.toMillis?.() || 0),
    };
  },
);

export const submitSolicitudSignature = onCall(
  { cors: true, timeoutSeconds: 90, memory: "1GiB" },
  async (request) => {
    const token = clean(request.data?.token, 160);
    if (!/^[A-Za-z0-9_-]{24,160}$/.test(token)) throw new HttpsError("invalid-argument", "Link de firma inválido.");
    const acceptance = receiptAcceptance(request.data);
    const { signerName, signerRole } = acceptance;
    const png = await decodePngDataUrl(request.data?.signatureDataUrl);

    if (!signerName) throw new HttpsError("invalid-argument", "Nombre de quien firma requerido.");

    const tokenRef = db.collection("signatureRequests").doc(token);
    await recoverAbandonedReservation(tokenRef);
    const tokenSnap = await tokenRef.get();
    if (!tokenSnap.exists) throw new HttpsError("not-found", "Link de firma invalido.");
    const tokenRow: any = tokenSnap.data() || {};
    if (tokenRow.status !== "PENDING") throw new HttpsError("failed-precondition", "Este link ya fue usado o cancelado.");
    if (Number(tokenRow.expiresAt?.toMillis?.() || 0) < Date.now()) throw new HttpsError("deadline-exceeded", "Este link ya expiro.");

    const solicitudId = clean(tokenRow.solicitudId, 128);
    const rootId = clean(tokenRow.rootId, 128);
    const actorUid = clean(tokenRow.createdBy, 128);
    const actorUser = await getMyUser(actorUid);
    assertAuthorized({ uid: actorUid }, actorUser, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "uploadDocs" });
    const solicitudSnap = await db.collection("solicitudes").doc(solicitudId).get();
    if (!solicitudSnap.exists) throw new HttpsError("not-found", "Solicitud no existe.");
    const solicitud: any = solicitudSnap.data() || {};
    if (clean(actorUser.rootId || actorUid, 128) !== rootId || !canAccessSolicitud(actorUser, actorUid, rootId, solicitud) ||
        clean(tokenRow.clienteId, 128) !== clean(solicitud.clienteId || solicitud.clientId, 128) ||
        clean(tokenRow.companyId, 128) !== clean(solicitud.companyId, 128)) throw new HttpsError("permission-denied", "El expediente cambió de ámbito. Solicita un nuevo enlace.");
    if (["CANCELADA", "CANCELADO", "RECHAZADA", "RECHAZADO", "ELIMINADA"].includes(clean(solicitud.status).toUpperCase()))
      throw new HttpsError("failed-precondition", "La solicitud ya no admite firma.");

    const documentSha256 = sha256(png);
    const uploadId = db.collection("uploads").doc().id;
    const filename = `firma-recepcion-${clean(solicitud.folio || solicitudId, 80)}.png`.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `roots/${rootId}/solicitudes/${solicitudId}/docs/FIRMA_AUTORIZADA_CLIENTE/${uploadId}-${filename}`;
    // Reserve the one-time token before writing evidence. Concurrent requests
    // cannot publish two signatures or overwrite the first acceptance.
    await db.runTransaction(async tx => {
      const current = (await tx.get(tokenRef)).data();
      if (current?.status !== "PENDING" || Number(current?.expiresAt?.toMillis?.() || 0) < Date.now())
        throw new HttpsError("failed-precondition", "Este enlace ya fue utilizado o está siendo procesado.");
      if (current.rootId !== rootId || current.solicitudId !== solicitudId || current.createdBy !== actorUid ||
          current.clienteId !== tokenRow.clienteId || current.companyId !== tokenRow.companyId)
        throw new HttpsError("permission-denied", "El enlace cambió de ámbito.");
      tx.update(tokenRef, { status: "PROCESSING", uploadId, processingAt: FieldValue.serverTimestamp() });
    });

    let finalVersion = 1;
    try {
    await admin.storage().bucket().file(storagePath).save(png, {
      contentType: "image/png",
      resumable: false,
      metadata: {
        metadata: {
          uploadid: uploadId,
          sha256: documentSha256,
          integrityHashAlgorithm: "SHA-256",
          integritySealVersion: "PAY0-MATERIALIDAD-V1",
        },
      },
    });

    const uploadRef = db.collection("uploads").doc(uploadId);
    await uploadRef.set({
      rootId,
      adminId: solicitud.adminId || rootId,
      clienteId: solicitud.clienteId || solicitud.clientId || tokenRow.clienteId || null,
      clienteNombre: solicitud.clienteNombre || solicitud.clientName || tokenRow.clienteNombre || null,
      companyId: solicitud.companyId || null,
      empresaNombre: solicitud.empresaNombre || solicitud.companyName || null,
      entityType: "solicitudes",
      entityId: solicitudId,
      solicitudId,
      solicitudFolio: solicitud.folio || null,
      documentType: "FIRMA_AUTORIZADA_CLIENTE",
      documentTypeLabel: "Firma Autorizada del Cliente",
      originalName: filename,
      filename,
      contentType: "image/png",
      sizeBytes: png.length,
      storagePath,
      sha256: documentSha256,
      integrityHashAlgorithm: "SHA-256",
      integritySealStatus: "HASH_SERVER_GENERATED",
      integritySealVersion: "PAY0-MATERIALIDAD-V1",
      signatureCapture: {
        source: "PUBLIC_LINK",
        ...acceptance,
        acceptanceSha256: sha256(Buffer.from(JSON.stringify(acceptance), "utf8")),
        observedIp: clean(request.rawRequest?.ip, 80) || null,
        userAgent: clean(request.rawRequest?.get?.("user-agent"), 300) || null,
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
      const currentSolicitud = (await tx.get(solicitudSnap.ref)).data();
      const currentActor = (await tx.get(db.collection("users").doc(actorUid))).data();
      assertAuthorized({ uid: actorUid }, currentActor, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "uploadDocs" });
      if (current?.status !== "PROCESSING" || current.uploadId !== uploadId)
        throw new HttpsError("failed-precondition", "La reserva de firma cambió.");
      if (!currentSolicitud || clean(currentActor?.rootId || actorUid, 128) !== rootId || !canAccessSolicitud(currentActor, actorUid, rootId, currentSolicitud) ||
          currentSolicitud.companyId !== tokenRow.companyId || (currentSolicitud.clienteId || currentSolicitud.clientId) !== tokenRow.clienteId ||
          ["CANCELADA", "CANCELADO", "RECHAZADA", "RECHAZADO", "ELIMINADA"].includes(clean(currentSolicitud.status).toUpperCase()))
        throw new HttpsError("failed-precondition", "La solicitud cambió mientras se registraba la firma.");
      finalVersion = await finalizeSolicitudDocumentVersionTx({
        tx,
        db,
        rootId,
        solicitudId,
        documentType: "FIRMA_AUTORIZADA_CLIENTE",
        uploadId,
        uploadRef,
        mode: "update",
        readyPatch: {
          finalizedBy: actorUid,
          finalizedUsername: signerName,
          finalizedAt: FieldValue.serverTimestamp(),
          integritySealStatus: "SEALED",
          integritySealedAt: FieldValue.serverTimestamp(),
          integritySealedBy: actorUid,
          integritySealedUsername: signerName,
        },
      });
      tx.update(tokenRef, {
        status: "SIGNED",
        usedAt: FieldValue.serverTimestamp(),
        uploadId,
        signerName,
        signerRole: signerRole || null,
        receiptLocation: acceptance.receiptLocation,
        receiptAddress: acceptance.receiptAddress,
        observations: acceptance.observations,
        acceptanceVersion: acceptance.acceptanceVersion,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    } catch (error) {
      // A failed unpublished attempt may retry; a sealed signature is never reset.
      await db.runTransaction(async tx => {
        const current = (await tx.get(tokenRef)).data();
        if (current?.status === "PROCESSING" && current.uploadId === uploadId)
          tx.update(tokenRef, { status: "PENDING", uploadId: FieldValue.delete(), processingAt: FieldValue.delete() });
      });
      throw error;
    }

    let constanciaPending = false;
    await generateConstanciaRecepcionForSolicitudCore({
      auth: { uid: actorUid },
      data: { solicitudId, signatureUploadId: uploadId, source: "PUBLIC_SIGNATURE_LINK" },
    }).catch(async () => {
      constanciaPending = true;
      await solicitudSnap.ref.update({ constanciaAutoGenerateStatus: "ERROR",
        constanciaAutoGenerateLastError: "La firma está guardada. Reintenta generar la constancia desde Documentos.",
        constanciaAutoGenerateUpdatedAt: FieldValue.serverTimestamp() });
    });

    await logActivity({
      event: "DOCUMENTO_SOLICITUD_SUBIDO",
      rootId,
      adminId: solicitud.adminId || rootId,
      actorUid,
      actorUsername: username(actorUser, actorUid),
      actorRole: role(actorUser),
      entityType: "solicitudes",
      entityId: solicitudId,
      referenceId: solicitudId,
      referenceFolio: solicitud.folio || solicitudId,
      referenceType: "solicitudDocument",
      description: `Firma de recepcion capturada por link publico para solicitud ${solicitud.folio || solicitudId}.`,
      createdBy: actorUid,
      extra: { source: "signatureLinks", uploadId, signerName, signerRole: signerRole || null },
    });

    return { ok: true, uploadId, version: finalVersion, constanciaPending };
  },
);
