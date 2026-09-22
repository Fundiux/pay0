import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import { db, getActivityAdminId, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { reconcileAgent007Recommendations } from "./reconciliation";
import { executeRequestIqComplement, requestedComplementAction } from "./capabilities";
import { Pay0Connector } from "./pay0Connector";
import { HugoToolRouter } from "./hugoCore/toolRouter";
import { HugoConversationCore } from "./hugoCore/conversationCore";
import { VertexGeminiAdapter } from "./vertexGeminiAdapter";
import { conversationTrace } from "./traceStore";

const clean = (value: unknown, max = 1000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

const conversationIdFor = (rootId: string, uid: string) => `${rootId}_${uid}`;

function timestampMillis(value: any): number {
  if (value?.toMillis) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

function displayName(user: any): string {
  return clean(user?.displayName || user?.name || user?.nombre || user?.firstName || user?.email?.split?.("@")[0] || "", 80) || "usuario";
}

async function recentRows(collection: string, rootId: string, limit = 20) {
  const snap = await db.collection(collection).where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as any))
    .sort((a, b) => timestampMillis(b.updatedAt || b.createdAt) - timestampMillis(a.updatedAt || a.createdAt));
}

async function actor(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"] });
  return { uid, user, rootId: clean(user?.rootId || uid, 128) };
}

export const recordAgent007Observation = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { uid, user, rootId } = await actor(request);
    const caseType = clean(request.data?.caseType, 40).toUpperCase();
    const caseId = clean(request.data?.caseId, 128);
    const intent = clean(request.data?.intent, 500);
    const humanDecision = clean(request.data?.humanDecision, 500);
    const outcome = clean(request.data?.outcome, 500);
    if (!caseType || !caseId || !intent || !humanDecision || !outcome) {
      throw new HttpsError("invalid-argument", "Caso, intención, decisión humana y resultado son obligatorios.");
    }
    const ref = db.collection("agent007Observations").doc();
    await ref.create({
      rootId, agentId: "AGENTE_007", phase: "OBSERVATION", caseType, caseId, intent, humanDecision, outcome,
      actorUid: uid, actorRole: String(getUserRole(user)), authorization: { role: String(getUserRole(user)), scope: "rootId", rootId },
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), expiresAt: null,
    });
    await logActivity({ event: "AGENTE_007_OBSERVACION", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid, actorName: clean(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: ref.id, referenceType: "agent007Observation", relatedEntityId: caseId, relatedEntityType: caseType, description: `Hugo registró observación supervisada: ${intent}` });
    return { ok: true, observationId: ref.id };
  }
);

export const listAgent007Observations = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { rootId } = await actor(request);
    const snapshot = await db.collection("agent007Observations").where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(50).get();
    return { ok: true, observations: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) };
  }
);

export const listAgent007Recommendations = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { rootId } = await actor(request);
    const snapshot = await db.collection("agent007Recommendations").where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(50).get();
    return { ok: true, recommendations: snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })) };
  },
);

export const reconcileAgent007RecommendationsNow = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { rootId } = await actor(request);
    const changed = await reconcileAgent007Recommendations(db, rootId);
    return { ok: true, changed };
  },
);

