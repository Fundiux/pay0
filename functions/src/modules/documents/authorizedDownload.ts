import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, normalizeRole } from "../../utils/authGuard";
import { requireClientOperationalAccess, type ClientAccessPermissionKey } from "../clientDelegations/access";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

type DocumentFamily = "solicitudes" | "pagos" | "clientDispersions";

const FAMILY_CONFIG: Record<DocumentFamily, {
  collection: string;
  idField: "solicitudId" | "pagoId" | "dispersionId";
  module: string;
  action: string;
  clientPermission: ClientAccessPermissionKey;
}> = {
  solicitudes: {
    collection: "solicitudes",
    idField: "solicitudId",
    module: "solicitudes",
    action: "view",
    clientPermission: "operateSolicitudes",
  },
  pagos: {
    collection: "pagos",
    idField: "pagoId",
    module: "pagos",
    action: "view",
    clientPermission: "operatePagos",
  },
  clientDispersions: {
    collection: "clientDispersions",
    idField: "dispersionId",
    module: "wallet",
    action: "dispersiones",
    clientPermission: "operateDispersiones",
  },
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function inferFamily(upload: Record<string, any>): DocumentFamily | null {
  const entityType = clean(upload.entityType);
  if (entityType in FAMILY_CONFIG) return entityType as DocumentFamily;
  if (clean(upload.dispersionId)) return "clientDispersions";
  if (clean(upload.pagoId)) return "pagos";
  if (clean(upload.solicitudId)) return "solicitudes";
  return null;
}

export async function getAuthorizedDocumentDownloadUrlCore(
  request: any,
  signUrl: (storagePath: string) => Promise<string> = async (storagePath) => {
    const file = admin.storage().bucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) throw new HttpsError("not-found", "Archivo no encontrado.");
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 5 * 60 * 1000,
    });
    return url;
  },
) {
    const uid = clean(request.auth?.uid);
    const uploadId = clean(request.data?.uploadId);
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
    if (!uploadId) throw new HttpsError("invalid-argument", "uploadId requerido.");

    const [userSnap, uploadSnap] = await Promise.all([
      db.doc(`users/${uid}`).get(),
      db.doc(`uploads/${uploadId}`).get(),
    ]);
    if (!userSnap.exists) throw new HttpsError("permission-denied", "Perfil no encontrado.");
    if (!uploadSnap.exists) throw new HttpsError("not-found", "Documento no encontrado.");

    const user: any = userSnap.data() || {};
    const upload: any = uploadSnap.data() || {};
    const family = inferFamily(upload);
    if (!family) throw new HttpsError("failed-precondition", "Familia documental no soportada.");
    const config = FAMILY_CONFIG[family];

    assertAuthorized(request.auth, user, {
      allowedRoles: ["superadmin", "admin", "operador"],
      requiredModule: config.module,
      requiredAction: config.action,
    });

    const rootId = clean(user.rootId || uid);
    if (clean(upload.rootId) !== rootId) {
      throw new HttpsError("permission-denied", "Documento fuera del root autorizado.");
    }

    const parentId = clean(upload[config.idField]);
    if (!parentId) throw new HttpsError("failed-precondition", "Documento sin recurso padre.");
    const parentSnap = await db.doc(`${config.collection}/${parentId}`).get();
    if (!parentSnap.exists) throw new HttpsError("failed-precondition", "Recurso padre no encontrado.");
    const parent: any = parentSnap.data() || {};
    if (clean(parent.rootId) !== rootId) {
      throw new HttpsError("permission-denied", "Recurso padre fuera del root autorizado.");
    }

    const role = normalizeRole(user.role);
    const clientId = clean(parent.clientId || parent.clienteId);
    if (role !== "superadmin") {
      if (!clientId) throw new HttpsError("permission-denied", "Recurso padre sin cliente autorizado.");
      await requireClientOperationalAccess({
        uid,
        role,
        rootId,
        clientId,
        permission: config.clientPermission,
        errorMessage: "No autorizado para consultar documentos de este recurso.",
      });
    }

    if (upload.active === false || ["INACTIVE", "REPLACED"].includes(clean(upload.status).toUpperCase())) {
      throw new HttpsError("failed-precondition", "El documento ya no esta activo.");
    }

    const storagePath = clean(upload.storagePath);
    const storageFamily = family === "clientDispersions" ? "dispersiones" : family;
    const expectedParentPrefix = `roots/${rootId}/${storageFamily}/${parentId}/`;
    if (!storagePath.startsWith(expectedParentPrefix)) {
      throw new HttpsError("failed-precondition", "Ruta documental invalida.");
    }

    let url: string;
    try {
      url = await signUrl(storagePath);
    } catch (error: any) {
      if (error instanceof HttpsError) throw error;
      if (Number(error?.code) === 404 || Number(error?.statusCode) === 404) {
        throw new HttpsError("not-found", "Archivo no encontrado.");
      }
      throw new HttpsError("internal", "No fue posible generar temporalmente el enlace de descarga.");
    }

    return { ok: true, uploadId, url, expiresInSeconds: 300 };
}

export const getAuthorizedDocumentDownloadUrl = onCall(
  { cors: true, timeoutSeconds: 30, memory: "256MiB" },
  async (request) => getAuthorizedDocumentDownloadUrlCore(request),
);
