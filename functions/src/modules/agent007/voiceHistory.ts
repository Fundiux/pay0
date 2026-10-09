import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { db, getMyUser, requireAuth } from "../sharedCallables/helpers";

const clean = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const validId = (value: string) => Boolean(value && value.length <= 180 && !value.includes("/"));
const allowedEvents = new Set(["session.created", "input_audio_buffer.speech_started", "input_audio_buffer.speech_stopped", "conversation.item.input_audio_transcription.completed", "conversation.item.input_audio_transcription.failed", "response.created", "response.output_audio_transcript.done", "response.done", "response.cancelled", "error", "peer.connection_state", "peer.ice_state", "gateway.interruption_candidate", "gateway.interruption_rejected", "gateway.interruption_confirmed", "gateway.response_created", "gateway.first_audio", "gateway.output_audio_done", "gateway.tool_started", "gateway.tool_completed", "gateway.tool_failed"]);
const voiceRates: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-realtime-2.1": { input: 32, cached: 0.4, output: 64 },
  "gpt-realtime-2.1-mini": { input: 10, cached: 0.3, output: 20 },
};

async function identity(request: any) {
  const uid = requireAuth(request), user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
  return { uid, rootId: clean(user?.rootId || uid, 128), conversationId: `${clean(user?.rootId || uid, 128)}_${uid}_global` };
}

