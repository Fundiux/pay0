import { createHash } from "node:crypto";
import { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { buildDraftExperience, buildVerifiedExperience, withCorrection, withOutcome } from "./hugoCore/experienceBuilder";
import { HugoLearningStore, relevantExperience } from "./hugoCore/learningStore";
import { LearningCorrection, LearningEffect, LearningEventType, LearningExperience, LearningLedgerEvent, LearningQuery, LearningRetrieval, LearningSplit, trainingEligibility } from "./hugoCore/learningContract";

const validId = (value: string) => /^[A-Za-z0-9_-]{1,160}$/.test(value);
const iso = (value: any) => value?.toDate?.()?.toISOString?.() || (typeof value === "string" ? value : "");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);
export class FirestoreHugoLearningStore implements HugoLearningStore {
  constructor(private readonly db: Firestore) {}
  private scope(rootId: string) { if (!validId(rootId)) throw new HttpsError("invalid-argument", "Ámbito de aprendizaje inválido."); return rootId; }
  private ref(id: string) { if (!validId(id)) throw new HttpsError("invalid-argument", "Experiencia inválida."); return this.db.collection("agent007LearningExperiences").doc(id); }
  private ledgerRef(id: string) { return this.db.collection("agent007LearningLedger").doc(id); }
  async createDraftFromDecision(input: { rootId: string; decisionId: string; traceId?: string; domain: string; taskType: string; intent: string; questionClass: string; features: Record<string, string>; actorUid: string }) {
    const rootId = this.scope(input.rootId);
    if (![input.decisionId, input.actorUid, ...(input.traceId ? [input.traceId] : [])].every(validId) ||
      ![input.domain, input.taskType, input.intent, input.questionClass].every(x => /^[A-Z][A-Z0-9_]{1,59}$/.test(x)) ||
      !/^[A-Z][A-Z0-9_]{1,39}$/.test(input.features.entityType || "") || Object.keys(input.features).length > 12 || !Object.entries(input.features).every(([k, v]) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) && /^[A-Za-z0-9_-]{1,80}$/.test(v))) throw new HttpsError("invalid-argument", "Metadatos de experiencia inválidos.");
    const id = `learning_${digest([rootId, input.decisionId])}`, target = this.ref(id);
    return this.db.runTransaction(async tx => {
      const existing = await tx.get(target);
      if (existing.exists) { const record = existing.data() as LearningExperience; if (record.rootId !== rootId) throw new HttpsError("not-found", "Experiencia no encontrada."); return { id, created: false, record }; }
      const decisionSnap = await tx.get(this.db.collection("agent007Memory").doc(input.decisionId)), d = decisionSnap.data();
      if (!d || d.rootId !== rootId || d.kind !== "DECISION" || d.status !== "CONFIRMED" || !validId(d.links?.observationId || "") ||
        d.entityReference?.entityType !== input.features.entityType) throw new HttpsError("failed-precondition", "Falta decisión vinculada a observación.");
      const [observationSnap, traceSnap] = await Promise.all([tx.get(this.db.collection("agent007Observations").doc(d.links.observationId)),
        input.traceId ? tx.get(this.db.collection("agent007Traces").doc(input.traceId)) : Promise.resolve(null)]);
      const o = observationSnap.data(), t = traceSnap?.data();
      if (!o || o.rootId !== rootId || o.caseId !== d.entityReference?.entityId || input.traceId && !t) throw new HttpsError("failed-precondition", "Observación o traza fuera de ámbito.");
      const now = new Date().toISOString(); let record: LearningExperience;
      try { record = buildDraftExperience({ rootId, experienceId: id, decisionMemoryId: input.decisionId, domain: input.domain, taskType: input.taskType, intent: input.intent,
        questionClass: input.questionClass, features: input.features, now,
        observation: { id: observationSnap.id, rootId: o.rootId, caseId: o.caseId, source: o.source, createdAt: iso(o.createdAt) },
        decision: { id: decisionSnap.id, rootId: d.rootId, kind: d.kind, status: d.status, entityId: d.entityReference?.entityId, actorUid: d.decision?.actorUid, decisionType: d.decision?.decisionType, decidedAt: d.decision?.decisionAt },
        ...(t ? { trace: { id: traceSnap!.id, rootId: t.rootId, evidenceReferences: t.evidenceReferences || [], promptVersion: t.promptVersion, model: t.model, modelVersion: t.modelVersion, modelProvider: t.modelProvider, resultStatus: t.resultStatus } } : {}) }); }
      catch { throw new HttpsError("failed-precondition", "No hay linaje verificable para el borrador."); }
      tx.create(target, record); tx.create(this.db.collection("agent007LearningRevisions").doc(`${id}_1`), record);
      const eventId = `created_${id}`;
      tx.create(this.ledgerRef(eventId), { eventId, rootId, experienceId: id, type: "EXPERIENCE_CREATED", at: now, actorUid: input.actorUid,
        references: record.evidenceReferences, metadata: { state: record.state, revision: 1 } } satisfies LearningLedgerEvent);
      return { id, created: true, record };
    });
  }
  async createFromVerifiedMemory(input: { rootId: string; memoryId: string; traceId?: string; domain: string; taskType: string; intent: string; questionClass: string; features: Record<string, string>; actorUid: string }) {
    const rootId = this.scope(input.rootId);
    if (![input.memoryId, input.actorUid, ...(input.traceId ? [input.traceId] : [])].every(validId) ||
      ![input.domain, input.taskType, input.intent, input.questionClass].every(x => /^[A-Z][A-Z0-9_]{1,59}$/.test(x)) ||
      Object.keys(input.features).length > 12 || !Object.entries(input.features).every(([k, v]) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k) && /^[A-Za-z0-9_-]{1,80}$/.test(v))) throw new HttpsError("invalid-argument", "Metadatos de experiencia inválidos.");
    const id = `learning_${digest([rootId, input.memoryId])}`, target = this.ref(id);
    return this.db.runTransaction(async tx => {
      const existing = await tx.get(target);
      if (existing.exists) { const data = existing.data() as LearningExperience; if (data.rootId !== rootId) throw new HttpsError("not-found", "Experiencia no encontrada."); return { id, created: false, record: data }; }
      const memorySnap = await tx.get(this.db.collection("agent007Memory").doc(input.memoryId));
      const m = memorySnap.data();
      if (!m || m.rootId !== rootId || m.kind !== "EXPERIENCE" || m.status !== "CONFIRMED" || !m.links?.observationId || !m.links?.decisionId || !m.links?.outcomeId) throw new HttpsError("failed-precondition", "Memoria sin resultado verificado.");
      const [obsSnap, decisionSnap, outcomeSnap, traceSnap] = await Promise.all([
        tx.get(this.db.collection("agent007Observations").doc(m.links.observationId)), tx.get(this.db.collection("agent007Memory").doc(m.links.decisionId)),
        tx.get(this.db.collection("agent007Observations").doc(m.links.outcomeId)), input.traceId ? tx.get(this.db.collection("agent007Traces").doc(input.traceId)) : Promise.resolve(null),
      ]);
      const o = obsSnap.data(), d = decisionSnap.data(), z = outcomeSnap.data(), t = traceSnap?.data();
      if (!o || !d || !z || input.traceId && !t) throw new HttpsError("failed-precondition", "Faltan fuentes de experiencia.");
      const now = new Date().toISOString();
      let record: LearningExperience;
      try { record = buildVerifiedExperience({ rootId, experienceId: id, domain: input.domain, taskType: input.taskType, intent: input.intent, questionClass: input.questionClass,
        features: input.features, now, memory: { id: memorySnap.id, rootId: m.rootId, status: m.status, kind: m.kind, entityReference: m.entityReference, links: m.links, createdAt: m.createdAt },
        observation: { id: obsSnap.id, rootId: o!.rootId, caseId: o!.caseId, source: o!.source, createdAt: iso(o!.createdAt) },
        decision: { id: decisionSnap.id, rootId: d!.rootId, kind: d!.kind, status: d!.status, entityId: d!.entityReference?.entityId, actorUid: d!.decision?.actorUid, decisionType: d!.decision?.decisionType, decidedAt: d!.decision?.decisionAt },
        outcome: { id: outcomeSnap.id, rootId: z!.rootId, caseId: z!.caseId, source: z!.source, sourceEvent: z!.sourceEvent, occurredAt: iso(z!.createdAt) },
        ...(t ? { trace: { id: traceSnap!.id, rootId: t.rootId, evidenceReferences: t.evidenceReferences || [], promptVersion: t.promptVersion, model: t.model, modelVersion: t.modelVersion, modelProvider: t.modelProvider, resultStatus: t.resultStatus } } : {}) }); }
      catch { throw new HttpsError("failed-precondition", "Los vínculos no prueban una experiencia verificable."); }
      const eventId = `created_${id}`;
      tx.create(target, record);
      tx.create(this.db.collection("agent007LearningRevisions").doc(`${id}_1`), record);
      tx.create(this.ledgerRef(eventId), { eventId, rootId, experienceId: id, type: "EXPERIENCE_CREATED", at: now, actorUid: input.actorUid,
        references: record.evidenceReferences, metadata: { eligible: record.trainingEligibility.eligible, revision: 1 } } satisfies LearningLedgerEvent);
      const verifiedId = `verified_${id}_1`;
      tx.create(this.ledgerRef(verifiedId), { eventId: verifiedId, rootId, experienceId: id, type: "EXPERIENCE_VERIFIED", at: new Date(Date.parse(now) + 1).toISOString(), actorUid: input.actorUid,
        references: record.outcome ? [record.outcome.reference] : [], metadata: { eligible: record.trainingEligibility.eligible, revision: 1 } } satisfies LearningLedgerEvent);
      return { id, created: true, record };
    });
  }
  async addCorrection(rootId: string, experienceId: string, correction: LearningCorrection, expectedBehavior: string) {
    const scope = this.scope(rootId), target = this.ref(experienceId);
    if (![correction.originalBehavior, correction.correctedBehavior, correction.reasonCode, expectedBehavior].every(x => /^[A-Z][A-Z0-9_]{1,79}$/.test(x)) || !validId(correction.actorUid)) throw new HttpsError("invalid-argument", "Corrección estructurada inválida.");
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(target), row = snap.data() as LearningExperience | undefined;
      if (!row || row.rootId !== scope) throw new HttpsError("not-found", "Experiencia no encontrada.");
      if (row.correction) throw new HttpsError("failed-precondition", "La corrección ya existe; cree una nueva revisión supervisada.");
      if (!correction.evidenceReferences.every(r => row.evidenceReferences.some(e => e.system === r.system && e.kind === r.kind && e.id === r.id && e.rootId === r.rootId))) throw new HttpsError("failed-precondition", "Evidencia de corrección fuera de la experiencia.");
      let next: LearningExperience;
      try { next = withCorrection(row, correction, expectedBehavior); } catch { throw new HttpsError("failed-precondition", "No se puede vincular la corrección."); }
      tx.set(target, next);
      tx.create(this.db.collection("agent007LearningRevisions").doc(`${experienceId}_${next.revision}`), next);
      const eventId = `correction_${experienceId}_${next.revision}`;
      tx.create(this.ledgerRef(eventId), { eventId, rootId: scope, experienceId, type: "CORRECTION_RECORDED", at: correction.correctedAt, actorUid: correction.actorUid,
        references: correction.evidenceReferences, metadata: { reasonCode: correction.reasonCode, revision: next.revision, eligible: next.trainingEligibility.eligible } } satisfies LearningLedgerEvent);
      return next;
    });
  }
  async linkOutcome(rootId: string, experienceId: string, outcomeId: string, actorUid: string) {
    const scope = this.scope(rootId), target = this.ref(experienceId);
    if (!validId(outcomeId) || !validId(actorUid)) throw new HttpsError("invalid-argument", "Resultado inválido.");
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(target), row = snap.data() as LearningExperience | undefined;
      if (!row || row.rootId !== scope) throw new HttpsError("not-found", "Experiencia no encontrada.");
      if (row.state !== "WAITING_FOR_OUTCOME" || row.outcome) throw new HttpsError("failed-precondition", "La experiencia ya tiene resultado o no está pendiente.");
      const outcomeSnap = await tx.get(this.db.collection("agent007Observations").doc(outcomeId)), z = outcomeSnap.data();
      const decisionAt = row.humanDecision?.decidedAt, correctedAt = row.correction?.correctedAt, occurredAt = iso(z?.createdAt);
      if (!z || z.rootId !== scope || z.caseId !== row.entityReferences[0]?.entityId || z.source !== "ACTIVITY_LOG" ||
        !["SOLICITUD_COMPLETADA", "PAGO_APLICADO_A_SOLICITUD", "DISPERSION_INCIDENCIA_RESUELTA", "OPERACION_RECUPERADA"].includes(z.sourceEvent) ||
        !decisionAt || !occurredAt || Date.parse(occurredAt) < Date.parse(decisionAt) || correctedAt && Date.parse(occurredAt) < Date.parse(correctedAt))
        throw new HttpsError("failed-precondition", "El resultado no verifica esta secuencia.");
      const outcome = { type: z.sourceEvent, verified: true, occurredAt, reference: { system: "PAY0", kind: "OUTCOME", id: outcomeId, rootId: scope } };
      const next = withOutcome(row, outcome);
      tx.set(target, next); tx.create(this.db.collection("agent007LearningRevisions").doc(`${experienceId}_${next.revision}`), next);
      const now = new Date().toISOString(), eventId = `outcome_${experienceId}_${next.revision}`;
      tx.create(this.ledgerRef(eventId), { eventId, rootId: scope, experienceId, type: "OUTCOME_LINKED", at: now, actorUid,
        references: [outcome.reference], metadata: { outcomeType: outcome.type, occurredAt, revision: next.revision } } satisfies LearningLedgerEvent);
      const verifiedId = `verified_${experienceId}_${next.revision}`;
      tx.create(this.ledgerRef(verifiedId), { eventId: verifiedId, rootId: scope, experienceId, type: "EXPERIENCE_VERIFIED", at: new Date(Date.parse(now) + 1).toISOString(), actorUid,
        references: [outcome.reference], metadata: { eligible: next.trainingEligibility.eligible, revision: next.revision } } satisfies LearningLedgerEvent);
      return next;
    });
  }
  async assignSplit(rootId: string, experienceId: string, split: LearningSplit, actorUid: string) {
    const scope = this.scope(rootId), target = this.ref(experienceId);
    if (!["TRAIN", "VALIDATION", "TEST", "HOLDOUT", "GOLDEN"].includes(split) || !validId(actorUid)) throw new HttpsError("invalid-argument", "Partición inválida.");
    return this.db.runTransaction(async tx => {
      const snap = await tx.get(target), row = snap.data() as LearningExperience | undefined;
      if (!row || row.rootId !== scope) throw new HttpsError("not-found", "Experiencia no encontrada.");
      if (row.state !== "VERIFIED" || split === "TRAIN" && (row.protectedCaseIds.length || ["HOLDOUT", "GOLDEN"].includes(row.split))) throw new HttpsError("failed-precondition", "Caso protegido o no verificado.");
      if (row.split === split) return row;
      const next: LearningExperience = { ...row, revision: row.revision + 1, split,
        protectedCaseIds: ["HOLDOUT", "GOLDEN"].includes(split) ? [...new Set([...row.protectedCaseIds, row.experienceId])] : row.protectedCaseIds };
      next.trainingEligibility = trainingEligibility(next);
      tx.set(target, next);
      tx.create(this.db.collection("agent007LearningRevisions").doc(`${experienceId}_${next.revision}`), next);
      const eventId = `split_${experienceId}_${next.revision}`;
      tx.create(this.ledgerRef(eventId), { eventId, rootId: scope, experienceId, type: "SPLIT_ASSIGNED", at: new Date().toISOString(), actorUid,
        references: [], metadata: { split, revision: next.revision } } satisfies LearningLedgerEvent);
      return next;
    });
  }
  async retrieve(query: LearningQuery): Promise<LearningRetrieval> {
    const rootId = this.scope(query.rootId);
    if (!/^[A-Z][A-Z0-9_]{1,59}$/.test(query.domain) || !/^[A-Z][A-Z0-9_]{1,59}$/.test(query.taskType) || !/^[A-Z][A-Z0-9_]{1,59}$/.test(query.entityType)) throw new HttpsError("invalid-argument", "Consulta de aprendizaje inválida.");
    const snap = await this.db.collection("agent007LearningExperiences").where("rootId", "==", rootId).where("domain", "==", query.domain).where("taskType", "==", query.taskType).limit(100).get();
    const rows = snap.docs.map(doc => doc.data() as LearningExperience), selected: LearningExperience[] = [], rejected: LearningRetrieval["rejected"] = [];
    for (const row of rows) { const match = relevantExperience(row, query); if (match.selected) selected.push(row); else rejected.push({ experienceId: row.experienceId, reason: match.reason }); }
    return { considered: rows.length, selected: selected.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.min(Math.max(query.limit || 3, 1), 5)), rejected };
  }
  async list(rootId: string, limit = 50) {
    const snap = await this.db.collection("agent007LearningExperiences").where("rootId", "==", this.scope(rootId)).orderBy("createdAt", "desc").limit(Math.min(Math.max(limit, 1), 500)).get();
    return snap.docs.map(doc => doc.data() as LearningExperience);
  }
  async listLedger(rootId: string, experienceId: string, limit = 50) {
    const scope = this.scope(rootId), target = this.ref(experienceId), owner = await target.get();
    if (!owner.exists || owner.data()?.rootId !== scope) throw new HttpsError("not-found", "Experiencia no encontrada.");
    const snap = await this.db.collection("agent007LearningLedger").where("rootId", "==", rootId).where("experienceId", "==", experienceId).orderBy("at", "asc").limit(Math.min(Math.max(limit, 1), 100)).get();
    return snap.docs.map(doc => doc.data() as LearningLedgerEvent);
  }
  async listExportCandidates(rootId: string, limit = 500) {
    const snap = await this.db.collection("agent007LearningExperiences").where("rootId", "==", this.scope(rootId)).where("state", "==", "VERIFIED").limit(Math.min(Math.max(limit, 1), 500)).get();
    return snap.docs.map(doc => doc.data() as LearningExperience).filter(row => row.trainingEligibility?.eligible);
  }
  async appendEvent(rootId: string, experienceId: string, type: LearningEventType, actorUid: string | null, metadata: Record<string, string | number | boolean | null> = {}) {
    const scope = this.scope(rootId), target = this.ref(experienceId), snap = await target.get();
    if (!snap.exists || snap.data()?.rootId !== scope) throw new HttpsError("not-found", "Experiencia no encontrada.");
    const eventId = this.db.collection("agent007LearningLedger").doc().id;
    await this.ledgerRef(eventId).create({ eventId, rootId: scope, experienceId, type, at: new Date().toISOString(), actorUid, references: [], metadata } satisfies LearningLedgerEvent);
  }
  async recordEffect(rootId: string, effect: LearningEffect) {
    await this.appendEvent(rootId, effect.experienceId, "LEARNING_EFFECT_MEASURED", null, { caseId: effect.caseId, improved: effect.improved, overgeneralized: effect.overgeneralized,
      modelAdapter: effect.modelAdapter, promptVersion: effect.promptVersion, evidenceDigest: effect.evidenceDigest });
  }
}
