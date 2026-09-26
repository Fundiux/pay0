import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { db, getMyUser, requireAuth } from "../sharedCallables/helpers";

const clean = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const validId = (value: string) => Boolean(value && value.length <= 180 && !value.includes("/"));
const allowedEvents = new Set(["session.created", "input_audio_buffer.speech_started", "input_audio_buffer.speech_stopped", "conversation.item.input_audio_transcription.completed", "response.created", "response.output_audio_transcript.done", "response.done", "response.cancelled", "error", "peer.connection_state", "peer.ice_state"]);
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
    const turns = Array.isArray(data.turns) ? data.turns.slice(0, 40) : [];
    const events = Array.isArray(data.events) ? data.events.slice(0, 80) : [];
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
        costs: { voiceCostUsd, delegatedModelCostUsd: null, externalToolCostUsd: 0, transcriptionCostUsd: 0 }, audioUsage,
      }, { merge: true });
    });
    const batch = db.batch();
    for (const raw of turns) {
      const turnId = clean(raw?.turnId, 180), speaker = raw?.speaker === "HUGO" ? "HUGO" : "USER";
      if (!validId(turnId)) continue;
      const id = createHash("sha256").update(`${turnId}:${speaker}`).digest("hex").slice(0, 40);
      batch.set(sessionRef.collection("turns").doc(id), {
        rootId: actor.rootId, ownerUid: actor.uid, sessionId, turnId, responseId: clean(raw?.responseId, 180) || null,
        speaker, text: clean(raw?.text, 8000), modality: "VOICE", timestampMs: Math.max(0, Number(raw?.timestampMs) || 0),
        durationMs: Math.max(0, Math.min(Number(raw?.durationMs) || 0, 60 * 60 * 1000)), interrupted: raw?.interrupted === true,
        status: clean(raw?.status, 50) || "COMPLETED", transcriptionStatus: clean(raw?.transcriptionStatus, 80) || (speaker === "HUGO" ? "REALTIME_NATIVE" : "NOT_ENABLED"),
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
    const turns = await ref.collection("turns").orderBy("timestampMs", "asc").limit(200).get();
    return { ok: true, session: { id: session.id, ...session.data() }, turns: turns.docs.map(doc => ({ id: doc.id, ...doc.data() })) };
  },
);
