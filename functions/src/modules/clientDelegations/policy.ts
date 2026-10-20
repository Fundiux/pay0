import { Timestamp } from "firebase-admin/firestore";

// Persisted legacy grants may omit expiry or use epoch milliseconds. Never
// coerce strings, booleans or arbitrary objects into an unlimited grant.
export function delegationTimeMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 253402300799999
    ? value : null;
}

export function delegationIsCurrent(access: any, now = Date.now()): boolean {
  if (access?.active !== true || access.revokedAt != null) return false;
  if (access.mode === "TEMPORARY" && access.expiresAt == null) return false;
  if (access.expiresAt != null) {
    const expiry = delegationTimeMillis(access.expiresAt);
    if (expiry === null || expiry <= now) return false;
  }
  if (access.startsAt != null) {
    const start = delegationTimeMillis(access.startsAt);
    if (start === null || start > now) return false;
  }
  return true;
}

// Callable Timestamp values arrive as plain seconds/nanoseconds objects.
// Canonicalize at the write boundary so rules and backend see the same type.
export function canonicalDelegationTime(value: unknown): Timestamp | null {
  if (value == null) return null;
  const millis = delegationTimeMillis(value);
  if (millis !== null) return Timestamp.fromMillis(millis);
  if (typeof value === "object" && value !== null) {
    const raw = value as Record<string, unknown>;
    const seconds = raw.seconds ?? raw._seconds;
    const nanos = raw.nanoseconds ?? raw._nanoseconds ?? 0;
    if (Number.isInteger(seconds) && Number.isInteger(nanos)
      && Number(seconds) >= 0 && Number(seconds) <= 253402300799
      && Number(nanos) >= 0 && Number(nanos) < 1e9) {
      return new Timestamp(Number(seconds), Number(nanos));
    }
  }
  throw new Error("Fecha de delegación inválida.");
}
