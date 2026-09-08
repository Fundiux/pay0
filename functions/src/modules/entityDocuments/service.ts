import * as admin from "firebase-admin";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import {
  EntityDocumentEntityType,
  EntityDocumentFiscalAdminType,
  EntityDocumentLegalPersonType,
  EntityDocumentType,
  buildDocumentPeriod,
  buildEntityDocumentStoragePath,
  getEntityDocumentLabel,
  getEntityDocumentMaxSizeBytes,
  isEntityDocumentEntityType,
  isEntityDocumentFiscalAdminType,
  isEntityDocumentLegalPersonType,
  isEntityDocumentPeriodicType,
  isEntityDocumentType,
} from "./domain";

if (!admin.apps.length) admin.initializeApp();

const db = getFirestore();
function getEntityDocumentsBucket() {
  return getStorage().bucket();
}

type AuthContext = {
  uid: string;
  rootId: string;
  role: string;
  user: Record<string, any>;
  username: string;
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanUpper(value: unknown): string {
  return cleanText(value).toUpperCase();
}

function getUsername(user: Record<string, any>, uid: string): string {
  return (
    cleanText(user.username) ||
    cleanText(user.displayName) ||
    cleanText(user.name) ||
    cleanText(user.email) ||
    uid
  );
}


function buildInitialValidationFields(documentType: string) {
  return {
    validationStatus: "PENDIENTE_VALIDACION",
    validationKind: documentType,
    validationSource: "MANUAL_REVIEW",
    validationErrors: [],
    extractedData: {
      rfc: null,
      razonSocial: null,
      regimenFiscal: null,
      documentDate: null,
      clientName: null,
      opinionStatus: "NO_DETERMINADO",
      rawTextSample: null,
    },
    documentDate: null,
  };
}

function sanitizeFilename(value: unknown): string {
  const raw = cleanText(value) || "documento";
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return safe.slice(0, 140) || "documento";
}

function parseSha256(data: Record<string, any>): string | null {
  const input = cleanText(data.sha256 || data.fileSha256).toLowerCase();
  return /^[a-f0-9]{64}$/.test(input) ? input : null;
}

function parsePositiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDocumentType(value: unknown): EntityDocumentType {
  const type = cleanUpper(value);
  if (!isEntityDocumentType(type)) {
    throw new HttpsError("invalid-argument", "Tipo de documento de entidad invalido.");
  }
  return type;
}

function parseEntityType(value: unknown): EntityDocumentEntityType {
  const type = cleanUpper(value);
  if (!isEntityDocumentEntityType(type)) {
    throw new HttpsError("invalid-argument", "Tipo de entidad invalido.");
  }
  return type;
}

function parseOptionalLegalPersonType(
  value: unknown
): EntityDocumentLegalPersonType | null {
  const type = cleanUpper(value);
  if (!type) return null;
  if (!isEntityDocumentLegalPersonType(type)) {
    throw new HttpsError("invalid-argument", "Tipo de persona fiscal invalido.");
  }
  return type;
}

function parseOptionalFiscalAdminType(
  value: unknown
): EntityDocumentFiscalAdminType | null {
  const type = cleanUpper(value);
  if (!type) return null;
  if (!isEntityDocumentFiscalAdminType(type)) {
    throw new HttpsError("invalid-argument", "Tipo de administracion fiscal invalido.");
  }
  return type;
}

function getEntityCollectionName(entityType: EntityDocumentEntityType): string {
  if (entityType === "CLIENTE") return "clients";
  if (entityType === "COMPANY") return "companies";
  if (entityType === "DESPACHO") return "despachos";
  throw new HttpsError("invalid-argument", "Tipo de entidad invalido.");
}

async function requireAuthContext(request: any): Promise<AuthContext> {
  const uid = cleanText(request.auth?.uid);
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sesion requerida.");
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }

  const user = userSnap.data() || {};
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
  const rootId = cleanText(user.rootId) || uid;
  const role = cleanText(user.role).toLowerCase();

  return {
    uid,
    rootId,
    role,
    user,
    username: getUsername(user, uid),
  };
}

function requireEntityDocumentManager(ctx: AuthContext) {
  if (ctx.role !== "superadmin") {
    throw new HttpsError(
      "permission-denied",
      "Solo superadmin puede administrar papeleria fiscal/legal por ahora."
    );
  }
}

async function ensureEntityInRoot(
  rootId: string,
  entityType: EntityDocumentEntityType,
  entityId: string
): Promise<Record<string, any>> {
  if (!entityId) {
    throw new HttpsError("invalid-argument", "entityId es obligatorio.");
  }

  const collectionName = getEntityCollectionName(entityType);
  const snap = await db.collection(collectionName).doc(entityId).get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Entidad no encontrada.");
  }

  const entity = snap.data() || {};
  const entityRootId = cleanText(entity.rootId);

  if (entityRootId && entityRootId !== rootId) {
    throw new HttpsError("permission-denied", "Entidad fuera del root.");
  }

  return entity;
}

