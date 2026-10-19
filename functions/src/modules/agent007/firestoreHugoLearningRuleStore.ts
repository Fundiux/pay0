import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { LearningEventType, LearningExperience, LearningQuery, trainingEligibility } from "./hugoCore/learningContract";
import { buildVerifiedExperience } from "./hugoCore/experienceBuilder";
import { decideWithoutModel, measureLearningEffect, proposeRuleCandidates } from "./hugoCore/learningEvaluation";
import { selectLearningExperiences } from "./hugoCore/learningStore";
import { observationEvidenceResolver, assertResolvedOutcomeTime } from "./observationEvidence";

const enabled = () => process.env.HUGO_SUPERVISED_RULES_ENABLED === "true";
const valid = (value: string) => /^[A-Za-z0-9_-]{1,160}$/.test(value);
const iso = (value: any) => value?.toDate?.()?.toISOString?.() || (typeof value === "string" ? value : "");
const behavior = "VERIFY_DOCUMENT_BEFORE_DECISION";
type Identity = { uid: string; rootId: string };
type Rule = { schemaVersion: "supervised-rule-v1"; ruleId: string; rootId: string; status: "ACTIVE" | "INVALIDATED";
  version: number; domain: string; taskType: string; features: Record<string, string>; behavior: string;
  supportingIds: string[]; supportingRevisions: Record<string, number>; approvedBy: string; approvedAt: string; expiresAt: string;
  invalidatedBy: string | null; evaluation: { improved: boolean; overgeneralized: boolean; modelAdapter: string } };

