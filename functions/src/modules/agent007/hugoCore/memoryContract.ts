// Phase 4 design contract only. No current collection is migrated to this shape.
export type HugoMemoryKind = "FACT" | "RULE" | "EXPERIENCE" | "USER_STATEMENT" | "PREFERENCE" | "HYPOTHESIS" | "DECISION" | "OUTCOME";
export type HugoMemoryStatus = "PROPOSED" | "VERIFIED" | "DISPUTED" | "SUPERSEDED" | "EXPIRED";
export type HugoMemoryRecord = {
  id: string;
  rootId: string;
  kind: HugoMemoryKind;
  content: string;
  source: string;
  sourceSystem: string;
  entityReference?: { sourceSystem: string; entityType: string; entityId: string };
  confidence: number | null;
  createdAt: string;
  lastVerifiedAt: string | null;
  validUntil: string | null;
  supersedes: string[];
  status: HugoMemoryStatus;
};
