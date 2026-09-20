import * as admin from "firebase-admin";
import { randomBytes, createHash } from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { finalizeSolicitudDocumentVersionTx } from "../solicitudDocuments/lifecycle";
import { generateConstanciaRecepcionForSolicitudCore } from "../constancias/service";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

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
  if (r === "superadmin") return clean(solicitud?.rootId, 128) === rootId || clean(solicitud?.createdBy, 128) === uid;
  if (r === "admin") return clean(solicitud?.rootId, 128) === rootId && clean(solicitud?.adminId, 128) === uid;
  if (r === "operador") return clean(solicitud?.rootId, 128) === rootId && clean(solicitud?.createdBy, 128) === uid;
  return false;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function decodePngDataUrl(input: unknown): Buffer {
  const value = String(input || "");
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new HttpsError("invalid-argument", "Firma PNG invalida.");
  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length < 500) throw new HttpsError("invalid-argument", "Firma vacia o invalida.");
  if (buffer.length > 1024 * 1024) throw new HttpsError("invalid-argument", "La firma excede 1 MB.");
  return buffer;
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
    const snap = token ? await db.collection("signatureRequests").doc(token).get() : null;
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
  { cors: true, timeoutSeconds: 60, memory: "512MiB" },
  async (request) => {
    const token = clean(request.data?.token, 160);
    const signerName = clean(request.data?.signerName, 180);
    const signerRole = clean(request.data?.signerRole, 120);
    const png = decodePngDataUrl(request.data?.signatureDataUrl);

    if (!signerName) throw new HttpsError("invalid-argument", "Nombre de quien firma requerido.");

    const tokenRef = db.collection("signatureRequests").doc(token);
    const tokenSnap = await tokenRef.get();
    if (!tokenSnap.exists) throw new HttpsError("not-found", "Link de firma invalido.");
    const tokenRow: any = tokenSnap.data() || {};
    if (tokenRow.status !== "PENDING") throw new HttpsError("failed-precondition", "Este link ya fue usado o cancelado.");
    if (Number(tokenRow.expiresAt?.toMillis?.() || 0) < Date.now()) throw new HttpsError("deadline-exceeded", "Este link ya expiro.");

    const solicitudId = clean(tokenRow.solicitudId, 128);
    const rootId = clean(tokenRow.rootId, 128);
    const actorUid = clean(tokenRow.createdBy, 128);
    const actorUser = await getMyUser(actorUid);
    const solicitudSnap = await db.collection("solicitudes").doc(solicitudId).get();
    if (!solicitudSnap.exists) throw new HttpsError("not-found", "Solicitud no existe.");
    const solicitud: any = solicitudSnap.data() || {};

    const documentSha256 = sha256(png);
    const uploadId = db.collection("uploads").doc().id;
    const filename = `firma-recepcion-${clean(solicitud.folio || solicitudId, 80)}.png`.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `roots/${rootId}/solicitudes/${solicitudId}/docs/FIRMA_AUTORIZADA_CLIENTE/${uploadId}-${filename}`;

    await admin.storage().bucket().file(storagePath).save(png, {
      contentType: "image/png",
      resumable: false,
      metadata: {
        metadata: {
          uploadid: uploadId,
          sha256: documentSha256,
          integrityHashAlgorithm: "SHA-256",
          integritySealVersion: "PAY0-MATERIALIDAD-V1",
          signatureToken: token,
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
        token,
        signerName,
        signerRole: signerRole || null,
        acceptedNoClaimPolicy: request.data?.acceptedNoClaimPolicy === true,
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

    let finalVersion = 1;
    await db.runTransaction(async (tx) => {
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
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    await generateConstanciaRecepcionForSolicitudCore({
      auth: { uid: actorUid },
      data: { solicitudId, signatureUploadId: uploadId, source: "PUBLIC_SIGNATURE_LINK" },
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

    return { ok: true, uploadId, version: finalVersion };
  },
);
