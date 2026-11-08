import * as admin from "firebase-admin";
import { isCanonicalUserActive, normalizeCanonicalRole } from "../users/authorization";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export type AlertRecipient = { id: string; chatId: string };
/** Active links read per run; the query stays bounded and a warning is logged if the limit is reached. */
const LINK_LIMIT = 200;

/**
 * Telegram recipients grouped by root. A link receives the alert when it belongs to the root owner
 * (uid == rootId, as the notifications that do arrive resolve it) or when the canonical users document
 * says its user is an active superadmin. telegramUsers.role is copied when the link is made and can be
 * empty or stale, so it is ignored. Links are deduplicated by chat id.
 */
export async function loadSuperadminAlertRecipients(): Promise<Map<string, AlertRecipient[]>> {
  const linked = await db.collection("telegramUsers").where("active", "==", true).limit(LINK_LIMIT).get();
  if (linked.size >= LINK_LIMIT) console.error("AGENT_ALERT_RECIPIENT_LINK_LIMIT_REACHED", LINK_LIMIT);
  const users = new Map<string, Record<string, any> | undefined>();
  const byRoot = new Map<string, AlertRecipient[]>();
  const seen = new Set<string>();
  for (const doc of [...linked.docs].sort((a, b) => a.id.localeCompare(b.id))) {
    const chatId = String(doc.get("chatId") || "").trim();
    const uid = String(doc.get("uid") || "").trim();
    if (!chatId || !uid) continue;
    if (!users.has(uid)) users.set(uid, (await db.collection("users").doc(uid).get()).data());
    const user = users.get(uid);
    if (!user) { console.error("AGENT_DAILY_ALERT_RECIPIENT_SKIPPED", doc.id); continue; }
    if (!isCanonicalUserActive(user)) continue;
    const rootId = String(user.rootId || uid);
    const isRootOwner = uid === rootId;
    if (!isRootOwner && normalizeCanonicalRole(user.role ?? user.supervisorRole) !== "superadmin") continue;
    const key = `${rootId}\u0000${chatId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byRoot.set(rootId, [...(byRoot.get(rootId) || []), { id: doc.id, chatId }]);
  }
  return byRoot;
}
