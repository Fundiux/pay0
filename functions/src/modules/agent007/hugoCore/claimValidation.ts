export type StructuredClaim = { text: string; evidenceIds: string[]; entityId?: string; field?: "status" | "amount"; value?: string };
export type StructuredCandidate = { answer: string; claims: StructuredClaim[]; referencedEntities: string[]; experienceReferences: string[]; proposedActions: string[] };
export function validateStructuredCandidate(candidate: StructuredCandidate, scope: { evidenceIds: string[]; entityFacts: Array<{ id: string; status?: string; amount?: string }>;
  experienceIds: string[]; allowedActions: string[]; rootAggregateComplete: boolean }): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [], evidence = new Set(scope.evidenceIds), entities = new Map(scope.entityFacts.map(row => [row.id, row]));
  for (const entity of candidate.referencedEntities || []) if (!entities.has(entity)) reasons.push("ENTITY_OUT_OF_SCOPE");
  for (const id of candidate.experienceReferences || []) if (!scope.experienceIds.includes(id)) reasons.push("EXPERIENCE_OUT_OF_SCOPE");
  for (const action of candidate.proposedActions || []) if (!scope.allowedActions.includes(action)) reasons.push("ACTION_NOT_ALLOWED");
  for (const claim of candidate.claims || []) {
    if (!claim.evidenceIds?.length || claim.evidenceIds.some(id => !evidence.has(id) && !scope.experienceIds.includes(id))) reasons.push("CLAIM_EVIDENCE_UNKNOWN");
    if (claim.entityId && !entities.has(claim.entityId)) reasons.push("CLAIM_ENTITY_UNKNOWN");
    if (claim.entityId && claim.field && claim.value && entities.has(claim.entityId)) {
      const current = entities.get(claim.entityId)?.[claim.field];
      if (current != null && current !== claim.value) reasons.push("CURRENT_FACT_CONTRADICTION");
    }
    if (!scope.rootAggregateComplete && /\b(total de toda la ra[ií]z|todos los pagos|todas las solicitudes|ninguna solicitud)\b/i.test(claim.text)) reasons.push("UNSUPPORTED_EXHAUSTIVE_CLAIM");
  }
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}
