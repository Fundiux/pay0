import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireWhatsAppSuperadmin } from "./whatsappConnectorAuthority";
import { summarizeAgentChats, type ChatRow } from "./whatsappAgentChatsDomain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const MAX_CHATS = 1000;

export const listWhatsAppAgentChats = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const { rootId } = await requireWhatsAppSuperadmin(request);
  const bindingId = String(request.data?.bindingId ?? "").trim();
  if (!/^[a-f0-9-]{36}$/.test(bindingId)) throw new HttpsError("invalid-argument", "Conexión inválida.");
  const binding = await db.doc(`whatsappQrConnectorBindings/${bindingId}`).get();
  if (!binding.exists || binding.get("rootId") !== rootId) throw new HttpsError("not-found", "Conexión no encontrada.");
  const snap = await db.collection("whatsappAgentChats").where("rootId", "==", rootId).where("bindingId", "==", bindingId).limit(MAX_CHATS).get();
  return { ok: true, ...summarizeAgentChats(snap.docs.map(doc => doc.data() as ChatRow), snap.size === MAX_CHATS) };
});
