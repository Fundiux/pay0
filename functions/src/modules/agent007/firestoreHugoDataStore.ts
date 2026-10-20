import { observationEvidenceResolver, assertResolvedOutcomeTime } from "./observationEvidence";
import { sameEvidenceIdentity, observationEntity } from "./hugoCore/evidenceIdentity";
import { FieldValue, Firestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { createHash } from "node:crypto";
import { HugoConversationState, HugoDataStore, HugoTraceFilter, HugoTurnInput } from "./hugoCore/dataStoreContract";
import { HugoMemoryKind, HugoMemoryRecord, MemoryQuery, MemoryRetrieval, MEMORY_CONTRACT_VERSION, memoryApplicable, memoryPriority, memoryReason, memoryWritePolicy } from "./hugoCore/memoryContract";
import { normalizeConversationState } from "./hugoCore/conversationState";
import { correctionBindingId, persistConversationCorrection, type CorrectionTopic } from "./conversationCorrections";
import { assertAuthorized } from "../../utils/authGuard";

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
    const conversationState = normalizeConversationState(owned ? row?.conversationState : null, identity.rootId);
    const correctionIds = owned && Array.isArray(row?.responseCorrectionIds) ? row.responseCorrectionIds.filter((id: unknown): id is string => typeof id === "string" && valid(id)).slice(0, 3) : [];
    const correctionSnaps = await Promise.all(correctionIds.map((id: string) => this.memoryRef(id).get()));
    const conversationCorrections = correctionSnaps.flatMap(snap => {
      const record = snap.data() as HugoMemoryRecord | undefined, link = record?.conversationCorrection;
      if (!record || record.id !== snap.id || record.rootId !== identity.rootId || record.authorUid !== identity.uid || record.kind !== "USER_STATEMENT" || record.source !== "EXPLICIT_HUMAN" || record.status !== "CONFIRMED" || record.supersededBy ||
        !link || link.topic || link.sourceKind !== "TEXT" || link.conversationId !== conversationId || link.ownerUid !== identity.uid || !Number.isInteger(link.confirmedTurn) || link.confirmedTurn > conversationState.turn || conversationState.turn - link.confirmedTurn > 4 ||
        typeof record.content !== "string" || !record.content.trim() || record.content.length > 1000 || !record.validUntil || !Number.isFinite(Date.parse(record.validUntil)) || Date.parse(record.validUntil) <= Date.now()) return [];
      return [{ id: snap.id, content: record.content, sourceId: link.sourceId, turnId: link.turnId, ...(link.sourceQuestion ? { sourceQuestion: link.sourceQuestion } : {}), authority: "USER_STATEMENT_NOT_FACT" as const }];
    });
    return { history, memory: { recommendations, rules }, recentEntities: owned && Array.isArray(row.recentEntities) ? row.recentEntities.slice(0, 8) : [],
      conversationState, conversationCorrections };
  }
  async listObservations(rootId: string, limit = 50) { return this.recent("agent007Observations", rootId, Math.min(Math.max(limit, 1), 50)); }
  async loadTopicCorrections(identity: { uid: string; rootId: string }, topics: CorrectionTopic[]) {
    if (!valid(identity.uid) || !valid(identity.rootId) || topics.length > 2 || topics.some(topic => !["CLIENT", "TOPIC"].includes(topic.kind) || !valid(topic.id))) throw new HttpsError("invalid-argument", "Tema inválido.");
    return this.db.runTransaction(async tx => {
      const user = (await tx.get(this.db.doc(`users/${identity.uid}`))).data();
      assertAuthorized({ uid: identity.uid }, user, { allowedRoles: ["superadmin"] });
      if ((user?.rootId || identity.uid) !== identity.rootId) throw new HttpsError("permission-denied", "Ámbito revocado.");
      const bindings = await Promise.all(topics.map(topic => tx.get(this.db.doc(`agent007ConversationCorrectionBindings/${correctionBindingId(identity.rootId, identity.uid, topic)}`))));
      const requests = bindings.flatMap((snap, index) => {
        const row = snap.data(), topic = topics[index];
        if (!row || row.rootId !== identity.rootId || row.ownerUid !== identity.uid || row.topic?.kind !== topic.kind || row.topic?.id !== topic.id || !Array.isArray(row.memoryIds)) return [];
        return row.memoryIds.slice(0, 3).filter((id: unknown): id is string => typeof id === "string" && valid(id)).map((id: string) => ({ id, topic, bindingId: snap.id }));
      });
      const records = await Promise.all(requests.map(request => tx.get(this.memoryRef(request.id))));
      return records.flatMap((snap, index) => {
        const row = snap.data() as HugoMemoryRecord | undefined, link = row?.conversationCorrection, request = requests[index];
        if (!row || row.rootId !== identity.rootId || row.authorUid !== identity.uid || row.kind !== "USER_STATEMENT" || row.source !== "EXPLICIT_HUMAN" || row.status !== "CONFIRMED" || row.supersededBy || row.validUntil !== null ||
          !link || link.sourceKind !== "TEXT" || link.ownerUid !== identity.uid || link.bindingId !== request.bindingId || link.topic?.kind !== request.topic.kind || link.topic?.id !== request.topic.id || typeof row.content !== "string" || !row.content.trim() || row.content.length > 1000) return [];
        return [{ id: snap.id, content: row.content, sourceId: link.sourceId, turnId: link.turnId, topic: request.topic, authority: "USER_STATEMENT_NOT_FACT" as const }];
      });
    });
  }
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
    const conversation = { rootId: input.rootId, ownerUid: input.uid, participantUids: [input.uid], status: "ACTIVE", lastMessage: input.reply,
      lastMessageAt: now, updatedAt: now, recentEntities: input.recentEntities, ...(input.conversationState ? { conversationState: input.conversationState } : {}), createdAt: FieldValue.serverTimestamp() };
    // Replace the supplied state map: recursive merge would revive cleared report filters.
    // Other top-level conversation fields remain untouched; the batch keeps turn writes atomic.
    batch.set(this.db.collection("agent007Conversations").doc(input.conversationId), conversation, { mergeFields: Object.keys(conversation) });
    batch.create(userMessage, { rootId: input.rootId, conversationId: input.conversationId, role: "user", text: input.text, senderUid: input.uid, source: "USER", visibility: "CONVERSATION", scope: input.scope || "PAY0", profile: input.profile || "OPERATOR", read: true, createdAt: now });
    batch.create(assistantMessage, { rootId: input.rootId, conversationId: input.conversationId, role: "assistant", text: input.reply, ...(input.reportExport ? { reportExport: input.reportExport } : {}), ...(input.correctionChoices?.length ? { correctionChoices: input.correctionChoices } : {}), ...(input.personalNotes?.length ? { personalNotes: input.personalNotes } : {}), recipientUid: input.uid, source: input.source,
      visibility: "CONVERSATION", scope: input.scope || "PAY0", profile: input.profile || "OPERATOR", replyToMessageId: userMessage.id, turn: input.conversationState?.turn ?? null, traceId: input.traceId,
      read: true, capability: input.capability || null, capabilityExecuted: input.capabilityExecuted, contextSummary: input.contextSummary, createdAt: Timestamp.fromMillis(now.toMillis() + 1) });
    batch.create(this.db.collection("agent007Traces").doc(input.traceId), { ...input.trace, rootId: input.rootId, actorUid: input.uid, conversationId: input.conversationId });
    await batch.commit();
    return { id: assistantMessage.id, createdAt: now };
  }
  async saveVoiceOperationalState(input: { rootId: string; uid: string; resumeContext?: Record<string, any>; diagnostic: Record<string, any> }) {
    const conversationId = `${this.scope(input.rootId)}_${input.uid}_global`;
    if (!valid(input.uid) || !this.ownsConversation(input.rootId, input.uid, conversationId)) throw new HttpsError("permission-denied", "Conversación fuera de ámbito.");
    await this.db.collection("agent007Conversations").doc(conversationId).set({ rootId: input.rootId, ownerUid: input.uid, participantUids: [input.uid], status: "ACTIVE",
      ...(input.resumeContext ? { resumeContext: input.resumeContext } : {}), lastOperationDiagnostic: input.diagnostic, updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() }, { merge: true });
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
    const selected = records.filter(row => !row.conversationCorrection && memoryApplicable(row, query)).sort((a, b) => memoryPriority(a) - memoryPriority(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit).map(record => ({ record, relevanceReason: memoryReason(record), verificationStatus: record.status }));
    const obsKeys = [...new Set(query.entityReferences.flatMap(x => [x.entityId, x.displayReference].filter((v): v is string => Boolean(v && valid(v)))))] .slice(0, 4);
    const observationSnaps = await Promise.all(obsKeys.map(caseId => this.db.collection("agent007Observations").where("rootId", "==", rootId).where("caseId", "==", caseId).limit(8).get()));
    const legacy = observationSnaps.flatMap(snap => snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any))).filter(row => row.rootId === rootId && row.source === "ACTIVITY_LOG");
    return { considered: records.length, selected, legacyObservationsConsidered: legacy.length,
      legacyObservations: legacy.slice(0, 2).map(row => ({ id: row.id, rootId, caseId: row.caseId, sourceEvent: String(row.sourceEvent || ""), intent: String(row.intent || "").slice(0, 250), outcome: String(row.outcome || "").slice(0, 350), createdAt: row.createdAt?.toDate?.()?.toISOString() || null, verificationStatus: "UNVERIFIED_LEGACY" as const, relevanceReason: "ENTITY_MATCH" as const })) };
  }
  async listMemoryDiagnostics(rootId: string, limit = 50, ownerUid?: string): Promise<HugoMemoryRecord[]> {
    const snap = await this.db.collection("agent007Memory").where("rootId", "==", this.scope(rootId)).orderBy("createdAt", "desc").limit(Math.min(Math.max(limit, 1), 50)).get();
    return snap.docs.map(doc => ({ ...doc.data(), id: doc.id } as HugoMemoryRecord)).filter(row => !row.conversationCorrection || row.authorUid === ownerUid);
  }
  async correctResponse(input: { rootId: string; uid: string; messageId: string; scope: "PAY0" | "GLOBAL"; content: string; expectedVersion: number; expectedText: string; rememberFor?: { kind: "CLIENT" } | { kind: "TOPIC"; label: string } }) {
    const conversationId = `${input.rootId}_${input.uid}${input.scope === "GLOBAL" ? "_global" : ""}`;
    return persistConversationCorrection(this.db, { ...input, conversationId, sourceKind: "TEXT", sourceId: input.messageId }, async tx => {
      const ref = this.messageRef(input.messageId), snap = await tx.get(ref), row = snap.data();
      if (!row || row.role !== "assistant" || row.rootId !== input.rootId || row.recipientUid !== input.uid || row.conversationId !== conversationId) throw new HttpsError("permission-denied", "La respuesta no pertenece a esta conversación.");
      if (typeof input.expectedText !== "string" || input.expectedText !== row.text) throw new HttpsError("failed-precondition", "La respuesta cambió. Recarga antes de corregirla.");
      const question = typeof row.replyToMessageId === "string" && valid(row.replyToMessageId) ? (await tx.get(this.messageRef(row.replyToMessageId))).data() : null;
      const sourceQuestion = question?.rootId === input.rootId && question?.conversationId === conversationId && question?.senderUid === input.uid && question?.role === "user" && typeof question.text === "string" ? question.text : undefined;
      const rows = row.reportExport?.version === 1 && row.reportExport?.kind === "EARNINGS_BY_CLIENT" ? row.reportExport.rows : undefined;
      const client = Array.isArray(rows) && rows.length === 1 && typeof rows[0]?.clienteId === "string" && valid(rows[0].clienteId) && typeof rows[0]?.clienteNombre === "string" ? { kind: "CLIENT" as const, id: rows[0].clienteId, label: rows[0].clienteNombre } : undefined;
      return { ref, data: { rootId: row.rootId, ownerUid: row.recipientUid, conversationId: row.conversationId, sourceKind: "TEXT", sourceId: snap.id, turnId: Number.isInteger(row.turn) ? String(row.turn) : snap.id, sourceText: row.text, responseCorrection: row.responseCorrection }, ...(sourceQuestion ? { sourceQuestion } : {}), ...(client ? { clientTopic: client } : {}) };
    });
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
      if (row.conversationCorrection && row.authorUid !== actorUid) throw new HttpsError("permission-denied", "Corrección de otra conversación.");
      if (row.conversationCorrection) {
        const user = (await tx.get(this.db.doc(`users/${actorUid}`))).data();
        assertAuthorized({ uid: actorUid }, user, { allowedRoles: ["superadmin"] });
        if ((user?.rootId || actorUid) !== rootId || row.conversationCorrection.ownerUid !== actorUid || decision !== "REJECT" || supersedesId) throw new HttpsError("permission-denied", "Sólo puedes retirar tu propia corrección.");
        const link = row.conversationCorrection;
        if (link.bindingId && (!link.topic || link.bindingId !== correctionBindingId(rootId, actorUid, link.topic))) throw new HttpsError("failed-precondition", "Ámbito de corrección inconsistente.");
        const bindingRef = link.bindingId ? this.db.doc(`agent007ConversationCorrectionBindings/${link.bindingId}`) : null;
        const binding = bindingRef ? await tx.get(bindingRef) : null;
        const sourceRef = link.sourceKind === "TEXT" && valid(link.sourceId) ? this.messageRef(link.sourceId) : null;
        const source = sourceRef ? await tx.get(sourceRef) : null;
        if (source && (source.get("rootId") !== rootId || source.get("recipientUid") !== actorUid || source.get("conversationId") !== link.conversationId)) throw new HttpsError("permission-denied", "Respuesta de otro ámbito.");
        if (binding?.exists && (binding.get("rootId") !== rootId || binding.get("ownerUid") !== actorUid)) throw new HttpsError("permission-denied", "Ámbito ajeno.");
        if (binding?.exists && (!Array.isArray(binding.get("memoryIds")) || binding.get("memoryIds").length > 3 || !binding.get("memoryIds").every((value: unknown) => typeof value === "string" && valid(value)))) throw new HttpsError("failed-precondition", "El vínculo del recuerdo requiere revisión.");
        if (row.status !== "CONFIRMED") return { changed: false };
        tx.update(ref, { status: "REJECTED", lastVerifiedAt: new Date().toISOString(), reviewedBy: actorUid });
        if (bindingRef && binding?.exists) tx.update(bindingRef, { memoryIds: (binding.get("memoryIds") || []).filter((value: string) => value !== id) });
        if (sourceRef && source?.get("responseCorrection.memoryId") === id) tx.update(sourceRef, { "responseCorrection.status": "REJECTED" });
        return { changed: true };
      }
      if (row.status !== "CANDIDATE") return { changed: false };
      if (decision === "CONFIRM" && (["FACT", "RULE", "HYPOTHESIS"].includes(row.kind) || row.kind === "EXPERIENCE" && (!row.links?.outcomeId || row.verification?.outcomeKnown !== true))) throw new HttpsError("failed-precondition", "La evidencia no permite confirmar esta memoria.");
      const oldSnap = oldRef ? await tx.get(oldRef) : null, old = oldSnap?.data() as HugoMemoryRecord | undefined;
      if (old?.conversationCorrection) throw new HttpsError("permission-denied", "Usa la corrección original para editar o retirar este recuerdo.");
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
    const id = `experience_${createHash("sha256").update(JSON.stringify([scope, observationId, decisionId, outcomeId])).digest("hex").slice(0, 36)}`;
    const ref = this.memoryRef(id);
    // Source evidence and creation share one read set: a concurrent revocation retries validation.
    return this.db.runTransaction(async tx => {
      const [observation, decision, outcome, existing] = await Promise.all([tx.get(this.observationRef(observationId)), tx.get(this.memoryRef(decisionId)), tx.get(this.observationRef(outcomeId)), tx.get(ref)]);
      const resolveEvidence = observationEvidenceResolver(this.db, tx, scope);
      const [initialEvidence, outcomeEvidence] = await Promise.all([
        resolveEvidence(observationId, observation.data()), resolveEvidence(outcomeId, outcome.data()),
      ]);
      const a = initialEvidence.observation, d = decision.data() as HugoMemoryRecord | undefined, z = outcomeEvidence.observation;
      assertResolvedOutcomeTime(outcomeEvidence, Date.parse(d?.decision?.decisionAt || ""));
      if (!sameEvidenceIdentity(observationEntity(a), d?.entityReference, observationEntity(z)))
        throw new HttpsError("failed-precondition", "Identidad de evidencia incompleta o incompatible: sistema, tipo e identificador requeridos.");
      const observedAt = a?.createdAt?.toMillis?.(), decidedAt = Date.parse(d?.decision?.decisionAt || ""), outcomeAt = z?.createdAt?.toMillis?.();
      if (!a || !d || !z || [a.rootId, d.rootId, z.rootId].some(x => x !== scope) || !a.caseId || a.caseId !== z.caseId || d.entityReference?.entityId !== a.caseId ||
        d.kind !== "DECISION" || d.status !== "CONFIRMED" || d.links?.observationId !== observationId || !d.decision?.decisionAt ||
        ![observedAt, decidedAt, outcomeAt].every(value => Number.isFinite(value) && value > 0) || observedAt > decidedAt || outcomeAt < decidedAt ||
        a.source !== "ACTIVITY_LOG" || z.source !== "ACTIVITY_LOG" ||
        !["SOLICITUD_COMPLETADA", "PAGO_APLICADO_A_SOLICITUD", "DISPERSION_INCIDENCIA_RESUELTA", "OPERACION_RECUPERADA"].includes(z.sourceEvent)) throw new HttpsError("failed-precondition", "No hay vínculo verificable entre observación, decisión y resultado.");
      const now = new Date().toISOString(), entityReference = d.entityReference!;
      if (existing.exists) {
        if (existing.data()?.rootId !== scope) throw new HttpsError("failed-precondition", "La experiencia no pertenece al root actual.");
        return { id, created: false };
      }
      const record: HugoMemoryRecord & { entityKey: string } = { id, version: MEMORY_CONTRACT_VERSION, rootId: scope, kind: "EXPERIENCE", status: "CONFIRMED",
        scope: { level: "ENTITY", rootId: scope, system: entityReference.sourceSystem, entityType: entityReference.entityType, entityId: entityReference.entityId },
        entityReference, entityKey: `${entityReference.sourceSystem}:${entityReference.entityType}:${entityReference.entityId}`,
        content: `Evento observado: ${String(a.intent || a.sourceEvent).slice(0, 220)}. Decisión humana: ${String(d.decision?.decisionType || "UNKNOWN").slice(0, 40)}. Resultado registrado: ${String(z.outcome || z.sourceEvent).slice(0, 220)}.`,
        source: "VERIFIED_ACTIVITY_LINK", sourceSystem: "HUGO", confidence: null, createdAt: now, effectiveAt: new Date(outcomeAt).toISOString(), lastVerifiedAt: now, validUntil: null, supersedes: [],
        links: { observationId, ...(d.links?.recommendationId ? { recommendationId: d.links.recommendationId } : {}), decisionId, outcomeId, linkStatus: "LINKED" },
        verification: { evidenceSource: "ACTIVITY_LOG_TERMINAL_EVENT", confirmations: 1, contradictions: 0, outcomeKnown: true } };
      tx.create(ref, record);
      return { id, created: true };
    });
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
