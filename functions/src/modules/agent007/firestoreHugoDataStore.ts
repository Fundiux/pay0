import { FieldValue, Firestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { createHash } from "node:crypto";
import { HugoConversationState, HugoDataStore, HugoTraceFilter, HugoTurnInput } from "./hugoCore/dataStoreContract";
import { HugoMemoryKind, HugoMemoryRecord, MemoryQuery, MemoryRetrieval, MEMORY_CONTRACT_VERSION, memoryApplicable, memoryPriority, memoryReason, memoryWritePolicy } from "./hugoCore/memoryContract";
import { normalizeConversationState } from "./hugoCore/conversationState";

const timestampMillis = (value: any) => value?.toMillis?.() || (value instanceof Date ? value.getTime() : 0);
const valid = (value: string) => Boolean(value && value.length <= 160 && !value.includes("/"));

export class FirestoreHugoDataStore implements HugoDataStore {
  constructor(private readonly db: Firestore) {}

  private scope(rootId: string) { if (!valid(rootId)) throw new HttpsError("invalid-argument", "Ámbito inválido."); return rootId; }
  private ownsConversation(rootId: string, uid: string, conversationId: string) { return conversationId === `${rootId}_${uid}` || conversationId === `${rootId}_${uid}_global`; }
  private async recent(collection: string, rootId: string, limit: number) {
    const snap = await this.db.collection(collection).where("rootId", "==", this.scope(rootId)).orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).sort((a, b) => timestampMillis(b.updatedAt || b.createdAt) - timestampMillis(a.updatedAt || a.createdAt));
  }
  async loadConversationState(identity: { uid: string; rootId: string }, conversationId: string): Promise<HugoConversationState> {
    if (!valid(identity.uid) || !this.ownsConversation(this.scope(identity.rootId), identity.uid, conversationId)) throw new HttpsError("permission-denied", "Conversación fuera de ámbito.");
    const [prior, conversationSnap, recommendations, rules] = await Promise.all([
      this.db.collection("agent007Messages").where("conversationId", "==", conversationId).where("rootId", "==", identity.rootId).orderBy("createdAt", "desc").limit(12).get(),
      this.db.collection("agent007Conversations").doc(conversationId).get(), this.recent("agent007Recommendations", identity.rootId, 20), this.recent("agent007LearnedRules", identity.rootId, 20),
    ]);
    const history = prior.docs.map(doc => doc.data()).sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt)).slice(-12);
    const row = conversationSnap.data();
    const owned = row?.rootId === identity.rootId && row?.ownerUid === identity.uid;
    return { history, memory: { recommendations, rules }, recentEntities: owned && Array.isArray(row.recentEntities) ? row.recentEntities.slice(0, 8) : [],
      conversationState: normalizeConversationState(owned ? row?.conversationState : null, identity.rootId) };
  }
  async listObservations(rootId: string, limit = 50) { return this.recent("agent007Observations", rootId, Math.min(Math.max(limit, 1), 50)); }
  async listRecommendations(rootId: string, limit = 50) { return this.recent("agent007Recommendations", rootId, Math.min(Math.max(limit, 1), 50)); }
  async recordObservation(rootId: string, payload: Record<string, any>) {
    const ref = this.db.collection("agent007Observations").doc();
    await ref.create({ ...payload, rootId: this.scope(rootId) });
    return ref.id;
  }
  async getRecommendation(rootId: string, id: string) {
    if (!valid(id)) throw new HttpsError("invalid-argument", "Recomendación inválida.");
    const snap = await this.db.collection("agent007Recommendations").doc(id).get();
    if (!snap.exists || snap.data()?.rootId !== this.scope(rootId)) throw new HttpsError("not-found", "Recomendación no encontrada.");
    return { id: snap.id, ...snap.data() } as any;
  }
  recommendationRef(id: string) { return this.db.collection("agent007Recommendations").doc(id); }
  learnedRuleRef(id: string) { return this.db.collection("agent007LearnedRules").doc(id); }
  observationRef(id: string) { return this.db.collection("agent007Observations").doc(id); }
  messageRef(id: string) { return this.db.collection("agent007Messages").doc(id); }
  newTraceId() { return this.db.collection("agent007Traces").doc().id; }
  memoryRef(id: string) { return this.db.collection("agent007Memory").doc(id); }
  pendingRecommendations(rootId: string, limit = 100) { return this.db.collection("agent007Recommendations").where("rootId", "==", this.scope(rootId)).where("status", "==", "PENDING_REVIEW").limit(limit); }
  async listMessages(rootId: string, uid: string, limit = 80, requestedConversationId?: string) {
    const conversationId = requestedConversationId || `${this.scope(rootId)}_${uid}`;
    if (!this.ownsConversation(rootId, uid, conversationId)) throw new HttpsError("permission-denied", "Conversación fuera de ámbito.");
    const snap = await this.db.collection("agent007Messages").where("conversationId", "==", conversationId).where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(Math.min(Math.max(limit, 1), 80)).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt));
  }
  async markMessagesRead(rootId: string, uid: string) {
    const conversationId = `${this.scope(rootId)}_${uid}`;
    const snap = await this.db.collection("agent007Messages").where("conversationId", "==", conversationId).where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(80).get();
    const unread = snap.docs.filter(doc => doc.data().recipientUid === uid && doc.data().read === false);
    if (unread.length) { const batch = this.db.batch(); unread.forEach(doc => batch.set(doc.ref, { read: true, readAt: FieldValue.serverTimestamp() }, { merge: true })); await batch.commit(); }
    return unread.length;
  }
  async saveTurn(input: HugoTurnInput) {
    if (!this.ownsConversation(this.scope(input.rootId), input.uid, input.conversationId)) throw new HttpsError("permission-denied", "Conversación fuera de ámbito.");
    const messages = this.db.collection("agent007Messages"), userMessage = messages.doc(), assistantMessage = messages.doc(), now = Timestamp.now();
    const batch = this.db.batch();
    batch.set(this.db.collection("agent007Conversations").doc(input.conversationId), { rootId: input.rootId, ownerUid: input.uid, participantUids: [input.uid], status: "ACTIVE", lastMessage: input.reply,
      lastMessageAt: now, updatedAt: now, recentEntities: input.recentEntities, ...(input.conversationState ? { conversationState: input.conversationState } : {}), createdAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.create(userMessage, { rootId: input.rootId, conversationId: input.conversationId, role: "user", text: input.text, senderUid: input.uid, source: "USER", visibility: "CONVERSATION", scope: input.scope || "PAY0", profile: input.profile || "OPERATOR", read: true, createdAt: now });
    batch.create(assistantMessage, { rootId: input.rootId, conversationId: input.conversationId, role: "assistant", text: input.reply, recipientUid: input.uid, source: input.source,
      visibility: "CONVERSATION", scope: input.scope || "PAY0", profile: input.profile || "OPERATOR", read: true, capability: input.capability || null, capabilityExecuted: input.capabilityExecuted, contextSummary: input.contextSummary, createdAt: Timestamp.fromMillis(now.toMillis() + 1) });
    batch.create(this.db.collection("agent007Traces").doc(input.traceId), { ...input.trace, rootId: input.rootId, actorUid: input.uid, conversationId: input.conversationId });
    await batch.commit();
    return { id: assistantMessage.id, createdAt: now };
  }
  async saveErrorTrace(rootId: string, traceId: string, payload: Record<string, any>) {
    await this.db.collection("agent007Traces").doc(traceId).create({ ...payload, rootId: this.scope(rootId), traceId });
  }

  async listTraces(rootId: string, filter: HugoTraceFilter) {
    const limit = Math.min(Math.max(Number(filter.limit) || 20, 1), 50);
    const to = filter.to || new Date(), from = filter.from || new Date(to.getTime() - 30 * 86400000);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) throw new HttpsError("invalid-argument", "Rango inválido.");
    if (to.getTime() - from.getTime() > 31 * 86400000) throw new HttpsError("invalid-argument", "Rango máximo: 31 días.");
    if (filter.cursor && !valid(filter.cursor)) throw new HttpsError("invalid-argument", "Cursor inválido.");
    let query = this.db.collection("agent007Traces").where("rootId", "==", this.scope(rootId)).where("timestamp", ">=", from).where("timestamp", "<=", to).orderBy("timestamp", "desc").orderBy("__name__", "desc").limit(limit + 1);
    if (filter.cursor) {
      const cursorSnap = await this.db.collection("agent007Traces").doc(filter.cursor).get();
      if (!cursorSnap.exists || cursorSnap.data()?.rootId !== rootId) throw new HttpsError("invalid-argument", "Cursor fuera de ámbito.");
      query = query.startAfter(cursorSnap);
    }
    const snap = await query.get();
    const page = snap.docs.slice(0, limit);
    const rows = page.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(row =>
      (!filter.conversationId || row.conversationId === filter.conversationId) && (!filter.resultStatus || row.resultStatus === filter.resultStatus) &&
      (!filter.tool || row.toolsRequested?.includes(filter.tool)) && (!filter.sourceSystem || row.sourceSystems?.includes(filter.sourceSystem)) &&
      (!filter.completeness || row.toolsExecuted?.some((tool: any) => tool.completeness === filter.completeness)) && (!filter.errorOnly || row.resultStatus === "ERROR" || !!row.errorCode));
    return { traces: rows, cursor: snap.docs.length > limit ? page.at(-1)?.id || null : null, complete: snap.docs.length <= limit, scanned: page.length };
  }
  async getTrace(rootId: string, id: string) {
    if (!valid(id)) throw new HttpsError("invalid-argument", "Traza inválida.");
    const snap = await this.db.collection("agent007Traces").doc(id).get();
    if (!snap.exists || snap.data()?.rootId !== this.scope(rootId)) throw new HttpsError("not-found", "Traza no encontrada.");
    return { id: snap.id, ...snap.data() };
  }
  async retrieveMemory(query: MemoryQuery): Promise<MemoryRetrieval> {
    const rootId = this.scope(query.rootId);
    if (!Array.isArray(query.entityReferences) || query.entityReferences.length > 4 || !query.entityReferences.every(x => valid(x.entityId) && valid(x.entityType) && valid(x.sourceSystem))) throw new HttpsError("invalid-argument", "Referencias de memoria inválidas.");
    const limit = Math.min(Math.max(Number(query.limit) || 4, 1), 8);
    const keys = [...new Set(query.entityReferences.map(x => `${x.sourceSystem}:${x.entityType}:${x.entityId}`))];
    const memorySnaps = await Promise.all([...keys, null].map(entityKey => this.db.collection("agent007Memory").where("rootId", "==", rootId).where("entityKey", "==", entityKey).limit(20).get()));
    const records = memorySnaps.flatMap(snap => snap.docs.map(doc => ({ ...doc.data(), id: doc.id } as HugoMemoryRecord)));
    const selected = records.filter(row => memoryApplicable(row, query)).sort((a, b) => memoryPriority(a) - memoryPriority(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit).map(record => ({ record, relevanceReason: memoryReason(record), verificationStatus: record.status }));
    const obsKeys = [...new Set(query.entityReferences.flatMap(x => [x.entityId, x.displayReference].filter((v): v is string => Boolean(v && valid(v)))))] .slice(0, 4);
    const observationSnaps = await Promise.all(obsKeys.map(caseId => this.db.collection("agent007Observations").where("rootId", "==", rootId).where("caseId", "==", caseId).limit(8).get()));
    const legacy = observationSnaps.flatMap(snap => snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any))).filter(row => row.rootId === rootId && row.source === "ACTIVITY_LOG");
    return { considered: records.length, selected, legacyObservationsConsidered: legacy.length,
      legacyObservations: legacy.slice(0, 2).map(row => ({ id: row.id, rootId, caseId: row.caseId, sourceEvent: String(row.sourceEvent || ""), intent: String(row.intent || "").slice(0, 250), outcome: String(row.outcome || "").slice(0, 350), createdAt: row.createdAt?.toDate?.()?.toISOString() || null, verificationStatus: "UNVERIFIED_LEGACY" as const, relevanceReason: "ENTITY_MATCH" as const })) };
  }
  async listMemoryDiagnostics(rootId: string, limit = 50): Promise<HugoMemoryRecord[]> {
    const snap = await this.db.collection("agent007Memory").where("rootId", "==", this.scope(rootId)).orderBy("createdAt", "desc").limit(Math.min(Math.max(limit, 1), 50)).get();
    return snap.docs.map(doc => ({ ...doc.data(), id: doc.id } as HugoMemoryRecord));
  }
  async createMemoryCandidate(input: { rootId: string; actorUid: string; kind: HugoMemoryKind; content: string; entityReference?: { sourceSystem: string; entityType: string; entityId: string; displayReference?: string } }) {
    const rootId = this.scope(input.rootId), policy = memoryWritePolicy({ kind: input.kind, source: "EXPLICIT_HUMAN", explicitHumanInput: true, entityReference: input.entityReference, content: input.content });
    if (!policy.allowed) throw new HttpsError("invalid-argument", policy.reason);
    if (input.entityReference && ![input.entityReference.sourceSystem, input.entityReference.entityType, input.entityReference.entityId].every(valid)) throw new HttpsError("invalid-argument", "Entidad inválida.");
    const entityKey = input.entityReference ? `${input.entityReference.sourceSystem}:${input.entityReference.entityType}:${input.entityReference.entityId}` : null;
    const id = createHash("sha256").update(JSON.stringify([rootId, input.kind, entityKey, input.content.trim().toLocaleLowerCase("es-MX")])).digest("hex").slice(0, 40);
    const ref = this.memoryRef(id), now = new Date().toISOString();
    if ((await ref.get()).exists) return { id, created: false };
    const record: HugoMemoryRecord & { entityKey: string | null } = { id, version: MEMORY_CONTRACT_VERSION, rootId, kind: input.kind,
      scope: input.entityReference ? { level: "ENTITY", rootId, system: input.entityReference.sourceSystem, entityType: input.entityReference.entityType, entityId: input.entityReference.entityId } : { level: "ROOT", rootId },
      content: input.content.trim(), source: "EXPLICIT_HUMAN", sourceSystem: "USER", authorUid: input.actorUid, ...(input.entityReference ? { entityReference: input.entityReference } : {}), confidence: null, createdAt: now,
      effectiveAt: null, lastVerifiedAt: null, validUntil: null, supersedes: [], status: policy.initialStatus, entityKey };
    try { await ref.create(record); return { id, created: true }; }
    catch (error: any) { if (error?.code === 6 || error?.code === "already-exists") return { id, created: false }; throw error; }
  }
  async reviewMemoryCandidate(rootId: string, actorUid: string, id: string, decision: "CONFIRM" | "REJECT", supersedesId?: string) {
    if (!valid(id) || (supersedesId && (!valid(supersedesId) || supersedesId === id))) throw new HttpsError("invalid-argument", "Identificador de memoria inválido.");
    const ref = this.memoryRef(id), oldRef = supersedesId ? this.memoryRef(supersedesId) : null;
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(ref), row = snap.data() as HugoMemoryRecord | undefined;
      if (!row || row.rootId !== this.scope(rootId)) throw new HttpsError("not-found", "Memoria no encontrada.");
      if (row.status !== "CANDIDATE") return { changed: false };
      if (decision === "CONFIRM" && (["FACT", "RULE", "HYPOTHESIS"].includes(row.kind) || row.kind === "EXPERIENCE" && (!row.links?.outcomeId || row.verification?.outcomeKnown !== true))) throw new HttpsError("failed-precondition", "La evidencia no permite confirmar esta memoria.");
      const oldSnap = oldRef ? await tx.get(oldRef) : null, old = oldSnap?.data() as HugoMemoryRecord | undefined;
      if (oldRef && (!old || old.rootId !== rootId || old.status !== "CONFIRMED" || JSON.stringify(old.scope) !== JSON.stringify(row.scope))) throw new HttpsError("failed-precondition", "La memoria anterior no pertenece al mismo ámbito vigente.");
      const now = new Date().toISOString();
      tx.set(ref, { status: decision === "CONFIRM" ? "CONFIRMED" : "REJECTED", lastVerifiedAt: now, reviewedBy: actorUid,
        ...(oldRef && decision === "CONFIRM" ? { supersedes: [...(row.supersedes || []), oldRef.id] } : {}) }, { merge: true });
      if (oldRef && decision === "CONFIRM") tx.set(oldRef, { status: "SUPERSEDED", supersededBy: id, lastVerifiedAt: now }, { merge: true });
      return { changed: true };
    });
  }
  async linkVerifiedExperience(rootId: string, observationId: string, decisionId: string, outcomeId: string) {
    const scope = this.scope(rootId);
    if (![observationId, decisionId, outcomeId].every(valid)) throw new HttpsError("invalid-argument", "Referencias de experiencia inválidas.");
    const [observation, decision, outcome] = await Promise.all([this.observationRef(observationId).get(), this.memoryRef(decisionId).get(), this.observationRef(outcomeId).get()]);
    const a = observation.data(), d = decision.data() as HugoMemoryRecord | undefined, z = outcome.data();
    if (!a || !d || !z || [a.rootId, d.rootId, z.rootId].some(x => x !== scope) || !a.caseId || a.caseId !== z.caseId || d.entityReference?.entityId !== a.caseId ||
      d.kind !== "DECISION" || d.status !== "CONFIRMED" || d.links?.observationId !== observationId || !d.decision?.decisionAt ||
      !a.createdAt?.toMillis?.() || !z.createdAt?.toMillis?.() || a.createdAt.toMillis() > Date.parse(d.decision.decisionAt) || z.createdAt.toMillis() < Date.parse(d.decision.decisionAt) ||
      a.source !== "ACTIVITY_LOG" || z.source !== "ACTIVITY_LOG" ||
      !["SOLICITUD_COMPLETADA", "PAGO_APLICADO_A_SOLICITUD", "DISPERSION_INCIDENCIA_RESUELTA", "OPERACION_RECUPERADA"].includes(z.sourceEvent)) throw new HttpsError("failed-precondition", "No hay vínculo verificable entre observación, decisión y resultado.");
    const id = `experience_${createHash("sha256").update(JSON.stringify([scope, observationId, decisionId, outcomeId])).digest("hex").slice(0, 36)}`;
    const ref = this.memoryRef(id), now = new Date().toISOString(), entityReference = d.entityReference!;
    if ((await ref.get()).exists) return { id, created: false };
    const record: HugoMemoryRecord & { entityKey: string } = { id, version: MEMORY_CONTRACT_VERSION, rootId: scope, kind: "EXPERIENCE", status: "CONFIRMED",
      scope: { level: "ENTITY", rootId: scope, system: entityReference.sourceSystem, entityType: entityReference.entityType, entityId: entityReference.entityId },
      entityReference, entityKey: `${entityReference.sourceSystem}:${entityReference.entityType}:${entityReference.entityId}`,
      content: `Evento observado: ${String(a.intent || a.sourceEvent).slice(0, 220)}. Decisión humana: ${String(d.decision?.decisionType || "UNKNOWN").slice(0, 40)}. Resultado registrado: ${String(z.outcome || z.sourceEvent).slice(0, 220)}.`,
      source: "VERIFIED_ACTIVITY_LINK", sourceSystem: "HUGO", confidence: null, createdAt: now, effectiveAt: z.createdAt?.toDate?.()?.toISOString() || now, lastVerifiedAt: now, validUntil: null, supersedes: [],
      links: { observationId, ...(d.links?.recommendationId ? { recommendationId: d.links.recommendationId } : {}), decisionId, outcomeId, linkStatus: "LINKED" },
      verification: { evidenceSource: "ACTIVITY_LOG_TERMINAL_EVENT", confirmations: 1, contradictions: 0, outcomeKnown: true } };
    try { await ref.create(record); return { id, created: true }; }
    catch (error: any) { if (error?.code === 6 || error?.code === "already-exists") return { id, created: false }; throw error; }
  }
  async purgeExpiredTraces(now = new Date()) {
    let removed = 0;
    for (let page = 0; page < 5; page++) {
      const due = await this.db.collection("agent007Traces").where("expiresAt", "<=", now).orderBy("expiresAt").limit(100).get();
      if (due.empty) break;
      const batch = this.db.batch(); due.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit(); removed += due.size;
      if (due.size < 100) break;
    }
    return removed;
  }
}
