import { createHash } from "node:crypto";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { MEMORY_CONTRACT_VERSION, memoryWritePolicy } from "./hugoCore/memoryContract";

export type CorrectionTopic = { kind: "CLIENT"; id: string; label: string } | { kind: "TOPIC"; id: string; label: string };
export const correctionBindingId = (rootId: string, uid: string, topic: CorrectionTopic) => hash([rootId, uid, topic.kind, topic.id]);
export function explicitCorrectionTopic(label: unknown): CorrectionTopic {
  if (typeof label !== "string" || !label.trim() || label.length > 80 || /[\x00-\x1f]/.test(label)) throw new HttpsError("invalid-argument", "Escribe y confirma un tema específico.");
  const normalized = label.trim().replace(/\s+/g, " ").normalize("NFC").toLocaleLowerCase("es-MX");
  return { kind: "TOPIC", id: hash(normalized), label: label.trim().replace(/\s+/g, " ") };
}
/** Server-owned confirmation proof only; never construct this from model arguments. */
export type VoiceTopicConfirmation = {
  sessionId: string; correctionTurnId: string; confirmationTurnId: string;
  rootId: string; ownerUid: string; label: string; confirmed: boolean;
  transcriptAuthority: "CLIENT_TRANSCRIPT_NOT_FACT";
};
/** Preparation seam only. No persistence caller currently enables this gate. */
export function validateVoicePersonalTopic(input: {
  rootId: string; uid: string; sessionId: string; correctionTurnId: string;
  rememberFor: { kind: "TOPIC"; label: string };
}, proof: VoiceTopicConfirmation, enabled = false): CorrectionTopic {
  if (enabled !== true) throw new HttpsError("failed-precondition", "Los temas personales de voz todavía no están habilitados.");
  if (!input || input.rememberFor?.kind !== "TOPIC" || !valid(input.rootId) || !valid(input.uid) || !valid(input.sessionId) || !valid(input.correctionTurnId))
    throw new HttpsError("invalid-argument", "Confirma un tema específico para esta sesión de voz.");
  const requested = explicitCorrectionTopic(input.rememberFor.label);
  if (!proof || proof.confirmed !== true || proof.rootId !== input.rootId || proof.ownerUid !== input.uid || proof.sessionId !== input.sessionId ||
      proof.correctionTurnId !== input.correctionTurnId || (!valid(proof.confirmationTurnId) || proof.confirmationTurnId === input.correctionTurnId) || proof.transcriptAuthority !== "CLIENT_TRANSCRIPT_NOT_FACT")
    throw new HttpsError("permission-denied", "La confirmación del tema no pertenece a esta sesión.");
  const confirmed = explicitCorrectionTopic(proof.label);
  if (confirmed.id !== requested.id) throw new HttpsError("failed-precondition", "Confirma el mismo tema antes de guardar el recuerdo.");
  return requested;
}
export type ConversationCorrectionInput = { uid: string; rootId: string; conversationId: string; sourceKind: "TEXT" | "VOICE"; sourceId: string; sessionId?: string; content: string; expectedVersion: number; rememberFor?: { kind: "CLIENT" } | { kind: "TOPIC"; label: string } };
export type ConversationCorrectionSource = { ref: DocumentReference; data: { rootId: string; ownerUid: string; conversationId: string; sourceKind: "TEXT" | "VOICE"; sourceId: string; turnId: string; sourceText: string; sessionId?: string; responseCorrection?: { memoryId: string; version: number } };
  clientTopic?: CorrectionTopic; sourceQuestion?: string; provenance?: { sessionId: string; responseId: string; correctionTurnId: string; transcriptAuthority: "CLIENT_TRANSCRIPT_NOT_FACT" } };
