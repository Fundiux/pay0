export const MEMORY_CONTRACT_VERSION = "memory-v2";
export const MEMORY_RETRIEVAL_VERSION = "structured-v1";
export type HugoMemoryKind = "FACT" | "RULE" | "EXPERIENCE" | "USER_STATEMENT" | "PREFERENCE" | "HYPOTHESIS" | "DECISION" | "OUTCOME";
export type HugoMemoryStatus = "CANDIDATE" | "CONFIRMED" | "DISPUTED" | "SUPERSEDED" | "EXPIRED" | "REJECTED";
export type HugoMemoryScope = { level: "ROOT" | "SYSTEM" | "CLIENT" | "ENTITY_TYPE" | "ENTITY"; rootId: string; system?: string; clientId?: string; entityType?: string; entityId?: string };
export type HugoEntityReference = { sourceSystem: string; entityType: string; entityId: string; displayReference?: string };
export type HugoMemoryRecord = {
  id: string; version: typeof MEMORY_CONTRACT_VERSION; rootId: string; kind: HugoMemoryKind; scope: HugoMemoryScope;
  content: string; source: string; sourceSystem: string; entityReference?: HugoEntityReference;
  claim?: { field: string; value: string };
  authorUid?: string;
  confidence: number | null; createdAt: string; effectiveAt: string | null; lastVerifiedAt: string | null; validUntil: string | null;
  supersedes: string[]; supersededBy?: string | null; status: HugoMemoryStatus;
  links?: { observationId?: string; recommendationId?: string; decisionId?: string; outcomeId?: string; linkStatus: "LINKED" | "UNLINKED" | "UNKNOWN" };
  decision?: { actorUid: string; actorRole: string; decisionType: string; decisionAt: string };
  verification?: { evidenceSource: string; confirmations: number; contradictions: number; outcomeKnown: boolean };
  lastUsedAt?: string | null;
};
export type MemoryQuery = { rootId: string; entityReferences: HugoEntityReference[]; intent: string; kinds?: HugoMemoryKind[]; limit?: number; now?: string };
export type RetrievedMemory = { record: HugoMemoryRecord; relevanceReason: "ENTITY_MATCH" | "RULE_SCOPE_MATCH" | "RECENT_OUTCOME" | "EXPLICIT_USER_REFERENCE"; verificationStatus: HugoMemoryStatus };
export type RetrievedLegacyObservation = { id: string; rootId: string; caseId: string; sourceEvent: string; intent: string; outcome: string; createdAt: string | null; verificationStatus: "UNVERIFIED_LEGACY"; relevanceReason: "ENTITY_MATCH" };
export type MemoryRetrieval = { considered: number; selected: RetrievedMemory[]; legacyObservationsConsidered: number; legacyObservations: RetrievedLegacyObservation[] };

export function memoryWritePolicy(input: { kind: HugoMemoryKind; source: string; explicitHumanInput?: boolean; evidenceCompleteness?: string; entityReference?: HugoEntityReference; content: string }): { allowed: boolean; initialStatus: HugoMemoryStatus; reason: string } {
  if (!input.content.trim() || input.content.length > 1000) return { allowed: false, initialStatus: "REJECTED", reason: "INVALID_CONTENT" };
  if (input.kind === "FACT" && input.evidenceCompleteness !== "COMPLETE") return { allowed: false, initialStatus: "REJECTED", reason: "FACT_REQUIRES_COMPLETE_SOURCE" };
  if (input.kind === "RULE") return { allowed: false, initialStatus: "REJECTED", reason: "RULE_REQUIRES_SEPARATE_HUMAN_PROMOTION" };
  if (input.kind === "HYPOTHESIS") return { allowed: true, initialStatus: "CANDIDATE", reason: "HYPOTHESIS_NEVER_AUTO_CONFIRMED" };
  if (["USER_STATEMENT", "PREFERENCE", "DECISION", "EXPERIENCE"].includes(input.kind) && !input.explicitHumanInput) return { allowed: false, initialStatus: "REJECTED", reason: "EXPLICIT_HUMAN_INPUT_REQUIRED" };
  return { allowed: true, initialStatus: "CANDIDATE", reason: "REQUIRES_VALIDATION" };
}

export function memoryApplicable(record: HugoMemoryRecord, query: MemoryQuery): boolean {
  if (record.rootId !== query.rootId || record.scope.rootId !== query.rootId || record.status !== "CONFIRMED" || record.supersededBy) return false;
  const now = Date.parse(query.now || new Date().toISOString());
  if (record.validUntil && Date.parse(record.validUntil) <= now) return false;
  if (query.kinds?.length && !query.kinds.includes(record.kind)) return false;
  const refs = query.entityReferences;
  if (record.scope.level === "ENTITY") return refs.some(ref => ref.sourceSystem === record.entityReference?.sourceSystem && ref.entityType === record.entityReference.entityType && ref.entityId === record.entityReference.entityId);
  if (record.scope.level === "ENTITY_TYPE") return refs.some(ref => ref.sourceSystem === record.scope.system && ref.entityType === record.scope.entityType);
  if (record.scope.level === "SYSTEM") return refs.some(ref => ref.sourceSystem === record.scope.system);
  if (record.scope.level === "CLIENT") return false;
  return (record.kind === "PREFERENCE" && record.source === "EXPLICIT_HUMAN") ||
    (record.kind === "RULE" && record.verification?.evidenceSource === "EXPLICIT_HUMAN_PROMOTION");
}
export function memoryReason(record: HugoMemoryRecord): RetrievedMemory["relevanceReason"] {
  if (record.kind === "RULE") return "RULE_SCOPE_MATCH";
  if (record.kind === "OUTCOME" || record.kind === "EXPERIENCE") return "RECENT_OUTCOME";
  if (record.kind === "USER_STATEMENT" || record.kind === "PREFERENCE") return "EXPLICIT_USER_REFERENCE";
  return "ENTITY_MATCH";
}
export function memoryPriority(record: HugoMemoryRecord): number {
  return { RULE: 0, OUTCOME: 1, DECISION: 2, EXPERIENCE: 3, PREFERENCE: 4, USER_STATEMENT: 5, FACT: 6, HYPOTHESIS: 7 }[record.kind];
}
