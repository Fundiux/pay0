import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
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
import { FirestoreHugoDataStore } from "./firestoreHugoDataStore";
import { HugoTraceFilter } from "./hugoCore/dataStoreContract";
import { MEMORY_CONTRACT_VERSION } from "./hugoCore/memoryContract";
import { FirestoreHugoLearningStore } from "./firestoreHugoLearningStore";
import { LearningCorrection, LearningReference } from "./hugoCore/learningContract";
import { HumanReviewInput, validateHumanReview } from "./hugoCore/humanReviewContract";

const clean = (value: unknown, max = 1000) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

const conversationIdFor = (rootId: string, uid: string) => `${rootId}_${uid}`;
const hugoData = new FirestoreHugoDataStore(db);
const hugoLearning = new FirestoreHugoLearningStore(db);

function displayName(user: any): string {
  return clean(user?.displayName || user?.name || user?.nombre || user?.firstName || user?.email?.split?.("@")[0] || "", 80) || "usuario";
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
    const observationId = await hugoData.recordObservation(rootId, {
      rootId, agentId: "AGENTE_007", phase: "OBSERVATION", caseType, caseId, intent, humanDecision, outcome,
      actorUid: uid, actorRole: String(getUserRole(user)), authorization: { role: String(getUserRole(user)), scope: "rootId", rootId },
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), expiresAt: null,
    });
    await logActivity({ event: "AGENTE_007_OBSERVACION", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid, actorName: clean(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: observationId, referenceType: "agent007Observation", relatedEntityId: caseId, relatedEntityType: caseType, description: `Hugo registró observación supervisada: ${intent}` });
    return { ok: true, observationId };
  }
);

export const listAgent007Observations = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { rootId } = await actor(request);
    return { ok: true, observations: await hugoData.listObservations(rootId) };
  }
);

