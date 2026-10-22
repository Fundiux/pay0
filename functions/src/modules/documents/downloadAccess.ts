import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { requireClientOperationalAccess, type ClientAccessPermissionKey } from "../clientDelegations/access";
import { assertDispersionFundingOwner } from "../financing/dispersionFunding";

if (!admin.apps.length) admin.initializeApp();
export type PrivateDocumentFamily = "uploads" | "entityDocuments" | "assetDocuments";
export type PrivateDocumentReference = { family: PrivateDocumentFamily; documentId: string };
export type AuthorizedDocumentObject = { storagePath: string; revision: string; filename: string; expectedGeneration: string | null };
const clean = (value: unknown) => String(value ?? "").trim();
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 180 && !/[\/\\\x00-\x1f]/.test(value);
const unavailable = (row: any) => !row || row.active === false || row.isDeleted === true || row.deleted === true || row.deletedAt != null ||
  ["ELIMINADA", "ELIMINADO", "DELETED"].includes(clean(row.status).toUpperCase());
const uploadFamilies: Record<string, { collection: string; idField: string; module: string; action: string; permission: ClientAccessPermissionKey; storage: string }> = {
  solicitudes: { collection: "solicitudes", idField: "solicitudId", module: "solicitudes", action: "view", permission: "operateSolicitudes", storage: "solicitudes" },
  pagos: { collection: "pagos", idField: "pagoId", module: "pagos", action: "view", permission: "operatePagos", storage: "pagos" },
  clientDispersions: { collection: "clientDispersions", idField: "dispersionId", module: "wallet", action: "dispersiones", permission: "operateDispersiones", storage: "dispersiones" },
};
export function validatePrivateDocumentReference(input: any): PrivateDocumentReference {
  if (!input || !["uploads", "entityDocuments", "assetDocuments"].includes(input.family) || !validId(input.documentId)) {
    throw new HttpsError("invalid-argument", "Documento invalido.");
  }
  return { family: input.family, documentId: input.documentId };
}

/** Current authority and every grant ancestor share the same Firestore snapshot. */
export async function resolveAuthorizedDocumentObject(uid: string, input: PrivateDocumentReference,
  database: FirebaseFirestore.Firestore = admin.firestore()): Promise<AuthorizedDocumentObject> {
  const reference = validatePrivateDocumentReference(input);
  if (!validId(uid)) throw new HttpsError("unauthenticated", "Sesion no disponible.");
  return database.runTransaction(async tx => {
    const [userSnap, documentSnap] = await Promise.all([
      tx.get(database.doc(`users/${uid}`)), tx.get(database.doc(`${reference.family}/${reference.documentId}`)),
    ]);
    const user = userSnap.data(), document = documentSnap.data();
    assertAuthorized({ uid }, user, { allowedRoles: ["superadmin", "admin", "operador"] });
    const role = getUserRole(user), rootId = clean(user?.rootId || uid);
    if (!document || unavailable(document)) throw new HttpsError("not-found", "Documento no disponible.");
    if (document.rootId !== rootId) throw new HttpsError("permission-denied", "Documento fuera de alcance.");
    const status = clean(document.status).toUpperCase();
    if (document.active === false || ["INACTIVE", "INACTIVO", "REPLACED", "PENDING_UPLOAD"].includes(status)) {
      throw new HttpsError("failed-precondition", "Documento no vigente.");
    }
    let prefix: string;
    if (reference.family === "uploads") {
      // READY imports and explicit active legacy records remain compatible;
      // prepared/pending uploads are never a downloadable document.
      if (!["READY", "ACTIVE", "FINALIZED"].includes(status) && !(status === "" && document.active === true)) {
        throw new HttpsError("failed-precondition", "Carga no finalizada.");
      }
      const family = clean(document.entityType) in uploadFamilies ? clean(document.entityType) :
        document.dispersionId ? "clientDispersions" : document.pagoId ? "pagos" : document.solicitudId ? "solicitudes" : "";
      const config = uploadFamilies[family];
      if (!config) throw new HttpsError("failed-precondition", "Familia no soportada.");
      const parentId = document[config.idField];
      if (!validId(parentId)) throw new HttpsError("failed-precondition", "Documento sin padre valido.");
      assertAuthorized({ uid }, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: config.module, requiredAction: config.action });
      const parent = (await tx.get(database.doc(`${config.collection}/${parentId}`))).data();
      if (unavailable(parent) || parent!.rootId !== rootId) throw new HttpsError("permission-denied", "Recurso no disponible.");
      if (family === "clientDispersions") assertDispersionFundingOwner({ rootId, uid, role, dispersion: parent });
      const userFunded = family === "clientDispersions" && parent!.fundingSource?.holderType === "USER";
      if (role !== "superadmin" && !userFunded) {
        const clientId = parent!.clientId || parent!.clienteId;
        if (!validId(clientId)) throw new HttpsError("permission-denied", "Cliente no disponible.");
        await requireClientOperationalAccess({ uid, role, rootId, clientId, permission: config.permission, transaction: tx });
      }
      prefix = `roots/${rootId}/${config.storage}/${parentId}/`;
    } else if (reference.family === "entityDocuments") {
      // Match the historical document manager AND Storage root-owner boundary.
      if (role !== "superadmin" || uid !== rootId) throw new HttpsError("permission-denied", "Documento fuera de alcance.");
      const collection = ({ CLIENTE: "clients", COMPANY: "companies", DESPACHO: "despachos" } as Record<string, string>)[document.entityType];
      if (!collection || !validId(document.entityId) || !validId(document.documentType)) throw new HttpsError("failed-precondition", "Entidad invalida.");
      const entity = (await tx.get(database.doc(`${collection}/${document.entityId}`))).data();
      if (unavailable(entity) || (entity!.rootId && entity!.rootId !== rootId)) throw new HttpsError("permission-denied", "Entidad fuera de alcance.");
      if (document.uploadStatus !== "FINALIZED" || status !== "ACTIVE") throw new HttpsError("failed-precondition", "Carga no finalizada.");
      prefix = `roots/${rootId}/entityDocuments/${document.entityType}/${document.entityId}/${document.documentType}/`;
    } else {
      if (document.ownerUid !== uid || (role !== "superadmin" && user?.systemAccess?.assets !== true)) throw new HttpsError("permission-denied", "Documento privado del titular.");
      if (status !== "ACTIVE") throw new HttpsError("failed-precondition", "Carga no finalizada.");
      prefix = `roots/${rootId}/assets/${uid}/documents/${reference.documentId}/`;
    }
    const storagePath = clean(document.storagePath);
    if (!storagePath.startsWith(prefix) || storagePath.includes("..") || /[\\\x00-\x1f]/.test(storagePath) || storagePath.length <= prefix.length) {
      throw new HttpsError("failed-precondition", "Ruta documental invalida.");
    }
    const revision = createHash("sha256").update(JSON.stringify([reference.family, reference.documentId, storagePath, documentSnap.updateTime?.toMillis() || 0])).digest("hex");
    const expectedGeneration = clean(document.storageGeneration || document.verifiedStorageGeneration) || null;
    return { storagePath, revision, expectedGeneration, filename: clean(document.originalName || document.originalFileName || document.fileName || document.filename) || "documento" };
  });
}
