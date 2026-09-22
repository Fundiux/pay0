import { LearningExperience, LearningReference, LearningCorrection, LearningOutcome, LEARNING_SCHEMA_VERSION, trainingEligibility } from "./learningContract";

export type VerifiedMemorySource = { id: string; rootId: string; status: string; kind: string; entityReference: { sourceSystem: string; entityType: string; entityId: string };
  links: { observationId?: string; decisionId?: string; outcomeId?: string }; createdAt: string };
export type ExperienceArtifacts = { rootId: string; experienceId: string; domain: string; taskType: string; intent: string; questionClass: string;
  memory: VerifiedMemorySource; observation: { id: string; rootId: string; caseId: string; source: string; createdAt: string };
  decision: { id: string; rootId: string; kind: string; status: string; entityId: string; actorUid: string; decisionType: string; decidedAt: string };
  outcome: { id: string; rootId: string; caseId: string; source: string; sourceEvent: string; occurredAt: string };
  trace?: { id: string; rootId: string; evidenceReferences: Array<{ sourceSystem: string; entityType: string; entityId: string }>; promptVersion: string; model: string; modelVersion: string; modelProvider?: string; resultStatus: string };
  features: Record<string, string>; now: string };
const ref = (rootId: string, system: string, kind: string, id: string, entityType?: string, entityId?: string): LearningReference => ({ system, kind, id, rootId, ...(entityType ? { entityType } : {}), ...(entityId ? { entityId } : {}) });
const terminal = new Set(["SOLICITUD_COMPLETADA", "PAGO_APLICADO_A_SOLICITUD", "DISPERSION_INCIDENCIA_RESUELTA", "OPERACION_RECUPERADA"]);
export type DraftArtifacts = Omit<ExperienceArtifacts, "memory" | "outcome"> & { decisionMemoryId: string };
export function buildDraftExperience(a: DraftArtifacts): LearningExperience {
  const o = a.observation, d = a.decision;
  if (o.rootId !== a.rootId || d.rootId !== a.rootId || o.caseId !== d.entityId || o.source !== "ACTIVITY_LOG" || d.kind !== "DECISION" || d.status !== "CONFIRMED" ||
    !Number.isFinite(Date.parse(o.createdAt)) || !Number.isFinite(Date.parse(d.decidedAt)) || Date.parse(o.createdAt) > Date.parse(d.decidedAt) ||
    a.trace && (a.trace.rootId !== a.rootId || !a.trace.evidenceReferences.some(e => e.entityId === o.caseId))) throw Error("LEARNING_DRAFT_LINEAGE_INVALID");
  const entityType = String(a.features.entityType || "");
  const references = [ref(a.rootId, "HUGO", "OBSERVATION", o.id), ref(a.rootId, "HUGO", "DECISION", d.id)];
  const record: LearningExperience = { schemaVersion: LEARNING_SCHEMA_VERSION, experienceId: a.experienceId, revision: 1, rootId: a.rootId, domain: a.domain, taskType: a.taskType,
    input: { intent: a.intent, questionClass: a.questionClass, ambiguity: "NONE" }, contextReferences: a.trace ? [ref(a.rootId, "HUGO", "TRACE", a.trace.id)] : [],
    entityReferences: [ref(a.rootId, "PAY0", entityType, o.caseId, entityType, o.caseId)], evidenceReferences: references, evidenceCompleteness: "PARTIAL", features: a.features,
    modelDecision: a.trace ? { behavior: a.trace.resultStatus, provider: a.trace.modelProvider || null, model: a.trace.model, modelVersion: a.trace.modelVersion, promptVersion: a.trace.promptVersion } : null,
    humanDecision: { type: d.decisionType, actorUid: d.actorUid, decidedAt: d.decidedAt, reference: references[1] }, correction: null, outcome: null, expectedBehavior: null,
    state: "WAITING_FOR_OUTCOME", quality: { provenance: "VERIFIED", outcome: "UNKNOWN", feedback: "DECIDED" },
    trainingEligibility: { eligible: false, reasons: [], policyVersion: "learning-eligibility-v1" }, split: "TEST", protectedCaseIds: [],
    governance: { use: "TRAINING_REVIEW_REQUIRED", externalProvider: "NOT_APPROVED", reviewedBy: null, reviewedAt: null },
    createdFrom: { memoryId: a.decisionMemoryId, traceId: a.trace?.id || null }, sourceVersions: { core: "phase5-v1", context: "context-v2", memory: "memory-v2", prompt: a.trace?.promptVersion || null },
    createdAt: a.now, finalizedAt: null, supersedesId: null };
  record.trainingEligibility = trainingEligibility(record);
  return record;
}
export function buildVerifiedExperience(a: ExperienceArtifacts): LearningExperience {
  const { memory: m, observation: o, decision: d, outcome: z } = a;
  if (m.rootId !== a.rootId || o.rootId !== a.rootId || d.rootId !== a.rootId || z.rootId !== a.rootId ||
    m.kind !== "EXPERIENCE" || m.status !== "CONFIRMED" || m.links.observationId !== o.id || m.links.decisionId !== d.id || m.links.outcomeId !== z.id ||
    o.caseId !== z.caseId || o.caseId !== m.entityReference.entityId || d.entityId !== o.caseId || d.kind !== "DECISION" || d.status !== "CONFIRMED" ||
    o.source !== "ACTIVITY_LOG" || z.source !== "ACTIVITY_LOG" || !terminal.has(z.sourceEvent) ||
    !(Date.parse(o.createdAt) <= Date.parse(d.decidedAt) && Date.parse(d.decidedAt) <= Date.parse(z.occurredAt)) ||
    a.trace && (a.trace.rootId !== a.rootId || !a.trace.evidenceReferences.some(e => e.entityId === o.caseId))) throw Error("LEARNING_LINEAGE_INVALID");
  const entity = ref(a.rootId, m.entityReference.sourceSystem, m.entityReference.entityType, o.caseId, m.entityReference.entityType, o.caseId);
  const evidence = [ref(a.rootId, "HUGO", "OBSERVATION", o.id), ref(a.rootId, "HUGO", "DECISION", d.id), ref(a.rootId, "PAY0", "OUTCOME", z.id)];
  const record: LearningExperience = { schemaVersion: LEARNING_SCHEMA_VERSION, experienceId: a.experienceId, revision: 1, rootId: a.rootId, domain: a.domain, taskType: a.taskType,
    input: { intent: a.intent, questionClass: a.questionClass, ambiguity: "NONE" }, contextReferences: a.trace ? [ref(a.rootId, "HUGO", "TRACE", a.trace.id)] : [],
    entityReferences: [entity], evidenceReferences: evidence, evidenceCompleteness: "COMPLETE", features: a.features,
    modelDecision: a.trace ? { behavior: a.trace.resultStatus, provider: a.trace.modelProvider || null, model: a.trace.model, modelVersion: a.trace.modelVersion, promptVersion: a.trace.promptVersion } : null,
    humanDecision: { type: d.decisionType, actorUid: d.actorUid, decidedAt: d.decidedAt, reference: evidence[1] }, correction: null,
    outcome: { type: z.sourceEvent, verified: true, occurredAt: z.occurredAt, reference: evidence[2] }, expectedBehavior: null,
    state: "VERIFIED", quality: { provenance: "VERIFIED", outcome: "VERIFIED", feedback: "DECIDED" },
    trainingEligibility: { eligible: false, reasons: [], policyVersion: "learning-eligibility-v1" }, split: "TEST", protectedCaseIds: [],
    governance: { use: "TRAINING_REVIEW_REQUIRED", externalProvider: "NOT_APPROVED", reviewedBy: null, reviewedAt: null },
    createdFrom: { memoryId: m.id, traceId: a.trace?.id || null }, sourceVersions: { core: "phase5-v1", context: "context-v2", memory: "memory-v2", prompt: a.trace?.promptVersion || null },
    createdAt: a.now, finalizedAt: a.now, supersedesId: null };
  record.trainingEligibility = trainingEligibility(record);
  return record;
}
export function withCorrection(record: LearningExperience, correction: LearningCorrection, expectedBehavior: string): LearningExperience {
  if (!["WAITING_FOR_OUTCOME", "VERIFIED"].includes(record.state) || !correction.evidenceReferences.length ||
    !correction.evidenceReferences.every(r => r.rootId === record.rootId && record.evidenceReferences.some(e => e.system === r.system && e.kind === r.kind && e.id === r.id)) ||
    !Number.isFinite(Date.parse(correction.correctedAt)) || Date.parse(correction.correctedAt) < Date.parse(record.humanDecision?.decidedAt || "") ||
    !correction.correctedBehavior || !expectedBehavior) throw Error("LEARNING_CORRECTION_INVALID");
  const next = { ...record, revision: record.revision + 1, correction, expectedBehavior, quality: { ...record.quality, feedback: "CORRECTED" as const } };
  next.trainingEligibility = trainingEligibility(next);
  return next;
}
export function withOutcome(record: LearningExperience, outcome: LearningOutcome): LearningExperience {
  if (record.state !== "WAITING_FOR_OUTCOME" || record.outcome || outcome.reference.rootId !== record.rootId || !outcome.verified || !terminal.has(outcome.type) ||
    !Number.isFinite(Date.parse(outcome.occurredAt)) || Date.parse(outcome.occurredAt) < Date.parse(record.correction?.correctedAt || record.humanDecision?.decidedAt || "")) throw Error("LEARNING_OUTCOME_INVALID");
  const next: LearningExperience = { ...record, revision: record.revision + 1, outcome, evidenceReferences: [...record.evidenceReferences, outcome.reference], evidenceCompleteness: "COMPLETE", state: "VERIFIED", finalizedAt: outcome.occurredAt,
    quality: { ...record.quality, outcome: "VERIFIED" } };
  next.trainingEligibility = trainingEligibility(next);
  return next;
}
