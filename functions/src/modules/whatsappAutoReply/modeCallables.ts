import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { AGENTS } from "../agentOperations/contract";
import { requireWhatsAppSuperadmin } from "../documentDelivery/whatsappConnectorAuthority";
import { logActivity } from "../../utils/logActivity";
import { readInternalGroupChatIds } from "./internalGroups";
import { mexicoMonthKey, summarizeReplyMetrics, type ModeEventRow, type ReplyMetricRow } from "./metrics";
import { applyModeChange, readAgentModes, type AgentMode } from "./modes";
import { correctionLessonId, isCorrectionCategory, LESSONS } from "./lessons";
import { REPLY_AGENT_ID } from "./constants";
import { refreshPlaybookProposals } from "./playbook";
import { REPLY_METRICS } from "./runner";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

export const MODE_EVENTS = "whatsappAgentModeEvents";
const MAX_ROWS = 2000;
const clean = (value: unknown, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const observerId = (rootId: string, chatId: string) => `${rootId}__${encodeURIComponent(chatId)}`;

// Switch one agent between OBSERVER and ACTING in one group. Observer is the default. Superadmin only.
// Rules: only a group assigned to a user can have an acting agent; nobody acts where Hugo observes; going back to observer needs a reason.
export const setWhatsAppGroupAgentMode = onCall({ cors: true, timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { uid, rootId } = await requireWhatsAppSuperadmin(request);
  const groupChatId = clean(request.data?.groupChatId), agentId = clean(request.data?.agentId, 64), mode = request.data?.mode, reason = clean(request.data?.reason, 300);
  if (!groupChatId || !agentId) throw new HttpsError("invalid-argument", "Grupo y agente son obligatorios.");
  if (mode !== "OBSERVER" && mode !== "ACTING") throw new HttpsError("invalid-argument", "Modo inválido.");
  if ((await readInternalGroupChatIds(db, rootId)).has(groupChatId)) throw new HttpsError("failed-precondition", "El grupo interno del equipo no tiene agentes actuando.");

  const ref = db.doc(`whatsappAgentObservers/${observerId(rootId, groupChatId)}`);
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("rootId") !== rootId || snap.get("active") !== true) throw new HttpsError("failed-precondition", "El grupo no está en observación.");
    if (mode === "ACTING" && !clean(snap.get("ownerUserUid"), 128)) throw new HttpsError("failed-precondition", "Asigna el grupo a un usuario antes de activar a un agente.");
    const agentsInGroup = ((snap.get("observers") as any[]) || []).map(row => clean(row?.agentId, 64)).filter(Boolean);
    const outcome = applyModeChange({
      change: { agentId, mode: mode as AgentMode, reason },
      modes: readAgentModes(snap.get("agentModes")), agentsInGroup,
      enabledInCatalog: id => AGENTS.find(agent => agent.id === id)?.enabled === true,
    });
    if (!outcome.ok) throw new HttpsError("failed-precondition", outcome.message);
    tx.update(ref, { agentModes: outcome.modes, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() });
    const groupName = clean(snap.get("groupName"), 160);
    for (const changedId of outcome.changed) {
      const nextMode: AgentMode = outcome.modes[changedId] === "ACTING" ? "ACTING" : "OBSERVER";
      tx.create(db.collection(MODE_EVENTS).doc(), {
        rootId, agentId: changedId, chatId: groupChatId, groupName, mode: nextMode, reason: nextMode === "OBSERVER" ? (changedId === agentId ? reason : `Hugo volvió a Observador: ${reason}`) : null,
        monthKey: mexicoMonthKey(Date.now()), changedBy: uid, createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { modes: outcome.modes, changed: outcome.changed, groupName };
  });
  await logActivity({
    event: mode === "ACTING" ? "WHATSAPP_AGENTE_ACTUANDO" : "WHATSAPP_AGENTE_OBSERVADOR", rootId, actorUid: uid, actorRole: "superadmin",
    referenceId: observerId(rootId, groupChatId), referenceType: "whatsapp_agent_observer", entityId: observerId(rootId, groupChatId), entityType: "whatsapp_agent_observer",
    description: mode === "ACTING" ? `${agentId} quedó actuando en el grupo ${result.groupName}.` : `${result.changed.join(", ")} volvió a Observador en el grupo ${result.groupName}: ${reason}`,
  }).catch(() => undefined);
  return { ok: true, agentModes: result.modes, changed: result.changed };
});

// What Hugo observes in the month, over every observed group (not only the acting ones). Counts only; documents are counted apart from conversation.
async function observationSummary(rootId: string, month: string) {
  const [year, mon] = month.split("-").map(Number);
  // Mexico City is UTC-6 all year since 2022.
  const fromMs = Date.UTC(year, mon - 1, 1, 6), toMs = Date.UTC(year, mon, 1, 6);
  const [observers, inbound, answers] = await Promise.all([
    db.collection("whatsappAgentObservers").where("rootId", "==", rootId).where("active", "==", true).limit(500).get(),
    db.collection("whatsappInboundMessages").where("rootId", "==", rootId).where("agentId", "==", REPLY_AGENT_ID).where("timestampMs", ">=", fromMs).where("timestampMs", "<", toMs).limit(5000).get(),
    db.collection(LESSONS).where("rootId", "==", rootId).where("monthKey", "==", month).limit(MAX_ROWS).get(),
  ]);
  const observed = new Set(observers.docs.filter(doc => ((doc.get("observers") as any[]) || []).some(row => row?.agentId === REPLY_AGENT_ID)).map(doc => clean(doc.get("groupChatId"))));
  const chatsWithMessages = new Set<string>(), chatsWithDocuments = new Set<string>();
  let conversationMessages = 0, documentMessages = 0;
  for (const doc of inbound.docs) {
    const chatId = clean(doc.get("chatId")), type = clean(doc.get("type"), 40);
    if (!observed.has(chatId)) continue;
    if (type === "document" || type === "image") { documentMessages++; chatsWithDocuments.add(chatId); }
    else if (type === "chat") { conversationMessages++; chatsWithMessages.add(chatId); }
  }
  const answered = answers.docs.filter(doc => doc.get("type") === "HUMAN_ANSWERED");
  return {
    observedGroups: observed.size, groupsWithConversation: chatsWithMessages.size, conversationMessages,
    groupsWithDocuments: chatsWithDocuments.size, documentMessages,
    humanAnswers: answered.length, humanAnswerGroups: new Set(answered.map(doc => clean(doc.get("chatId")))).size,
    truncated: inbound.size >= 5000,
  };
}

// Monthly measurement per agent and per group.
export const getWhatsAppAgentReplyMetrics = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const { rootId } = await requireWhatsAppSuperadmin(request);
  const requested = clean(request.data?.month, 7), month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : mexicoMonthKey(Date.now());
  const [replies, events] = await Promise.all([
    db.collection(REPLY_METRICS).where("rootId", "==", rootId).where("monthKey", "==", month).limit(MAX_ROWS).get(),
    db.collection(MODE_EVENTS).where("rootId", "==", rootId).where("monthKey", "==", month).limit(MAX_ROWS).get(),
  ]);
  const replyRows: ReplyMetricRow[] = replies.docs.map(doc => ({
    agentId: clean(doc.get("agentId"), 64), chatId: clean(doc.get("chatId")), groupName: clean(doc.get("groupName"), 160), kind: clean(doc.get("kind"), 40), subject: doc.get("subject") || null,
    responseMs: Number(doc.get("responseMs")) || 0, aiTokens: Number(doc.get("aiTokens")) || 0, escalated: doc.get("escalated") === true, humanCorrection: doc.get("humanCorrection") === true, monthKey: month,
  }));
  const eventRows: ModeEventRow[] = events.docs.map(doc => ({
    agentId: clean(doc.get("agentId"), 64), chatId: clean(doc.get("chatId")), groupName: clean(doc.get("groupName"), 160), mode: doc.get("mode") === "ACTING" ? "ACTING" : "OBSERVER", reason: clean(doc.get("reason"), 300) || null, monthKey: month,
  }));
  return { ok: true, month, truncated: replies.size >= MAX_ROWS || events.size >= MAX_ROWS, buckets: summarizeReplyMetrics(replyRows, eventRows, month), observation: await observationSummary(rootId, month) };
});

