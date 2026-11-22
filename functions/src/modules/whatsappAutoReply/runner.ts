import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logActivity } from "../../utils/logActivity";
import { operatorAuthorHashes, MAX_REPLY_AGE_MS, OWNER_WORKING_HOURS } from "./domain";
import { planGroupReplies, type InboundRow, type PlannedReply, type ReplyMode, type ReplyRuntimeConfig } from "./planner";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

export const REPLY_AGENT_ID = "hugo";
export const REPLY_CONFIGS = "whatsappAgentReplyConfigs";
const REPLY_STATE = "whatsappAgentReplyState";
const LOOKBACK_MS = MAX_REPLY_AGE_MS + 5 * 60 * 1000;
const MAX_MESSAGES_PER_RUN = 400;
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
  };
  const delivery = {
    rootId, channel: "WHATSAPP", status: "PENDING_SEND", connectorId: "default", chatId: plan.chatId, chatName: groupName || "Grupo", chatType: "GROUP",
    safeDocId: encodeURIComponent(plan.chatId),
  };
  return { jobId, deliveryId: encodeURIComponent(plan.chatId), job, delivery };
}

type ReplyConfigDoc = { enabled: boolean; mode: ReplyMode };

// The team's single internal group (owned by the delivery notices) is never answered. No document or an empty id means there is none.
export const INTERNAL_GROUPS = "whatsappInternalGroups";
export async function readInternalGroupChatId(rootId: string): Promise<string | null> {
  const snap = await db.doc(`${INTERNAL_GROUPS}/${rootId}`).get();
  return clean(snap.get("groupChatId"), 200) || null;
}

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

export async function runGroupReplies(rootId: string, nowMs = Date.now()) {
  const stored = await readReplyConfig(rootId);
  const internalChatId = await readInternalGroupChatId(rootId);
  if (!stored.enabled) return { skipped: "OFF" as const, queued: 0 };
  const config: ReplyRuntimeConfig = { enabled: true, mode: stored.mode, workingHours: OWNER_WORKING_HOURS };

  // Only groups assigned to a user are answered.
  const observers = await db.collection("whatsappAgentObservers").where("rootId", "==", rootId).where("active", "==", true).limit(200).get();
  const ownerByChat: Record<string, string> = {}, groupNameByChat: Record<string, string> = {};
  for (const doc of observers.docs) {
    const owner = clean(doc.get("ownerUserUid"), 128), chatId = clean(doc.get("groupChatId"), 200);
    const observed = ((doc.get("observers") as any[]) || []).some(row => row?.agentId === REPLY_AGENT_ID);
    if (owner && chatId && observed && chatId !== internalChatId) { ownerByChat[chatId] = owner; groupNameByChat[chatId] = clean(doc.get("groupName"), 160); }
  }
  if (!Object.keys(ownerByChat).length) return { skipped: "NO_GROUPS" as const, queued: 0 };

  const recent = await db.collection("whatsappInboundMessages").where("rootId", "==", rootId).where("agentId", "==", REPLY_AGENT_ID)
    .where("timestampMs", ">=", nowMs - LOOKBACK_MS).orderBy("timestampMs").limit(MAX_MESSAGES_PER_RUN).get();
  const messages: InboundRow[] = recent.docs.filter(doc => ownerByChat[clean(doc.get("chatId"), 200)]).map(doc => ({
    id: doc.id, chatId: clean(doc.get("chatId"), 200), authorHash: doc.get("authorHash") || null, fromMe: doc.get("fromMe") === true,
    timestampMs: Number(doc.get("timestampMs")) || 0, type: clean(doc.get("type"), 40), body: String(doc.get("body") ?? ""),
  }));
  if (!messages.length) return { skipped: "NO_MESSAGES" as const, queued: 0 };

  const chats = [...new Set(messages.map(row => row.chatId))];
  const firstObservedByChat: Record<string, number | null> = {};
  for (const chatId of chats) firstObservedByChat[chatId] = await firstObservedAt(rootId, chatId);

  const operatorDocs = await db.collection("userOperatorNumbers").where("rootId", "==", rootId).limit(500).get();
  const operatorHashes = new Set<string>();
  for (const doc of operatorDocs.docs) for (const hash of operatorAuthorHashes(rootId, (doc.get("numbers") as string[]) || [])) operatorHashes.add(hash);

  const jobRefs = messages.map(row => db.doc(`documentDeliveryJobs/${replyJobId(rootId, row.id)}`));
  const existing = await db.getAll(...jobRefs);
  const repliedIds = new Set(messages.filter((_row, index) => existing[index].exists).map(row => row.id));

  const owners = [...new Set(chats.map(chatId => ownerByChat[chatId]))];
  const ownerDocs = await db.getAll(...owners.map(uid => db.doc(`users/${uid}`)));
  const clientNameByOwner: Record<string, string> = {};
  ownerDocs.forEach((doc, index) => { clientNameByOwner[owners[index]] = safeName(doc.get("displayName") || doc.get("nombreUsuario") || doc.get("username")); });

  const plan = planGroupReplies({
    config, nowMs, messages, ownerByChat, operatorHashes, firstObservedByChat, repliedIds, clientNameByOwner,
    // "Already processing" needs the user's open requests; until that lookup exists, questions get the neutral "let us validate".
    hasOpenSolicitud: () => false,
  });

  let queued = 0;
  for (const item of plan) {
    const built = buildReplyDelivery(rootId, groupNameByChat[item.chatId], clientNameByOwner[item.ownerUserUid] || "", item, nowMs);
    const jobRef = db.doc(`documentDeliveryJobs/${built.jobId}`);
    const created = await db.runTransaction(async tx => {
      if ((await tx.get(jobRef)).exists) return false;
      const stamp = { createdAt: FieldValue.serverTimestamp(), releasedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
      tx.create(jobRef, { ...built.job, ...stamp });
      tx.create(jobRef.collection("deliveries").doc(built.deliveryId), { ...built.delivery, ...stamp });
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
  }
  return { skipped: null, queued };
}

// Every minute. Does nothing unless the owner switched replies on; the sender adds its own switch and hours.
export const processWhatsAppGroupReplies = onSchedule(
  { schedule: "every 1 minutes", region: "us-central1", timeZone: "America/Mexico_City", timeoutSeconds: 120, memory: "256MiB", maxInstances: 1, concurrency: 1 },
  async () => {
    const enabled = await db.collection(REPLY_CONFIGS).where("enabled", "==", true).limit(20).get();
    for (const doc of enabled.docs) {
      const rootId = clean(doc.get("rootId"), 200);
      if (!rootId || doc.id !== replyConfigId(rootId)) continue;
      try { await runGroupReplies(rootId); }
      catch (error) { console.error("WHATSAPP_GROUP_REPLY_RUN_FAILED", { rootId, message: error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN" }); }
    }
  },
);
