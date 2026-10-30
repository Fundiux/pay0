import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { validateEarningsReportInput, type EarningsReportToolInput } from "./hugoCore/reportSemantics";
import { normalizeConversationState, type ConversationState } from "./hugoCore/conversationState";

// Admin-only subdocuments; the existing Firestore default-deny rule applies.
// These are authorized query filters, never report rows, names inferred by a
// model, money, a permission grant, or proof of an authenticated Realtime event.
export type VoiceReportIdentity = { uid: string; rootId: string; sessionId: string };
export type VoiceReportTicket = VoiceReportIdentity & { generation: number; turn: number; globalStateDigest: string };
export type VoiceReportFilter = { query: EarningsReportToolInput; resolvedAt: number; resolvedTurn: number };
const valid = (value: unknown, max = 160): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\/\\\x00-\x1f]/.test(value);
const forbidden = () => new HttpsError("permission-denied", "El contexto de voz ya no pertenece a tu acceso vigente.");
const stateDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
const referenceState = (raw: unknown, rootId: string): ConversationState => {
  const normalized = normalizeConversationState(raw, rootId);
  const entity = (row: any) => row && valid(row.entityId) ? {
    system: "PAY0" as const, entityType: row.entityType, entityId: row.entityId, folio: row.folio, rootId,
    resolvedAt: row.resolvedAt, resolvedTurn: row.resolvedTurn,
    source: typeof row.source === "string" ? row.source.slice(0, 80) : "UNKNOWN",
    confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? Math.min(Math.max(row.confidence, 0), 1) : 0,
  } : null;
  return { version: normalized.version, rootId, turn: normalized.turn, activeEntity: entity(normalized.activeEntity),
    recentEntities: normalized.recentEntities.map(entity).filter(Boolean) as ConversationState["recentEntities"],
    pendingAmbiguity: normalized.pendingAmbiguity.map(entity).filter(Boolean) as ConversationState["pendingAmbiguity"], lastIntent: normalized.lastIntent };
};
const reference = (db: Firestore, identity: VoiceReportIdentity) => {
  if (!valid(identity.uid) || !valid(identity.rootId) || !valid(identity.sessionId, 180)) throw forbidden();
  const key = createHash("sha256").update(identity.sessionId).digest("hex");
  return db.doc(`agent007Conversations/${identity.rootId}_${identity.uid}_global/voiceReportContexts/${key}`);
};
async function authorize(tx: Transaction, db: Firestore, identity: VoiceReportIdentity) {
  const [profile, parent] = await Promise.all([tx.get(db.doc(`users/${identity.uid}`)),
    tx.get(db.doc(`agent007Conversations/${identity.rootId}_${identity.uid}_global`))]);
  const user = profile.data(), conversation = parent.data();
  assertAuthorized({ uid: identity.uid }, user, { allowedRoles: ["superadmin"] });
  if ((user?.rootId || identity.uid) !== identity.rootId) throw forbidden();
  if (conversation && (conversation.rootId !== identity.rootId || conversation.ownerUid !== identity.uid || conversation.status !== "ACTIVE" || conversation.isDeleted === true || conversation.deletedAt)) throw forbidden();
  return conversation;
}
function filter(row: any, identity: VoiceReportIdentity, turn: number, now: number): VoiceReportFilter | null {
  if (!row || row.rootId !== identity.rootId || row.ownerUid !== identity.uid || row.sessionId !== identity.sessionId ||
      !Number.isFinite(row.resolvedAt) || row.resolvedAt > now || now - row.resolvedAt > 30 * 60_000 ||
      !Number.isSafeInteger(row.resolvedTurn) || row.resolvedTurn < 1 || row.resolvedTurn > turn || turn - row.resolvedTurn > 4) return null;
  try { validateEarningsReportInput(row.query); } catch { return null; }
  return { query: { ...row.query }, resolvedAt: row.resolvedAt, resolvedTurn: row.resolvedTurn };
}

