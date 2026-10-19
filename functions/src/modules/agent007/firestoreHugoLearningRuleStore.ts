import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { FieldPath, Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { LearningEventType, LearningExperience, LearningQuery, trainingEligibility, validReference } from "./hugoCore/learningContract";
import { buildVerifiedExperience } from "./hugoCore/experienceBuilder";
import { decideWithoutModel, measureLearningEffect, proposeRuleCandidates } from "./hugoCore/learningEvaluation";
import { selectLearningExperiences } from "./hugoCore/learningStore";
import { observationEvidenceResolver, assertResolvedOutcomeTime } from "./observationEvidence";

const enabled = () => process.env.HUGO_SUPERVISED_RULES_ENABLED === "true";
const valid = (value: string) => /^[A-Za-z0-9_-]{1,160}$/.test(value);
const iso = (value: any) => value?.toDate?.()?.toISOString?.() || (typeof value === "string" ? value : "");
const behavior = "VERIFY_DOCUMENT_BEFORE_DECISION";
type Identity = { uid: string; rootId: string };
export type SupervisedReviewQuery = { candidateCursor?: string; ruleCursor?: string; focusedRuleId?: string; limit?: number };
type Rule = { schemaVersion: "supervised-rule-v1"; ruleId: string; rootId: string; status: "ACTIVE" | "INVALIDATED";
  version: number; domain: string; taskType: string; features: Record<string, string>; behavior: string;
  supportingIds: string[]; supportingRevisions: Record<string, number>; approvedBy: string; approvedAt: string; expiresAt: string;
  invalidatedBy: string | null; evaluation: { improved: boolean; overgeneralized: boolean; modelAdapter: string } };

/** Optional advice only. No business mutation, model call or financial rule is executed. */
export class FirestoreHugoLearningRuleStore {
  constructor(private readonly db: Firestore) {}
  async readReview(identity: Identity, input: SupervisedReviewQuery) {
    const limit = input.limit === undefined ? 20 : input.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new HttpsError("invalid-argument", "Límite de revisión inválido.");
    if (input.focusedRuleId !== undefined && (typeof input.focusedRuleId !== "string" || !valid(input.focusedRuleId)))
      throw new HttpsError("invalid-argument", "Regla de revisión inválida.");
    const cursorId = (value: string | undefined, kind: "CANDIDATES" | "RULES") => {
      if (value === undefined) return null;
      try {
        if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw Error();
        const row = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
        if (Object.keys(row).sort().join(",") !== "id,kind,rootId,v" || row.v !== 1 || row.kind !== kind ||
          row.rootId !== identity.rootId || typeof row.id !== "string" || !valid(row.id)) throw Error();
        return row.id as string;
      } catch { throw new HttpsError("invalid-argument", "Página de revisión inválida."); }
    };
    const candidateId = cursorId(input.candidateCursor, "CANDIDATES"), ruleId = cursorId(input.ruleCursor, "RULES");
    const nextCursor = (id: string, kind: "CANDIDATES" | "RULES") => Buffer.from(JSON.stringify({ v: 1, kind, rootId: identity.rootId, id })).toString("base64url");
    return this.db.runTransaction(async tx => {
      await this.actor(tx, identity);
      const candidates = this.db.collection("agent007LearningExperiences").where("rootId", "==", identity.rootId)
        .where("domain", "==", "SOLICITUDES").where("taskType", "==", "REASON").orderBy(FieldPath.documentId());
      const rules = this.db.collection("agent007LearnedRules").where("rootId", "==", identity.rootId)
        .where("schemaVersion", "==", "supervised-rule-v1").orderBy(FieldPath.documentId());
      const candidateStart = candidateId ? await tx.get(this.db.collection("agent007LearningExperiences").doc(candidateId)) : null;
      const ruleStart = ruleId ? await tx.get(this.db.collection("agent007LearnedRules").doc(ruleId)) : null;
      if (candidateStart && (!candidateStart.exists || candidateStart.get("rootId") !== identity.rootId ||
        candidateStart.get("domain") !== "SOLICITUDES" || candidateStart.get("taskType") !== "REASON"))
        throw new HttpsError("invalid-argument", "Página de experiencias fuera de ámbito.");
      if (ruleStart && (!ruleStart.exists || ruleStart.get("rootId") !== identity.rootId || ruleStart.get("schemaVersion") !== "supervised-rule-v1"))
        throw new HttpsError("invalid-argument", "Página de reglas fuera de ámbito.");
      const [candidatePage, rulePage, focused] = await Promise.all([
        tx.get((candidateStart ? candidates.startAfter(candidateStart) : candidates).limit(limit + 1)),
        tx.get((ruleStart ? rules.startAfter(ruleStart) : rules).limit(limit + 1)),
        input.focusedRuleId ? tx.get(this.db.collection("agent007LearnedRules").doc(input.focusedRuleId)) : Promise.resolve(null),
      ]);
      if (focused && (!focused.exists || focused.get("rootId") !== identity.rootId || focused.get("schemaVersion") !== "supervised-rule-v1"))
        throw new HttpsError("not-found", "Regla no encontrada.");
      const candidateRows = [];
      const code = (value: unknown) => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : "UNKNOWN";
      const id = (value: unknown) => typeof value === "string" && valid(value) ? value : "";
      const date = (value: unknown) => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null;
      const object = (value: any) => !!value && typeof value === "object" && !Array.isArray(value);
      const reference = (value: any) => object(value) && typeof value.id === "string" && typeof value.system === "string" &&
        typeof value.kind === "string" && validReference(value, identity.rootId);
      const references = (value: any, nonempty = false) => Array.isArray(value) && value.length <= 20 &&
        (!nonempty || value.length > 0) && value.every(reference);
      for (const doc of candidatePage.docs.slice(0, limit)) {
        const row = doc.data() as LearningExperience;
        const reasons: string[] = [];
        const complete = row.schemaVersion === "hugo-learning-v1" && row.experienceId === doc.id && Number.isInteger(row.revision) && row.revision > 0 &&
          object(row.input) && code(row.input.intent) !== "UNKNOWN" && code(row.input.questionClass) !== "UNKNOWN" &&
          object(row.features) && object(row.quality) && references(row.contextReferences) && references(row.entityReferences, true) && references(row.evidenceReferences, true) &&
          Array.isArray(row.protectedCaseIds) && row.protectedCaseIds.length <= 100 && row.protectedCaseIds.every(value => !!id(value)) &&
          object(row.createdFrom) && !!id(row.createdFrom.memoryId) && !!date(row.createdAt) &&
          object(row.correction) && references(row.correction?.evidenceReferences, true) && !!id(row.correction?.actorUid) && !!date(row.correction?.correctedAt) &&
          object(row.humanDecision) && reference(row.humanDecision?.reference) && !!id(row.humanDecision?.actorUid) && !!date(row.humanDecision?.decidedAt) &&
          object(row.outcome) && reference(row.outcome?.reference) && !!date(row.outcome?.occurredAt);
        if (!complete) reasons.push("INCOMPLETE_RECORD");
        else if (!trainingEligibility(row).eligible) reasons.push("QUALITY_INELIGIBLE");
        if (row.state !== "VERIFIED" || row.features?.entityType !== "SOLICITUD" || row.features?.status !== "PENDIENTE" ||
          row.features?.issueCode !== "DOCUMENT_MISSING" || row.expectedBehavior !== behavior || row.correction?.correctedBehavior !== behavior)
          reasons.push("OUTSIDE_SUPERVISED_CONTRACT");
        if (!reasons.length) try { await this.verifyEvidence(tx, row); } catch (error) {
          if (error instanceof HttpsError && ["failed-precondition", "not-found"].includes(error.code)) reasons.push("EVIDENCE_NOT_VERIFIED");
          else throw error;
        }
        candidateRows.push({ id: doc.id, revision: Number.isInteger(row.revision) ? row.revision : 0, state: code(row.state), split: code(row.split), domain: code(row.domain), taskType: code(row.taskType),
          features: { entityType: code(row.features?.entityType), status: code(row.features?.status), issueCode: code(row.features?.issueCode) },
          expectedBehavior: code(row.expectedBehavior), correctionCode: code(row.correction?.reasonCode),
          outcomeType: code(row.outcome?.type), outcomeAt: date(row.outcome?.occurredAt),
          evidence: (Array.isArray(row.evidenceReferences) ? row.evidenceReferences : []).filter(ref => ref && ref.rootId === identity.rootId && id(ref.id) && code(ref.system) !== "UNKNOWN" && code(ref.kind) !== "UNKNOWN").slice(0, 20)
            .map(ref => ({ system: ref.system, kind: ref.kind, id: ref.id })),
          selectionEligible: reasons.length === 0, reasons });
      }
      const ruleView = (doc: { id: string; data(): any }) => {
        const row = doc.data() as Rule;
        const supportingIds = (Array.isArray(row.supportingIds) ? row.supportingIds : []).filter(value => id(value)).slice(0, 5);
        return { id: doc.id, status: code(row.status), version: Number.isInteger(row.version) ? row.version : 0, behavior: code(row.behavior),
          supportingIds, supportingRevisions: Object.fromEntries(supportingIds.map(key => [key, Number.isInteger(row.supportingRevisions?.[key]) ? row.supportingRevisions[key] : 0])), approvedBy: id(row.approvedBy),
          approvedAt: date(row.approvedAt), expiresAt: date(row.expiresAt), expired: !date(row.expiresAt) || Date.parse(row.expiresAt) <= Date.now(),
          invalidatedBy: row.invalidatedBy ? code(row.invalidatedBy) : null };
      };
      return { gateStatus: { diagnosticsLocalFlag: enabled(), review: "UNKNOWN" as const, chat: "UNKNOWN" as const }, queriedAt: new Date().toISOString(), limit, candidates: candidateRows,
        nextCandidateCursor: candidatePage.size > limit ? nextCursor(candidatePage.docs[limit - 1].id, "CANDIDATES") : null,
        rules: rulePage.docs.slice(0, limit).map(ruleView),
        nextRuleCursor: rulePage.size > limit ? nextCursor(rulePage.docs[limit - 1].id, "RULES") : null,
        focusedRule: focused ? ruleView(focused) : null };
    });
  }
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