/** Optional advice only. No business mutation, model call or financial rule is executed. */
export class FirestoreHugoLearningRuleStore {
  constructor(private readonly db: Firestore) {}
  private async actor(tx: Transaction, identity: Identity) {
    if (!valid(identity.uid) || !valid(identity.rootId)) throw new HttpsError("unauthenticated", "Sesión inválida.");
    const user = (await tx.get(this.db.doc(`users/${identity.uid}`))).data();
    assertAuthorized({ uid: identity.uid }, user, { allowedRoles: ["superadmin"] });
    if ((user?.rootId || identity.uid) !== identity.rootId) throw new HttpsError("permission-denied", "Ámbito de aprendizaje revocado.");
  }
  private async verifyEvidence(tx: Transaction, row: LearningExperience) {
    if (!trainingEligibility(row).eligible || !row.correction || row.correction.correctedBehavior !== row.expectedBehavior)
      throw new HttpsError("failed-precondition", "Experiencia no vigente.");
    const memory = (await tx.get(this.db.doc(`agent007Memory/${row.createdFrom.memoryId}`))).data();
    if (!memory || memory.rootId !== row.rootId || memory.kind !== "EXPERIENCE" || memory.status !== "CONFIRMED" ||
      ![memory.links?.observationId, memory.links?.decisionId, memory.links?.outcomeId].every(x => typeof x === "string" && valid(x)))
      throw new HttpsError("failed-precondition", "Memoria de origen revocada.");
    const [observation, decision, outcome] = await Promise.all([
      tx.get(this.db.doc(`agent007Observations/${memory.links.observationId}`)),
      tx.get(this.db.doc(`agent007Memory/${memory.links.decisionId}`)),
      tx.get(this.db.doc(`agent007Observations/${memory.links.outcomeId}`)),
    ]);
    const resolve = observationEvidenceResolver(this.db, tx, row.rootId);
    const [initial, final] = await Promise.all([resolve(observation.id, observation.data()), resolve(outcome.id, outcome.data())]);
    const d = decision.data();
    assertResolvedOutcomeTime(final, Date.parse(d?.decision?.decisionAt || ""));
    try {
      const verified = buildVerifiedExperience({ rootId: row.rootId, experienceId: row.experienceId, domain: row.domain, taskType: row.taskType,
        intent: row.input.intent, questionClass: row.input.questionClass, features: row.features, now: row.createdAt,
        memory: { id: row.createdFrom.memoryId, rootId: memory.rootId, kind: memory.kind, status: memory.status, entityReference: memory.entityReference, links: memory.links, createdAt: memory.createdAt },
        observation: { id: observation.id, ...initial.observation, createdAt: iso(initial.observation.createdAt) },
        decision: { id: decision.id, rootId: d?.rootId, kind: d?.kind, status: d?.status, entityId: d?.entityReference?.entityId,
          entityType: d?.entityReference?.entityType, sourceSystem: d?.entityReference?.sourceSystem, actorUid: d?.decision?.actorUid,
          decisionType: d?.decision?.decisionType, decidedAt: d?.decision?.decisionAt },
        outcome: { id: outcome.id, ...final.observation, occurredAt: iso(final.observation.createdAt) } });
      if (!isDeepStrictEqual(verified.evidenceReferences, row.evidenceReferences) ||
        !isDeepStrictEqual(verified.outcome, row.outcome) || !isDeepStrictEqual(verified.humanDecision, row.humanDecision) ||
        !row.correction.evidenceReferences.every(ref => verified.evidenceReferences.some(e => JSON.stringify(e) === JSON.stringify(ref) ||
          e.system === ref.system && e.kind === ref.kind && e.id === ref.id && e.rootId === ref.rootId))) throw Error("CHANGED_EVIDENCE");
    } catch { throw new HttpsError("failed-precondition", "Evidencia de aprendizaje revocada."); }
  }
  private async matching(tx: Transaction, query: LearningQuery) {
    const snap = await tx.get(this.db.collection("agent007LearningExperiences").where("rootId", "==", query.rootId)
      .where("domain", "==", query.domain).where("taskType", "==", query.taskType).limit(101));
    if (snap.size > 100) throw new HttpsError("failed-precondition", "Revisión de aprendizaje excede el límite seguro.");
    return selectLearningExperiences(snap.docs.map(doc => doc.data() as LearningExperience), { ...query, limit: 5 });
  }
  private event(tx: Transaction, rule: Rule, type: LearningEventType, actorUid: string, reason: string) {
    const eventId = `${rule.ruleId}_${rule.version}_${type}`;
    tx.create(this.db.doc(`agent007LearningLedger/${eventId}`), { eventId, rootId: rule.rootId, experienceId: rule.supportingIds[0], type,
      at: new Date().toISOString(), actorUid, references: rule.supportingIds.map(id => ({ system: "HUGO", kind: "EXPERIENCE", id, rootId: rule.rootId })),
      metadata: { ruleId: rule.ruleId, version: rule.version, reason } });
  }
  async review(identity: Identity, input: { action: "APPROVE" | "REVOKE"; supportingIds?: string[]; ruleId?: string }) {
    if (!enabled()) throw new HttpsError("failed-precondition", "Las reglas supervisadas están deshabilitadas.");
    return this.db.runTransaction(async tx => {
      await this.actor(tx, identity);
      if (input.action === "REVOKE") {
        if (!valid(input.ruleId || "")) throw new HttpsError("invalid-argument", "Regla inválida.");
        const ref = this.db.doc(`agent007LearnedRules/${input.ruleId}`), rule = (await tx.get(ref)).data() as Rule | undefined;
        if (!rule || rule.schemaVersion !== "supervised-rule-v1" || rule.rootId !== identity.rootId) throw new HttpsError("not-found", "Regla no encontrada.");
        if (rule.status !== "ACTIVE") return { ruleId: rule.ruleId, status: rule.status, version: rule.version };
        const next: Rule = { ...rule, status: "INVALIDATED", version: rule.version + 1, invalidatedBy: "HUMAN_REVOKED" };
        tx.set(ref, next); this.event(tx, next, "RULE_REVOKED", identity.uid, "HUMAN_REVOKED");
        return { ruleId: next.ruleId, status: next.status, version: next.version };
      }
      const ids = input.supportingIds;
      if (input.action !== "APPROVE" || !Array.isArray(ids) || ids.length < 2 || ids.length > 5 || new Set(ids).size !== ids.length || !ids.every(valid))
        throw new HttpsError("invalid-argument", "Se requieren dos a cinco experiencias independientes.");
      const rows = await Promise.all(ids.map(async id => (await tx.get(this.db.doc(`agent007LearningExperiences/${id}`))).data() as LearningExperience | undefined));
      if (rows.some(row => !row || row.rootId !== identity.rootId)) throw new HttpsError("not-found", "Experiencia no encontrada.");
      const support = rows as LearningExperience[], first = support[0];
      if (first.domain !== "SOLICITUDES" || first.taskType !== "REASON" || first.features.entityType !== "SOLICITUD" ||
        first.features.status !== "PENDIENTE" || first.features.issueCode !== "DOCUMENT_MISSING" || support.some(r => r.expectedBehavior !== behavior))
        throw new HttpsError("failed-precondition", "Sólo se admite la recomendación de revisión documental.");
      const query = { rootId: identity.rootId, domain: first.domain, taskType: first.taskType, entityType: "SOLICITUD", features: first.features };
      const matched = await this.matching(tx, query);
      if (matched.conflict || !ids.every(id => matched.selected.some(row => row.experienceId === id))) throw new HttpsError("failed-precondition", "Experiencias contradictorias o incompatibles.");
      for (const row of support) await this.verifyEvidence(tx, row);
      const candidate = proposeRuleCandidates(support).find(c => c.expectedBehavior === behavior && c.supportingIds.length === ids.length && !c.contradictoryIds.length);
      if (!candidate) throw new HttpsError("failed-precondition", "Faltan resultados independientes.");
      const task = { caseId: "supervised-contract-evaluation", query, expectedBehavior: behavior, currentFacts: { documentStatus: "UNVERIFIED" }, modelNecessity: "MODEL_NOT_REQUIRED" as const };
      const evaluation = measureLearningEffect({ task, experience: first, before: decideWithoutModel(task, []), after: decideWithoutModel(task, support),
        modelAdapter: "NONE", promptVersion: "policy-v1", evidenceDigest: createHash("sha256").update(JSON.stringify(support.map(r => [r.experienceId, r.revision]))).digest("hex") });
      if (!evaluation.improved || evaluation.overgeneralized) throw new HttpsError("failed-precondition", "Evaluación no aprobada.");
      const ruleId = `supervised_${createHash("sha256").update(JSON.stringify([identity.rootId, [...ids].sort()])).digest("hex").slice(0, 40)}`;
      const ref = this.db.doc(`agent007LearnedRules/${ruleId}`), previous = (await tx.get(ref)).data() as Rule | undefined;
      const revisions = Object.fromEntries(support.map(r => [r.experienceId, r.revision]));
      if (previous?.status === "ACTIVE" && Date.parse(previous.expiresAt) > Date.now() &&
        ids.every(id => previous.supportingRevisions[id] === revisions[id]))
        return { ruleId, status: previous.status, version: previous.version };
      const now = Date.now(), rule: Rule = { schemaVersion: "supervised-rule-v1", ruleId, rootId: identity.rootId, status: "ACTIVE", version: (previous?.version || 0) + 1,
        domain: first.domain, taskType: first.taskType, features: { ...first.features }, behavior, supportingIds: [...ids].sort(),
        supportingRevisions: revisions, approvedBy: identity.uid, approvedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(), invalidatedBy: null,
        evaluation: { improved: evaluation.improved, overgeneralized: evaluation.overgeneralized, modelAdapter: "NONE" } };
      tx.set(ref, rule); this.event(tx, rule, "RULE_ACTIVATED", identity.uid, "SUPERVISED_POLICY_CONTRACT_PASS");
      return { ruleId, status: rule.status, version: rule.version };
    });
  }
  async resolve(identity: Identity, query: LearningQuery, entityId: string, folio: string): Promise<{ ruleId: string; text: string } | null> {
    if (!enabled()) return null;
    if (!valid(entityId) || !/^S\d{1,12}$/.test(folio) || query.rootId !== identity.rootId) return null;
    return this.db.runTransaction(async tx => {
      await this.actor(tx, identity);
      const current = (await tx.get(this.db.doc(`solicitudes/${entityId}`))).data();
      if (!current || current.rootId !== identity.rootId || current.folio !== folio || (current.status || current.estatus) !== "PENDIENTE" || current.deletedAt || current.isDeleted === true) return null;
      const snap = await tx.get(this.db.collection("agent007LearnedRules").where("rootId", "==", identity.rootId).where("schemaVersion", "==", "supervised-rule-v1").where("status", "==", "ACTIVE").limit(21));
      if (snap.size > 20) return null;
      const ruleDoc = snap.docs.find(doc => { const r = doc.data() as Rule; return r.domain === query.domain && r.taskType === query.taskType &&
        Object.entries(r.features).every(([k, v]) => query.features[k] === v); });
      if (!ruleDoc) return null;
      const rule = ruleDoc.data() as Rule;
      let invalid = Date.parse(rule.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(rule.expiresAt)) ? "EXPIRED" : "";
      try { await this.actor(tx, { uid: rule.approvedBy, rootId: identity.rootId }); } catch { invalid ||= "SUPERVISOR_REVOKED"; }
      const matched = await this.matching(tx, query);
      if (matched.conflict) invalid = "CONTRADICTION";
      for (const id of rule.supportingIds) {
        const row = (await tx.get(this.db.doc(`agent007LearningExperiences/${id}`))).data() as LearningExperience | undefined;
        if (!row || row.revision !== rule.supportingRevisions[id] || !trainingEligibility(row).eligible || row.expectedBehavior !== rule.behavior ||
          !matched.selected.some(item => item.experienceId === id)) { invalid ||= "SUPPORT_REVOKED"; continue; }
        try { await this.verifyEvidence(tx, row); } catch { invalid ||= "EVIDENCE_REVOKED"; }
      }
      if (invalid) {
        const next: Rule = { ...rule, status: "INVALIDATED", version: rule.version + 1, invalidatedBy: invalid };
        tx.set(ruleDoc.ref, next); this.event(tx, next, "RULE_INVALIDATED", identity.uid, invalid); return null;
      }
      if (rule.behavior !== behavior) return null;
      return { ruleId: rule.ruleId, text: `Antes de decidir sobre ${folio}, verifica la documentación. Esta recomendación no confirma que falte un documento ni determina la causa de su estado.` };
    });
  }
}