export const listAgent007Recommendations = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { rootId } = await actor(request);
    return { ok: true, recommendations: await hugoData.listRecommendations(rootId) };
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
    const ref = hugoData.recommendationRef(recommendationId);
    const snap = await ref.get(); const row: any = snap.data() || {};
    if (!snap.exists || clean(row.rootId, 128) !== rootId) throw new HttpsError("not-found", "Recomendacion no encontrada.");
    if (row.status !== "PENDING_REVIEW") return { ok: true, alreadyResolved: true };
    const ruleRef = hugoData.learnedRuleRef(`${rootId}_${clean(row.kind, 50)}_${clean(row.proposal, 120)}`.replace(/[^A-Za-z0-9_-]/g, "_"));
    const memoryRef = hugoData.memoryRef(`decision_${recommendationId}`);
    const resolved = await db.runTransaction(async (tx) => {
      const latest = await tx.get(ref);
      if (!latest.exists || latest.data()?.rootId !== rootId) throw new HttpsError("not-found", "Recomendación no encontrada.");
      if (latest.data()?.status !== "PENDING_REVIEW") return false;
      const rule = await tx.get(ruleRef); const current: any = rule.data() || {};
      const observationRef = row.sourceActivityId ? hugoData.observationRef(`activity_${clean(row.sourceActivityId, 160)}`) : null;
      const observation = observationRef ? await tx.get(observationRef) : null;
      const linkedObservation = observationRef && observation?.data()?.rootId === rootId && observation.data()?.caseId === row.caseId ? observationRef.id : null;
      tx.set(ref, { status: decision, correction: correction || null, resolvedBy: uid, resolvedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(ruleRef, { rootId, agentId: "AGENTE_007", phase: "SUPERVISED_ASSISTANCE", kind: row.kind, proposal: row.proposal, correction: correction || null, approvals: Number(current.approvals || 0) + (decision === "APPROVED" ? 1 : 0), rejections: Number(current.rejections || 0) + (decision === "REJECTED" ? 1 : 0), lastDecision: decision, updatedAt: FieldValue.serverTimestamp(), createdAt: current.createdAt || FieldValue.serverTimestamp() }, { merge: true });
      const now = new Date().toISOString(), entityId = clean(row.caseId, 128), entityType = clean(row.caseType, 40);
      tx.set(memoryRef, { id: memoryRef.id, version: MEMORY_CONTRACT_VERSION, rootId, kind: "DECISION", status: "CONFIRMED",
        scope: entityId && entityType ? { level: "ENTITY", rootId, system: "PAY0", entityType, entityId } : { level: "ROOT", rootId },
        entityKey: entityId && entityType ? `PAY0:${entityType}:${entityId}` : null,
        ...(entityId && entityType ? { entityReference: { sourceSystem: "PAY0", entityType, entityId } } : {}),
        content: `Decisión ${decision} sobre propuesta: ${clean(row.proposal, 300)}${correction ? `. Corrección: ${correction}` : ""}`,
        source: "RECOMMENDATION_RESOLUTION", sourceSystem: "HUGO", confidence: null, createdAt: now, effectiveAt: now, lastVerifiedAt: now,
        validUntil: null, supersedes: [], links: { recommendationId, ...(linkedObservation ? { observationId: linkedObservation } : {}), linkStatus: linkedObservation ? "LINKED" : "UNKNOWN" },
        decision: { actorUid: uid, actorRole: String(getUserRole(user)), decisionType: decision, decisionAt: now },
        verification: { evidenceSource: "HUMAN_DECISION", confirmations: 1, contradictions: 0, outcomeKnown: false } });
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
    const messages = await hugoData.listMessages(rootId, uid);
    return { ok: true, conversationId, messages };
  },
);

export const markAgent007MessagesRead = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const { uid, rootId } = await actor(request);
    const conversationId = conversationIdFor(rootId, uid);
    return { ok: true, marked: await hugoData.markMessagesRead(rootId, uid) };
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
    const core = new HugoConversationCore(router, new VertexGeminiAdapter(), hugoData, hugoLearning);
    const coreInput = { channel: "WEB", conversationId, identity, name, message: text, commandReply: capability?.reply, promptVersion: "hugo-v2" as const };
    const traceId = hugoData.newTraceId();
    const result = await core.respond(coreInput).catch(async error => {
      await hugoData.saveErrorTrace(rootId, traceId, { schemaVersion: 1, conversationId, actorUid: uid, actorRole: "superadmin", channel: "WEB",
        timestamp: FieldValue.serverTimestamp(), model: "gemini-2.5-flash", promptVersion: "hugo-v2", resultStatus: "ERROR",
        errorCode: error instanceof Error ? clean(error.name, 80) : "ERROR", latencyMs: Date.now() - startedAt,
        toolsRequested: error instanceof Error ? (error as Error & { hugoToolsRequested?: string[] }).hugoToolsRequested || [] : [],
        toolsExecuted: error instanceof Error ? (error as Error & { hugoToolsExecuted?: string[] }).hugoToolsExecuted || [] : [],
        evidenceReferences: [], expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }).catch(() => undefined);
      throw error;
    });
    const reply = result.text;
    const source = result.source === "MODEL_RESPONSE" ? "VERTEX_AI" : "HUGO_ENGINE";
    const saved = await hugoData.saveTurn({ rootId, uid, conversationId, text, reply, source, capability: capability ? "REQUEST_IQ_PAYMENT_COMPLEMENT" : null,
      capabilityExecuted: capability?.executed === true, recentEntities: result.recentEntities, conversationState: result.conversationState,
      contextSummary: { folioConsultado: result.context.folioConsultado, solicitudes: result.context.solicitudes.length, pagos: result.context.pagos.length, dudas: result.context.dudasPendientes.length },
      traceId, trace: conversationTrace(traceId, coreInput, result, startedAt, capability) });
    for (const experienceId of result.learningUsage?.includedIds || []) {
      await hugoLearning.appendEvent(rootId, experienceId, "EXPERIENCE_RETRIEVED", uid, { traceId }).catch(() => undefined);
    }
    return { ok: true, conversationId, message: { id: saved.id, role: "assistant", text: reply, source, createdAt: saved.createdAt } };
  },
);

