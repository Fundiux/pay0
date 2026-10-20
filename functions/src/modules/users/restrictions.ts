/** Server-only field contract; the marker is not a cryptographic signature.
 * The future authenticated writer owns issuance/revocation. Client reports and
 * legacy securityLock must never create or remove a trusted restriction.
 */
export const TRUSTED_RESTRICTION_WRITER = "PAY0_TRUSTED_RESTRICTION_WRITER@1" as const;
export const TRUSTED_RESTRICTION_POLICY = "PAY0-CONTAINMENT@1" as const;
export const MAX_RESTRICTION_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_RESTRICTION_TTL_MS = 15 * 60 * 1000;
export const RESTRICTION_REASONS = ["SECURITY_REVIEW", "CREDENTIAL_COMPROMISE_CONFIRMED", "SUPPORT_CONTAINMENT"] as const;
export const REVOCATION_REASONS = ["REVIEW_CLEARED", "CREDENTIALS_RECOVERED", "SUPPORT_RECOVERY"] as const;

export type TrustedRestriction = {
  schemaVersion: 1;
  writer: typeof TRUSTED_RESTRICTION_WRITER;
  policyVersion: typeof TRUSTED_RESTRICTION_POLICY;
  restrictionId: string;
  rootId: string;
  subjectUid: string;
  state: "ACTIVE" | "REVOKED";
  scope: "ACCOUNT_OPERATIONS";
  authority: "HUMAN_SECURITY_ADMIN";
  authorityUid: string;
  reasonCode: typeof RESTRICTION_REASONS[number];
  incidentId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  authorizationVersion: number;
  revokedAtMs?: number;
  revokedBy?: string;
  revocationReason?: typeof REVOCATION_REASONS[number];
};
export type RestrictionEvaluation = {
  restricted: boolean;
  state: "NONE" | "ACTIVE" | "EXPIRED" | "REVOKED" | "INVALID";
};
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const milliseconds = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 253402300799999;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const allowedFields = new Set([
  "schemaVersion", "writer", "policyVersion", "restrictionId", "rootId", "subjectUid", "state", "scope", "authority", "authorityUid", "reasonCode", "incidentId", "issuedAtMs", "expiresAtMs", "authorizationVersion", "revokedAtMs", "revokedBy", "revocationReason",
]);

/** Pure check before role bypass. A valid expiry is effective at equality.
 * Present but malformed fields fail closed, even if they claim to be revoked.
 */
export function evaluateTrustedRestriction(user: unknown, authenticatedUid: string, nowMs = Date.now()): RestrictionEvaluation {
  if (!user || typeof user !== "object" || !own(user, "trustedRestrictionV1")) return { restricted: false, state: "NONE" };
  const invalid: RestrictionEvaluation = { restricted: true, state: "INVALID" };
  const profile = user as Record<string, unknown>;
  const raw = profile.trustedRestrictionV1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !milliseconds(nowMs)) return invalid;
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return invalid;
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Object.keys(descriptors).some(key => !allowedFields.has(key) || !own(descriptors[key], "value"))) return invalid;
  const row = raw as Record<string, unknown>;
  const rootId = profile.rootId || authenticatedUid;
  if (!identifier(authenticatedUid) || !identifier(rootId) ||
      row.schemaVersion !== 1 || row.writer !== TRUSTED_RESTRICTION_WRITER || row.policyVersion !== TRUSTED_RESTRICTION_POLICY ||
      !identifier(row.restrictionId) || row.rootId !== rootId || row.subjectUid !== authenticatedUid ||
      row.scope !== "ACCOUNT_OPERATIONS" || row.authority !== "HUMAN_SECURITY_ADMIN" ||
      !identifier(row.authorityUid) || row.authorityUid === authenticatedUid || !identifier(row.incidentId) ||
      !RESTRICTION_REASONS.includes(row.reasonCode as typeof RESTRICTION_REASONS[number]) ||
      !Number.isSafeInteger(row.authorizationVersion) || (row.authorizationVersion as number) < 1 ||
      !milliseconds(row.issuedAtMs) || !milliseconds(row.expiresAtMs) || row.issuedAtMs > nowMs ||
      row.expiresAtMs <= row.issuedAtMs || row.expiresAtMs - row.issuedAtMs > MAX_RESTRICTION_TTL_MS) return invalid;

  if (row.state === "REVOKED") {
    if (!milliseconds(row.revokedAtMs) || row.revokedAtMs < row.issuedAtMs || row.revokedAtMs > nowMs ||
        !identifier(row.revokedBy) || row.revokedBy === authenticatedUid ||
        !REVOCATION_REASONS.includes(row.revocationReason as typeof REVOCATION_REASONS[number])) return invalid;
    return { restricted: false, state: "REVOKED" };
  }
  if (row.state !== "ACTIVE" || own(row, "revokedAtMs") || own(row, "revokedBy") || own(row, "revocationReason")) return invalid;
  return nowMs < row.expiresAtMs ? { restricted: true, state: "ACTIVE" } : { restricted: false, state: "EXPIRED" };
}