export type ResponseCorrection = { memoryId: string; version: number; content: string; status: "CONFIRMED"; scope: "CONVERSATION_ONLY" | "USER_TOPIC"; expiresAt: string | null; topic?: CorrectionTopic };
const valid = (value: unknown, limit = 160): value is string => typeof value === "string" && value.length > 0 && value.length <= limit && !/[\/\\\x00-\x1f]/.test(value);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Human statement only. A server-owned source resolver runs inside the same authorization transaction. */
export async function persistConversationCorrection(db: Firestore, input: ConversationCorrectionInput, resolveSource: (tx: Transaction) => Promise<ConversationCorrectionSource>) {
  if (!valid(input.uid) || !valid(input.rootId) || !valid(input.sourceId) || ![`${input.rootId}_${input.uid}`, `${input.rootId}_${input.uid}_global`].includes(input.conversationId) ||
    !["TEXT", "VOICE"].includes(input.sourceKind) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 10000 ||
    typeof input.content !== "string" || !input.content.trim() || input.content.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.content) ||
    (input.sourceKind === "VOICE" ? !valid(input.sessionId) : input.sessionId !== undefined)) throw new HttpsError("invalid-argument", "Corrección de conversación inválida.");
  const content = input.content.trim(), policy = memoryWritePolicy({ kind: "USER_STATEMENT", source: "EXPLICIT_HUMAN", explicitHumanInput: true, content });
  if (!policy.allowed) throw new HttpsError("invalid-argument", "Corrección inválida.");
  if (input.rememberFor && (input.sourceKind !== "TEXT" || !["CLIENT", "TOPIC"].includes(input.rememberFor.kind))) throw new HttpsError("invalid-argument", "Ámbito de corrección inválido.");
  const conversationRef = db.doc(`agent007Conversations/${input.conversationId}`);
  return db.runTransaction(async tx => {
    const [userSnap, conversationSnap] = await Promise.all([tx.get(db.doc(`users/${input.uid}`)), tx.get(conversationRef)]);
    const user = userSnap.data(), conversation = conversationSnap.data();
    assertAuthorized({ uid: input.uid }, user, { allowedRoles: ["superadmin"] });
    if ((user?.rootId || input.uid) !== input.rootId || (!conversation && input.sourceKind !== "VOICE") || (conversation && (conversation.rootId !== input.rootId || conversation.ownerUid !== input.uid || conversation.status !== "ACTIVE" || conversation.isDeleted === true || conversation.deletedAt))) throw new HttpsError("permission-denied", "La conversación no pertenece a tu sesión vigente.");
    const source = await resolveSource(tx), row = source.data;
    const expectedPath = input.sourceKind === "TEXT" ? `agent007Messages/${input.sourceId}` : `agent007Conversations/${input.conversationId}/voiceSessions/${input.sessionId}/turns/${input.sourceId}`;
    if (source.ref.path !== expectedPath || row.rootId !== input.rootId || row.ownerUid !== input.uid || row.conversationId !== input.conversationId || row.sourceKind !== input.sourceKind || row.sourceId !== input.sourceId ||
      !valid(row.turnId) || typeof row.sourceText !== "string" || !row.sourceText.trim() || row.sessionId !== input.sessionId) throw new HttpsError("permission-denied", "La respuesta no pertenece a esta conversación.");
    if (input.sourceKind === "VOICE" && (!source.provenance || source.provenance.sessionId !== input.sessionId || !valid(source.provenance.responseId) || !valid(source.provenance.correctionTurnId) || source.provenance.transcriptAuthority !== "CLIENT_TRANSCRIPT_NOT_FACT"))
      throw new HttpsError("failed-precondition", "No hay un turno de voz verificable para la corrección.");
    const topic = input.rememberFor?.kind === "TOPIC" ? explicitCorrectionTopic(input.rememberFor.label) : input.rememberFor?.kind === "CLIENT" ? source.clientTopic : undefined;
    if (input.rememberFor?.kind === "CLIENT" && (!topic || topic.kind !== "CLIENT" || !valid(topic.id) || !valid(topic.label, 250))) throw new HttpsError("failed-precondition", "Este mensaje no identifica un único cliente canónico. Confirma un tema específico.");
    const bindingRef = topic ? db.doc(`agent007ConversationCorrectionBindings/${correctionBindingId(input.rootId, input.uid, topic)}`) : null;
    const binding = bindingRef ? await tx.get(bindingRef) : null;
    if (binding?.exists && (binding.get("rootId") !== input.rootId || binding.get("ownerUid") !== input.uid || binding.get("topic.kind") !== topic!.kind || binding.get("topic.id") !== topic!.id)) throw new HttpsError("permission-denied", "Ámbito de corrección ajeno.");
    if (binding?.exists && (!Array.isArray(binding.get("memoryIds")) || binding.get("memoryIds").length > 3 || !binding.get("memoryIds").every((id: unknown) => valid(id)))) throw new HttpsError("failed-precondition", "El vínculo del recuerdo requiere revisión.");
    const previous = row.responseCorrection, version = input.expectedVersion + 1;
    const id = `response_correction_${hash([input.rootId, input.uid, input.conversationId, input.sourceKind, input.sessionId || null, input.sourceId, version, content, ...(topic ? [topic.kind, topic.id] : [])]).slice(0, 40)}`;
    const ref = db.doc(`agent007Memory/${id}`), existing = await tx.get(ref);
    const currentTurn = Number.isInteger(conversation?.conversationState?.turn) ? conversation!.conversationState.turn : 0;
    if (previous?.memoryId === id && previous.version === version && existing.exists && existing.get("status") === "CONFIRMED" &&
      existing.get("rootId") === input.rootId && existing.get("authorUid") === input.uid && existing.get("kind") === "USER_STATEMENT" && existing.get("conversationCorrection.conversationId") === input.conversationId &&
      existing.get("conversationCorrection.sourceKind") === input.sourceKind && existing.get("conversationCorrection.sourceId") === input.sourceId && existing.get("conversationCorrection.sourceHash") === hash(row.sourceText) &&
      (topic ? binding?.get("memoryIds")?.includes(id) && existing.get("conversationCorrection.topic.id") === topic.id && existing.get("conversationCorrection.topic.kind") === topic.kind :
        Number.isInteger(existing.get("conversationCorrection.confirmedTurn")) && existing.get("conversationCorrection.confirmedTurn") <= currentTurn && currentTurn - existing.get("conversationCorrection.confirmedTurn") <= 4 &&
        typeof existing.get("validUntil") === "string" && Number.isFinite(Date.parse(existing.get("validUntil"))) && Date.parse(existing.get("validUntil")) > Date.now())) {
      const saved = existing.data()!;
      return { id, created: false, correction: { memoryId: id, version, content: saved.content, status: "CONFIRMED" as const, scope: topic ? "USER_TOPIC" as const : "CONVERSATION_ONLY" as const, expiresAt: saved.validUntil as string | null, ...(topic ? { topic } : {}) } };
    }
    if ((previous?.version || 0) !== input.expectedVersion) throw new HttpsError("failed-precondition", "La respuesta ya tiene otra corrección. Recarga antes de guardar.");
    const oldRef = previous?.memoryId && valid(previous.memoryId) ? db.doc(`agent007Memory/${previous.memoryId}`) : null;
    const old = oldRef ? await tx.get(oldRef) : null;
    if (previous && (!old?.exists || old.get("rootId") !== input.rootId || old.get("authorUid") !== input.uid || old.get("conversationCorrection.conversationId") !== input.conversationId)) throw new HttpsError("failed-precondition", "La corrección anterior requiere revisión.");
    const turn = Number.isInteger(conversation?.conversationState?.turn) ? conversation!.conversationState.turn : 0;
    const now = new Date(), expiresAt = topic ? null : new Date(now.getTime() + 30 * 60_000).toISOString();
    const correction: ResponseCorrection = { memoryId: id, version, content, status: "CONFIRMED", scope: topic ? "USER_TOPIC" : "CONVERSATION_ONLY", expiresAt, ...(topic ? { topic } : {}) };
    const record = { id, version: MEMORY_CONTRACT_VERSION, rootId: input.rootId, kind: "USER_STATEMENT", status: "CONFIRMED", source: "EXPLICIT_HUMAN", sourceSystem: "USER", authorUid: input.uid,
      scope: { level: "ENTITY", rootId: input.rootId, system: "HUGO", entityType: "CONVERSATION", entityId: input.conversationId },
      entityReference: { sourceSystem: "HUGO", entityType: "CONVERSATION", entityId: input.conversationId }, entityKey: `HUGO:CONVERSATION:${input.conversationId}`,
      content, confidence: null, createdAt: now.toISOString(), effectiveAt: now.toISOString(), lastVerifiedAt: now.toISOString(), validUntil: expiresAt,
      supersedes: oldRef ? [oldRef.id] : [], reviewedBy: input.uid,
      conversationCorrection: { version: 1, conversationId: input.conversationId, ownerUid: input.uid, sourceKind: input.sourceKind, sourceId: input.sourceId, turnId: row.turnId,
        sourceHash: hash(row.sourceText), confirmedTurn: turn, correctionVersion: version, ...(topic ? { topic, bindingId: bindingRef!.id } : {}), ...(source.sourceQuestion ? { sourceQuestion: source.sourceQuestion.slice(0, 2000) } : {}), ...(source.provenance ? { provenance: source.provenance } : {}) } };
    if (existing.exists) throw new HttpsError("failed-precondition", "La corrección ya no está vigente.");
    const refs = Array.isArray(conversation?.responseCorrectionIds) ? conversation!.responseCorrectionIds.filter((value: unknown): value is string => valid(value) && value !== previous?.memoryId && value !== id) : [];
    tx.create(ref, record);
    if (oldRef) tx.set(oldRef, { status: "SUPERSEDED", supersededBy: id, lastVerifiedAt: now.toISOString() }, { merge: true });
    tx.update(source.ref, { responseCorrection: correction });
    if (conversation) tx.update(conversationRef, { responseCorrectionIds: [id, ...refs].slice(0, 3) });
    else tx.create(conversationRef, { rootId: input.rootId, ownerUid: input.uid, status: "ACTIVE", responseCorrectionIds: [id] });
    if (bindingRef) {
      const priorIds = Array.isArray(binding?.get("memoryIds")) ? binding!.get("memoryIds").filter((value: unknown) => valid(value) && value !== previous?.memoryId && value !== id) : [];
      tx.set(bindingRef, { rootId: input.rootId, ownerUid: input.uid, topic, memoryIds: [id, ...priorIds].slice(0, 3), updatedAt: now.toISOString() });
    }
    return { id, created: true, correction };
  });
}
