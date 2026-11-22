import type { Firestore } from "firebase-admin/firestore";

// Internal team groups: one document per owner (superadmin or admin) of the root, written by the group-only delivery module.
// Hugo never answers in any of them and none can be assigned to a client. Read only here; an owner without a document or with an empty id has none.
export const INTERNAL_GROUPS = "whatsappInternalGroups";
const MAX_INTERNAL_GROUPS = 200;

export async function readInternalGroupChatIds(db: Firestore, rootId: string): Promise<Set<string>> {
  const snap = await db.collection(INTERNAL_GROUPS).where("rootId", "==", rootId).limit(MAX_INTERNAL_GROUPS).get();
  const ids = new Set<string>();
  for (const doc of snap.docs) {
    if (doc.get("rootId") !== rootId) continue;
    const chatId = String(doc.get("groupChatId") ?? "").trim().slice(0, 200);
    if (chatId) ids.add(chatId);
  }
  return ids;
}
