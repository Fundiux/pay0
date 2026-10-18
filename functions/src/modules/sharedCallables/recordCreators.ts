import { HttpsError } from "firebase-functions/v2/https";
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";

type Actor = { uid: string; rootId: string; role: string };
export type CreatorOption = { uid: string; displayName: string; username: string };
const text = (value: unknown) => String(value ?? "").trim();

export function requestedRecordCreator(value: unknown, role: string): string {
  const uid = text(value);
  if (uid && !["superadmin", "admin"].includes(role)) {
    throw new HttpsError("permission-denied", "El filtro por usuario está disponible para administración.");
  }
  if (uid.length > 128 || uid.includes("/")) throw new HttpsError("invalid-argument", "Usuario inválido.");
  return uid;
}

function identity(uid: string, data: Record<string, any>): CreatorOption {
  // A technical fallback must never become a human display name.
  const human = (value: unknown) => {
    const candidate = text(value);
    return candidate && candidate !== uid && !/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(candidate) ? candidate : "";
  };
  return { uid, displayName: human(data.displayName || data.name || data.nombreUsuario), username: human(data.username) };
}

export async function resolveRecordCreators(db: Firestore, actor: Actor, documents: QueryDocumentSnapshot[]) {
  if (!["superadmin", "admin"].includes(actor.role)) return { labels: new Map<string, CreatorOption>(), creatorOptions: [] as CreatorOption[] };
  // Only the administrative hierarchy is offered as a directory. Authors on
  // already-authorized records may also be shown without expanding row access.
  let directory = db.collection("users").where("rootId", "==", actor.rootId);
  if (actor.role === "admin") directory = directory.where("parentUserId", "==", actor.uid);
  const snapshot = await directory.select("rootId", "displayName", "name", "nombreUsuario", "username").get();
  const labels = new Map<string, CreatorOption>();
  for (const doc of snapshot.docs) labels.set(doc.id, identity(doc.id, doc.data()));
  const missing = [...new Set([actor.uid, ...documents.map(doc => text(doc.get("createdBy")))])].filter(uid => uid && !uid.includes("/") && !labels.has(uid));
  if (missing.length) {
    const people = await db.getAll(...missing.map(uid => db.doc(`users/${uid}`)), { fieldMask: ["rootId", "displayName", "name", "nombreUsuario", "username"] });
    for (const person of people) if (person.exists && text(person.get("rootId") || person.id) === actor.rootId) labels.set(person.id, identity(person.id, person.data() || {}));
  }
  const creatorOptions = [...labels.values()].filter(person => person.displayName || person.username)
    .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username, "es"));
  return { labels, creatorOptions };
}

export function creatorDisplayFields(data: Record<string, any>, labels: Map<string, CreatorOption>, role: string) {
  if (!["superadmin", "admin"].includes(role)) return {};
  const person = labels.get(text(data.createdBy));
  // Keep legacy snapshots if the account no longer exists, never guess its owner.
  const legacy = identity(text(data.createdBy), { displayName: data.createdByDisplayName || data.createdByName, username: data.createdByUsername });
  return { createdByDisplayName: person?.displayName || legacy.displayName || null, createdByUsername: person?.username || legacy.username || null };
}
