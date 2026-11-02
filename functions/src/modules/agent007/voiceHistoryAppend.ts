import { createHash } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";

const valid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
/** Minimal receipt path for gateway-observed transcripts. Never resets usage/costs or reopens a closed session. */
export async function appendHugoVoiceHistory(db: Firestore, actor: { uid: string; rootId: string; conversationId: string }, data: any) {
  if (![data?.sessionId, data?.gatewayCallId].every(valid) || actor.conversationId !== `${actor.rootId}_${actor.uid}_global` ||
      !Array.isArray(data.turns) || data.turns.length > 200 || (data.events !== undefined && (!Array.isArray(data.events) || data.events.length)))
    throw new HttpsError("invalid-argument", "Historial incremental de voz inválido.");
  const sessionRef = db.doc(`agent007Conversations/${actor.conversationId}/voiceSessions/${data.sessionId}`);
  const conversationRef = db.doc(`agent007Conversations/${actor.conversationId}`);
  const turns = data.turns.map((row: any) => {
    if (!valid(row?.turnId) || !["USER", "HUGO"].includes(row.speaker) || row.speaker === "HUGO" && !valid(row.responseId) ||
        row.status !== "COMPLETED" || row.transcriptionStatus !== "REALTIME_NATIVE" || row.interrupted === true ||
        typeof row.text !== "string" || !row.text.trim() || row.text.length > 8000 || !Number.isFinite(row.timestampMs) || row.timestampMs < 0)
      throw new HttpsError("invalid-argument", "Turno incremental incompleto.");
    const responseId = row.speaker === "HUGO" ? row.responseId : null;
    const id = createHash("sha256").update(`${row.turnId}:${row.speaker}:${responseId || "input"}`).digest("hex").slice(0, 40);
    return { ref: sessionRef.collection("turns").doc(id), row: { rootId: actor.rootId, ownerUid: actor.uid, sessionId: data.sessionId,
      turnId: row.turnId, speaker: row.speaker, responseId, text: row.text.trim(), modality: "VOICE", timestampMs: row.timestampMs,
      interrupted: false, status: "COMPLETED", transcriptionStatus: "REALTIME_NATIVE" } };
  });
  if (new Set(turns.map((turn: any) => turn.ref.path)).size !== turns.length) throw new HttpsError("invalid-argument", "Turnos incrementales duplicados.");
  return db.runTransaction(async tx => {
    const [userSnap, conversationSnap, sessionSnap, ...priorTurns] = await Promise.all([
      tx.get(db.doc(`users/${actor.uid}`)), tx.get(conversationRef), tx.get(sessionRef), ...turns.map((turn: any) => tx.get(turn.ref)),
    ]);
    const user = userSnap.data(), conversation = conversationSnap.data(), session = sessionSnap.data();
    assertAuthorized({ uid: actor.uid }, user, { allowedRoles: ["superadmin"] });
    if ((user?.rootId || actor.uid) !== actor.rootId || conversation && (conversation.rootId !== actor.rootId || conversation.ownerUid !== actor.uid ||
        conversation.status !== "ACTIVE" || conversation.deletedAt || conversation.isDeleted === true) ||
        session && (session.rootId !== actor.rootId || session.ownerUid !== actor.uid || session.sessionId !== data.sessionId ||
          session.conversationId !== actor.conversationId || session.status !== "ACTIVE" || session.gatewayCallId && session.gatewayCallId !== data.gatewayCallId))
      throw new HttpsError("permission-denied", "La sesión no pertenece al historial activo.");
    priorTurns.forEach((snap, index) => {
      const prior = snap.data(), turn = turns[index].row;
      if (prior && (prior.rootId !== actor.rootId || prior.ownerUid !== actor.uid || prior.sessionId !== data.sessionId ||
          prior.turnId !== turn.turnId || prior.speaker !== turn.speaker || prior.responseCorrection && prior.text !== turn.text))
        throw new HttpsError("failed-precondition", "El turno guardado requiere revisión.");
    });
    const now = Timestamp.now();
    if (!conversation) tx.create(conversationRef, { rootId: actor.rootId, ownerUid: actor.uid, status: "ACTIVE", createdAt: now, updatedAt: now });
    if (!session) tx.create(sessionRef, { rootId: actor.rootId, ownerUid: actor.uid, conversationId: actor.conversationId,
      sessionId: data.sessionId, gatewayCallId: data.gatewayCallId, status: "ACTIVE", modality: "VOICE", system: "HUGO", context: "GLOBAL",
      startedAt: now, updatedAt: now, transcriptPolicy: "REALTIME_EVENTS_ONLY", audioStored: false });
    else tx.update(sessionRef, { updatedAt: now, ...(session.gatewayCallId ? {} : { gatewayCallId: data.gatewayCallId }) });
    turns.forEach((turn: any) => tx.set(turn.ref, { ...turn.row, updatedAt: now }, { merge: true }));
    return { ok: true, appendOnly: true, appended: turns.length };
  });
}