export const resolveAgent007Recommendation = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { uid, user, rootId } = await actor(request);
    const recommendationId = clean(request.data?.recommendationId, 160);
    const decision = clean(request.data?.decision, 16).toUpperCase();
    const correction = clean(request.data?.correction, 500);
    if (!recommendationId || !["APPROVED", "REJECTED"].includes(decision)) throw new HttpsError("invalid-argument", "Recomendacion o decision invalida.");
    const ref = db.collection("agent007Recommendations").doc(recommendationId);
    const snap = await ref.get(); const row: any = snap.data() || {};
    if (!snap.exists || clean(row.rootId, 128) !== rootId) throw new HttpsError("not-found", "Recomendacion no encontrada.");
    if (row.status !== "PENDING_REVIEW") return { ok: true, alreadyResolved: true };
    const ruleRef = db.collection("agent007LearnedRules").doc(`${rootId}_${clean(row.kind, 50)}_${clean(row.proposal, 120)}`.replace(/[^A-Za-z0-9_-]/g, "_"));
    const resolved = await db.runTransaction(async (tx) => {
      const latest = await tx.get(ref);
      if (!latest.exists || latest.data()?.rootId !== rootId) throw new HttpsError("not-found", "Recomendación no encontrada.");
      if (latest.data()?.status !== "PENDING_REVIEW") return false;
      const rule = await tx.get(ruleRef); const current: any = rule.data() || {};
      tx.set(ref, { status: decision, correction: correction || null, resolvedBy: uid, resolvedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(ruleRef, { rootId, agentId: "AGENTE_007", phase: "SUPERVISED_ASSISTANCE", kind: row.kind, proposal: row.proposal, correction: correction || null, approvals: Number(current.approvals || 0) + (decision === "APPROVED" ? 1 : 0), rejections: Number(current.rejections || 0) + (decision === "REJECTED" ? 1 : 0), lastDecision: decision, updatedAt: FieldValue.serverTimestamp(), createdAt: current.createdAt || FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!resolved) return { ok: true, alreadyResolved: true };
    await logActivity({ event: "AGENTE_007_OBSERVACION", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid, actorName: clean(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: recommendationId, referenceType: "agent007Recommendation", relatedEntityId: clean(row.caseId, 128), relatedEntityType: clean(row.caseType, 40), description: `Hugo Fase 2: recomendacion ${decision.toLowerCase()}` });
    return { ok: true };
  },
);

export const listAgent007Messages = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { uid, rootId } = await actor(request);
    const conversationId = conversationIdFor(rootId, uid);
    const snapshot = await db.collection("agent007Messages")
      .where("conversationId", "==", conversationId)
      .where("rootId", "==", rootId)
      .orderBy("createdAt", "desc")
      .limit(80)
      .get();
    const messages = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as any))
      .sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt))
      .slice(-80);
    return { ok: true, conversationId, messages };
  },
);

export const markAgent007MessagesRead = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { uid, rootId } = await actor(request);
    const conversationId = conversationIdFor(rootId, uid);
    const snapshot = await db.collection("agent007Messages").where("conversationId", "==", conversationId).where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(80).get();
    const batch = db.batch();
    const unread = snapshot.docs.filter((doc) => {
      const row = doc.data();
      return row.recipientUid === uid && row.read === false;
    });
    unread.forEach((doc) => batch.set(doc.ref, { read: true, readAt: FieldValue.serverTimestamp() }, { merge: true }));
    if (unread.length) await batch.commit();
    return { ok: true, marked: unread.length };
  },
);

