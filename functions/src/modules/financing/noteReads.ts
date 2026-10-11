import * as admin from "firebase-admin";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { assertDispersionFundingOwner } from "./dispersionFunding";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type Cursor = { version: 2; dispersionId: string; updateSeconds: number; updateNanoseconds: number; id: string };
function documentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 1500
    && value === value.trim() && !value.includes("/") && value !== "." && value !== "..";
}
function noteDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 1500
    && !value.includes("/") && value !== "." && value !== "..";
}
function timestamp(value: any): value is { seconds: number; nanoseconds: number } {
  return value && Number.isInteger(value.seconds) && value.seconds >= -62135596800 && value.seconds <= 253402300799
    && Number.isInteger(value.nanoseconds) && value.nanoseconds >= 0 && value.nanoseconds < 1000000000;
}
function storedTimestamp(value: any): value is Timestamp {
  return value instanceof Timestamp && timestamp(value);
}
function parseInput(data: any) {
  if (!data || !documentId(data.dispersionId)) throw new HttpsError("invalid-argument", "Dispersión inválida.");
  const limit = data.limit === undefined ? 50 : data.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpsError("invalid-argument", "Límite inválido.");
  const cursor = data.cursor as Cursor | undefined;
  if (cursor !== undefined && (!cursor || cursor.version !== 2 || cursor.dispersionId !== data.dispersionId || !noteDocumentId(cursor.id)
    || !timestamp({ seconds: cursor.updateSeconds, nanoseconds: cursor.updateNanoseconds }))) {
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

// Application budget, not a historical content limit. Entire notes are retained.
export const NOTES_RESPONSE_BYTES = 8 * 1024 * 1024;
export const NOTES_READ_BATCH_SIZE: 4 | 8 = 4;
export type NoteDisplayDate = { kind: "NONE" } | { kind: "STRING"; value: string }
  | { kind: "MILLISECONDS" | "SECONDS"; value: number }
  | { kind: "TIMESTAMP"; seconds: number; nanoseconds: number };
// Preserve browser interpretation of strings. Never parse historical strings in the
// server timezone, expose arbitrary map fields, or use the display value for ordering.
export function noteDisplayDate(value: unknown): NoteDisplayDate {
  const none: NoteDisplayDate = { kind: "NONE" };
  if (!value) return none;
  if (storedTimestamp(value)) return { kind: "TIMESTAMP", seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (typeof value === "string") return { kind: "STRING", value };
  if (typeof value === "number") return Number.isFinite(new Date(value).getTime()) ? { kind: "MILLISECONDS", value } : none;
  if (value === true) return { kind: "MILLISECONDS", value: 1 };
  if (Array.isArray(value)) {
    // The old browser Date(array) converted primitive arrays to their comma string.
    // Do not call data-provided methods or serialize objects contained in arrays.
    const operand = (items: unknown[], depth: number): string | null => {
      if (depth > 20) return null;
      const parts: string[] = [];
      for (const item of items) {
        if (item == null) parts.push("");
        else if (["string", "number", "boolean"].includes(typeof item)) parts.push(String(item));
        else if (Array.isArray(item)) { const nested = operand(item, depth + 1); if (nested === null) return null; parts.push(nested); }
        else return null;
      }
      return parts.join(",");
    };
    const text = operand(value, 0);
    return text ? { kind: "STRING", value: text } : none;
  }
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    const seconds = typeof row.seconds === "number" ? row.seconds : typeof row._seconds === "number" ? row._seconds : undefined;
    if (seconds !== undefined && Number.isFinite(new Date(seconds * 1000).getTime())) return { kind: "SECONDS", value: seconds };
  }
  return none;
}
type NoteDto = { id: string; displayDate: NoteDisplayDate; updateSeconds: number; updateNanoseconds: number; [key: string]: unknown };
function cursorFor(doc: admin.firestore.DocumentSnapshot, dispersionId: string): Cursor {
  if (!storedTimestamp(doc.updateTime)) throw new HttpsError("failed-precondition", "La versión de una nota cambió. Actualiza las notas.");
  return { version: 2, dispersionId, id: doc.id, updateSeconds: doc.updateTime.seconds, updateNanoseconds: doc.updateTime.nanoseconds };
}
const noteStrings = ["text", "authorType", "origin", "source", "createdBy", "createdByRole", "authorId", "authorName", "createdByName", "createdByUsername"];
function noteDto(doc: admin.firestore.QueryDocumentSnapshot): NoteDto {
  const row = doc.data();
  if (!Object.prototype.hasOwnProperty.call(row, "createdAt") || !storedTimestamp(doc.updateTime)) throw new HttpsError("failed-precondition", "La página de notas cambió. Actualiza las notas.");
  const result: NoteDto = { id: doc.id, displayDate: noteDisplayDate(row.createdAt), updateSeconds: doc.updateTime.seconds, updateNanoseconds: doc.updateTime.nanoseconds };
  for (const key of noteStrings) if (typeof row[key] === "string") result[key] = row[key];
  if (typeof row.system === "boolean") result.system = row.system;
  return result;
}

// The batch argument is server-internal for the bounded 4-versus-8 SDK gate;
// callable input cannot select it or raise the byte budget.
export async function readClientDispersionNotes(request: any, readBatchSize: 4 | 8 = NOTES_READ_BATCH_SIZE) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const { dispersionId, limit, cursor } = parseInput(request.data);
  const notes = db.collection(`clientDispersions/${dispersionId}/notas`);
  const page = await db.runTransaction(async transaction => {
    const authority = await authorize(transaction, request.auth, dispersionId);
    // A cursor is a position, never an authorization token. Bind it to an actual
    // note under the already-authorized parent and reject modified/deleted anchors.
    let position: admin.firestore.DocumentSnapshot | undefined;
    if (cursor) {
      const anchor = await transaction.get(notes.doc(cursor.id));
      const time = anchor.updateTime;
      if (!anchor.exists || !Object.prototype.hasOwnProperty.call(anchor.data() || {}, "createdAt") || !storedTimestamp(time)
        || time.seconds !== cursor.updateSeconds || time.nanoseconds !== cursor.updateNanoseconds) {
        throw new HttpsError("failed-precondition", "La página cambió. Actualiza las notas.");
      }
      position = anchor;
    }
    const items: NoteDto[] = [];
    let itemBytes = 0, scanned = 0, more = false, finished = false;
    let lastDelivered: Cursor | null = null;
    // Each iteration retains only this small snapshot and the emitted DTO prefix.
    // Never accumulate snapshots or decode all 100 potentially 1 MiB documents.
    while (!finished && scanned < limit + 1) {
      const batchLimit = Math.min(readBatchSize, limit + 1 - scanned);
      let query = notes.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc").limit(batchLimit);
      if (position) query = query.startAfter(position);
      const snapshot = await transaction.get(query);
      scanned += snapshot.size;
      if (!snapshot.size) break;
      for (const doc of snapshot.docs) {
        if (items.length === limit) { more = true; finished = true; break; }
        const item = noteDto(doc);
        const candidate = cursorFor(doc, dispersionId);
        const bytes = Buffer.byteLength(JSON.stringify(item), "utf8");
        // SDK encode leaves this DTO's primitives unchanged. Include the real
        // result envelope, commas and cursor; no repeated serialization of pages.
        const envelope = Buffer.byteLength(JSON.stringify({ result: { items: [], nextCursor: candidate } }), "utf8");
        if (itemBytes + bytes + items.length + envelope > NOTES_RESPONSE_BYTES) {
          if (!items.length) throw new HttpsError("resource-exhausted", "La nota excede el transporte disponible. Contacta a soporte.");
          more = true; finished = true; break;
        }
        items.push(item); itemBytes += bytes;
        position = doc; lastDelivered = candidate;
      }
      if (snapshot.size < batchLimit) finished = true;
    }
    // A byte cut resumes after the last emitted note, not the last fetched row.
    // This is a complete prefix of the ordered range; no note is truncated/skipped.
    return { authority, items, nextCursor: more ? lastDelivered : null };
  }, { maxAttempts: 3 });
  // Fresh authority immediately before delivery, including grantor lineage. This
  // cannot retroactively revoke information already delivered to the browser.
  const current = await db.runTransaction(transaction => authorize(transaction, request.auth, dispersionId), { maxAttempts: 3 });
  if (current !== page.authority) throw new HttpsError("permission-denied", "El alcance de las notas cambió. Actualiza la página.");
  return { items: page.items, nextCursor: page.nextCursor };
}

export const listClientDispersionNotes = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB", concurrency: 1 }, request => readClientDispersionNotes(request));