// The owner marks that a person had to correct one of Hugo's replies. It feeds the monthly measurement.
export const markWhatsAppReplyCorrection = onCall({ cors: true, timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const { uid, rootId } = await requireWhatsAppSuperadmin(request);
  const jobId = clean(request.data?.jobId, 80), corrected = request.data?.corrected !== false;
  const reason = clean(request.data?.reason, 300), category = isCorrectionCategory(request.data?.category) ? request.data.category : "OTHER";
  if (!jobId) throw new HttpsError("invalid-argument", "Respuesta requerida.");
  const ref = db.doc(`${REPLY_METRICS}/${jobId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get("rootId") !== rootId) throw new HttpsError("not-found", "No se encontró esa respuesta.");
  await ref.update({ humanCorrection: corrected, correctionMarkedBy: uid, correctionMarkedAt: FieldValue.serverTimestamp() });
  // Learning (capture only): why the reply needed a person, kept per group. Unmarking removes the lesson.
  const lessonRef = db.doc(`${LESSONS}/${correctionLessonId(jobId)}`);
  if (corrected) {
    await lessonRef.set({
      rootId, agentId: clean(snap.get("agentId"), 64), chatId: clean(snap.get("chatId")), groupName: clean(snap.get("groupName"), 160), type: "CORRECTION",
      kind: clean(snap.get("kind"), 40), subject: snap.get("subject") || null, category, reason, jobId, monthKey: clean(snap.get("monthKey"), 7),
      markedBy: uid, createdAt: FieldValue.serverTimestamp(),
    });
    await refreshPlaybookProposals(db, rootId, clean(snap.get("chatId"))).catch(() => undefined);
  } else await lessonRef.delete();
  await logActivity({
    event: "WHATSAPP_RESPUESTA_CORREGIDA", rootId, actorUid: uid, actorRole: "superadmin", referenceId: jobId, referenceType: "documentDeliveryJob", entityId: jobId, entityType: "document_delivery",
    description: corrected ? "Una persona corrigió una respuesta de Hugo en un grupo." : "Se quitó la marca de corrección de una respuesta de Hugo.",
  }).catch(() => undefined);
  return { ok: true, humanCorrection: corrected };
});

// The owner's list of what Hugo sent in groups this month, newest first, with the sent text and whether it was marked corrected.
export const listWhatsAppAgentReplies = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async request => {
  const { rootId } = await requireWhatsAppSuperadmin(request);
  const requested = clean(request.data?.month, 7), month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : mexicoMonthKey(Date.now());
  const snap = await db.collection(REPLY_METRICS).where("rootId", "==", rootId).where("monthKey", "==", month).limit(MAX_ROWS).get();
  const rows = snap.docs.map(doc => ({ doc, at: Number(doc.get("queuedAtMs")) || 0 })).sort((a, b) => b.at - a.at).slice(0, 100);
  const jobs = rows.length ? await db.getAll(...rows.map(row => db.doc(`documentDeliveryJobs/${row.doc.id}`))) : [];
  const replies = rows.map(({ doc, at }, index) => ({
    id: doc.id, agentId: clean(doc.get("agentId"), 64), groupName: clean(doc.get("groupName"), 160), kind: clean(doc.get("kind"), 40), subject: doc.get("subject") || null, atMs: at,
    text: jobs[index]?.exists && jobs[index].get("rootId") === rootId ? clean(jobs[index].get("textBody"), 600) : "",
    humanCorrection: doc.get("humanCorrection") === true,
  }));
  return { ok: true, month, replies };
});