function parsePeriod(documentType: EntityDocumentType, data: Record<string, any>) {
  const rawYear = data.periodYear ?? data.year;
  const rawMonth = data.periodMonth ?? data.month;

  const periodYear = rawYear === undefined || rawYear === null || rawYear === ""
    ? null
    : Number(rawYear);

  const periodMonth = rawMonth === undefined || rawMonth === null || rawMonth === ""
    ? null
    : Number(rawMonth);

  if (!isEntityDocumentPeriodicType(documentType)) {
    return {
      documentPeriod: null,
      periodYear: null,
      periodMonth: null,
    };
  }

  if (
    !Number.isInteger(periodYear) ||
    !Number.isInteger(periodMonth) ||
    Number(periodYear) < 2000 ||
    Number(periodYear) > 2100 ||
    Number(periodMonth) < 1 ||
    Number(periodMonth) > 12
  ) {
    throw new HttpsError(
      "invalid-argument",
      "periodYear y periodMonth son obligatorios para documentos periodicos."
    );
  }

  const documentPeriod = buildDocumentPeriod({
    documentType,
    periodYear: Number(periodYear),
    periodMonth: Number(periodMonth),
  });

  return {
    documentPeriod,
    periodYear: Number(periodYear),
    periodMonth: Number(periodMonth),
  };
}

async function getCurrentAndNextVersion(params: {
  rootId: string;
  entityType: EntityDocumentEntityType;
  entityId: string;
  documentType: EntityDocumentType;
  documentPeriod: string | null;
}) {
  const snap = await db
    .collection("entityDocuments")
    .where("rootId", "==", params.rootId)
    .where("entityType", "==", params.entityType)
    .where("entityId", "==", params.entityId)
    .where("documentType", "==", params.documentType)
    .limit(200)
    .get();

  let maxVersion = 0;
  let currentDocumentId: string | null = null;

  snap.docs.forEach((doc) => {
    const row = doc.data() || {};
    const samePeriod = cleanText(row.documentPeriod) === cleanText(params.documentPeriod);
    if (!samePeriod) return;

    const version = parsePositiveNumber(row.version);
    if (version > maxVersion) maxVersion = version;

    if (row.active === true && row.isCurrent === true) {
      currentDocumentId = doc.id;
    }
  });

  return {
    nextVersion: maxVersion + 1,
    currentDocumentId,
  };
}

export async function initEntityDocumentUploadCore(request: any) {
  const ctx = await requireAuthContext(request);
  requireEntityDocumentManager(ctx);

  const data = request.data || {};

  const entityType = parseEntityType(data.entityType);
  const entityId = cleanText(data.entityId);
  const documentType = parseDocumentType(data.documentType);
  const legalPersonType = parseOptionalLegalPersonType(data.legalPersonType);
  const fiscalAdminType = parseOptionalFiscalAdminType(data.fiscalAdminType);

  const originalName = cleanText(data.originalName || data.fileName || data.filename);
  if (!originalName) {
    throw new HttpsError("invalid-argument", "originalName es obligatorio.");
  }

  const fileSize = parsePositiveNumber(data.fileSize || data.sizeBytes);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new HttpsError("invalid-argument", "Tamano de archivo invalido.");
  }

  const maxSizeBytes = getEntityDocumentMaxSizeBytes(documentType);
  if (fileSize > maxSizeBytes) {
    throw new HttpsError(
      "invalid-argument",
      `El archivo excede el limite permitido para ${getEntityDocumentLabel(documentType)}.`
    );
  }

  await ensureEntityInRoot(ctx.rootId, entityType, entityId);

  const { documentPeriod, periodYear, periodMonth } = parsePeriod(documentType, data);

  const { nextVersion, currentDocumentId } = await getCurrentAndNextVersion({
    rootId: ctx.rootId,
    entityType,
    entityId,
    documentType,
    documentPeriod,
  });

  const documentRef = db.collection("entityDocuments").doc();
  const documentId = documentRef.id;
  const safeName = sanitizeFilename(originalName);
  const storagePath = buildEntityDocumentStoragePath({
    rootId: ctx.rootId,
    entityType,
    entityId,
    documentType,
    documentId,
    safeName,
  });

  const sha256 = parseSha256(data);
  const contentType = cleanText(data.contentType) || "application/octet-stream";

  await documentRef.set({
    id: documentId,
    rootId: ctx.rootId,
    entityType,
    entityId,
    legalPersonType,
    fiscalAdminType,
    documentType,
    documentTypeLabel: getEntityDocumentLabel(documentType),
    documentPeriod,
    periodYear,
    periodMonth,
    version: nextVersion,
    isCurrent: false,
    active: false,
    status: "INACTIVE",
    uploadStatus: "PENDING_UPLOAD",
    ...buildInitialValidationFields(documentType),
    storagePath,
    fileName: safeName,
    filename: safeName,
    originalName,
    fileSize,
    sizeBytes: fileSize,
    contentType,
    sha256,
    integrityHashAlgorithm: sha256 ? "SHA-256" : null,
    integritySealStatus: sha256 ? "HASH_CLIENT_REPORTED" : "NO_HASH",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: ctx.uid,
    createdByName: ctx.username,
    supersedesDocumentId: currentDocumentId,
    supersededByDocumentId: null,
    validFrom: null,
    validTo: null,
    notes: cleanText(data.notes) || null,
  });

  return {
    ok: true,
    entityDocumentId: documentId,
    documentId,
    storagePath,
    documentType,
    documentTypeLabel: getEntityDocumentLabel(documentType),
    documentPeriod,
    periodYear,
    periodMonth,
    version: nextVersion,
    maxSizeBytes,
  };
}

