import * as admin from "firebase-admin";
import { documentId, noteDocumentId, timestamp, nativeNoteCursor, readNotesPage, NOTES_READ_BATCH_SIZE, NativeNoteCursor } from "./readPagination";
export { NOTES_RESPONSE_BYTES, NOTES_READ_BATCH_SIZE, noteDisplayDate, NoteDisplayDate } from "./readPagination";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { requireClientOperationalAccess } from "../clientDelegations/access";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type Cursor = NativeNoteCursor<"solicitudId">;
function parseInput(data: any) {
  if (!data || !documentId(data.solicitudId)) throw new HttpsError("invalid-argument", "Solicitud inválida.");
  const limit = data.limit === undefined ? 50 : data.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpsError("invalid-argument", "Límite inválido.");
  const cursor = data.cursor as Cursor | undefined;
  if (cursor !== undefined && (!cursor || cursor.version !== 2 || cursor.solicitudId !== data.solicitudId || !noteDocumentId(cursor.id)
    || !timestamp({ seconds: cursor.updateSeconds, nanoseconds: cursor.updateNanoseconds }))) {
    throw new HttpsError("invalid-argument", "Página de notas inválida.");
  }
  return { solicitudId: data.solicitudId as string, limit: limit as number, cursor };
}

// A transaction has at most two distinct client aliases and the canonical resolver's
// sixteen-ancestor bound. There is no cross-request or cross-transaction authority cache.
async function authorize(transaction: admin.firestore.Transaction, auth: any, solicitudId: string) {
  const uid = auth.uid as string;
  const user = await transaction.get(db.doc(`users/${uid}`));
  if (!user.exists) throw new HttpsError("permission-denied", "Notas no disponibles.");
  const profile = user.data()!;
  const role = assertAuthorized(auth, profile, {
    allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "solicitudes", requiredAction: "view",
  });
  const parent = await transaction.get(db.doc(`solicitudes/${solicitudId}`));
  if (!parent.exists) throw new HttpsError("permission-denied", "Notas no disponibles.");
  const rootId = String(profile.rootId || uid).trim();
  const row = parent.data()!;
  // A missing legacy root is an explicit compatibility gap, never inferred from
  // the caller, aliases, economic owner, or a browser-supplied field.
  if (!documentId(row.rootId)) {
    // Expose the fixed compatibility reason only through an explicit stored
    // relationship. Client access and a root-wide role cannot prove this legacy
    // parent's scope and must not reveal its existence or malformed state.
    if (![row.adminId, row.createdBy].includes(uid)) {
      throw new HttpsError("permission-denied", "Notas no disponibles.");
    }
    throw new HttpsError("failed-precondition", "No se pudo verificar el alcance de estas notas. Solicita revisión.", { reason: "ROOT_SCOPE_UNVERIFIED" });
  }
  if (!rootId || row.rootId !== rootId) throw new HttpsError("permission-denied", "Notas fuera de tu alcance.");
  let allowed = role === "superadmin" || [row.adminId, row.createdBy].includes(uid);
  if (!allowed) {
    const aliases = [...new Set([row.clientId, row.clienteId]
      .filter((value): value is string => typeof value === "string")
      .map(value => value.trim()).filter(documentId))];
    for (const clientId of aliases) {
      try {
        await requireClientOperationalAccess({ uid, role, rootId, clientId, transaction, permission: "operateSolicitudes" });
        allowed = true;
        break;
      } catch (error: any) {
        if (!["permission-denied", "not-found", "failed-precondition"].includes(error?.code)) throw error;
      }
    }
  }
  if (!allowed) throw new HttpsError("permission-denied", "No tienes acceso a estas notas.");
  // Rebinding a parent after the query must not authorize delivery of the old scope.
  return JSON.stringify([rootId, row.clientId ?? null, row.clienteId ?? null,
    row.adminId ?? null, row.createdBy ?? null]);
}

// The batch argument is server-internal for the bounded 4-versus-8 SDK gate;
// callable input cannot select it or raise the byte budget.
export async function readSolicitudNotes(request: any, readBatchSize: 4 | 8 = NOTES_READ_BATCH_SIZE) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const { solicitudId, limit, cursor } = parseInput(request.data);
  const notes = db.collection(`solicitudes/${solicitudId}/notas`);
  const page = await db.runTransaction(async transaction => {
    const authority = await authorize(transaction, request.auth, solicitudId);
    const page = await readNotesPage({ transaction, notes, limit, cursor, readBatchSize,
      makeCursor: doc => nativeNoteCursor("solicitudId", solicitudId, doc) });
    return { authority, ...page };
  }, { maxAttempts: 3 });
  // Fresh authority immediately before delivery, including grantor lineage. This
  // cannot retroactively revoke information already delivered to the browser.
  const current = await db.runTransaction(transaction => authorize(transaction, request.auth, solicitudId), { maxAttempts: 3 });
  if (current !== page.authority) throw new HttpsError("permission-denied", "El alcance de las notas cambió. Actualiza la página.");
  return { items: page.items, nextCursor: page.nextCursor };
}

export const listSolicitudNotes = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB", concurrency: 1 }, request => readSolicitudNotes(request));