export const listAgent007Traces = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { rootId } = await actor(request);
    const data = request.data || {};
    const date = (value: unknown, endOfDay = false) => {
      if (value == null || value === "") return undefined;
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)) throw new HttpsError("invalid-argument", "Fecha inválida.");
      const parsed = new Date(value);
      if (!Number.isFinite(parsed.getTime())) throw new HttpsError("invalid-argument", "Fecha inválida.");
      if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) parsed.setUTCHours(23, 59, 59, 999);
      return parsed;
    };
    const filter: HugoTraceFilter = {
      conversationId: clean(data.conversationId, 160) || undefined,
      resultStatus: clean(data.resultStatus, 40) || undefined,
      tool: clean(data.tool, 80) || undefined,
      sourceSystem: clean(data.sourceSystem, 80) || undefined,
      completeness: clean(data.completeness, 40) || undefined,
      errorOnly: data.errorOnly === true,
      from: date(data.from), to: date(data.to, true), cursor: clean(data.cursor, 160) || undefined,
      limit: Number(data.limit) || 20,
    };
    return { ok: true, ...(await hugoData.listTraces(rootId, filter)) };
  },
);

export const getAgent007Trace = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { rootId } = await actor(request);
    const traceId = clean(request.data?.traceId, 160);
    if (!traceId) throw new HttpsError("invalid-argument", "Traza requerida.");
    return { ok: true, trace: await hugoData.getTrace(rootId, traceId) };
  },
);

export const listAgent007MemoryDiagnostics = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { rootId } = await actor(request);
    return { ok: true, memories: await hugoData.listMemoryDiagnostics(rootId) };
  },
);

export const createAgent007MemoryCandidate = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, user, rootId } = await actor(request);
    const kind = clean(request.data?.kind, 30);
    const content = clean(request.data?.content, 1000);
    if (!["USER_STATEMENT", "PREFERENCE", "DECISION", "EXPERIENCE"].includes(kind) || !content) throw new HttpsError("invalid-argument", "Tipo o contenido de memoria inválido.");
    const raw = request.data?.entityReference;
    const entityReference = raw ? { sourceSystem: clean(raw.sourceSystem, 40), entityType: clean(raw.entityType, 40), entityId: clean(raw.entityId, 160), displayReference: clean(raw.displayReference, 80) || undefined } : undefined;
    if (entityReference && (!entityReference.sourceSystem || !entityReference.entityType || !entityReference.entityId)) throw new HttpsError("invalid-argument", "Entidad inválida.");
    const result = await hugoData.createMemoryCandidate({ rootId, actorUid: uid, kind: kind as "USER_STATEMENT" | "PREFERENCE" | "DECISION" | "EXPERIENCE", content, entityReference });
    if (result.created) await logActivity({ event: "AGENTE_007_OBSERVACION", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid, actorName: clean(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: result.id, referenceType: "agent007Memory", description: `Hugo creó candidato de memoria ${kind}` });
    return { ok: true, ...result, status: "CANDIDATE" };
  },
);

export const reviewAgent007MemoryCandidate = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, user, rootId } = await actor(request);
    const id = clean(request.data?.memoryId, 160), decision = clean(request.data?.decision, 20).toUpperCase();
    const supersedesId = clean(request.data?.supersedesId, 160) || undefined;
    if (!id || !["CONFIRM", "REJECT"].includes(decision) || decision === "REJECT" && supersedesId) throw new HttpsError("invalid-argument", "Revisión de memoria inválida.");
    const result = await hugoData.reviewMemoryCandidate(rootId, uid, id, decision as "CONFIRM" | "REJECT", supersedesId);
    if (result.changed) await logActivity({ event: "AGENTE_007_OBSERVACION", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid, actorName: clean(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: id, referenceType: "agent007Memory", description: `Hugo revisó candidato de memoria: ${decision}` });
    return { ok: true, ...result };
  },
);