export const sendAgent007Message = onCall(
  { region: "us-central1", timeoutSeconds: 90, memory: "512MiB" },
  async (request) => {
    const { uid, user, rootId } = await actor(request);
    const text = clean(request.data?.text, 2000);
    if (!text) throw new HttpsError("invalid-argument", "Escribe un mensaje para Hugo.");
    const startedAt = Date.now();
    const conversationId = conversationIdFor(rootId, uid);
    const conversationRef = db.collection("agent007Conversations").doc(conversationId);
    const messagesRef = db.collection("agent007Messages");
    const [prior, conversationSnap, recommendations, rules] = await Promise.all([
      messagesRef.where("conversationId", "==", conversationId).where("rootId", "==", rootId).orderBy("createdAt", "desc").limit(12).get(),
      conversationRef.get(), recentRows("agent007Recommendations", rootId, 20), recentRows("agent007LearnedRules", rootId, 20),
    ]);
    const history = prior.docs
      .map((doc) => doc.data() as any)
      .sort((a, b) => timestampMillis(a.createdAt) - timestampMillis(b.createdAt))
      .slice(-12);
    const name = displayName(user);
    const capability = requestedComplementAction(text)
      ? await executeRequestIqComplement({ db, rootId, uid, message: text })
      : null;
    const identity = { uid, rootId, role: "superadmin" as const };
    const pay0 = new Pay0Connector(db, identity);
    const router = new HugoToolRouter(identity, {
      getSolicitud: ({ folio }) => pay0.getSolicitud(folio), searchSolicitudes: ({ limit }) => pay0.searchSolicitudes(limit),
      getPago: ({ folio }) => pay0.getPago(folio), searchPagos: ({ limit }) => pay0.searchPagos(limit),
      getPaymentComplementStatus: ({ folio }) => pay0.getPaymentComplementStatus(folio),
      getPay0OperationalSummary: () => pay0.getPay0OperationalSummary(), getIqCapabilities: () => pay0.getIqCapabilities(),
    });
    const core = new HugoConversationCore(router, new VertexGeminiAdapter());
    const coreInput = { channel: "WEB", conversationId, identity, name, message: text, history, memory: { recommendations, rules },
      recentEntities: conversationSnap.data()?.rootId === rootId && conversationSnap.data()?.ownerUid === uid ? conversationSnap.data()?.recentEntities || [] : [],
      commandReply: capability?.reply };
    const traceRef = db.collection("agent007Traces").doc();
    const result = await core.respond(coreInput).catch(async error => {
      await traceRef.create({ schemaVersion: 1, traceId: traceRef.id, conversationId, rootId, actorUid: uid, actorRole: "superadmin", channel: "WEB",
        timestamp: FieldValue.serverTimestamp(), model: "gemini-2.5-flash", promptVersion: "legacy-v1", resultStatus: "ERROR",
        errorCode: error instanceof Error ? clean(error.name, 80) : "ERROR", latencyMs: Date.now() - startedAt,
        toolsRequested: error instanceof Error ? (error as Error & { hugoToolsRequested?: string[] }).hugoToolsRequested || [] : [],
        toolsExecuted: error instanceof Error ? (error as Error & { hugoToolsExecuted?: string[] }).hugoToolsExecuted || [] : [],
        evidenceReferences: [], expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }).catch(() => undefined);
      throw error;
    });
    const reply = result.text;
    const userMessage = messagesRef.doc();
    const assistantMessage = messagesRef.doc();
    const now = Timestamp.now();
    const batch = db.batch();
    batch.set(conversationRef, {
      rootId, ownerUid: uid, participantUids: [uid], status: "ACTIVE",
      lastMessage: reply, lastMessageAt: now, updatedAt: now,
      recentEntities: result.recentEntities.length ? result.recentEntities : coreInput.recentEntities,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.create(userMessage, {
      rootId, conversationId, role: "user", text, senderUid: uid,
      source: "USER", read: true, createdAt: now,
    });
    batch.create(assistantMessage, {
      rootId, conversationId, role: "assistant", text: reply, recipientUid: uid,
      source: result.source === "MODEL_RESPONSE" ? "VERTEX_AI" : "HUGO_ENGINE", read: true,
      capability: capability ? "REQUEST_IQ_PAYMENT_COMPLEMENT" : null,
      capabilityExecuted: capability?.executed === true,
      contextSummary: { folioConsultado: result.context.folioConsultado, solicitudes: result.context.solicitudes.length, pagos: result.context.pagos.length, dudas: result.context.dudasPendientes.length },
      createdAt: Timestamp.fromMillis(now.toMillis() + 1),
    });
    batch.create(traceRef, conversationTrace(traceRef.id, coreInput, result, startedAt, capability));
    await batch.commit();
    return { ok: true, conversationId, message: { id: assistantMessage.id, role: "assistant", text: reply, source: result.source === "MODEL_RESPONSE" ? "VERTEX_AI" : "HUGO_ENGINE", createdAt: now } };
  },
);
