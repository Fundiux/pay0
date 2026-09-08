import * as admin from "firebase-admin";
import { logActivity, logActivityTx } from "../../utils/logActivity";
import { HttpsError } from "firebase-functions/v2/https";
import { MAX_SOLICITUD_DOCUMENT_SIZE_BYTES, buildSolicitudDocumentStoragePath, getSolicitudDocumentTypeLabel, normalizeSolicitudDocumentType, sanitizeDocumentLabel, sanitizeFilename } from "./domain";
import { enqueueIqCreationForSolicitud } from "../iq/solicitudCreateQueueCallables";
import { finalizeSolicitudDocumentVersionTx } from "./lifecycle";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
function isSolicitudIqTerminalForReplacementH4D58H(solicitud: Record<string, unknown>): boolean {
  if (solicitud.iqTerminalLocked === true) return true;
  if (solicitud.iqSolicitudTerminalLocked === true) return true;

  const text = [
    solicitud.status,
    solicitud.iqStatus,
    solicitud.iqReconciliationStatus,
    solicitud.iqTerminalStatus,
  ].map((value) => String(value || "")).join(" ").toUpperCase();

  return text.includes("RECHAZ") ||
    text.includes("REJECT") ||
    text.includes("CANCEL");
}

function buildSolicitudIqReplacementUnlockPatchH4D58H(input: {
  solicitud: Record<string, unknown>;
  uploadId: string;
  documentType: string;
  uid: string;
}): Record<string, unknown> {
  if (input.documentType !== "ORDEN_COMPRA") return {};
  if (!isSolicitudIqTerminalForReplacementH4D58H(input.solicitud)) return {};

  const previousIqId = String(input.solicitud.iqId || input.solicitud.iqFolio || "").trim();

  return {
    status: "PROCESANDO",

    iqPreviousTerminalIqId: previousIqId || null,
    iqPreviousTerminalStatus: input.solicitud.iqStatus || input.solicitud.iqReconciliationStatus || input.solicitud.iqTerminalStatus || null,
    iqPreviousTerminalUnlockedByUploadId: input.uploadId,

    iqId: FieldValue.delete(),
    iqFolio: FieldValue.delete(),

    iqStatus: "READY_FOR_NEW_IQ_FOLIO",
    iqReconciliationStatus: "RESET_BY_NEW_OC",
    iqCreationStatus: "READY_FOR_RECREATE",
    iqCreateQueueStatus: "PENDING_NEW_OC",

    iqTerminalLocked: false,
    iqSolicitudTerminalLocked: false,
    iqTerminalUnlockedAt: FieldValue.serverTimestamp(),
    iqTerminalUnlockedBy: input.uid,
    iqTerminalUnlockUploadId: input.uploadId,
    iqTerminalUnlockDocumentType: input.documentType,
    iqTerminalUnlockReason: "Nueva OC subida; se habilita crear nuevo folio IQ de solicitud.",

    iqAutomationOmitted: false,
    iqFollowupStatus: "PENDING_NEW_FOLIO",
    iqSyncUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}
// H4_D58H_B1_SOLICITUD_DOC_UNLOCK_HELPERS
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


type FacturaXmlMetadata = {
  facturaSerie: string | null;
  facturaFolio: string | null;
  facturaDisplay: string | null;
  facturaUuid: string | null;
  facturaSubtotal: number | null;
  facturaTotal: number | null;
  facturaMetodoPago: string | null;
  facturaMoneda: string | null;
  facturaFecha: string | null;
};

function cleanCfdiText(value: any): string {
  return String(value || "").trim();
}

function readXmlAttribute(tag: string, attr: string): string {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = new RegExp("\\s" + escaped + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i");
  const match = rx.exec(tag || "");
  return cleanCfdiText((match && (match[1] || match[2])) || "");
}

function findXmlTag(xml: string, localName: string): string {
  const rx = new RegExp("<(?:[A-Za-z0-9_]+:)?" + localName + "\\b[^>]*>", "i");
  const match = rx.exec(xml || "");
  return match ? match[0] : "";
}

function toCfdiNumber(value: string): number | null {
  const num = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(num) ? num : null;
}

function buildFacturaDisplay(serie: string, folio: string, uuid: string): string {
  const cleanSerie = cleanCfdiText(serie);
  const cleanFolio = cleanCfdiText(folio);
  const cleanUuid = cleanCfdiText(uuid);

  if (cleanFolio) {
    if (cleanSerie && !cleanFolio.toUpperCase().startsWith(cleanSerie.toUpperCase())) {
      return cleanSerie + cleanFolio;
    }
    return cleanFolio;
  }

  return cleanUuid;
}

function parseFacturaXmlMetadata(xml: string): FacturaXmlMetadata | null {
  const comprobanteTag = findXmlTag(xml, "Comprobante");
  if (!comprobanteTag) return null;

  const timbreTag = findXmlTag(xml, "TimbreFiscalDigital");

  const facturaSerie = cleanCfdiText(readXmlAttribute(comprobanteTag, "Serie")) || null;
  const facturaFolio = cleanCfdiText(readXmlAttribute(comprobanteTag, "Folio")) || null;
  const facturaUuid = cleanCfdiText(readXmlAttribute(timbreTag, "UUID")).toUpperCase() || null;
  const facturaSubtotal = toCfdiNumber(readXmlAttribute(comprobanteTag, "SubTotal"));
  const facturaTotal = toCfdiNumber(readXmlAttribute(comprobanteTag, "Total"));
  const facturaMetodoPago = cleanCfdiText(readXmlAttribute(comprobanteTag, "MetodoPago")).toUpperCase() || null;
  const facturaMoneda = cleanCfdiText(readXmlAttribute(comprobanteTag, "Moneda")).toUpperCase() || null;
  const facturaFecha = cleanCfdiText(readXmlAttribute(comprobanteTag, "Fecha")) || null;
  const facturaDisplay = cleanCfdiText(buildFacturaDisplay(facturaSerie || "", facturaFolio || "", facturaUuid || "")) || null;

  if (!facturaDisplay && !facturaUuid && facturaTotal === null) return null;

  return {
    facturaSerie,
    facturaFolio,
    facturaDisplay,
    facturaUuid,
    facturaSubtotal,
    facturaTotal,
    facturaMetodoPago,
    facturaMoneda,
    facturaFecha,
  };
}

async function readFacturaXmlMetadataFromStorage(bucket: any, storagePath: string): Promise<FacturaXmlMetadata | null> {
  try {
    if (!storagePath) return null;
    const [buffer] = await bucket.file(storagePath).download();
    const xml = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
    return parseFacturaXmlMetadata(xml);
  } catch (error) {
    console.warn("[solicitudDocuments] No se pudo parsear metadata CFDI XML", error);
    return null;
  }
}
function canUploadSolicitudDocs(user: any): boolean {
  const role = getRole(user);
  if (role === "superadmin") return true;

  const modules = user?.modules || {};
  if (modules?.solicitudes?.uploadDocs === true) return true;

  return false;
}

function canAccessSolicitud(user: any, uid: string, rootId: string, solicitud: any): boolean {
  const role = getRole(user);

  if (role === "superadmin") {
    return String(solicitud?.rootId || "") === rootId || String(solicitud?.createdBy || "") === uid;
  }

  if (role === "admin") {
    return String(solicitud?.rootId || "") === rootId && String(solicitud?.adminId || "") === uid;
  }

  if (role === "operador") {
    return String(solicitud?.rootId || "") === rootId && String(solicitud?.createdBy || "") === uid;
  }

  return false;
}

async function loadSolicitudOrThrow(input: {
  solicitudId: string;
  uid: string;
  user: any;
  rootId: string;
}) {
  const solicitudRef = db.collection("solicitudes").doc(input.solicitudId);
  const solicitudSnap = await solicitudRef.get();

  if (!solicitudSnap.exists) {
    throw new HttpsError("not-found", "Solicitud no existe.");
  }

  const solicitud = solicitudSnap.data() || {};

  if (!canAccessSolicitud(input.user, input.uid, input.rootId, solicitud)) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  return {
    solicitudRef,
    solicitud,
  };
}

export async function initSolicitudDocumentUploadCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  if (!canUploadSolicitudDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para subir documentos.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const data = request.data || {};

  const solicitudId = String(data.solicitudId || "").trim();
  const originalName = String(data.originalName || data.filename || "").trim();
  const contentType = String(data.contentType || "application/octet-stream").trim();
  const sizeBytes = Number(data.sizeBytes || 0);
  const documentType = normalizeSolicitudDocumentType(data.documentType);
  const customDocumentTypeLabel = sanitizeDocumentLabel(data.customDocumentTypeLabel || data.otherDocumentTypeLabel || "");
  const documentTypeLabel =
    documentType === "OTRO" && customDocumentTypeLabel
      ? customDocumentTypeLabel
      : getSolicitudDocumentTypeLabel(documentType);

  if (!solicitudId || !originalName) {
    throw new HttpsError("invalid-argument", "solicitudId y originalName son obligatorios.");
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new HttpsError("invalid-argument", "TamaÃ±o de archivo invalido.");
  }

  if (sizeBytes > MAX_SOLICITUD_DOCUMENT_SIZE_BYTES) {
    throw new HttpsError("invalid-argument", "El archivo excede el limite de 1 MB.");
  }

  
  const inputSha256 = String(data.sha256 || data.fileSha256 || "").trim().toLowerCase();
  const sha256 = /^[a-f0-9]{64}$/.test(inputSha256) ? inputSha256 : "";
const { solicitud } = await loadSolicitudOrThrow({
    solicitudId,
    uid,
    user,
    rootId,
  });

  
const safeName = sanitizeFilename(originalName);
  const uploadId = db.collection("uploads").doc().id;
  const storagePath = buildSolicitudDocumentStoragePath({ rootId, solicitudId, documentType, uploadId, originalName: safeName });

  await db.collection("uploads").doc(uploadId).set({
    rootId,
    adminId: solicitud.adminId || rootId,
    clienteId: solicitud.clienteId || solicitud.clientId || null,
    clienteNombre: solicitud.clienteNombre || solicitud.clientName || null,
    companyId: solicitud.companyId || null,
    empresaNombre: solicitud.empresaNombre || solicitud.companyName || null,

    entityType: "solicitudes",
    entityId: solicitudId,
    solicitudId,
    solicitudFolio: solicitud.folio || null,

    documentType,
    documentTypeLabel,
    originalName,
    filename: safeName,
    contentType,
    sizeBytes,
    storagePath,

    
      sha256: sha256 || null,
      integrityHashAlgorithm: sha256 ? "SHA-256" : null,
      integritySealStatus: sha256 ? "HASH_CLIENT_REPORTED" : "NO_HASH",
      integritySealVersion: "PAY0-MATERIALIDAD-V1",
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
    
      sha256: sha256 || null,
      integrityHashAlgorithm: sha256 ? "SHA-256" : null,
      integritySealStatus: sha256 ? "HASH_CLIENT_REPORTED" : "NO_HASH",
      integritySealVersion: "PAY0-MATERIALIDAD-V1",
    documentType,
  };
}

export async function finalizeSolicitudDocumentUploadCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  if (!canUploadSolicitudDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para finalizar documentos.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const data = request.data || {};

  const uploadId = String(data.uploadId || "").trim();
  const storagePathIn = String(data.storagePath || "").trim();

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

  const solicitudId = String(upload.solicitudId || upload.entityId || "").trim();
  const documentType = normalizeSolicitudDocumentType(upload.documentType);

  if (!solicitudId) {
    throw new HttpsError("failed-precondition", "Upload sin solicitudId.");
  }

  await loadSolicitudOrThrow({
    solicitudId,
    uid,
    user,
    rootId,
  });

  const solicitudRef = db.collection("solicitudes").doc(solicitudId);

  
if (storagePathIn && storagePathIn !== String(upload.storagePath || "")) {
    throw new HttpsError("invalid-argument", "storagePath no coincide con el registro.");
  }

  let facturaXmlMetadata: FacturaXmlMetadata | null = null;

  try {
    const bucket = admin.storage().bucket();
    const [exists] = await bucket.file(String(upload.storagePath || "")).exists();

    if (!exists) {
      throw new HttpsError("failed-precondition", "El archivo no existe en Storage.");
    }

    facturaXmlMetadata =
      documentType === "FACTURA_XML"
        ? await readFacturaXmlMetadataFromStorage(bucket, String(upload.storagePath || ""))
        : null;
  } catch (e: any) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("internal", "No se pudo verificar el archivo en Storage.");
  }

  let finalVersion = 1;

  await db.runTransaction(async (tx) => {
    const solicitudSnapH4D58H = await tx.get(solicitudRef);
    const solicitudH4D58H = solicitudSnapH4D58H.exists ? ((solicitudSnapH4D58H.data() || {}) as Record<string, unknown>) : {};
    // H4_D58H_B1_SOLICITUD_DOC_TX_READ
    finalVersion = await finalizeSolicitudDocumentVersionTx({
      tx,
      db,
      rootId,
      solicitudId,
      documentType,
      uploadId,
      uploadRef,
      mode: "update",
      readyPatch: {
        finalizedBy: uid,
        finalizedUsername: getUsername(user, uid),
        finalizedAt: FieldValue.serverTimestamp(),
        integritySealStatus: upload.sha256 ? "SEALED" : "SEALED_NO_HASH",
        integritySealedAt: FieldValue.serverTimestamp(),
        integritySealedBy: uid,
        integritySealedUsername: getUsername(user, uid),
        ...(facturaXmlMetadata ? {
          facturaSerie: facturaXmlMetadata.facturaSerie,
          facturaFolio: facturaXmlMetadata.facturaFolio,
          facturaDisplay: facturaXmlMetadata.facturaDisplay,
          facturaUuid: facturaXmlMetadata.facturaUuid,
          facturaSubtotal: facturaXmlMetadata.facturaSubtotal,
          facturaTotal: facturaXmlMetadata.facturaTotal,
          facturaMetodoPago: facturaXmlMetadata.facturaMetodoPago,
          facturaMoneda: facturaXmlMetadata.facturaMoneda,
          facturaFecha: facturaXmlMetadata.facturaFecha,
        } : {}),
      },
    });

        
      if (facturaXmlMetadata) {
        tx.update(solicitudRef, {
          numFactura: facturaXmlMetadata.facturaDisplay || null,
          facturaSerie: facturaXmlMetadata.facturaSerie,
          facturaFolio: facturaXmlMetadata.facturaFolio,
          facturaDisplay: facturaXmlMetadata.facturaDisplay,
          facturaUuid: facturaXmlMetadata.facturaUuid,
          uuidCfdi: facturaXmlMetadata.facturaUuid,
          facturaSubtotal: facturaXmlMetadata.facturaSubtotal,
          facturaTotal: facturaXmlMetadata.facturaTotal,
          facturaMetodoPago: facturaXmlMetadata.facturaMetodoPago,
          facturaMoneda: facturaXmlMetadata.facturaMoneda,
          facturaFecha: facturaXmlMetadata.facturaFecha,
          facturaXmlUploadId: uploadId,
          facturaMetadataSource: "FACTURA_XML",
          facturaMetadataUpdatedAt: FieldValue.serverTimestamp(),
        });
      }
    const iqUnlockPatchH4D58H = buildSolicitudIqReplacementUnlockPatchH4D58H({
      solicitud: solicitudH4D58H,
      uploadId,
      documentType,
      uid,
    });

    if (Object.keys(iqUnlockPatchH4D58H).length > 0) {
      tx.set(solicitudRef, iqUnlockPatchH4D58H, { merge: true });
    }
    // H4_D58H_B1_SOLICITUD_DOC_UNLOCK_WRITE
logActivityTx(tx, db, {
      event: "DOCUMENTO_SOLICITUD_SUBIDO",
      rootId,
      adminId: upload.adminId || rootId,
      actorUid: uid,
      actorUsername: getUsername(user, uid),
      actorRole: getRole(user),
      entityType: "solicitudes",
      entityId: solicitudId,
      referenceId: solicitudId,
      referenceFolio: upload.solicitudFolio || solicitudId,
      referenceType: "solicitudDocument",
      description: `Documento ${upload.documentTypeLabel || getSolicitudDocumentTypeLabel(documentType)} subido a solicitud ${upload.solicitudFolio || solicitudId}.`,
      createdBy: uid,
      extra: {
        source: "docs",
        clientId: upload.clienteId || upload.clientId || null,
        clienteId: upload.clienteId || upload.clientId || null,
        clientName: upload.clienteNombre || upload.clientName || null,
        clienteNombre: upload.clienteNombre || upload.clientName || null,
        companyId: upload.companyId || null,
        empresaNombre: upload.empresaNombre || upload.companyName || null,
        documentType,
        documentTypeLabel: upload.documentTypeLabel || getSolicitudDocumentTypeLabel(documentType),
        uploadId,
      },
    });
  });

  if (documentType === "ORDEN_COMPRA") {
    await enqueueIqCreationForSolicitud({
      solicitudId,
      requestedBy: uid,
      source: "OC_UPLOAD",
    }).catch(async (error) => {
      await solicitudRef.set(
        {
          iqCreateQueueStatus: "NOT_ENQUEUED",
          iqCreateQueueLastError: String(error?.message || error || "No se pudo encolar envio al despacho."),
          iqSyncUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  }

  return {
    ok: true,
    uploadId,
    status: "READY",
    active: true,
    version: finalVersion,
  };
}

export async function deactivateSolicitudDocumentCore(request: any) {
  const uid = requireAuthLike(request);
  const user = await getUser(uid);

  if (!user) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  if (!canUploadSolicitudDocs(user)) {
    throw new HttpsError("permission-denied", "No autorizado para desactivar documentos.");
  }

  const rootId = getRootIdFromUser(user, uid);
  const uploadId = String(request?.data?.uploadId || "").trim();

  if (!uploadId) {
    throw new HttpsError("invalid-argument", "uploadId requerido.");
  }

  const uploadRef = db.collection("uploads").doc(uploadId);
  const uploadSnap = await uploadRef.get();

  if (!uploadSnap.exists) {
    throw new HttpsError("not-found", "Documento no existe.");
  }

  const upload = uploadSnap.data() || {};

  if (String(upload.rootId || "") !== rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  const solicitudId = String(upload.solicitudId || upload.entityId || "").trim();

  await loadSolicitudOrThrow({
    solicitudId,
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
    event: "DOCUMENTO_SOLICITUD_DESACTIVADO",
    rootId,
    adminId: upload.adminId || rootId,
    actorUid: uid,
    actorUsername: getUsername(user, uid),
    actorRole: getRole(user),
    entityType: "solicitudes",
    entityId: solicitudId,
    referenceId: solicitudId,
    referenceFolio: upload.solicitudFolio || solicitudId,
    referenceType: "solicitudDocument",
    description: `Documento ${upload.documentTypeLabel || upload.documentType || "OTRO"} desactivado en solicitud ${upload.solicitudFolio || solicitudId}.`,
    createdBy: uid,
    extra: {
      source: "docs",
      clientId: upload.clienteId || upload.clientId || null,
      clienteId: upload.clienteId || upload.clientId || null,
      clientName: upload.clienteNombre || upload.clientName || null,
      clienteNombre: upload.clienteNombre || upload.clientName || null,
      companyId: upload.companyId || null,
      empresaNombre: upload.empresaNombre || upload.companyName || null,
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