/** Reserve before a query: a slow earlier response cannot replace a newer one. */
export async function beginVoiceReportTurn(db: Firestore, identity: VoiceReportIdentity, options: { invalidate: boolean; reset: boolean; now?: number }) {
  const ref = reference(db, identity), now = options.now ?? Date.now();
  return db.runTransaction(async tx => {
    const parent = await authorize(tx, db, identity);
    const snap = await tx.get(ref), old = snap.data();
    if (old && (old.rootId !== identity.rootId || old.ownerUid !== identity.uid || old.sessionId !== identity.sessionId)) throw forbidden();
    if (old && (!Number.isSafeInteger(old.generation) || old.generation < 1 || !Number.isSafeInteger(old.turn) || old.turn < 1))
      throw new HttpsError("failed-precondition", "El contexto de esta sesión requiere revisión.");
    const generation = Number.isSafeInteger(old?.generation) && old!.generation >= 0 ? old!.generation + 1 : 1;
    const turn = Number.isSafeInteger(old?.turn) && old!.turn >= 0 ? old!.turn + 1 : 1;
    if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(turn)) throw new HttpsError("failed-precondition", "Inicia otra sesión de voz.");
    const previous = options.reset ? null : filter(old?.report, identity, turn - 1, now);
    const ticket: VoiceReportTicket = { ...identity, generation, turn, globalStateDigest: stateDigest(parent?.conversationState) };
    const voiceReferences = old?.referenceState ? referenceState(old.referenceState, identity.rootId) : null;
    tx.set(ref, { rootId: identity.rootId, ownerUid: identity.uid, sessionId: identity.sessionId, generation, turn,
      ...(!options.reset && !options.invalidate && previous ? { report: old!.report } : {}),
      ...(voiceReferences ? { referenceState: voiceReferences } : {}), updatedAt: now });
    return { ticket, previous, referenceState: voiceReferences };
  });
}

/** Preserve RTC references without replacing the global TEXT report map. */
export async function saveVoiceCoreReferenceState(db: Firestore, ticket: VoiceReportTicket, state: ConversationState, reportOperation: boolean) {
  const ref = reference(db, ticket), parentRef = db.doc(`agent007Conversations/${ticket.rootId}_${ticket.uid}_global`);
  const safe = referenceState(state, ticket.rootId);
  return db.runTransaction(async tx => {
    const parent = await authorize(tx, db, ticket);
    const current = (await tx.get(ref)).data();
    if (!current || current.rootId !== ticket.rootId || current.ownerUid !== ticket.uid || current.sessionId !== ticket.sessionId) throw forbidden();
    if (current.generation !== ticket.generation || current.turn !== ticket.turn) return { current: false, globalUpdated: false };
    tx.set(ref, { referenceState: safe }, { merge: true });
    // A concurrent TEXT turn owns its new state. Never restore a stale snapshot.
    const globalUpdated = !reportOperation && stateDigest(parent?.conversationState) === ticket.globalStateDigest;
    if (globalUpdated) {
      if (parent) {
        const fields = Object.fromEntries(Object.entries(safe).map(([key, value]) => [`conversationState.${key}`, value]));
        tx.update(parentRef, fields);
      } else tx.set(parentRef, { rootId: ticket.rootId, ownerUid: ticket.uid, status: "ACTIVE", conversationState: safe }, { merge: true });
    }
    return { current: true, globalUpdated };
  });
}

/** Called only with the actual authorized tool result, never model output. */
export async function completeVoiceReportTurn(db: Firestore, ticket: VoiceReportTicket, query: EarningsReportToolInput, result: any, now = Date.now()) {
  validateEarningsReportInput(query);
  if (result?.tool !== "getEarningsByClientReport" || result?.sourceSystem !== "PAY0" || result?.scope?.rootId !== ticket.rootId) throw forbidden();
  const data = result.data;
  const resolved = data && data.dateFrom === query.dateFrom && data.dateTo === query.dateTo &&
    data.includeCompensated === (query.includeCompensated === true) &&
    (!query.compareDateFrom || data.comparison?.dateFrom === query.compareDateFrom && data.comparison?.dateTo === query.compareDateTo) &&
    !["AMBIGUOUS", "NOT_FOUND"].includes(data.clientResolution?.status) &&
    (query.clientQuery === undefined || data.clientResolution?.status === "RESOLVED");
  const ref = reference(db, ticket);
  return db.runTransaction(async tx => {
    await authorize(tx, db, ticket);
    const row = (await tx.get(ref)).data();
    if (!row || row.rootId !== ticket.rootId || row.ownerUid !== ticket.uid || row.sessionId !== ticket.sessionId) throw forbidden();
    if (row.generation !== ticket.generation || row.turn !== ticket.turn) return { current: false, remembered: false };
    if (!resolved) return { current: true, remembered: false };
    // Only the validated query allowlist is persisted; no tool result is stored.
    const clean: EarningsReportToolInput = { dateFrom: query.dateFrom, dateTo: query.dateTo, limit: query.limit ?? 5000,
      includeCompensated: query.includeCompensated === true,
      ...(query.compareDateFrom ? { compareDateFrom: query.compareDateFrom, compareDateTo: query.compareDateTo! } : {}),
      ...(query.clientQuery ? { clientQuery: query.clientQuery } : {}), ...(query.format ? { format: query.format } : {}) };
    tx.set(ref, { report: { rootId: ticket.rootId, ownerUid: ticket.uid, sessionId: ticket.sessionId,
      query: clean, resolvedAt: now, resolvedTurn: ticket.turn }, updatedAt: now }, { merge: true });
    return { current: true, remembered: true };
  });
}
