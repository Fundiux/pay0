import * as admin from "firebase-admin";
import { logActivity } from "../../utils/logActivity";
import { queueAutomaticClientDelivery } from "../documentDelivery/whatsappAutomaticDelivery";
import { LOOKBACK_MS, MAX_MESSAGES_PER_RUN, REPLY_AGENT_ID } from "./constants";
import { OWNER_WORKING_HOURS, operatorAuthorHashes } from "./domain";
import { readInternalGroupChatIds } from "./internalGroups";
import type { InboundRow } from "./planner";
import { clienteIdOfGroup } from "./requestLookup";
import { alertText, normalizeText, planUnansweredAlerts, type AlertAction, type OpenAlert } from "./unanswered";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

export const UNANSWERED_ALERTS = "whatsappAgentUnansweredAlerts";
const clean = (value: unknown, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const unansweredAlertId = (rootId: string, messageId: string) => `unans__${rootId.slice(0, 40)}__${messageId}`.slice(0, 200);

export type AlertDelivery = (input: { rootId: string; clienteId: string; sourceId: string; textBody: string }) => Promise<unknown>;

const defaultDeliver: AlertDelivery = ({ rootId, clienteId, sourceId, textBody }) => queueAutomaticClientDelivery({
  rootId, sourceType: "AVISO_GRUPO_INTERNO", sourceId, clienteId, clienteNombre: null, caption: "", textBody,
  notes: "Aviso interno: consulta de un cliente sin respuesta en un grupo.",
});

/**
 * Tells the team's internal group about client questions that nobody has answered: once after 3 minutes, then every 5 minutes.
 * Works in every group Hugo observes that is assigned to a user (observer or acting): the notice goes to the team, never to a client.
 */
export async function runUnansweredAlerts(rootId: string, nowMs = Date.now(), deliver: AlertDelivery = defaultDeliver) {
  const internalChatIds = await readInternalGroupChatIds(db, rootId);
  const observers = await db.collection("whatsappAgentObservers").where("rootId", "==", rootId).where("active", "==", true).limit(200).get();
  const observedChats = new Set<string>(), groupNameByChat: Record<string, string> = {}, agentPhones: string[] = [];
  for (const doc of observers.docs) {
    const chatId = clean(doc.get("groupChatId"), 200), rows = (doc.get("observers") as any[]) || [];
    for (const row of rows) if (typeof row?.phone === "string" && row.phone) agentPhones.push(row.phone);
    if (chatId && clean(doc.get("ownerUserUid"), 128) && rows.some(row => row?.agentId === REPLY_AGENT_ID) && !internalChatIds.has(chatId)) {
      observedChats.add(chatId); groupNameByChat[chatId] = clean(doc.get("groupName"), 160);
    }
  }
  if (!observedChats.size) return { sent: 0, resolved: 0 };

  const openSnap = await db.collection(UNANSWERED_ALERTS).where("rootId", "==", rootId).where("status", "==", "OPEN").limit(200).get();
  const openAlerts: OpenAlert[] = openSnap.docs.map(doc => ({
    messageId: clean(doc.get("messageId"), 200), chatId: clean(doc.get("chatId"), 200), questionAtMs: Number(doc.get("questionAtMs")) || 0,
    body: String(doc.get("body") ?? ""), alertCount: Number(doc.get("alertCount")) || 0, lastAlertAtMs: Number(doc.get("lastAlertAtMs")) || 0,
  })).filter(alert => alert.messageId && observedChats.has(alert.chatId));

  const since = Math.min(nowMs - LOOKBACK_MS, ...openAlerts.map(alert => alert.questionAtMs));
  const recent = await db.collection("whatsappInboundMessages").where("rootId", "==", rootId).where("agentId", "==", REPLY_AGENT_ID)
    .where("timestampMs", ">=", since).orderBy("timestampMs").limit(MAX_MESSAGES_PER_RUN).get();
  const messages: InboundRow[] = recent.docs.filter(doc => observedChats.has(clean(doc.get("chatId"), 200))).map(doc => ({
    id: doc.id, chatId: clean(doc.get("chatId"), 200), authorHash: doc.get("authorHash") || null, fromMe: doc.get("fromMe") === true,
    timestampMs: Number(doc.get("timestampMs")) || 0, type: clean(doc.get("type"), 40), body: String(doc.get("body") ?? ""),
  }));

  const operatorHashes = new Set<string>();
  for (const doc of (await db.collection("userOperatorNumbers").where("rootId", "==", rootId).limit(500).get()).docs)
    for (const hash of operatorAuthorHashes(rootId, (doc.get("numbers") as string[]) || [])) operatorHashes.add(hash);
  const ignoreHashes = operatorAuthorHashes(rootId, agentPhones);

  // What Hugo itself sent: the connected number wrote it, so it never counts as a person answering.
  const hugoTexts: Record<string, Set<string>> = {};
  for (const chatId of new Set(messages.filter(row => row.fromMe).map(row => row.chatId))) {
    const jobs = await db.collection("documentDeliveryJobs").where("rootId", "==", rootId).where("sourceType", "==", "GRUPO_RESPUESTA").where("targetChatId", "==", chatId).limit(100).get();
    hugoTexts[chatId] = new Set(jobs.docs.map(doc => normalizeText(String(doc.get("textBody") ?? ""))));
  }

  const candidateIds = [...new Set(messages.map(row => row.id))];
  const known = new Set<string>();
  if (candidateIds.length) {
    const docs = await db.getAll(...candidateIds.map(id => db.doc(`${UNANSWERED_ALERTS}/${unansweredAlertId(rootId, id)}`)));
    docs.forEach((doc, index) => { if (doc.exists) known.add(candidateIds[index]); });
  }

  const plan = planUnansweredAlerts({ messages, observedChats, operatorHashes, ignoreHashes, hugoTexts, knownAlertIds: known, openAlerts, nowMs, workingHours: OWNER_WORKING_HOURS, lookbackMs: LOOKBACK_MS });

  for (const id of plan.resolve) await db.doc(`${UNANSWERED_ALERTS}/${unansweredAlertId(rootId, id)}`).update({ status: "ANSWERED", closedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
  for (const id of plan.expire) await db.doc(`${UNANSWERED_ALERTS}/${unansweredAlertId(rootId, id)}`).update({ status: "EXPIRED", closedAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() }).catch(() => undefined);

  let sent = 0;
  for (const action of plan.alerts) {
    if (await sendAlert(rootId, action, groupNameByChat[action.chatId] || "", nowMs, deliver)) sent++;
  }
  return { sent, resolved: plan.resolve.length };
}

async function sendAlert(rootId: string, action: AlertAction, groupName: string, nowMs: number, deliver: AlertDelivery): Promise<boolean> {
  const ref = db.doc(`${UNANSWERED_ALERTS}/${unansweredAlertId(rootId, action.messageId)}`);
  const clienteId = await clienteIdOfGroup(db, rootId, action.chatId);
  try {
    // Record first, so a failed run never sends the same notice twice; the record also marks the question as known.
    if (action.kind === "FIRST") {
      await ref.create({ rootId, messageId: action.messageId, chatId: action.chatId, groupName, questionAtMs: action.questionAtMs, body: clean(action.body, 300), status: clienteId ? "OPEN" : "NO_ROUTE", alertCount: 1, lastAlertAtMs: nowMs, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    } else {
      await ref.update({ alertCount: action.count, lastAlertAtMs: nowMs, updatedAt: FieldValue.serverTimestamp() });
    }
  } catch { return false; }
  if (!clienteId) return false;
  try {
    await deliver({ rootId, clienteId, sourceId: `${clienteId}:sin-respuesta:${action.messageId}:${action.count}`, textBody: alertText(action, groupName) });
  } catch (error) {
    console.error("WHATSAPP_UNANSWERED_ALERT_FAILED", { rootId, message: error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN" });
    return false;
  }
  await logActivity({
    event: "WHATSAPP_CONSULTA_SIN_RESPUESTA_AVISADA", rootId, actorUid: "SYSTEM", actorName: "Hugo", actorRole: "system",
    referenceId: ref.id, referenceType: "whatsapp_unanswered_alert", entityId: ref.id, entityType: "whatsapp_unanswered_alert",
    description: `Hugo avisó al grupo interno de una consulta sin respuesta en el grupo ${groupName || ""} (aviso ${action.count}).`.trim(),
  }).catch(() => undefined);
  return true;
}
