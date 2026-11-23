import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { logActivity } from "../../utils/logActivity";
import { AGENTS } from "../agentOperations/contract";
import { INTERNAL_GROUPS } from "./internalGroups";
import { operatorAuthorHashes } from "./domain";
import { REPLY_AGENT_ID } from "./constants";
import { INTERNAL_MAX_AGE_MS, planInternalReplies, type InternalRow } from "./internalChatPlan";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const clean = (value: unknown, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export const INTERNAL_CHAT_STATE = "whatsappAgentInternalChatState";
const stateId = (rootId: string, chatId: string) => `${rootId}__${REPLY_AGENT_ID}__${encodeURIComponent(chatId)}`;
const jobIdFor = (rootId: string, messageId: string) => "internal_" + createHash("sha256").update(`${rootId}|${messageId}`).digest("hex").slice(0, 40);

/**
 * Answers the people of the team who address Hugo in the internal group, with a fixed limited script. Only messages that
 * mention Hugo (or use his name) are ever stored from that group, so there is nothing else to read. Goes through the same
 * signed document sender as every other reply, so its switch and working hours apply.
 */
export async function runInternalChat(rootId: string, nowMs = Date.now()) {
  if (AGENTS.find(agent => agent.id === REPLY_AGENT_ID)?.enabled !== true) return { queued: 0 };
  const groups = await db.collection(INTERNAL_GROUPS).where("rootId", "==", rootId).limit(50).get();
  const groupByChat = new Map<string, { ownerAdminId: string; name: string }>();
  for (const doc of groups.docs) {
    const chatId = clean(doc.get("groupChatId"), 200), ownerAdminId = clean(doc.get("ownerAdminId"), 200);
    if (doc.get("rootId") === rootId && chatId && ownerAdminId) groupByChat.set(chatId, { ownerAdminId, name: clean(doc.get("groupName"), 160) });
  }
  if (!groupByChat.size) { console.log("WHATSAPP_INTERNAL_CHAT_RUN", JSON.stringify({ groupDocs: groups.size, groupsUsable: 0, internalRead: 0, planned: 0, queued: 0 })); return { queued: 0 }; }

  const recent = await db.collection("whatsappInboundMessages").where("rootId", "==", rootId).where("agentId", "==", REPLY_AGENT_ID)
    .where("timestampMs", ">=", nowMs - INTERNAL_MAX_AGE_MS - 60 * 1000).orderBy("timestampMs").limit(400).get();
  const messages: InternalRow[] = recent.docs.filter(doc => groupByChat.has(clean(doc.get("chatId"), 200)) && doc.get("internalGroup") === true).map(doc => ({
    id: doc.id, chatId: clean(doc.get("chatId"), 200), authorHash: doc.get("authorHash") || null, fromMe: doc.get("fromMe") === true,
    timestampMs: Number(doc.get("timestampMs")) || 0, body: String(doc.get("body") ?? ""), mentionsMe: doc.get("mentionsMe") === true, waMessageId: clean(doc.get("messageId"), 200) || undefined,
  }));
  if (!messages.length) { console.log("WHATSAPP_INTERNAL_CHAT_RUN", JSON.stringify({ groupDocs: groups.size, groupsUsable: groupByChat.size, recentRead: recent.size, internalRead: 0, planned: 0, queued: 0 })); return { queued: 0 }; }

  // The agents' own numbers (Hugo's own account, María, Sofía) are never answered.
  const agentPhones: string[] = [];
  for (const doc of (await db.collection("whatsappAgentObservers").where("rootId", "==", rootId).limit(200).get()).docs)
    for (const row of ((doc.get("observers") as any[]) || [])) if (typeof row?.phone === "string" && row.phone) agentPhones.push(row.phone);
  const ignoreHashes = operatorAuthorHashes(rootId, agentPhones);

  const chats = [...new Set(messages.map(row => row.chatId))];
  const [jobDocs, stateDocs] = await Promise.all([
    db.getAll(...messages.map(row => db.doc(`documentDeliveryJobs/${jobIdFor(rootId, row.id)}`))),
    db.getAll(...chats.map(chatId => db.doc(`${INTERNAL_CHAT_STATE}/${stateId(rootId, chatId)}`))),
  ]);
  const repliedIds = new Set(messages.filter((_row, index) => jobDocs[index].exists).map(row => row.id));
  const lastReplyAtByChat: Record<string, number | undefined> = {};
  stateDocs.forEach((doc, index) => { if (doc.exists) lastReplyAtByChat[chats[index]] = Number(doc.get("lastReplyAtMs")) || undefined; });

  const planned = planInternalReplies({ nowMs, messages, ignoreHashes, repliedIds, lastReplyAtByChat });
  const diag = { groupDocs: groups.size, groupsUsable: groupByChat.size, recentRead: recent.size, internalRead: messages.length, alreadyReplied: repliedIds.size, ignoredAgentNumbers: messages.filter(row => row.authorHash && ignoreHashes.has(row.authorHash)).length, planned: planned.length, queued: 0 };
  let queued = 0;
  for (const reply of planned) {
    const group = groupByChat.get(reply.chatId)!;
    const jobId = jobIdFor(rootId, reply.messageId), jobRef = db.doc(`documentDeliveryJobs/${jobId}`);
    const deliveryId = encodeURIComponent(reply.chatId);
    const created = await db.runTransaction(async tx => {
      if ((await tx.get(jobRef)).exists) return false;
      const stamp = { createdAt: FieldValue.serverTimestamp(), releasedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
      tx.create(jobRef, {
        rootId, channel: "WHATSAPP", sourceType: "GRUPO_RESPUESTA", sourceId: reply.messageId, clienteId: group.ownerAdminId, clienteNombre: null,
        message: "respuesta en grupo interno", caption: reply.text, textBody: reply.text, status: "READY_FOR_SEND", releaseStatus: "RELEASED", origin: "AUTOMATIC",
        deliveryMode: "MULTI_TARGET", targetLabel: group.name || "Grupo interno", targetChatId: reply.chatId, targetChatName: group.name || "Grupo interno", targetChatType: "GROUP",
        targetDestinationsCount: 1, replyKind: reply.kind, releasedAtMs: nowMs, ...(reply.mentionMessageId ? { mentionInboundMessageId: reply.mentionMessageId } : {}), ...stamp,
      });
      tx.create(jobRef.collection("deliveries").doc(deliveryId), {
        rootId, channel: "WHATSAPP", status: "PENDING_SEND", connectorId: "default", chatId: reply.chatId, chatName: group.name || "Grupo interno", chatType: "GROUP", safeDocId: deliveryId, ...stamp,
      });
      tx.set(db.doc(`${INTERNAL_CHAT_STATE}/${stateId(rootId, reply.chatId)}`), { rootId, agentId: REPLY_AGENT_ID, chatId: reply.chatId, lastReplyAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!created) continue;
    queued++;
    await logActivity({
      event: "WHATSAPP_RESPUESTA_GRUPO_INTERNO_ENCOLADA", rootId, actorUid: "SYSTEM", actorName: "Hugo", actorRole: "system", referenceId: jobId, referenceType: "documentDeliveryJob",
      entityId: jobId, entityType: "document_delivery", description: `Hugo respondió (${reply.kind === "INTERNAL_GREETING" ? "saludo" : "respuesta limitada"}) a una mención en el grupo interno ${group.name || ""}.`.trim(),
    }).catch(() => undefined);
  }
  diag.queued = queued;
  console.log("WHATSAPP_INTERNAL_CHAT_RUN", JSON.stringify(diag));
  return { queued };
}
