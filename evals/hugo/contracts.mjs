export const COMPLETENESS = ["COMPLETE", "PARTIAL", "UNKNOWN"];
export const EVIDENCE_KINDS = ["FACT", "MEMORY", "INFERENCE", "USER_STATEMENT", "RULE", "UNKNOWN"];
export const ACTION_LEVELS = ["READ", "PROPOSE", "EXECUTE_REVERSIBLE", "EXECUTE_SENSITIVE", "REQUIRE_HUMAN"];

export function validateEvidence(evidence) {
  for (const key of ["sourceSystem", "sourceType", "entityType", "entityId", "retrievedAt", "effectiveAt", "scope", "completeness", "kind"]) {
    if (!(key in evidence)) throw Error(`Evidence missing ${key}`);
  }
  if (!COMPLETENESS.includes(evidence.completeness) || !EVIDENCE_KINDS.includes(evidence.kind)) throw Error("Invalid evidence classification");
  if (!evidence.scope.rootId) throw Error("Evidence missing rootId");
  return evidence;
}

export function validateToolResult(result, requestScope) {
  if (!result.tool || !result.operation || !["Query", "Command"].includes(result.operation)) throw Error("Invalid tool result");
  if (result.operation === "Query" && result.effects?.length) throw Error("Query may not report writes");
  for (const evidence of result.evidence || []) {
    validateEvidence(evidence);
    if (evidence.scope.rootId !== requestScope.rootId) throw Error("Cross-root evidence");
  }
  return result;
}

export function partialLegacySample({ sourceSystem = "PAY0", entityType, rootId, rows, retrievedAt }) {
  return validateToolResult({ tool: `legacy.${entityType}`, operation: "Query", effects: [], data: rows,
    evidence: rows.map(row => ({ sourceSystem, sourceType: "FIRESTORE_SAMPLE", entityType, entityId: row.id,
      retrievedAt, effectiveAt: row.updatedAt || null, scope: { rootId }, completeness: "PARTIAL", kind: "FACT" })) }, { rootId });
}