export const linkAgent007VerifiedExperience = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, user, rootId } = await actor(request);
    const observationId = clean(request.data?.observationId, 160), decisionId = clean(request.data?.decisionId, 160), outcomeId = clean(request.data?.outcomeId, 160);
    if (!observationId || !decisionId || !outcomeId) throw new HttpsError("invalid-argument", "Vínculos obligatorios.");
    const result = await hugoData.linkVerifiedExperience(rootId, observationId, decisionId, outcomeId);
    if (result.created) await logActivity({ event: "AGENTE_007_OBSERVACION", rootId, adminId: getActivityAdminId(user, uid, rootId), actorUid: uid, actorName: clean(user?.email || uid), actorRole: String(getUserRole(user)), referenceId: result.id, referenceType: "agent007Memory", description: "Hugo vinculó experiencia con resultado verificado" });
    return { ok: true, ...result };
  },
);

export const createAgent007LearningExperience = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, rootId } = await actor(request);
    const raw = request.data || {};
    const features = raw.features && typeof raw.features === "object" && !Array.isArray(raw.features) ?
      Object.fromEntries(Object.entries(raw.features).map(([key, value]) => [key, clean(value, 80)])) : {};
    const result = await hugoLearning.createFromVerifiedMemory({ rootId, actorUid: uid, memoryId: clean(raw.memoryId, 160), traceId: clean(raw.traceId, 160) || undefined,
      domain: clean(raw.domain, 60), taskType: clean(raw.taskType, 60), intent: clean(raw.intent, 60), questionClass: clean(raw.questionClass, 60), features });
    return { ok: true, id: result.id, created: result.created, state: result.record.state, trainingEligibility: result.record.trainingEligibility };
  },
);

export const createAgent007LearningDraft = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, rootId } = await actor(request);
    const raw = request.data || {};
    const features = raw.features && typeof raw.features === "object" && !Array.isArray(raw.features) ?
      Object.fromEntries(Object.entries(raw.features).map(([key, value]) => [key, clean(value, 80)])) : {};
    const result = await hugoLearning.createDraftFromDecision({ rootId, actorUid: uid, decisionId: clean(raw.decisionId, 160), traceId: clean(raw.traceId, 160) || undefined,
      domain: clean(raw.domain, 60), taskType: clean(raw.taskType, 60), intent: clean(raw.intent, 60), questionClass: clean(raw.questionClass, 60), features });
    return { ok: true, id: result.id, created: result.created, state: result.record.state, trainingEligibility: result.record.trainingEligibility };
  },
);

export const linkAgent007LearningOutcome = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, rootId } = await actor(request);
    const record = await hugoLearning.linkOutcome(rootId, clean(request.data?.experienceId, 160), clean(request.data?.outcomeId, 160), uid);
    return { ok: true, id: record.experienceId, state: record.state, revision: record.revision, trainingEligibility: record.trainingEligibility };
  },
);

export const correctAgent007LearningExperience = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, rootId } = await actor(request);
    const raw = request.data || {};
    const refs: LearningReference[] = Array.isArray(raw.evidenceReferences) ? raw.evidenceReferences.slice(0, 5).map((row: any) => ({ system: clean(row.system, 40), kind: clean(row.kind, 60), id: clean(row.id, 160), rootId })) : [];
    const correction: LearningCorrection = { originalBehavior: clean(raw.originalBehavior, 80), correctedBehavior: clean(raw.correctedBehavior, 80),
      reasonCode: clean(raw.reasonCode, 80), actorUid: uid, correctedAt: new Date().toISOString(), evidenceReferences: refs,
      scope: ["ENTITY", "ENTITY_TYPE", "ROOT"].includes(raw.scope) ? raw.scope : "ENTITY" };
    const record = await hugoLearning.addCorrection(rootId, clean(raw.experienceId, 160), correction, clean(raw.expectedBehavior, 80));
    return { ok: true, id: record.experienceId, revision: record.revision, trainingEligibility: record.trainingEligibility };
  },
);

