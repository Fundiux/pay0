import { ACTIVITY_SYSTEMS } from "../../activityLog/systemBoundary";

export type EvidenceEntity = { sourceSystem?: unknown; entityType?: unknown; entityId?: unknown };
export function isEvidenceSystem(value: unknown): value is string {
  return typeof value === "string" && (ACTIVITY_SYSTEMS as readonly string[]).includes(value);
}
// Logging producers use e.g. "solicitud"/"pago"; observer uppercases them.
// Only letter case is an alias. Never infer cross-domain relationships from an ID.
export function canonicalEvidenceType(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(value)) return null;
  return value.toUpperCase();
}
export function evidenceIdentity(value: EvidenceEntity | undefined): string | null {
  const type = canonicalEvidenceType(value?.entityType);
  if (!type || !isEvidenceSystem(value?.sourceSystem) || typeof value?.entityId !== "string" ||
      !value.entityId || value.entityId.length > 160 || /[\/\\\x00-\x1f]/.test(value.entityId)) return null;
  return JSON.stringify([value.sourceSystem, type, value.entityId]);
}
export function sameEvidenceIdentity(...values: Array<EvidenceEntity | undefined>): boolean {
  const first = evidenceIdentity(values[0]);
  return first !== null && values.every(value => evidenceIdentity(value) === first);
}
export const observationEntity = (row: any): EvidenceEntity => ({ sourceSystem: row?.sourceSystem, entityType: row?.caseType, entityId: row?.caseId });
