import { HttpsError } from "firebase-functions/v2/https";
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";

type Actor = { uid: string; rootId: string; role: string };
export type CreatorOption = { uid: string; displayName: string; username: string; userNumber?: number };
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
  return { uid, displayName: human(data.displayName || data.name || data.nombreUsuario), username: human(data.username), userNumber: Number(data.userNumber || data.numeroUsuario || data.sequenceNumber || 0) || undefined };
}

export async function resolveRecordCreators(db: Firestore, actor: Actor, documents: QueryDocumentSnapshot[]) {
  if (!["superadmin", "admin"].includes(actor.role)) return { labels: new Map<string, CreatorOption>(), creatorOptions: [] as CreatorOption[] };
  // Only the administrative hierarchy is offered as a directory. Authors on
  // already-authorized records may also be shown without expanding row access.
  let directory = db.collection("users").where("rootId", "==", actor.rootId);
  if (actor.role === "admin") directory = directory.where("parentUserId", "==", actor.uid);
  const snapshot = await directory.select("rootId", "displayName", "name", "nombreUsuario", "username", "userNumber", "numeroUsuario", "sequenceNumber").get();
  const labels = new Map<string, CreatorOption>();
  for (const doc of snapshot.docs) labels.set(doc.id, identity(doc.id, doc.data()));
  const missing = [...new Set([actor.uid, ...documents.flatMap(doc => [doc.get("createdBy"), doc.get("actorUid"), doc.get("creatorId"), doc.get("ownerId")].map(text))])].filter(uid => uid && !uid.includes("/") && !labels.has(uid));
  if (missing.length) {
    const people = await db.getAll(...missing.map(uid => db.doc(`users/${uid}`)), { fieldMask: ["rootId", "displayName", "name", "nombreUsuario", "username", "userNumber", "numeroUsuario", "sequenceNumber"] });
    for (const person of people) if (person.exists && text(person.get("rootId") || person.id) === actor.rootId) labels.set(person.id, identity(person.id, person.data() || {}));
  }
  const creatorOptions = [...labels.values()].filter(person => person.displayName || person.username)
    .sort((a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username, "es"));
  return { labels, creatorOptions };
}

export function creatorDisplayFields(data: Record<string, any>, labels: Map<string, CreatorOption>, role: string) {
  if (!["superadmin", "admin"].includes(role)) return {};
  const uid = text(data.createdBy || data.actorUid || data.creatorId);
  // Persisted actor snapshots remain authoritative even after account deletion.
  const legacy = identity(uid, { displayName: data.createdByDisplayName || data.createdByName || data.creatorName,
    username: data.createdByUsername || data.createdUsername });
  let person = labels.get(uid);
  if (!uid) {
    const ownerId = text(data.ownerId || data.operationalOwnerId);
    person = labels.get(ownerId);
    const number = Number(data.nUsuario || (!data.delegateUid && !data.delegateUserNumber ? data.userNumber : 0));
    if (!person && number > 0) {
      const matches = [...labels.values()].filter(candidate => candidate.userNumber === number);
      if (matches.length === 1) person = matches[0];
    }
  }
  const sameOwner = !uid || uid === text(data.operationalOwnerId || data.ownerId);
  const ownerSnapshot = sameOwner ? identity(uid, { displayName: data.operationalOwnerName }).displayName : "";
  return { createdByDisplayName: legacy.displayName || person?.displayName || ownerSnapshot || null,
    createdByUsername: legacy.username || person?.username || null };
}
