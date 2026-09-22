import { LearningQuery } from "./learningContract";
import { RuleCandidate } from "./learningEvaluation";

export type CompiledRule = { ruleId: string; version: number; rootId: string; domain: string; taskType: string; features: Record<string, string>;
  behavior: string; supportingIds: string[]; contradictoryIds: string[]; exceptions: string[]; approvedBy: string; approvedAt: string;
  status: "ACTIVE" | "INVALIDATED"; invalidatedBy: string | null };
export function approveSyntheticRule(candidate: RuleCandidate, rootId: string, actorUid: string, at: string): CompiledRule {
  if (candidate.supportingIds.length < 2 || candidate.contradictoryIds.length || !rootId || !actorUid || !Number.isFinite(Date.parse(at)))
    throw Error("RULE_APPROVAL_UNSAFE");
  return { ruleId: `synthetic_${candidate.supportingIds.slice().sort().join("_")}`, version: 1, rootId, domain: candidate.domain, taskType: candidate.taskType,
    features: { ...candidate.features }, behavior: candidate.expectedBehavior, supportingIds: [...candidate.supportingIds], contradictoryIds: [],
    exceptions: [], approvedBy: actorUid, approvedAt: at, status: "ACTIVE", invalidatedBy: null };
}
export function applyCompiledRule(rule: CompiledRule, query: LearningQuery): string | null {
  if (rule.status !== "ACTIVE" || rule.rootId !== query.rootId || rule.domain !== query.domain || rule.taskType !== query.taskType ||
    Object.entries(rule.features).some(([key, value]) => query.features[key] !== value) || rule.exceptions.some(code => Object.values(query.features).includes(code))) return null;
  return rule.behavior;
}
export function invalidateCompiledRule(rule: CompiledRule, contradictoryExperienceId: string): CompiledRule {
  if (!contradictoryExperienceId || rule.status !== "ACTIVE") throw Error("RULE_INVALIDATION_INVALID");
  return { ...rule, version: rule.version + 1, status: "INVALIDATED", invalidatedBy: contradictoryExperienceId,
    contradictoryIds: [...rule.contradictoryIds, contradictoryExperienceId] };
}
