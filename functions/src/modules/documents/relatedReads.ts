import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { documentId } from "../notes/readPagination";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
type Kind = "clientBeneficiaries" | "clientBeneficiaryMethods" | "pagoAplicaciones";
const kinds = new Set<Kind>(["clientBeneficiaries", "clientBeneficiaryMethods", "pagoAplicaciones"]);

async function readPage(transaction: admin.firestore.Transaction, request: any, collection: Kind, id: string, cursor: string | undefined) {
  const uid = request.auth.uid as string;
  const user = (await transaction.get(db.doc(`users/${uid}`))).data();
  let role;
  if (collection === "pagoAplicaciones") {
    try { role = assertAuthorized(request.auth, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: "create" }); }
    catch (error: any) {
      if (error?.code !== "permission-denied") throw error;
      role = assertAuthorized(request.auth, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: "conciliate" });
    }
  } else role = assertAuthorized(request.auth, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "beneficiarios" });
  const rootId = String(user?.rootId || uid).trim();
  if (!documentId(rootId)) throw new HttpsError("permission-denied", "Alcance no disponible.");
  let relatedAccess = role === "superadmin";
  if (collection === "pagoAplicaciones") {
    const parent = (await transaction.get(db.doc(`solicitudes/${id}`))).data();
    let allowed = relatedAccess || !!parent && parent.rootId === rootId && [parent.adminId, parent.createdBy].includes(uid);
    if (!allowed && parent && parent.rootId === rootId) for (const clientId of [...new Set([parent.clientId, parent.clienteId].filter(documentId))]) {
      try { await requireClientOperationalAccess({ uid, role, rootId, clientId, transaction, permission: "operatePagos" }); allowed = true; break; }
      catch (error: any) { if (!["permission-denied", "not-found", "failed-precondition"].includes(error?.code)) throw error; }
    }
    relatedAccess = allowed;
  } else {
    try { await requireClientOperationalAccess({ uid, role, rootId, clientId: id, transaction, permission: "viewBasic" }); relatedAccess = true; }
    catch (error: any) { if (!["permission-denied", "not-found", "failed-precondition"].includes(error?.code)) throw error; }
  }
  let query = db.collection(collection).where("rootId", "==", rootId)
    .where(collection === "pagoAplicaciones" ? "solicitudId" : "clientId", "==", id)
    .orderBy(admin.firestore.FieldPath.documentId()).limit(101);
  if (cursor) query = query.startAfter(cursor);
  let candidates: admin.firestore.QueryDocumentSnapshot[];
  if (relatedAccess) candidates = (await transaction.get(query)).docs;
  else {
    const fields = collection === "pagoAplicaciones" ? ["adminId", "createdBy"] : ["adminId", "operadorId", "createdBy"];
    const pages = await Promise.all(fields.map(field => transaction.get(query.where(field, "==", uid))));
    candidates = [...new Map(pages.flatMap(page => page.docs).map(doc => [doc.id, doc])).values()]
      .sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))).slice(0, 101);
    if (!candidates.length) throw new HttpsError("permission-denied", "Registros no disponibles.");
  }
  const docs = candidates.slice(0, 100);
  return { docs, nextCursor: candidates.length > 100 ? docs[docs.length - 1].id : null };
}

function transport(value: any): any {
  if (value instanceof admin.firestore.Timestamp) return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (Array.isArray(value)) return value.map(transport);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transport(item)]));
  return value;
}

export async function readAuthorizedRelatedRecords(request: any) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const { collection, id, cursor } = request.data || {};
  if (!kinds.has(collection) || !documentId(id) || (cursor !== undefined && !documentId(cursor))) throw new HttpsError("invalid-argument", "Consulta inválida.");
  const first = await db.runTransaction(transaction => readPage(transaction, request, collection, id, cursor), { maxAttempts: 3 });
  const current = await db.runTransaction(transaction => readPage(transaction, request, collection, id, cursor), { maxAttempts: 3 });
  if (first.nextCursor !== current.nextCursor || first.docs.length !== current.docs.length || first.docs.some((doc, index) => doc.id !== current.docs[index].id || !doc.updateTime.isEqual(current.docs[index].updateTime))) throw new HttpsError("aborted", "Los registros cambiaron. Actualiza la consulta.");
  return { items: current.docs.map(doc => ({ ...transport(doc.data()), id: doc.id })), nextCursor: current.nextCursor };
}

export const listAuthorizedRelatedRecords = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, readAuthorizedRelatedRecords);
