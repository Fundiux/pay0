export const LEARNING_SCHEMA_VERSION = "hugo-learning-v1";
export const LEARNING_POLICY_VERSION = "learning-eligibility-v1";
export type LearningState = "DRAFT" | "WAITING_FOR_FEEDBACK" | "WAITING_FOR_OUTCOME" | "VERIFIED" | "REJECTED" | "SUPERSEDED";
export type LearningSplit = "TRAIN" | "VALIDATION" | "TEST" | "HOLDOUT" | "GOLDEN";
export type LearningGovernance = { use: "EVAL_ONLY" | "TRAINING_ELIGIBLE_INTERNAL" | "TRAINING_REVIEW_REQUIRED" | "DO_NOT_TRAIN";
  externalProvider: "NOT_APPROVED" | "APPROVED"; reviewedBy: string | null; reviewedAt: string | null };
export type EvidenceCompleteness = "COMPLETE" | "PARTIAL" | "UNKNOWN";
export type LearningReference = { system: string; kind: string; id: string; rootId: string; entityType?: string; entityId?: string };
export type LearningCorrection = { originalBehavior: string; correctedBehavior: string; reasonCode: string; actorUid: string; correctedAt: string; evidenceReferences: LearningReference[]; scope: "ENTITY" | "ENTITY_TYPE" | "ROOT" };
export type LearningOutcome = { type: string; verified: boolean; occurredAt: string; reference: LearningReference };
export type LearningExperience = {
  schemaVersion: typeof LEARNING_SCHEMA_VERSION; experienceId: string; revision: number; rootId: string; domain: string; taskType: string;
  input: { intent: string; questionClass: string; ambiguity: "NONE" | "UNRESOLVED" };
  contextReferences: LearningReference[]; entityReferences: LearningReference[]; evidenceReferences: LearningReference[];
  evidenceCompleteness: EvidenceCompleteness; features: Record<string, string>;
  modelDecision: { behavior: string; provider: string | null; model: string | null; modelVersion: string | null; promptVersion: string | null } | null;
  humanDecision: { type: string; actorUid: string; decidedAt: string; reference: LearningReference } | null;
  correction: LearningCorrection | null; outcome: LearningOutcome | null;
  expectedBehavior: string | null; state: LearningState; quality: { provenance: "VERIFIED" | "PARTIAL" | "UNKNOWN"; outcome: "VERIFIED" | "UNKNOWN"; feedback: "CORRECTED" | "DECIDED" | "NONE" };
  trainingEligibility: { eligible: boolean; reasons: string[]; policyVersion: typeof LEARNING_POLICY_VERSION };
  split: LearningSplit; protectedCaseIds: string[]; governance?: LearningGovernance; createdFrom: { memoryId: string; traceId: string | null };
  sourceVersions: { core: string; context: string; memory: string; prompt: string | null };
  createdAt: string; finalizedAt: string | null; supersedesId: string | null; supersededById?: string | null;
};
export type LearningEventType = "EXPERIENCE_CREATED" | "CORRECTION_RECORDED" | "OUTCOME_LINKED" | "EXPERIENCE_VERIFIED" | "EXPERIENCE_REJECTED" | "EXPERIENCE_RETRIEVED" | "EXPERIENCE_SUPERSEDED" | "LEARNING_EFFECT_MEASURED" | "RULE_CANDIDATE_CREATED" | "SPLIT_ASSIGNED";
export type LearningLedgerEvent = { eventId: string; rootId: string; experienceId: string; type: LearningEventType; at: string; actorUid: string | null; references: LearningReference[]; metadata: Record<string, string | number | boolean | null> };
export type LearningQuery = { rootId: string; domain: string; taskType: string; entityType: string; features: Record<string, string>; limit?: number };
export type LearningRetrieval = { considered: number; selected: LearningExperience[]; rejected: Array<{ experienceId: string; reason: string }>; conflict?: boolean };
export type LearningEffect = { caseId: string; experienceId: string; beforeCorrect: boolean; afterCorrect: boolean; currentFactsCorrect: boolean; overgeneralized: boolean; improved: boolean; modelAdapter: string; promptVersion: string; evidenceDigest: string };

export const validReference = (ref: LearningReference, rootId: string): boolean => ref.rootId === rootId &&
  /^[A-Za-z0-9_-]{1,160}$/.test(ref.id) && /^[A-Z][A-Z0-9_]{1,39}$/.test(ref.system) && /^[A-Z][A-Z0-9_]{1,59}$/.test(ref.kind);
export function trainingEligibility(record: LearningExperience): LearningExperience["trainingEligibility"] {
  const reasons: string[] = [];
  if (!record.domain || !record.taskType || !record.input.intent) reasons.push("TASK_INCOMPLETE");
  if (record.input.ambiguity !== "NONE") reasons.push("UNRESOLVED_AMBIGUITY");
  if (!record.evidenceReferences.length || record.evidenceCompleteness === "UNKNOWN") reasons.push("EVIDENCE_INSUFFICIENT");
  if (![...record.contextReferences, ...record.entityReferences, ...record.evidenceReferences].every(ref => validReference(ref, record.rootId))) reasons.push("PROVENANCE_INVALID");
  if (!record.humanDecision && !record.correction) reasons.push("HUMAN_FEEDBACK_MISSING");
  if (!record.outcome?.verified || !validReference(record.outcome.reference, record.rootId)) reasons.push("OUTCOME_UNVERIFIED");
  if (!record.expectedBehavior) reasons.push("EXPECTED_BEHAVIOR_MISSING");
  if (record.supersededById || record.state === "SUPERSEDED") reasons.push("SUPERSEDED");
  if (record.state !== "VERIFIED") reasons.push("STATE_NOT_VERIFIED");
  if (record.split === "HOLDOUT" || record.split === "GOLDEN" || record.protectedCaseIds.length) reasons.push("PROTECTED_EVAL_CASE");
  return { eligible: reasons.length === 0, reasons, policyVersion: LEARNING_POLICY_VERSION };
}
