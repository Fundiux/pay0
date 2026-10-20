import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { persistConversationCorrection } from "./conversationCorrections";

const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const validActorId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 160 && !/[\/\\\x00-\x1f]/.test(value);
export const voiceCorrectionSourceId = (turnId: string, responseId: string) => createHash("sha256").update(`${turnId}:HUGO:${responseId}`).digest("hex").slice(0, 40);
const userSourceId = (turnId: string) => createHash("sha256").update(`${turnId}:USER:input`).digest("hex").slice(0, 40);
const unavailable = () => new HttpsError("failed-precondition", "El turno de voz aún no tiene una transcripción vinculada. No se guardó la corrección.");

export type VoiceCorrectionInput = {
  uid: string; rootId: string; gatewayCallId: string;
  sessionId: string; turnId: string; responseId: string; correctionTurnId: string;
  correction: string; expectedVersion: number;
};

export function voiceCorrectionSourceResolver(db: Firestore, input: VoiceCorrectionInput) {
  const conversationId = `${input.rootId}_${input.uid}_global`;
  const sessionRef = db.doc(`agent007Conversations/${conversationId}/voiceSessions/${input.sessionId}`);
  const sourceId = voiceCorrectionSourceId(input.turnId, input.responseId);
  const sourceRef = sessionRef.collection("turns").doc(sourceId);
  const correctionRef = sessionRef.collection("turns").doc(userSourceId(input.correctionTurnId));
  return async (tx: Transaction) => {
    const [session, source, correction] = await Promise.all([tx.get(sessionRef), tx.get(sourceRef), tx.get(correctionRef)]);
    const s = session.data(), a = source.data(), c = correction.data();
    if (!s || !a || !c || s.rootId !== input.rootId || s.ownerUid !== input.uid || s.sessionId !== input.sessionId ||
        s.conversationId !== conversationId || s.gatewayCallId !== input.gatewayCallId || s.status !== "ACTIVE" ||
        [a, c].some(row => row.rootId !== input.rootId || row.ownerUid !== input.uid || row.sessionId !== input.sessionId) ||
        a.speaker !== "HUGO" || a.turnId !== input.turnId || a.responseId !== input.responseId || a.status !== "COMPLETED" || a.interrupted === true ||
        c.speaker !== "USER" || c.turnId !== input.correctionTurnId || c.transcriptionStatus !== "REALTIME_NATIVE" ||
        typeof a.text !== "string" || !a.text.trim() || typeof c.text !== "string" || c.text.trim() !== input.correction ||
        !Number.isFinite(a.timestampMs) || !Number.isFinite(c.timestampMs) || c.timestampMs < a.timestampMs) throw unavailable();
    return { ref: sourceRef, data: { rootId: input.rootId, ownerUid: input.uid, conversationId, sourceKind: "VOICE" as const,
      sourceId, sessionId: input.sessionId, turnId: input.turnId, sourceText: a.text, responseCorrection: a.responseCorrection },
      sourceQuestion: c.text,
      provenance: { sessionId: input.sessionId, responseId: input.responseId, correctionTurnId: input.correctionTurnId,
        transcriptAuthority: "CLIENT_TRANSCRIPT_NOT_FACT" as const } };
  };
}

export async function persistVoiceConversationCorrection(db: Firestore, input: VoiceCorrectionInput) {
  if (![input.uid, input.rootId].every(validActorId) || ![input.gatewayCallId, input.sessionId, input.turnId, input.responseId, input.correctionTurnId].every(validId) ||
      typeof input.correction !== "string" || !input.correction.trim() || input.correction.length > 1000 ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new HttpsError("invalid-argument", "Corrección de voz incompleta.");
  const content = input.correction.trim();
  const result = await persistConversationCorrection(db, { uid: input.uid, rootId: input.rootId,
    conversationId: `${input.rootId}_${input.uid}_global`, sourceKind: "VOICE", sessionId: input.sessionId,
    sourceId: voiceCorrectionSourceId(input.turnId, input.responseId), content, expectedVersion: input.expectedVersion },
  voiceCorrectionSourceResolver(db, { ...input, correction: content }));
  return { correctionId: result.id, version: result.correction.version, correction: result.correction,
    persisted: true, scope: "SESSION" as const, sessionId: input.sessionId,
    turnId: input.turnId, responseId: input.responseId, correctionTurnId: input.correctionTurnId };
}
