import * as admin from "firebase-admin";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { assertDispersionFundingOwner } from "./dispersionFunding";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type Cursor = { version: 1; dispersionId: string; seconds: number; nanoseconds: number; id: string };
function documentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 1500
    && value === value.trim() && !value.includes("/") && value !== "." && value !== "..";
}
function timestamp(value: any): value is { seconds: number; nanoseconds: number } {
  return value && Number.isInteger(value.seconds) && value.seconds >= -62135596800 && value.seconds <= 253402300799
    && Number.isInteger(value.nanoseconds) && value.nanoseconds >= 0 && value.nanoseconds < 1000000000;
}
function parseInput(data: any) {
  if (!data || !documentId(data.dispersionId)) throw new HttpsError("invalid-argument", "Dispersión inválida.");
  const limit = data.limit === undefined ? 50 : data.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpsError("invalid-argument", "Límite inválido.");
  const cursor = data.cursor as Cursor | undefined;
  if (cursor !== undefined && (!cursor || cursor.version !== 1 || cursor.dispersionId !== data.dispersionId || !documentId(cursor.id) || !timestamp(cursor))) {
    throw new HttpsError("invalid-argument", "Página de notas inválida.");
  }
  return { dispersionId: data.dispersionId as string, limit: limit as number, cursor };
}

// A transaction has at most two distinct client aliases and the canonical resolver's
// sixteen-ancestor bound. There is no cross-request or cross-transaction authority cache.
async function authorize(transaction: admin.firestore.Transaction, auth: any, dispersionId: string) {
  const uid = auth.uid as string;
  const [user, parent] = await Promise.all([
    transaction.get(db.doc(`users/${uid}`)), transaction.get(db.doc(`clientDispersions/${dispersionId}`)),
  ]);
  if (!user.exists || !parent.exists) throw new HttpsError("permission-denied", "Notas no disponibles.");
  const profile = user.data()!;
  const role = assertAuthorized(auth, profile, {
    allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "dispersiones",
  });
  const rootId = String(profile.rootId || uid).trim();
  const row = parent.data()!;
  if (!rootId || row.rootId !== rootId) throw new HttpsError("permission-denied", "Notas fuera de tu alcance.");
  assertDispersionFundingOwner({ uid, role, rootId, dispersion: row });
  let allowed = role === "superadmin" || row.fundingSource?.holderType === "USER"
    || [row.adminId, row.operadorId, row.createdBy].includes(uid);
  if (!allowed) {
    const aliases = [...new Set([row.clientId, row.clienteId]
      .filter(value => ["string", "number", "boolean"].includes(typeof value))
      .map(value => String(value || "").trim()).filter(documentId))];
    for (const clientId of aliases) {
      try {
        await requireClientOperationalAccess({ uid, role, rootId, clientId, transaction, permission: "viewBasic" });
        allowed = true;
        break;
      } catch (error: any) {
        if (!["permission-denied", "not-found", "failed-precondition"].includes(error?.code)) throw error;
      }
    }
  }
  if (!allowed) throw new HttpsError("permission-denied", "No tienes acceso a estas notas.");
  // Rebinding a parent after the query must not authorize delivery of the old scope.
  return JSON.stringify([rootId, row.clientId ?? null, row.clienteId ?? null, row.adminId ?? null,
    row.operadorId ?? null, row.createdBy ?? null, row.ownerUid ?? null, row.fundingSource ?? null]);
}

const noteStrings = ["text", "authorType", "origin", "source", "createdBy", "createdByRole", "authorId", "authorName", "createdByName", "createdByUsername"];
function noteDto(doc: admin.firestore.QueryDocumentSnapshot) {
  const row = doc.data();
  if (!timestamp(row.createdAt)) throw new HttpsError("failed-precondition", "Una nota requiere revisión de su fecha.");
  const result: Record<string, unknown> = { id: doc.id, createdAt: { seconds: row.createdAt.seconds, nanoseconds: row.createdAt.nanoseconds } };
  for (const key of noteStrings) if (typeof row[key] === "string") result[key] = row[key];
  if (typeof row.system === "boolean") result.system = row.system;
  return result;
}

export const listClientDispersionNotes = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async request => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const { dispersionId, limit, cursor } = parseInput(request.data);
  const notes = db.collection(`clientDispersions/${dispersionId}/notas`);
  const page = await db.runTransaction(async transaction => {
    const authority = await authorize(transaction, request.auth, dispersionId);
    // A cursor is a position, never an authorization token. Bind it to an actual
    // note under the already-authorized parent and reject modified/deleted anchors.
    if (cursor) {
      const anchor = await transaction.get(notes.doc(cursor.id));
      const time = anchor.data()?.createdAt;
      if (!anchor.exists || !timestamp(time) || time.seconds !== cursor.seconds || time.nanoseconds !== cursor.nanoseconds) {
        throw new HttpsError("failed-precondition", "La página cambió. Actualiza las notas.");
      }
    }
    let query = notes.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc").limit(limit + 1);
    if (cursor) query = query.startAfter(new Timestamp(cursor.seconds, cursor.nanoseconds), cursor.id);
    const snapshot = await transaction.get(query);
    const selected = snapshot.docs.slice(0, limit);
    const items = selected.map(noteDto);
    const last = selected[selected.length - 1];
    const time = last?.data().createdAt;
    const nextCursor: Cursor | null = snapshot.size > limit && last ? { version: 1, dispersionId, seconds: time.seconds, nanoseconds: time.nanoseconds, id: last.id } : null;
    return { authority, items, nextCursor };
  }, { maxAttempts: 3 });
  // Fresh authority immediately before delivery, including grantor lineage. This
  // cannot retroactively revoke information already delivered to the browser.
  const current = await db.runTransaction(transaction => authorize(transaction, request.auth, dispersionId), { maxAttempts: 3 });
  if (current !== page.authority) throw new HttpsError("permission-denied", "El alcance de las notas cambió. Actualiza la página.");
  return { items: page.items, nextCursor: page.nextCursor };
});
