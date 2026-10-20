import type * as admin from "firebase-admin";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

export function documentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 1500
    && value === value.trim() && !value.includes("/") && value !== "." && value !== "..";
}
export function noteDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 1500
    && !value.includes("/") && value !== "." && value !== "..";
}
export function timestamp(value: any): value is { seconds: number; nanoseconds: number } {
  return value && Number.isInteger(value.seconds) && value.seconds >= -62135596800 && value.seconds <= 253402300799
    && Number.isInteger(value.nanoseconds) && value.nanoseconds >= 0 && value.nanoseconds < 1000000000;
}
function storedTimestamp(value: any): value is Timestamp {
  return value instanceof Timestamp && timestamp(value);
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
const noteStrings = ["text", "authorType", "origin", "source", "createdBy", "createdByRole", "authorId", "authorName", "createdByName", "createdByUsername"] as const;
export type NoteDto = { id: string; displayDate: NoteDisplayDate; updateSeconds: number; updateNanoseconds: number; system?: boolean }
  & Partial<Record<typeof noteStrings[number], string>>;
export type NoteCursorPosition = { version: 2; id: string; updateSeconds: number; updateNanoseconds: number };
export type NativeNoteCursor<K extends string> = NoteCursorPosition & Record<K, string>;
export function nativeNoteCursor<K extends string>(field: K, parentId: string, doc: admin.firestore.DocumentSnapshot): NativeNoteCursor<K> {
  if (!storedTimestamp(doc.updateTime)) throw new HttpsError("failed-precondition", "La versión de una nota cambió. Actualiza las notas.");
  return { version: 2, [field]: parentId, id: doc.id, updateSeconds: doc.updateTime.seconds, updateNanoseconds: doc.updateTime.nanoseconds } as NativeNoteCursor<K>;
}
function noteDto(doc: admin.firestore.QueryDocumentSnapshot): NoteDto {
  const row = doc.data();
  if (!Object.prototype.hasOwnProperty.call(row, "createdAt") || !storedTimestamp(doc.updateTime)) throw new HttpsError("failed-precondition", "La página de notas cambió. Actualiza las notas.");
  const result: NoteDto = { id: doc.id, displayDate: noteDisplayDate(row.createdAt), updateSeconds: doc.updateTime.seconds, updateNanoseconds: doc.updateTime.nanoseconds };
  for (const key of noteStrings) if (typeof row[key] === "string") result[key] = row[key];
  if (typeof row.system === "boolean") result.system = row.system;
  return result;
}

// Exact UTF-8 bytes between JSON string quotes, without allocating an expanded
// escaped copy. Node's well-formed JSON encoding escapes isolated surrogates.
function jsonStringContentBytes(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 34 || code === 92) bytes += 2;
    else if (code < 32) bytes += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length
      && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
    else bytes += 3;
  }
  return bytes;
}

// Internal closed-DTO contract, not a general JavaScript serializer. noteDto()
// constructs all own fields and a plain displayDate object; historical objects,
// arrays and methods are never copied into this DTO. Preserve native encoding of
// numbers, keys and structure; replace only admitted string contents in a small
// skeleton. The original complete note remains untouched for actual delivery.
export function noteDtoJsonBytes(item: NoteDto): number {
  const skeleton: NoteDto = { ...item };
  let stringBytes = 0;
  for (const key of noteStrings) {
    if (typeof item[key] === "string") {
      stringBytes += jsonStringContentBytes(item[key]!);
      skeleton[key] = "";
    }
  }
  if (item.displayDate.kind === "STRING") {
    stringBytes += jsonStringContentBytes(item.displayDate.value);
    skeleton.displayDate = { kind: "STRING", value: "" };
  }
  return Buffer.byteLength(JSON.stringify(skeleton), "utf8") + stringBytes;
}

// Internal pagination port: callers must authorize the supplied parent within this
// same transaction before entering, and revalidate authority before delivery.
export async function readNotesPage<C extends NoteCursorPosition>(params: {
  transaction: admin.firestore.Transaction;
  notes: admin.firestore.CollectionReference;
  limit: number;
  cursor?: C;
  makeCursor: (doc: admin.firestore.DocumentSnapshot) => C;
  readBatchSize: 4 | 8;
}) {
  const { transaction, notes, limit, cursor, makeCursor, readBatchSize } = params;
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
    let lastDelivered: C | null = null;
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
        const candidate = makeCursor(doc);
        const bytes = noteDtoJsonBytes(item);
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
    return { items, nextCursor: more ? lastDelivered : null };
}
