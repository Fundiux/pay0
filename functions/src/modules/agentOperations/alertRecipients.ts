import * as admin from "firebase-admin";
import { isCanonicalUserActive, normalizeCanonicalRole } from "../users/authorization";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export type AlertRecipient = { id: string; chatId: string };

/** Superadmins con Telegram vinculado, agrupados por root. */
export async function loadSuperadminAlertRecipients(): Promise<Map<string, AlertRecipient[]>> {
  const linked = await db.collection("telegramUsers").where("role", "==", "superadmin").where("active", "==", true).limit(20).get();
  const byRoot = new Map<string, AlertRecipient[]>();
  for (const doc of linked.docs) {
    const chatId = String(doc.get("chatId") || "").trim();
    const uid = String(doc.get("uid") || "").trim();
    if (!chatId || !uid) continue;
    // role/rootId de telegramUsers se copian al vincular y pueden estar obsoletos: manda el documento canónico de users.
    const user = (await db.collection("users").doc(uid).get()).data();
    if (!user || !isCanonicalUserActive(user) || normalizeCanonicalRole(user.role ?? user.supervisorRole) !== "superadmin") {
      console.error("AGENT_DAILY_ALERT_RECIPIENT_SKIPPED", doc.id);
      continue;
    }
    const rootId = String(user.rootId || uid);
    byRoot.set(rootId, [...(byRoot.get(rootId) || []), { id: doc.id, chatId }]);
  }
  return byRoot;
}
