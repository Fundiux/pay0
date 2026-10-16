import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const text = (value: unknown, max = 180) => typeof value === "string" ? value.trim().slice(0, max) : "";
const families = {
  solicitudes: { field: "solicitudId", path: "solicitudes", module: "solicitudes", action: "view" },
  pagos: { field: "pagoId", path: "pagos", module: "pagos", action: "view" },
  clientDispersions: { field: "dispersionId", path: "dispersiones", module: "wallet", action: "dispersiones" },
} as const;
const validId = (value: string) => !!value && value.length <= 1500 && !value.includes("/") && value !== "." && value !== "..";
const deleted = (row: FirebaseFirestore.DocumentData) => row.deleted === true || row.isDeleted === true || !!row.deletedAt || ["ELIMINADA", "ELIMINADO"].includes(text(row.status).toUpperCase());

// A view over existing uploads, never a second document store or an evaluation corpus.
export async function listOperationalDocumentsCore(request: any) {
  const uid = text(request.auth?.uid, 128);
  if (!validId(uid)) throw new HttpsError("unauthenticated", "Inicia sesión para consultar el expediente.");
  const user = (await db.collection("users").doc(uid).get()).data();
  if (!user) throw new HttpsError("permission-denied", "Perfil no disponible.");
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: "corporateResources", requiredAction: "view" });
  if (user.modules?.corporateResources === false || user.modules?.corporateResources?.view === false)
    throw new HttpsError("permission-denied", "El expediente está deshabilitado.");
  const rootId = text(user.rootId || uid, 128);
  const cursor = request.data?.cursor;
  if (cursor !== undefined && cursor !== null && (typeof cursor !== "string" || !validId(cursor)))
    throw new HttpsError("invalid-argument", "Página inválida.");
  let query = db.collection("uploads").where("rootId", "==", rootId).orderBy(admin.firestore.FieldPath.documentId()).limit(51);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const page = snapshot.docs.slice(0, 50);
  const authorizedFamilies = new Set<string>();
  for (const [family, config] of Object.entries(families)) {
    const permission = user.modules?.[config.module];
    if (permission === false || permission?.view === false || permission?.[config.action] === false) continue;
    try {
      assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: config.module, requiredAction: config.action });
      authorizedFamilies.add(family);
    } catch (error) {
      if (!(error instanceof HttpsError) || error.code !== "permission-denied") throw error;
    }
  }
  const inventory = (await Promise.all(page.map(async doc => {
    const row = doc.data();
    const family = text(row.entityType) || (row.dispersionId ? "clientDispersions" : row.pagoId ? "pagos" : row.solicitudId ? "solicitudes" : "");
    if (!Object.prototype.hasOwnProperty.call(families, family) || !authorizedFamilies.has(family)) return null;
    const config = families[family as keyof typeof families];
    const parentId = text(row[config.field], 1500);
    const status = text(row.status).toUpperCase();
    if (!validId(parentId) || row.active === false || ["INACTIVE", "REPLACED"].includes(status) || deleted(row)) return null;
    const storagePath = text(row.storagePath, 2048);
    if (storagePath && !storagePath.startsWith(`roots/${rootId}/${config.path}/${parentId}/`)) return null;
    const parent = (await db.collection(family).doc(parentId).get()).data();
    if (!parent || parent.rootId !== rootId || parent.active === false || deleted(parent)) return null;
    const available = row.active === true && status === "READY" && !!storagePath;
    return {
      id: doc.id, family, parentId,
      name: text(row.originalName || row.filename || row.label) || "Documento sin nombre",
      documentType: text(row.documentType),
      folio: text(parent.folio || parent.referenceFolio || parent.pagoFolio || row.solicitudFolio),
      company: text(parent.empresaNombre || parent.companyName || row.empresaNombre),
      client: text(parent.clienteNombre || parent.clientName || row.clienteNombre),
      origin: row.source === "IQ_INVOICE_ZIP" ? "IQ" : "PAY0",
      iqFolio: row.source === "IQ_INVOICE_ZIP" ? text(row.iqFolio) : "",
      version: Number.isSafeInteger(row.version) && row.version > 0 ? row.version : null,
      availability: available ? "AVAILABLE" as const : "PENDING_REVIEW" as const,
      ...(available ? {} : { pendingReason: status && status !== "READY" ? "UPLOAD_PENDING" as const : "LEGACY_METADATA" as const }),
    };
  }))).filter(row => row !== null);
  const documents = inventory.filter(row => row.availability === "AVAILABLE");
  const pendingDocuments = inventory.filter(row => row.availability === "PENDING_REVIEW");
  return { documents, pendingDocuments, scanned: page.length, nextCursor: snapshot.size > 50 ? page[page.length - 1].id : null };
}

export const listOperationalDocuments = onCall({ region: "us-central1", timeoutSeconds: 30 }, listOperationalDocumentsCore);
