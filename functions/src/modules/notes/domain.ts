import { HttpsError } from "firebase-functions/v2/https";

const clean = (value: unknown) => String(value ?? "").trim();

/** Authorship is assigned by the server, never taken from the note payload. */
export function manualNoteAuthor(uid: string, user: Record<string, any>) {
  const candidates = [user.displayName, user.name, user.username];
  const name = candidates.map(clean).find(value => value && value !== uid) || "Usuario";
  return { authorId: uid, authorType: "USER", authorName: name, origin: "MANUAL", type: "COMMENT",
    createdBy: uid, createdByName: name, createdByRole: clean(user.role), createdByUsername: clean(user.username) };
}

export function systemNoteAuthor(origin: string, type: string, initiatedBy?: string) {
  return { authorId: "system", authorType: "SYSTEM", authorName: "Sistema", origin, type,
    createdBy: "system", createdByName: "Sistema", createdByRole: "system", system: true,
    ...(initiatedBy ? { initiatedBy } : {}) };
}

export function assertNoteScope(record: Record<string, any>, actor: { uid: string; rootId: string; role: string }) {
  if (record.rootId !== actor.rootId ||
      (actor.role === "admin" && record.adminId !== actor.uid) ||
      (actor.role === "operador" && record.createdBy !== actor.uid)) {
    throw new HttpsError("permission-denied", "No autorizado para comentar este registro.");
  }
}