export const listAgent007LearningDiagnostics = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { rootId } = await actor(request);
    const records = await hugoLearning.list(rootId, 100);
    return { ok: true, boundedTo: 100, experiences: records.map(row => ({ id: row.experienceId, domain: row.domain, taskType: row.taskType, state: row.state,
      revision: row.revision, createdAt: row.createdAt, provenance: row.quality.provenance, outcome: row.quality.outcome, feedback: row.quality.feedback,
      trainingEligible: row.trainingEligibility.eligible, reasons: row.trainingEligibility.reasons, memoryId: row.createdFrom.memoryId,
      traceId: row.createdFrom.traceId, correctionCode: row.correction?.reasonCode || null, outcomeType: row.outcome?.type || null,
      supersededById: row.supersededById || null })) };
  },
);

export const listAgent007LearningLineage = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { rootId } = await actor(request);
    return { ok: true, events: await hugoLearning.listLedger(rootId, clean(request.data?.experienceId, 160)) };
  },
);

export const assignAgent007LearningSplit = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, rootId } = await actor(request);
    const record = await hugoLearning.assignSplit(rootId, clean(request.data?.experienceId, 160), clean(request.data?.split, 20) as any, uid);
    return { ok: true, id: record.experienceId, revision: record.revision, split: record.split, trainingEligibility: record.trainingEligibility };
  },
);

export const supersedeAgent007LearningExperience = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, rootId } = await actor(request);
    const record = await hugoLearning.supersede(rootId, clean(request.data?.experienceId, 160), clean(request.data?.replacementId, 160), uid);
    return { ok: true, id: record.experienceId, state: record.state, revision: record.revision, supersededById: record.supersededById };
  },
);

export const saveAgent007HumanReview = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { uid, user, rootId } = await actor(request);
    const raw = request.data || {};
    const input: HumanReviewInput = {
      evalRunId: clean(raw.evalRunId, 160), caseId: clean(raw.caseId, 160),
      status: clean(raw.status, 20) as HumanReviewInput["status"], choice: clean(raw.choice, 40) as HumanReviewInput["choice"] || undefined,
      reasons: Array.isArray(raw.reasons) ? raw.reasons.map((value: unknown) => clean(value, 40)) as HumanReviewInput["reasons"] : [],
      note: clean(raw.note, 1000) || undefined,
    };
    const errors = validateHumanReview(input);
    if (errors.length) throw new HttpsError("invalid-argument", `RevisiÃ³n invÃ¡lida: ${errors.join(",")}`);
    const reviewId = createHash("sha256").update(`${rootId}\u0000${input.evalRunId}\u0000${input.caseId}`).digest("hex");
    const ref = db.collection("agent007EvalReviews").doc(reviewId), reviewedAt = new Date().toISOString();
    const saved = await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref), previous = snapshot.data(), revision = Number(previous?.revision || 0) + 1;
      const record = { reviewId, rootId, evalRunId: input.evalRunId, caseId: input.caseId, choice: input.choice || null, reasons: input.reasons,
        note: input.note || null, reviewerUid: uid, reviewerEmail: clean(user?.email, 200) || null, reviewedAt, revision, status: input.status };
      tx.set(ref, record);
      tx.create(db.collection("agent007EvalReviewEvents").doc(`${reviewId}_${String(revision).padStart(4, "0")}`),
        { ...record, eventType: revision === 1 ? "REVIEW_CREATED" : "REVIEW_REVISED", previousChoice: previous?.choice || null });
      return record;
    });
    return { ok: true, review: saved };
  },
);

export const listAgent007HumanReviews = onCall(
  { region: "us-central1", timeoutSeconds: 30, memory: "256MiB" },
  async request => {
    const { rootId } = await actor(request);
    const evalRunId = clean(request.data?.evalRunId, 160);
    if (!evalRunId) throw new HttpsError("invalid-argument", "EvaluaciÃ³n requerida.");
    const snapshot = await db.collection("agent007EvalReviews").where("rootId", "==", rootId).where("evalRunId", "==", evalRunId).limit(100).get();
    return { ok: true, reviews: snapshot.docs.map(doc => doc.data()) };
  },
);