export async function finalizeEntityDocumentUploadCore(request: any) {
  const ctx = await requireAuthContext(request);
  requireEntityDocumentManager(ctx);

  const data = request.data || {};
  const documentId = cleanText(data.entityDocumentId || data.documentId || data.uploadId);
  const storagePathIn = cleanText(data.storagePath);

  if (!documentId) {
    throw new HttpsError("invalid-argument", "entityDocumentId es obligatorio.");
  }

  const documentRef = db.collection("entityDocuments").doc(documentId);
  const documentSnap = await documentRef.get();

  if (!documentSnap.exists) {
    throw new HttpsError("not-found", "Documento de entidad no encontrado.");
  }

  const document = documentSnap.data() || {};
  if (cleanText(document.rootId) !== ctx.rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  const storagePath = cleanText(document.storagePath);
  if (storagePathIn && storagePathIn !== storagePath) {
    throw new HttpsError("invalid-argument", "storagePath no coincide con el registro.");
  }

  const [exists] = await getEntityDocumentsBucket().file(storagePath).exists();
  if (!exists) {
    throw new HttpsError("failed-precondition", "El archivo no existe en Storage.");
  }

  const supersedesDocumentId = cleanText(document.supersedesDocumentId);
  const supersedesRef = supersedesDocumentId
    ? db.collection("entityDocuments").doc(supersedesDocumentId)
    : null;

  await db.runTransaction(async (tx) => {
    if (supersedesRef) {
      const prevSnap = await tx.get(supersedesRef);
      if (prevSnap.exists && cleanText((prevSnap.data() || {}).rootId) === ctx.rootId) {
        tx.update(supersedesRef, {
          isCurrent: false,
          status: "REPLACED",
          supersededByDocumentId: documentId,
          replacedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    tx.update(documentRef, {
      active: true,
      isCurrent: true,
      status: "ACTIVE",
      uploadStatus: "FINALIZED",
      finalizedBy: ctx.uid,
      finalizedByName: ctx.username,
      finalizedAt: FieldValue.serverTimestamp(),
      integritySealStatus: document.sha256 ? "SEALED" : "SEALED_NO_HASH",
      integritySealedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    ok: true,
    entityDocumentId: documentId,
    documentId,
  };
}

export async function listEntityDocumentsCore(request: any) {
  const ctx = await requireAuthContext(request);
  requireEntityDocumentManager(ctx);

  const data = request.data || {};
  const entityType = parseEntityType(data.entityType);
  const entityId = cleanText(data.entityId);
  const documentType = cleanText(data.documentType)
    ? parseDocumentType(data.documentType)
    : null;

  await ensureEntityInRoot(ctx.rootId, entityType, entityId);

  let query: FirebaseFirestore.Query = db
    .collection("entityDocuments")
    .where("rootId", "==", ctx.rootId)
    .where("entityType", "==", entityType)
    .where("entityId", "==", entityId)
    .limit(300);

  if (documentType) {
    query = query.where("documentType", "==", documentType);
  }

  const snap = await query.get();

  const documents = snap.docs
    .map((doc) => {
      const row = doc.data() || {};
      return {
        id: doc.id,
        ...row,
      };
    })
    .sort((a: any, b: any) => {
      const aVersion = parsePositiveNumber(a.version);
      const bVersion = parsePositiveNumber(b.version);
      if (a.documentType !== b.documentType) {
        return String(a.documentType || "").localeCompare(String(b.documentType || ""));
      }
      if (a.documentPeriod !== b.documentPeriod) {
        return String(b.documentPeriod || "").localeCompare(String(a.documentPeriod || ""));
      }
      return bVersion - aVersion;
    });

  return {
    ok: true,
    entityType,
    entityId,
    documents,
  };
}

export async function deactivateEntityDocumentCore(request: any) {
  const ctx = await requireAuthContext(request);
  requireEntityDocumentManager(ctx);

  const data = request.data || {};
  const documentId = cleanText(data.entityDocumentId || data.documentId || data.uploadId);

  if (!documentId) {
    throw new HttpsError("invalid-argument", "entityDocumentId es obligatorio.");
  }

  const documentRef = db.collection("entityDocuments").doc(documentId);
  const documentSnap = await documentRef.get();

  if (!documentSnap.exists) {
    throw new HttpsError("not-found", "Documento de entidad no encontrado.");
  }

  const document = documentSnap.data() || {};
  if (cleanText(document.rootId) !== ctx.rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  await documentRef.update({
    active: false,
    isCurrent: false,
    status: "INACTIVE",
    uploadStatus: "DEACTIVATED",
    deactivatedBy: ctx.uid,
    deactivatedByName: ctx.username,
    deactivatedAt: FieldValue.serverTimestamp(),
    deactivationReason: cleanText(data.reason) || null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    ok: true,
    entityDocumentId: documentId,
    documentId,
  };
}

export async function reactivateEntityDocumentCore(request: any) {
  const ctx = await requireAuthContext(request);
  requireEntityDocumentManager(ctx);

  const data = request.data || {};
  const documentId = cleanText(data.entityDocumentId || data.documentId || data.uploadId);

  if (!documentId) {
    throw new HttpsError("invalid-argument", "entityDocumentId es obligatorio.");
  }

  const documentRef = db.collection("entityDocuments").doc(documentId);

  await db.runTransaction(async (tx) => {
    const documentSnap = await tx.get(documentRef);

    if (!documentSnap.exists) {
      throw new HttpsError("not-found", "Documento de entidad no encontrado.");
    }

    const document = documentSnap.data() || {};

    if (cleanText(document.rootId) !== ctx.rootId) {
      throw new HttpsError("permission-denied", "No autorizado.");
    }

    const status = cleanUpper(document.status);
    if (status === "REPLACED") {
      throw new HttpsError(
        "failed-precondition",
        "No se puede reactivar un documento reemplazado."
      );
    }

    if (document.active === true && status === "ACTIVE") {
      throw new HttpsError("failed-precondition", "El documento ya esta activo.");
    }

    if (!cleanText(document.storagePath)) {
      throw new HttpsError(
        "failed-precondition",
        "No se puede reactivar un documento sin archivo finalizado."
      );
    }

    const entityType = cleanText(document.entityType);
    const entityId = cleanText(document.entityId);
    const documentType = cleanText(document.documentType);
    const documentPeriod = cleanText(document.documentPeriod) || null;

    if (!entityType || !entityId || !documentType) {
      throw new HttpsError(
        "failed-precondition",
        "El documento no tiene metadatos suficientes para reactivarse."
      );
    }

    const currentQuery = db
      .collection("entityDocuments")
      .where("rootId", "==", ctx.rootId)
      .where("entityType", "==", entityType)
      .where("entityId", "==", entityId)
      .where("documentType", "==", documentType)
      .where("active", "==", true)
      .where("isCurrent", "==", true);

    const currentSnap = await tx.get(currentQuery);
    let supersedesDocumentId: string | null = null;

    currentSnap.docs.forEach((snap) => {
      if (snap.id === documentId) return;

      const current = snap.data() || {};
      const samePeriod = cleanText(current.documentPeriod) === cleanText(documentPeriod);
      if (!samePeriod) return;

      supersedesDocumentId = snap.id;
      tx.update(snap.ref, {
        active: false,
        isCurrent: false,
        status: "REPLACED",
        supersededByDocumentId: documentId,
        replacedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    const updateData: Record<string, any> = {
      active: true,
      isCurrent: true,
      status: "ACTIVE",
      uploadStatus: "FINALIZED",
      supersededByDocumentId: null,
      reactivatedBy: ctx.uid,
      reactivatedByName: ctx.username,
      reactivatedAt: FieldValue.serverTimestamp(),
      reactivationReason: cleanText(data.reason) || null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (supersedesDocumentId) {
      updateData.supersedesDocumentId = supersedesDocumentId;
    }

    tx.update(documentRef, updateData);
  });

  return {
    ok: true,
    entityDocumentId: documentId,
    documentId,
  };
}
