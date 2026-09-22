import { LearningCorrection, LearningEffect, LearningEventType, LearningExperience, LearningLedgerEvent, LearningQuery, LearningRetrieval, LearningSplit } from "./learningContract";

export interface HugoLearningStore {
  createDraftFromDecision(input: { rootId: string; decisionId: string; traceId?: string; domain: string; taskType: string; intent: string; questionClass: string; features: Record<string, string>; actorUid: string }): Promise<{ id: string; created: boolean; record: LearningExperience }>;
  createFromVerifiedMemory(input: { rootId: string; memoryId: string; traceId?: string; domain: string; taskType: string; intent: string; questionClass: string; features: Record<string, string>; actorUid: string }): Promise<{ id: string; created: boolean; record: LearningExperience }>;
  addCorrection(rootId: string, experienceId: string, correction: LearningCorrection, expectedBehavior: string): Promise<LearningExperience>;
  linkOutcome(rootId: string, experienceId: string, outcomeId: string, actorUid: string): Promise<LearningExperience>;
  assignSplit(rootId: string, experienceId: string, split: LearningSplit, actorUid: string): Promise<LearningExperience>;
  supersede(rootId: string, experienceId: string, replacementId: string, actorUid: string): Promise<LearningExperience>;
  retrieve(query: LearningQuery): Promise<LearningRetrieval>;
  list(rootId: string, limit?: number): Promise<LearningExperience[]>;
  listLedger(rootId: string, experienceId: string, limit?: number): Promise<LearningLedgerEvent[]>;
  listExportCandidates(rootId: string, limit?: number): Promise<LearningExperience[]>;
  recordEffect(rootId: string, effect: LearningEffect): Promise<void>;
  appendEvent(rootId: string, experienceId: string, type: LearningEventType, actorUid: string | null, metadata?: Record<string, string | number | boolean | null>): Promise<void>;
}

const material = ["bank", "instrument", "eventType", "clientId", "entityType", "issueCode", "status"];
export function relevantExperience(record: LearningExperience, query: LearningQuery): { selected: boolean; reason: string } {
  if (record.rootId !== query.rootId) return { selected: false, reason: "FOREIGN_ROOT" };
  if (record.state !== "VERIFIED" || !record.outcome?.verified) return { selected: false, reason: "UNVERIFIED" };
  if (record.supersededById) return { selected: false, reason: "SUPERSEDED" };
  if (["HOLDOUT", "GOLDEN"].includes(record.split) || record.protectedCaseIds.length) return { selected: false, reason: "PROTECTED_EVAL" };
  if (!record.expectedBehavior || record.quality.provenance !== "VERIFIED") return { selected: false, reason: "WEAK_EXPERIENCE" };
  if (record.domain !== query.domain || record.taskType !== query.taskType) return { selected: false, reason: "TASK_MISMATCH" };
  if (!record.entityReferences.some(ref => ref.entityType === query.entityType)) return { selected: false, reason: "ENTITY_TYPE_MISMATCH" };
  for (const key of material) if ((record.features[key] || query.features[key]) && record.features[key] !== query.features[key]) return { selected: false, reason: `MATERIAL_DIFFERENCE_${key}` };
  return { selected: true, reason: "STRUCTURED_MATCH" };
}

export function selectLearningExperiences(rows: LearningExperience[], query: LearningQuery): LearningRetrieval {
  const matched: LearningExperience[] = [], rejected: LearningRetrieval["rejected"] = [];
  for (const row of rows) { const result = relevantExperience(row, query); if (result.selected) matched.push(row);
    else rejected.push({ experienceId: row.experienceId, reason: result.reason }); }
  const behaviors = new Set(matched.map(row => row.expectedBehavior));
  if (behaviors.size > 1) return { considered: rows.length, selected: [],
    rejected: [...rejected, ...matched.map(row => ({ experienceId: row.experienceId, reason: "CONTRADICTORY_VERIFIED_EXPERIENCE" }))], conflict: true };
  matched.sort((a, b) => Number(b.quality.feedback === "CORRECTED") - Number(a.quality.feedback === "CORRECTED") ||
    b.createdAt.localeCompare(a.createdAt) || a.experienceId.localeCompare(b.experienceId));
  return { considered: rows.length, selected: matched.slice(0, Math.min(Math.max(query.limit || 3, 1), 5)), rejected, conflict: false };
}
