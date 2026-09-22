import { LearningEffect, LearningExperience, LearningQuery } from "./learningContract";
import { relevantExperience } from "./learningStore";

export type ModelNecessity = "MODEL_REQUIRED" | "MODEL_OPTIONAL" | "MODEL_NOT_REQUIRED";
export type StructuredTask = { caseId: string; query: LearningQuery; expectedBehavior: string; currentFacts: Record<string, string>; modelNecessity: ModelNecessity };
export type StructuredDecision = { behavior: string; source: "POLICY" | "EXPERIENCE" | "ESCALATE"; experienceId: string | null; currentFactsUsed: boolean };
export function decideWithoutModel(task: StructuredTask, experiences: LearningExperience[]): StructuredDecision {
  if (task.query.taskType === "GLOBAL_COUNT" && task.currentFacts.completeness !== "COMPLETE_ROOT_AGGREGATE")
    return { behavior: "REFUSE_UNSUPPORTED_TOTAL", source: "POLICY", experienceId: null, currentFactsUsed: true };
  if (task.query.taskType === "AMBIGUOUS_REFERENCE" && task.currentFacts.ambiguity === "UNRESOLVED")
    return { behavior: "CLARIFY_FOLIO", source: "POLICY", experienceId: null, currentFactsUsed: true };
  if (task.query.taskType === "EXACT_STATUS" && task.currentFacts.evidenceComplete === "COMPLETE_EXACT" && task.currentFacts.status)
    return { behavior: `REPORT_STATUS_${task.currentFacts.status}`, source: "POLICY", experienceId: null, currentFactsUsed: true };
  const relevant = experiences.find(record => relevantExperience(record, task.query).selected && record.expectedBehavior &&
    record.expectedBehavior === "VERIFY_DOCUMENT_BEFORE_DECISION" && task.currentFacts.documentStatus === "UNVERIFIED");
  if (relevant) return { behavior: "VERIFY_DOCUMENT_BEFORE_DECISION", source: "EXPERIENCE", experienceId: relevant.experienceId, currentFactsUsed: true };
  return { behavior: "ESCALATE_UNKNOWN", source: "ESCALATE", experienceId: null, currentFactsUsed: true };
}
export function measureLearningEffect(input: { task: StructuredTask; experience: LearningExperience; before: StructuredDecision; after: StructuredDecision; modelAdapter: string; promptVersion: string; evidenceDigest: string }): LearningEffect {
  const beforeCorrect = input.before.behavior === input.task.expectedBehavior, afterCorrect = input.after.behavior === input.task.expectedBehavior;
  const currentFactsCorrect = input.after.currentFactsUsed, overgeneralized = input.after.experienceId === input.experience.experienceId &&
    !relevantExperience(input.experience, input.task.query).selected;
  return { caseId: input.task.caseId, experienceId: input.experience.experienceId, beforeCorrect, afterCorrect, currentFactsCorrect, overgeneralized,
    improved: !beforeCorrect && afterCorrect && currentFactsCorrect && !overgeneralized, modelAdapter: input.modelAdapter, promptVersion: input.promptVersion, evidenceDigest: input.evidenceDigest };
}
export type RuleCandidate = { domain: string; taskType: string; features: Record<string, string>; expectedBehavior: string; supportingIds: string[]; contradictoryIds: string[]; status: "RULE_CANDIDATE" };
export function proposeRuleCandidates(records: LearningExperience[]): RuleCandidate[] {
  const groups = new Map<string, LearningExperience[]>();
  const seen = new Set<string>();
  for (const row of records.filter(x => x.state === "VERIFIED" && x.outcome?.verified && x.expectedBehavior && x.quality.provenance === "VERIFIED" && !x.supersededById)) {
    if (seen.has(row.experienceId)) continue;
    seen.add(row.experienceId);
    const key = JSON.stringify([row.domain, row.taskType, Object.entries(row.features).sort()]);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const candidates: RuleCandidate[] = [];
  for (const group of groups.values()) {
    const byBehavior = new Map<string, LearningExperience[]>();
    for (const row of group) byBehavior.set(row.expectedBehavior!, [...(byBehavior.get(row.expectedBehavior!) || []), row]);
    for (const [expectedBehavior, support] of byBehavior) if (new Set(support.map(x => x.entityReferences[0]?.entityId)).size >= 2) candidates.push({ domain: support[0].domain, taskType: support[0].taskType,
      features: support[0].features, expectedBehavior, supportingIds: support.map(x => x.experienceId),
      contradictoryIds: group.filter(x => x.expectedBehavior !== expectedBehavior).map(x => x.experienceId), status: "RULE_CANDIDATE" });
  }
  return candidates;
}
