import { FieldValue, Firestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { HugoConversationState, HugoDataStore, HugoTraceFilter, HugoTurnInput } from "./hugoCore/dataStoreContract";

const timestampMillis = (value: any) => value?.toMillis?.() || (value instanceof Date ? value.getTime() : 0);
const valid = (value: string) => Boolean(value && value.length <= 160 && !value.includes("/"));

export class FirestoreHugoDataStore implements HugoDataStore {
  constructor(private readonly db: Firestore) {}

  private scope(rootId: string) { if (!valid(rootId)) throw new HttpsError("invalid-argument", "Ámbito inválido."); return rootId; }
  private async recent(collection: string, rootId: string, limit: number) {
    const snap = await this.db.collection(collection).where("rootId", "==", this.scope(rootId)).orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).sort((a, b) => timestampMillis(b.updatedAt || b.createdAt) - timestampMillis(a.updatedAt || a.createdAt));
  }
  async loadConversationState(identity: { uid: string; rootId: string }, conversationId: string): Promise<HugoConversationState> {
    if (!valid(identity.uid) || conversationId !== `${this.scope(identity.rootId)}_${identity.uid}`) throw new HttpsError("permission-denied", "Conversación fuera de ámbito.");
    const [prior, conversationSnap, recommendations, rules] = await Promise.all([
      this.db.collection("agent007Messages").where("conversationId", "==", conversationId).where("rootId", "==", identity.rootId).orderBy("createdAt", "desc").limit(12).get(),
      this.db.collection("agent007Conversations").doc(conversationId).get(), this.recent("agent007Recommendations", identity.rootId, 20), this.recent("agent007LearnedRules", identity.rootId, 20),
    ]);
    const history = prior.docs.map(doc => doc.data()).sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt)).slice(-12);
    const row = conversationSnap.data();
    return { history, memory: { recommendations, rules }, recentEntities: row?.rootId === identity.rootId && row?.ownerUid === identity.uid && Array.isArray(row.recentEntities) ? row.recentEntities.slice(0, 8) : [] };
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
  pendingRecommendations(rootId: string, limit = 100) { return this.db.collection("agent007Recommendations").where("rootId", "==", this.scope(rootId)).where("status", "==", "PENDING_REVIEW").limit(limit); }
  async listMessages(rootId: string, uid: string, limit = 80) {
    const conversationId = `${this.scope(rootId)}_${uid}`;
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
    if (input.conversationId !== `${this.scope(input.rootId)}_${input.uid}`) throw new HttpsError("permission-denied", "Conversación fuera de ámbito.");
    const messages = this.db.collection("agent007Messages"), userMessage = messages.doc(), assistantMessage = messages.doc(), now = Timestamp.now();
    const batch = this.db.batch();
    batch.set(this.db.collection("agent007Conversations").doc(input.conversationId), { rootId: input.rootId, ownerUid: input.uid, participantUids: [input.uid], status: "ACTIVE", lastMessage: input.reply,
      lastMessageAt: now, updatedAt: now, recentEntities: input.recentEntities, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.create(userMessage, { rootId: input.rootId, conversationId: input.conversationId, role: "user", text: input.text, senderUid: input.uid, source: "USER", read: true, createdAt: now });
    batch.create(assistantMessage, { rootId: input.rootId, conversationId: input.conversationId, role: "assistant", text: input.reply, recipientUid: input.uid, source: input.source,
      read: true, capability: input.capability || null, capabilityExecuted: input.capabilityExecuted, contextSummary: input.contextSummary, createdAt: Timestamp.fromMillis(now.toMillis() + 1) });
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
