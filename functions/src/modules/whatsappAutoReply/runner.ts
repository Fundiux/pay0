import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logActivity } from "../../utils/logActivity";
import { operatorAuthorHashes, MAX_REPLY_AGE_MS, OWNER_WORKING_HOURS } from "./domain";
import { readInternalGroupChatIds } from "./internalGroups";
import type { RequestLookup, StatusSubject } from "./domain";
import { AGENTS } from "../agentOperations/contract";
import { queueAutomaticClientDelivery } from "../documentDelivery/whatsappAutomaticDelivery";
import { agentCanAct, readAgentModes } from "./modes";
import { mexicoMonthKey } from "./metrics";
import { runUnansweredAlerts } from "./unansweredRunner";
import { runInternalChat } from "./internalChat";
import { findMissedQuestions, LESSONS, missedLessonId } from "./lessons";
import { refreshPlaybookProposals } from "./playbook";
import { runReplySimulation } from "./simulationRunner";
import { clienteIdOfGroup, lookupRequestForClient } from "./requestLookup";
import { planGroupReplies, type InboundRow, type LastReply, type PlannedReply, type ReplyMode, type ReplyRuntimeConfig } from "./planner";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

import { REPLY_AGENT_ID, LOOKBACK_MS, MAX_MESSAGES_PER_RUN } from "./constants";
export { REPLY_AGENT_ID };
export const REPLY_CONFIGS = "whatsappAgentReplyConfigs";
const REPLY_STATE = "whatsappAgentReplyState";
export const REPLY_METRICS = "whatsappAgentReplyMetrics";
export const CONVERSATION_STATE = "whatsappAgentConversationState";
const conversationStateId = (rootId: string, chatId: string) => `${rootId}__${REPLY_AGENT_ID}__${encodeURIComponent(chatId)}`;
const BRAND_OR_INTERNAL = /pay\s*-?\s*0|despacho/i;

