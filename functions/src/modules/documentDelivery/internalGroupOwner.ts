// The internal WhatsApp group belongs to an owner: a superadmin or an admin. Operators work under an admin and use
// that admin's group. In PAY0 admins and the superadmin share one rootId and are told apart by the client's adminId,
// so the group is keyed by rootId + the owner's adminId.
import type * as admin from "firebase-admin";

const clean = (value: unknown, max = 200) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export const INTERNAL_GROUPS = "whatsappInternalGroups";

export const internalGroupDocId = (rootId: string, ownerAdminId: string) => `${rootId}__${encodeURIComponent(ownerAdminId)}`;

/**
 * The owner whose internal group serves a client: the client's adminId, or, when that user is an operator,
 * the admin the operator depends on. Empty when the owner cannot be resolved inside the root.
 */
export async function resolveInternalOwnerAdminId(db: admin.firestore.Firestore, rootId: string, clientAdminId: unknown): Promise<string> {
  const adminId = clean(clientAdminId);
  if (!rootId || !adminId || /[\\/\x00-\x1f]/.test(adminId)) return "";
  const snap = await db.doc(`users/${adminId}`).get();
  if (!snap.exists) return "";
  if (clean(snap.get("rootId") || snap.id) !== rootId) return "";
  const role = clean(snap.get("role") || snap.get("supervisorRole"), 40).toLowerCase();
  if (role === "admin" || role === "superadmin") return snap.id;
  if (role === "operador" || role === "operator") {
    // Operators are created with parentUserId and parentRole (the parent is an admin or the superadmin); adminId is the older field.
    const parent = clean(snap.get("parentUserId") || snap.get("adminId"));
    if (!parent || parent === snap.id || /[\\/\x00-\x1f]/.test(parent)) return "";
    const parentSnap = await db.doc(`users/${parent}`).get();
    if (!parentSnap.exists || clean(parentSnap.get("rootId") || parentSnap.id) !== rootId) return "";
    const parentRole = clean(parentSnap.get("role") || parentSnap.get("supervisorRole"), 40).toLowerCase();
    return parentRole === "admin" || parentRole === "superadmin" ? parentSnap.id : "";
  }
  return "";
}

/** The owner's internal group (chat id and name), or null when that owner has not marked one. */
export async function readInternalGroup(db: admin.firestore.Firestore, rootId: string, ownerAdminId: string): Promise<{ groupChatId: string; groupName: string } | null> {
  if (!rootId || !ownerAdminId) return null;
  const snap = await db.doc(`${INTERNAL_GROUPS}/${internalGroupDocId(rootId, ownerAdminId)}`).get();
  if (!snap.exists || clean(snap.get("rootId")) !== rootId || clean(snap.get("ownerAdminId")) !== ownerAdminId) return null;
  const groupChatId = clean(snap.get("groupChatId"));
  return groupChatId ? { groupChatId, groupName: clean(snap.get("groupName"), 160) } : null;
}