export const saveHugoVoiceHistory = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const actor = await identity(request), data = request.data || {}, sessionId = clean(data.sessionId, 180);
    if (!validId(sessionId)) throw new HttpsError("invalid-argument", "Sesion de voz invalida.");
    const requestedVoice = clean(data.voice, 32);
    const voice = ["cedar", "marin"].includes(requestedVoice) ? requestedVoice : "cedar";
    const turns = Array.isArray(data.turns) ? data.turns : [];
    const events = Array.isArray(data.events) ? data.events : [];
    if (turns.length > 200 || events.length > 250) throw new HttpsError("resource-exhausted", "Lote incremental de auditoria demasiado grande.");
    const conversationRef = db.collection("agent007Conversations").doc(actor.conversationId);
    const sessionRef = conversationRef.collection("voiceSessions").doc(sessionId);
    await db.runTransaction(async tx => {
      const existing = await tx.get(sessionRef), now = Timestamp.now();
      tx.set(conversationRef, { rootId: actor.rootId, ownerUid: actor.uid, participantUids: [actor.uid], status: "ACTIVE", updatedAt: now, createdAt: FieldValue.serverTimestamp() }, { merge: true });
      const model = clean(data.model, 80) || "gpt-realtime-2.1";
      const audioUsage = { input: Math.max(0, Number(data.audioUsage?.input) || 0), cachedInput: Math.max(0, Number(data.audioUsage?.cachedInput) || 0), output: Math.max(0, Number(data.audioUsage?.output) || 0) };
      const rates = voiceRates[model], voiceCostUsd = rates ? ((audioUsage.input * rates.input) + (audioUsage.cachedInput * rates.cached) + (audioUsage.output * rates.output)) / 1_000_000 : null;
      tx.set(sessionRef, {
        rootId: actor.rootId, ownerUid: actor.uid, conversationId: actor.conversationId, sessionId,
        modality: "VOICE", system: "HUGO", context: "GLOBAL", voice: existing.exists ? existing.data()?.voice || voice : voice, model,
        status: ["ACTIVE", "COMPLETED", "FAILED"].includes(data.status) ? data.status : "ACTIVE",
        startedAt: existing.exists ? existing.data()?.startedAt : now, updatedAt: now,
        endedAt: data.status === "COMPLETED" || data.status === "FAILED" ? now : null,
        durationMs: Math.max(0, Math.min(Number(data.durationMs) || 0, 4 * 60 * 60 * 1000)),
        transcriptPolicy: "REALTIME_EVENTS_ONLY", audioStored: false,
        gatewayCallId: clean(data.gatewayCallId, 180) || null,
        gateway: {
          service: clean(data.gateway?.service, 120) || null, revision: clean(data.gateway?.revision, 120) || null,
          commit: clean(data.gateway?.commit, 80) || null, branch: clean(data.gateway?.branch, 160) || null,
          version: clean(data.gateway?.version, 80) || null,
        },
        realtime: {
          vad: { type: clean(data.realtime?.vad?.type, 40) || null, eagerness: clean(data.realtime?.vad?.eagerness, 40) || null, createResponse: data.realtime?.vad?.createResponse === true, interruptResponse: data.realtime?.vad?.interruptResponse === true, confirmationMs: Math.max(0, Math.min(Number(data.realtime?.vad?.confirmationMs) || 0, 5000)) },
          transcription: { model: clean(data.realtime?.transcription?.model, 80) || null, language: clean(data.realtime?.transcription?.language, 10) || null },
        },
        costs: { voiceCostUsd, delegatedModelCostUsd: null, externalToolCostUsd: 0, transcriptionCostUsd: null }, audioUsage,
      }, { merge: true });
    });
    const batch = db.batch();
    for (const raw of turns) {
      const turnId = clean(raw?.turnId, 180), speaker = raw?.speaker === "HUGO" ? "HUGO" : "USER";
      if (!validId(turnId)) continue;
      const responseId = clean(raw?.responseId, 180) || null;
      const id = createHash("sha256").update(`${turnId}:${speaker}:${responseId || "input"}`).digest("hex").slice(0, 40);
      batch.set(sessionRef.collection("turns").doc(id), {
        rootId: actor.rootId, ownerUid: actor.uid, sessionId, turnId, responseId,
        speaker, text: clean(raw?.text, 8000), modality: "VOICE", timestampMs: Math.max(0, Number(raw?.timestampMs) || 0),
        durationMs: Math.max(0, Math.min(Number(raw?.durationMs) || 0, 60 * 60 * 1000)), interrupted: raw?.interrupted === true,
        status: clean(raw?.status, 50) || "COMPLETED", transcriptionStatus: clean(raw?.transcriptionStatus, 80) || (speaker === "HUGO" ? "REALTIME_NATIVE" : "PENDING_NATIVE"),
        transcriptionConfidence: Number.isFinite(Number(raw?.transcriptionConfidence)) ? Math.max(0, Math.min(Number(raw.transcriptionConfidence), 1)) : null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    for (const raw of events) {
      const type = clean(raw?.type, 100), eventId = clean(raw?.eventId, 180);
      if (!allowedEvents.has(type) || !eventId) continue;
      const id = createHash("sha256").update(eventId).digest("hex").slice(0, 40);
      batch.set(sessionRef.collection("events").doc(id), {
        rootId: actor.rootId, ownerUid: actor.uid, sessionId, eventId, type,
        turnId: clean(raw?.turnId, 180) || null, responseId: clean(raw?.responseId, 180) || null,
        timestampMs: Math.max(0, Number(raw?.timestampMs) || 0), detail: clean(raw?.detail, 500) || null,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
    return { ok: true };
  },
);

export const getHugoVoiceSession = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const actor = await identity(request), sessionId = clean(request.data?.sessionId, 180);
    if (!validId(sessionId)) throw new HttpsError("invalid-argument", "Sesion de voz invalida.");
    const ref = db.collection("agent007Conversations").doc(actor.conversationId).collection("voiceSessions").doc(sessionId);
    const session = await ref.get();
    if (!session.exists || session.data()?.rootId !== actor.rootId || session.data()?.ownerUid !== actor.uid) throw new HttpsError("not-found", "Sesion no encontrada.");
    const pageSize = Math.max(1, Math.min(Number(request.data?.limit) || 100, 200));
    let turnsQuery = ref.collection("turns").orderBy("timestampMs", "asc").orderBy("__name__", "asc").limit(pageSize + 1);
    let eventsQuery = ref.collection("events").orderBy("timestampMs", "asc").orderBy("__name__", "asc").limit(pageSize + 1);
    const turnCursor = clean(request.data?.turnCursor, 180), eventCursor = clean(request.data?.eventCursor, 180);
    if (turnCursor) { const snap = await ref.collection("turns").doc(turnCursor).get(); if (snap.exists) turnsQuery = turnsQuery.startAfter(snap); }
    if (eventCursor) { const snap = await ref.collection("events").doc(eventCursor).get(); if (snap.exists) eventsQuery = eventsQuery.startAfter(snap); }
    const [turns, events] = await Promise.all([turnsQuery.get(), eventsQuery.get()]);
    const turnDocs = turns.docs.slice(0, pageSize), eventDocs = events.docs.slice(0, pageSize);
    return { ok: true, session: { id: session.id, ...session.data() },
      turns: turnDocs.map(doc => ({ id: doc.id, ...doc.data() })), events: eventDocs.map(doc => ({ id: doc.id, ...doc.data() })),
      nextTurnCursor: turns.docs.length > pageSize ? turnDocs.at(-1)?.id || null : null,
      nextEventCursor: events.docs.length > pageSize ? eventDocs.at(-1)?.id || null : null };
  },
);

export const listHugoVoiceActivity = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const actor = await identity(request), limit = Math.max(1, Math.min(Number(request.data?.limit) || 20, 50));
    const source = `agent007Conversations/${actor.conversationId}/voiceSessions`;
    const query = db.collection("agent007Conversations").doc(actor.conversationId).collection("voiceSessions").orderBy("startedAt", "desc").limit(limit + 1);
    const snap = await query.get(), docs = snap.docs.slice(0, limit);
    const sessions = await Promise.all(docs.map(async doc => {
      const data = doc.data(), gatewayCallId = clean(data.gatewayCallId, 180);
      const [turnCount, eventCount, responseCount, interruptionCount, errorCount, ledger] = await Promise.all([
        doc.ref.collection("turns").count().get(), doc.ref.collection("events").count().get(),
        doc.ref.collection("events").where("type", "==", "response.done").count().get(),
        doc.ref.collection("events").where("type", "==", "gateway.interruption_confirmed").count().get(),
        doc.ref.collection("events").where("type", "in", ["error", "gateway.tool_failed"]).count().get(),
        gatewayCallId ? db.collection("agent007CostLedger").where("rootId", "==", actor.rootId).where("ownerUid", "==", actor.uid).where("sessionId", "==", gatewayCallId).limit(100).get() : Promise.resolve(null),
      ]);
      const ledgerRows = ledger?.docs.map(item => item.data()) || [];
      return { id: doc.id, ...data, counts: { turns: turnCount.data().count, events: eventCount.data().count, responses: responseCount.data().count, interruptions: interruptionCount.data().count, errors: errorCount.data().count, tools: ledgerRows.length },
        tools: ledgerRows.map(row => ({ tool: row.tool || null, route: row.route || null, sourceSystem: row.sourceSystem || null, latencyMs: row.latencyMs || null, errorCode: row.errorCode || null })),
        ledger: { entries: ledgerRows.length, delegatedModelCostUsd: ledgerRows.reduce((sum, row) => sum + (Number(row.delegatedModelCostUsd) || 0), 0), externalToolCostUsd: ledgerRows.reduce((sum, row) => sum + (Number(row.externalToolCostUsd) || 0), 0) } };
    }));
    return { ok: true, sessions, complete: snap.docs.length <= limit, source, queriedAt: new Date().toISOString(), voiceIncluded: true };
  },
);
