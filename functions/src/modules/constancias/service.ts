import * as admin from "firebase-admin";
import { createHash, randomBytes } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity, logActivityTx } from "../../utils/logActivity";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { finalizeSolicitudDocumentVersionTx } from "../solicitudDocuments/lifecycle";
import { linkSolicitudToMaterialityOperationCore } from "../materiality/service";
import { renderCanonicalConstanciaPdf } from "../documents/canonicalPdf";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

function clean(value: unknown, max = 500): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function normalizeRfc(value: unknown): string {
  return clean(value, 13).toUpperCase().replace(/[^A-Z0-9Ñ&]/g, "");
}

function canonicalSlug(value: unknown): string {
  return clean(value, 180).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function role(user: any): string {
  return String(getUserRole(user) || "").toLowerCase();
}

function username(user: any, uid: string): string {
  return clean(user?.username || user?.displayName || user?.email || uid, 180);
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

function resolveConstanciaKind(solicitud: any): "CONSTANCIA_ENTREGA_BIENES" | "CONSTANCIA_SERVICIO" {
  const text = [
    solicitud?.operationTypeName,
    solicitud?.tipoOperacion,
    solicitud?.concepto,
    solicitud?.descripcion,
  ].map((value) => clean(value, 200).toUpperCase()).join(" ");

  if (/\b(BIEN|BIENES|PRODUCTO|MATERIAL|EQUIPO|INSUMO|SUMINISTRO|ENTREGA)\b/.test(text)) {
    return "CONSTANCIA_ENTREGA_BIENES";
  }

  return "CONSTANCIA_SERVICIO";
}

async function findActiveUpload(solicitudId: string, documentTypes: string[]): Promise<any | null> {
  for (const documentType of documentTypes) {
    const snap = await db.collection("uploads")
      .where("solicitudId", "==", solicitudId)
      .where("documentType", "==", documentType)
      .where("active", "==", true)
      .limit(1)
      .get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      return { id: doc.id, ...(doc.data() || {}) };
    }
  }
  return null;
}

export async function generateConstanciaRecepcionForSolicitudCore(request: {
  auth?: any;
  data: { solicitudId?: unknown; signatureUploadId?: unknown; source?: unknown };
}) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, {
    allowedRoles: ["superadmin", "admin", "operador"],
    requiredModule: "solicitudes",
    requiredAction: "uploadDocs",
  });

  const rootId = clean(user?.rootId || uid, 128);
  const solicitudId = clean(request.data?.solicitudId, 128);
  if (!solicitudId) throw new HttpsError("invalid-argument", "solicitudId requerido.");

  const solicitudRef = db.collection("solicitudes").doc(solicitudId);
  const solicitudSnap = await solicitudRef.get();
  if (!solicitudSnap.exists) throw new HttpsError("not-found", "Solicitud no existe.");
  const solicitud: any = solicitudSnap.data() || {};
  if (!canAccessSolicitud(user, uid, rootId, solicitud)) throw new HttpsError("permission-denied", "No autorizado.");

  const companyId = clean(solicitud.companyId || solicitud.empresaId, 128);
  const clientId = clean(solicitud.clienteId || solicitud.clientId, 128);
  const [companySnap, clientSnap] = await Promise.all([
    companyId ? db.collection("companies").doc(companyId).get() : Promise.resolve(null),
    clientId ? db.collection("clients").doc(clientId).get() : Promise.resolve(null),
  ]);
  const company: any = companySnap?.exists ? companySnap.data() || {} : {};
  const client: any = clientSnap?.exists ? clientSnap.data() || {} : {};
  const companyRfc = normalizeRfc(company.rfc || solicitud.companyRfc || solicitud.empresaRfc);

  if (!companySnap?.exists || !companyRfc) {
    throw new HttpsError("failed-precondition", "La empresa de la solicitud no tiene RFC o catalogo empresarial valido.");
  }
  const companyName = clean(company.nombre || company.razonSocial || solicitud.empresaNombre || solicitud.companyName, 180);
  const companySlug = canonicalSlug(companyName || companyRfc);

  const signatureUploadId = clean(request.data?.signatureUploadId, 128);
  const signatureUpload = signatureUploadId
    ? { id: signatureUploadId, ...((await db.collection("uploads").doc(signatureUploadId).get()).data() || {}) }
    : await findActiveUpload(solicitudId, ["FIRMA_AUTORIZADA_CLIENTE"]);

  if (!signatureUpload?.id || signatureUpload?.documentType !== "FIRMA_AUTORIZADA_CLIENTE") {
    throw new HttpsError("failed-precondition", "La constancia requiere firma autorizada del cliente.");
  }

  let signaturePng: Buffer | null = null;
  try {
    const [downloaded] = await admin.storage().bucket().file(String((signatureUpload as any).storagePath || "")).download();
    signaturePng = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded);
  } catch {
    throw new HttpsError("failed-precondition", "No se pudo leer la firma autorizada para integrar la constancia.");
  }

  const constanciaKind = resolveConstanciaKind(solicitud);
  const constanciaTemplate = {
    documentType: "CONSTANCIA_RECEPCION_SATISFACCION",
    templateType: constanciaKind,
    templateId: constanciaKind === "CONSTANCIA_ENTREGA_BIENES"
      ? `${companySlug}-constancia-entrega-v1.1`
      : `${companySlug}-constancia-servicio-v1.1`,
    templateVersion: "1.1",
    companyId: companyId || companySlug,
    companyName,
    companyRfc,
    templateSource: "src/canonicos/formatos/CONSTANCIAS/PAY0_CONSTANCIAS_CANONICAS_REGENERADAS_FINAL",
    templateEngine: "PAY0_COMPANY_CANONICAL_V1_1",
  };

  const cotizacion = await findActiveUpload(solicitudId, ["COTIZACION_FIRMADA", "COTIZACION"]);
  const factura = await findActiveUpload(solicitudId, ["FACTURA_XML", "FACTURA_PDF"]);
  const folio = `CONST-${clean(solicitud.folio || solicitudId, 80)}`;
  const clienteNombre = clean(solicitud.ocClientName || solicitud.clienteNombre || solicitud.clientName || client.nombre || client.name || "Cliente", 180);
  // The CSF canonical profile belongs to the client catalogue. Solicitudes can
  // carry a legacy partial snapshot, so use it only before the verified profile.
  const clienteRfc = normalizeRfc(solicitud.ocClientRfc || solicitud.clienteRfc || solicitud.clientRfc || client.rfc || client.fiscalProfile?.rfc) || "PENDIENTE";
  const receptorNombre = clean((signatureUpload as any).createdUsername || solicitud.receptorNombre || clienteNombre, 180);
  const publicVerificationToken = randomBytes(24).toString("base64url");
  const verificationUrl = `https://pay-0-system.web.app/verificar/constancia/${publicVerificationToken}`;
  const cfdi = clean(solicitud.cfdiUuid || solicitud.uuidCfdi || solicitud.facturaUuid || factura?.cfdiUuid || factura?.uuid || "PENDIENTE", 180);

  const pdf = await renderCanonicalConstanciaPdf({
    folio,
    kind: constanciaKind,
    companyName,
    companyRfc,
    clientName: clienteNombre,
    clientRfc: clienteRfc,
    solicitudFolio: clean(solicitud.folio || solicitudId, 120),
    reference: clean(solicitud.ordenCompraFolio || solicitud.ocReferencia || solicitud.folio || solicitudId, 180),
    cotizacion: clean(cotizacion?.quotationSnapshot?.folio || cotizacion?.filename || cotizacion?.id || "PENDIENTE", 180),
    cfdi,
    description: clean(solicitud.ocConceptDescription || solicitud.ordenCompraConcepto || solicitud.operationTypeName || solicitud.tipoOperacion || solicitud.concepto || solicitud.descripcion || "Concepto segun Orden de Compra", 500),
    receptorName: receptorNombre,
    receptorRole: clean((signatureUpload as any)?.signatureCapture?.signerRole || "", 120),
    signatureHash: clean((signatureUpload as any).sha256 || "PENDIENTE", 120),
    signaturePng,
    iqFolio: clean(solicitud.iqFolio || solicitud.iqId || "", 120),
    verificationUrl,
    items: Array.isArray(solicitud.ocItems) ? solicitud.ocItems : [],
  });
  const documentSha256 = sha256(pdf);
  const uploadId = db.collection("uploads").doc().id;
  const filename = `${folio}.pdf`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
  const storagePath = `roots/${rootId}/solicitudes/${solicitudId}/docs/CONSTANCIA_RECEPCION_SATISFACCION/${uploadId}-${filename}`;

  await admin.storage().bucket().file(storagePath).save(pdf, {
    contentType: "application/pdf",
    resumable: false,
    metadata: {
      metadata: {
        uploadid: uploadId,
        sha256: documentSha256,
        integrityHashAlgorithm: "SHA-256",
        integritySealVersion: "PAY0-MATERIALIDAD-V1",
        templateId: constanciaTemplate.templateId,
        templateVersion: constanciaTemplate.templateVersion,
        signatureUploadId: signatureUpload.id,
      },
    },
  });

  const uploadRef = db.collection("uploads").doc(uploadId);
  await uploadRef.set({
    rootId,
    adminId: solicitud.adminId || rootId,
    clienteId: solicitud.clienteId || solicitud.clientId || null,
    clienteNombre: clienteNombre || null,
    companyId: solicitud.companyId || null,
    empresaNombre: solicitud.empresaNombre || solicitud.companyName || companyName,
    entityType: "solicitudes",
    entityId: solicitudId,
    solicitudId,
    solicitudFolio: solicitud.folio || null,
    documentType: "CONSTANCIA_RECEPCION_SATISFACCION",
    documentTypeLabel: "Constancia de Recepcion y Satisfaccion",
    originalName: filename,
    filename,
    contentType: "application/pdf",
    sizeBytes: pdf.length,
    storagePath,
    sha256: documentSha256,
    integrityHashAlgorithm: "SHA-256",
    integritySealStatus: "HASH_SERVER_GENERATED",
    integritySealVersion: "PAY0-MATERIALIDAD-V1",
    generatedBySystem: true,
    generatedByModule: "constancias",
    constanciaTemplate,
    constanciaSnapshot: {
      folio,
      constanciaKind,
      signatureUploadId: signatureUpload.id,
      signatureSha256: (signatureUpload as any).sha256 || null,
      cotizacionUploadId: cotizacion?.id || null,
      facturaUploadId: factura?.id || null,
      noReclamoPolicyVersion: "PAY0-NO-RECLAMO-V1",
      documentSha256,
      cfdi,
    },
    publicVerificationToken,
    publicVerificationUrl: verificationUrl,
    status: "PENDING",
    active: false,
    version: null,
    createdBy: uid,
    createdUsername: username(user, uid),
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
      documentType: "CONSTANCIA_RECEPCION_SATISFACCION",
      uploadId,
      uploadRef,
      mode: "update",
      readyPatch: {
        finalizedBy: uid,
        finalizedUsername: username(user, uid),
        finalizedAt: FieldValue.serverTimestamp(),
        integritySealStatus: "SEALED",
        integritySealedAt: FieldValue.serverTimestamp(),
        integritySealedBy: uid,
        integritySealedUsername: username(user, uid),
      },
    });

    logActivityTx(tx, db, {
      event: "CONSTANCIA_RECEPCION_GENERADA",
      rootId,
      adminId: solicitud.adminId || rootId,
      actorUid: uid,
      actorUsername: username(user, uid),
      actorRole: role(user),
      entityType: "solicitudes",
      entityId: solicitudId,
      referenceId: solicitudId,
      referenceFolio: solicitud.folio || solicitudId,
      referenceType: "solicitudDocument",
      description: `Constancia de recepcion y satisfaccion generada para solicitud ${solicitud.folio || solicitudId}.`,
      createdBy: uid,
      extra: {
        source: "constancias",
        documentType: "CONSTANCIA_RECEPCION_SATISFACCION",
        uploadId,
        storagePath,
        signatureUploadId: signatureUpload.id,
        templateId: constanciaTemplate.templateId,
        templateVersion: constanciaTemplate.templateVersion,
        documentSha256,
      },
    });
  });

  await linkSolicitudToMaterialityOperationCore({
    auth: request.auth,
    data: { solicitudId },
  }).catch(async (error) => {
    await solicitudRef.set({
      materialitySyncStatus: "ERROR",
      materialitySyncLastError: String(error?.message || error || "No se pudo actualizar Materialidad."),
      materialitySyncUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  await logActivity({
    event: "DOCUMENTO_SOLICITUD_SUBIDO",
    rootId,
    adminId: solicitud.adminId || rootId,
    actorUid: uid,
    actorUsername: username(user, uid),
    actorRole: role(user),
    entityType: "solicitudes",
    entityId: solicitudId,
    referenceId: solicitudId,
    referenceFolio: solicitud.folio || solicitudId,
    referenceType: "solicitudDocument",
    description: `Documento Constancia de Recepcion y Satisfaccion generado y registrado en solicitud ${solicitud.folio || solicitudId}.`,
    createdBy: uid,
    extra: {
      source: "constancias",
      documentType: "CONSTANCIA_RECEPCION_SATISFACCION",
      uploadId,
      templateId: constanciaTemplate.templateId,
      documentSha256,
    },
  });

  return {
    ok: true,
    uploadId,
    storagePath,
    status: "READY",
    active: true,
    version: finalVersion,
    sizeBytes: pdf.length,
    sha256: documentSha256,
    templateId: constanciaTemplate.templateId,
  };
}

/** Token-scoped public validation. It exposes document integrity only, never the PAY0 dossier. */
export const getPublicConstanciaVerification = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const token = clean(request.data?.token, 120);
    if (!/^[A-Za-z0-9_-]{24,120}$/.test(token)) return { valid: false };
    const match = await db.collection("uploads").where("publicVerificationToken", "==", token).limit(1).get();
    if (match.empty) return { valid: false };
    const upload: any = match.docs[0].data() || {};
    if (
      upload.documentType !== "CONSTANCIA_RECEPCION_SATISFACCION" ||
      upload.integritySealStatus !== "SEALED" ||
      upload.active !== true
    ) return { valid: false };
    const snapshot: any = upload.constanciaSnapshot || {};
    return {
      valid: true,
      folio: clean(snapshot.folio || upload.originalName || "Constancia", 120),
      companyName: clean(upload.constanciaTemplate?.companyName || upload.empresaNombre, 180),
      clientName: clean(upload.clienteNombre, 180),
      cfdi: clean(snapshot.cfdi, 180),
      sha256: clean(upload.sha256 || snapshot.documentSha256, 100),
      active: upload.active === true,
      createdAt: upload.createdAt?.toDate?.()?.toISOString?.() || null,
    };
  },
);