const clean = (value: unknown, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const replyConfigId = (rootId: string) => `${rootId}__${REPLY_AGENT_ID}`;

// A client name is greeted only when it carries no brand or internal reference.
const safeName = (value: unknown) => { const text = clean(value, 120); return text && !BRAND_OR_INTERNAL.test(text) ? text : ""; };

export function replyJobId(rootId: string, inboundId: string): string {
  return "reply_" + createHash("sha256").update(`${rootId}|${inboundId}`).digest("hex").slice(0, 40);
}

/** The job and delivery that the existing document sender claims, sends and reports. */
export function buildReplyDelivery(rootId: string, groupName: string, ownerName: string, plan: PlannedReply, nowMs: number) {
  const jobId = replyJobId(rootId, plan.messageId);
  const job = {
    rootId, channel: "WHATSAPP", sourceType: "GRUPO_RESPUESTA", sourceId: plan.messageId, clienteId: plan.ownerUserUid, clienteNombre: ownerName || null,
    message: "respuesta en grupo", caption: plan.text, textBody: plan.text, status: "READY_FOR_SEND", releaseStatus: "RELEASED", origin: "AUTOMATIC",
    deliveryMode: "MULTI_TARGET", targetLabel: groupName || "Grupo", targetChatId: plan.chatId, targetChatName: groupName || "Grupo", targetChatType: "GROUP",
    targetDestinationsCount: 1, replyKind: plan.kind, releasedAtMs: nowMs,
    ...(plan.mentionMessageId ? { mentionInboundMessageId: plan.mentionMessageId } : {}),
  };
  const delivery = {
    rootId, channel: "WHATSAPP", status: "PENDING_SEND", connectorId: "default", chatId: plan.chatId, chatName: groupName || "Grupo", chatType: "GROUP",
    safeDocId: encodeURIComponent(plan.chatId),
  };
  return { jobId, deliveryId: encodeURIComponent(plan.chatId), job, delivery };
}

type ReplyConfigDoc = { enabled: boolean; mode: ReplyMode };

export async function readReplyConfig(rootId: string): Promise<ReplyConfigDoc> {
  const snap = await db.doc(`${REPLY_CONFIGS}/${replyConfigId(rootId)}`).get();
  return { enabled: snap.get("enabled") === true, mode: snap.get("mode") === "STANDARD" ? "STANDARD" : "GREETINGS_ONLY" };
}

async function firstObservedAt(rootId: string, chatId: string): Promise<number | null> {
  const ref = db.doc(`${REPLY_STATE}/${rootId}__${REPLY_AGENT_ID}__${encodeURIComponent(chatId)}`);
  const known = await ref.get();
  if (known.exists && Number(known.get("firstObservedAtMs")) > 0) return Number(known.get("firstObservedAtMs"));
  const first = await db.collection("whatsappInboundMessages").where("rootId", "==", rootId).where("agentId", "==", REPLY_AGENT_ID).where("chatId", "==", chatId)
    .orderBy("timestampMs").limit(1).get();
  const at = first.empty ? 0 : Number(first.docs[0].get("timestampMs")) || 0;
  if (at > 0) await ref.set({ rootId, agentId: REPLY_AGENT_ID, chatId, firstObservedAtMs: at, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  return at > 0 ? at : null;
}

/** Tells the team's internal group that a client's request was not found. Goes through the internal-notice route; no client is ever the target. */
async function noticeInternalTeam(rootId: string, item: PlannedReply, groupName: string, clienteId: string | null) {
  if (!clienteId) return;
  const what = item.subject === "TRANSFER" ? "su transferencia" : item.subject === "INVOICE" ? "su factura" : "una solicitud";
  try {
    await queueAutomaticClientDelivery({
      rootId, sourceType: "AVISO_GRUPO_INTERNO", sourceId: `${clienteId}:solicitud-no-encontrada:${item.messageId}`, clienteId, clienteNombre: null, caption: "",
      textBody: `Aviso de Hugo: en el grupo «${groupName || "sin nombre"}» un cliente preguntó por ${what} y no encontré la solicitud en el sistema. Ya le pedí confirmar el nombre del cliente o de quien hizo el pago. Por favor revísenlo.`,
      notes: "Aviso interno: solicitud no encontrada en una pregunta del grupo.",
    });
  } catch (error) { console.error("WHATSAPP_REPLY_INTERNAL_NOTICE_FAILED", { rootId, message: error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN" }); }
}

export async function runGroupReplies(rootId: string, nowMs = Date.now()) {
  const stored = await readReplyConfig(rootId);
  const internalChatIds = await readInternalGroupChatIds(db, rootId);
  if (!stored.enabled) return { skipped: "OFF" as const, queued: 0 };
  const config: ReplyRuntimeConfig = { enabled: true, mode: stored.mode, workingHours: OWNER_WORKING_HOURS };

  // Only groups assigned to a user are answered.
  const observers = await db.collection("whatsappAgentObservers").where("rootId", "==", rootId).where("active", "==", true).limit(200).get();
  const ownerByChat: Record<string, string> = {}, groupNameByChat: Record<string, string> = {}, agentPhones: string[] = [];
  const hugoEnabled = AGENTS.find(agent => agent.id === REPLY_AGENT_ID)?.enabled === true;
  for (const doc of observers.docs) {
    const owner = clean(doc.get("ownerUserUid"), 128), chatId = clean(doc.get("groupChatId"), 200);
    const observerRows = (doc.get("observers") as any[]) || [];
    for (const row of observerRows) if (typeof row?.phone === "string" && row.phone) agentPhones.push(row.phone);
    const observed = observerRows.some(row => row?.agentId === REPLY_AGENT_ID);
    // Observer mode is the default: Hugo answers only in the groups the owner switched to acting.
    const acting = agentCanAct(REPLY_AGENT_ID, readAgentModes(doc.get("agentModes")), hugoEnabled);
    if (owner && chatId && observed && acting && !internalChatIds.has(chatId)) { ownerByChat[chatId] = owner; groupNameByChat[chatId] = clean(doc.get("groupName"), 160); }
  }
  if (!Object.keys(ownerByChat).length) return { skipped: "NO_GROUPS" as const, queued: 0 };

  const recent = await db.collection("whatsappInboundMessages").where("rootId", "==", rootId).where("agentId", "==", REPLY_AGENT_ID)
    .where("timestampMs", ">=", nowMs - LOOKBACK_MS).orderBy("timestampMs").limit(MAX_MESSAGES_PER_RUN).get();
  const messages: InboundRow[] = recent.docs.filter(doc => ownerByChat[clean(doc.get("chatId"), 200)]).map(doc => ({
    id: doc.id, chatId: clean(doc.get("chatId"), 200), authorHash: doc.get("authorHash") || null, fromMe: doc.get("fromMe") === true,
    timestampMs: Number(doc.get("timestampMs")) || 0, type: clean(doc.get("type"), 40), body: String(doc.get("body") ?? ""), waMessageId: clean(doc.get("messageId"), 200) || undefined,
  }));
  if (!messages.length) return { skipped: "NO_MESSAGES" as const, queued: 0 };

  const chats = [...new Set(messages.map(row => row.chatId))];
  const firstObservedByChat: Record<string, number | null> = {};
  for (const chatId of chats) firstObservedByChat[chatId] = await firstObservedAt(rootId, chatId);

  const operatorDocs = await db.collection("userOperatorNumbers").where("rootId", "==", rootId).limit(500).get();
  const operatorHashes = new Set<string>();
  for (const doc of operatorDocs.docs) for (const hash of operatorAuthorHashes(rootId, (doc.get("numbers") as string[]) || [])) operatorHashes.add(hash);

  // The agents' own numbers are never clients: a message from another agent is neither answered nor counted as a person.
  for (const hash of operatorAuthorHashes(rootId, agentPhones)) operatorHashes.add(hash);

  const jobRefs = messages.map(row => db.doc(`documentDeliveryJobs/${replyJobId(rootId, row.id)}`));
  const existing = await db.getAll(...jobRefs);
  const repliedIds = new Set(messages.filter((_row, index) => existing[index].exists).map(row => row.id));

  const owners = [...new Set(chats.map(chatId => ownerByChat[chatId]))];
  const ownerDocs = await db.getAll(...owners.map(uid => db.doc(`users/${uid}`)));
  const clientNameByOwner: Record<string, string> = {};
  ownerDocs.forEach((doc, index) => { clientNameByOwner[owners[index]] = safeName(doc.get("displayName") || doc.get("nombreUsuario") || doc.get("username")); });

  // Real lookup of the client's request, prefetched per group because the planner is synchronous.
  const lookupByChat: Record<string, Partial<Record<StatusSubject, RequestLookup>>> = {}, clienteByChat: Record<string, string | null> = {};
  for (const chatId of chats.slice(0, 25)) {
    clienteByChat[chatId] = await clienteIdOfGroup(db, rootId, chatId);
    lookupByChat[chatId] = {};
    for (const subject of ["TRANSFER", "INVOICE"] as StatusSubject[]) lookupByChat[chatId][subject] = await lookupRequestForClient(db, rootId, clienteByChat[chatId], subject);
  }
  const stateDocs = await db.getAll(...chats.map(chatId => db.doc(`${CONVERSATION_STATE}/${conversationStateId(rootId, chatId)}`)));
  const lastReplyByChat: Record<string, LastReply | undefined> = {};
  stateDocs.forEach((doc, index) => { if (doc.exists) lastReplyByChat[chats[index]] = { lastReplyAtMs: Number(doc.get("lastReplyAtMs")) || 0, lastKind: clean(doc.get("lastKind"), 40), lastSubject: doc.get("lastSubject") || null, lastGreetingAtMs: Number(doc.get("lastGreetingAtMs")) || null }; });

  const plan = planGroupReplies({
    config, nowMs, messages, ownerByChat, operatorHashes, firstObservedByChat, repliedIds, clientNameByOwner, lastReplyByChat,
    lookupRequest: (_owner, subject, row) => lookupByChat[row.chatId]?.[subject] ?? "UNKNOWN",
    hasOpenSolicitud: ownerUserUid => Object.entries(ownerByChat).some(([chatId, owner]) => owner === ownerUserUid && lookupByChat[chatId]?.INVOICE === "FOUND"),
  });

  // Learning (capture only): client questions in acting groups that nobody answered. Created once per message, never overwritten.
  for (const missed of findMissedQuestions({ messages, ownerByChat, operatorHashes, repliedIds, nowMs, workingHours: config.workingHours ?? null })) {
    const wrote = await db.doc(`${LESSONS}/${missedLessonId(rootId, missed.messageId)}`).create({
      rootId, agentId: REPLY_AGENT_ID, chatId: missed.chatId, groupName: groupNameByChat[missed.chatId] || "", type: "MISSED_QUESTION",
      kind: missed.kind, subject: missed.subject, phrase: missed.phrase, withinHours: missed.withinHours, monthKey: mexicoMonthKey(nowMs), createdAt: FieldValue.serverTimestamp(),
    }).then(() => true).catch(() => false);
    if (wrote) await refreshPlaybookProposals(db, rootId, missed.chatId).catch(() => undefined);
  }

  // Learning stage 3 (simulation only): drafts stored for the owner to review, never queued or sent. Errors never reach the real reply flow.
  await runReplySimulation({
    db, rootId, nowMs, messages, ownerByChat, groupNameByChat, operatorHashes, lookupByChat,
    handledIds: new Set([...repliedIds, ...plan.map(item => item.messageId)]),
  }).catch(error => console.error("WHATSAPP_REPLY_SIMULATION_FAILED", { rootId, message: error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN" }));

  let queued = 0;
  for (const item of plan) {
    const built = buildReplyDelivery(rootId, groupNameByChat[item.chatId], clientNameByOwner[item.ownerUserUid] || "", item, nowMs);
    const jobRef = db.doc(`documentDeliveryJobs/${built.jobId}`);
    const inboundAtMs = messages.find(row => row.id === item.messageId)?.timestampMs ?? nowMs;
    const created = await db.runTransaction(async tx => {
      if ((await tx.get(jobRef)).exists) return false;
      const stamp = { createdAt: FieldValue.serverTimestamp(), releasedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
      tx.create(jobRef, { ...built.job, ...stamp });
      tx.create(jobRef.collection("deliveries").doc(built.deliveryId), { ...built.delivery, ...stamp });
      // Measurement: what kind of reply, how fast, whether it needed the team. Never the client's message.
      tx.create(db.doc(`${REPLY_METRICS}/${built.jobId}`), {
        rootId, agentId: REPLY_AGENT_ID, chatId: item.chatId, groupName: groupNameByChat[item.chatId] || "", kind: item.kind, subject: item.subject,
        inboundAtMs, queuedAtMs: nowMs, responseMs: Math.max(0, nowMs - inboundAtMs), aiTokens: 0, escalated: item.notifyInternal, humanCorrection: false,
        monthKey: mexicoMonthKey(nowMs), createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.doc(`${CONVERSATION_STATE}/${conversationStateId(rootId, item.chatId)}`), {
        rootId, agentId: REPLY_AGENT_ID, chatId: item.chatId, lastReplyAtMs: nowMs, lastKind: item.kind, lastSubject: item.subject,
        ...(item.kind === "GREETING" ? { lastGreetingAtMs: nowMs } : {}), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });
    if (!created) continue;
    queued++;
    // The audit trail records what kind of reply and for which group, never the client's message.
    await logActivity({
      event: "WHATSAPP_RESPUESTA_GRUPO_ENCOLADA", rootId, actorUid: "SYSTEM", actorName: "Hugo", actorRole: "system",
      referenceId: built.jobId, referenceType: "documentDeliveryJob", entityId: built.jobId, entityType: "document_delivery",
      description: `Hugo preparó una respuesta (${item.kind}) en el grupo ${groupNameByChat[item.chatId] || ""}.`.trim(),
    }).catch(() => undefined);
    if (item.notifyInternal) await noticeInternalTeam(rootId, item, groupNameByChat[item.chatId] || "", clienteByChat[item.chatId] ?? null);
  }
  return { skipped: null, queued };
}

// Every minute. Does nothing unless the owner switched replies on; the sender adds its own switch and hours.
export const processWhatsAppGroupReplies = onSchedule(
  { schedule: "every 1 minutes", region: "us-central1", timeZone: "America/Mexico_City", timeoutSeconds: 120, memory: "256MiB", maxInstances: 1, concurrency: 1 },
  async () => {
    // The team's internal group is answered whenever someone addresses Hugo, independent of the client reply switch (the sender has its own).
    const internalRoots = new Set<string>();
    for (const doc of (await db.collection("whatsappInternalGroups").limit(50).get()).docs) { const rootId = clean(doc.get("rootId"), 200); if (rootId) internalRoots.add(rootId); }
    for (const rootId of internalRoots) {
      try { await runInternalChat(rootId); }
      catch (error) { console.error("WHATSAPP_INTERNAL_CHAT_FAILED", { rootId, message: error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN" }); }
    }
    const enabled = await db.collection(REPLY_CONFIGS).where("enabled", "==", true).limit(20).get();
    for (const doc of enabled.docs) {
      const rootId = clean(doc.get("rootId"), 200);
      if (!rootId || doc.id !== replyConfigId(rootId)) continue;
      try { await runGroupReplies(rootId); }
      catch (error) { console.error("WHATSAPP_GROUP_REPLY_RUN_FAILED", { rootId, message: error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN" }); }
      try { await runUnansweredAlerts(rootId); }
      catch (error) { console.error("WHATSAPP_UNANSWERED_RUN_FAILED", { rootId, message: error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN" }); }
    }
  },
);
