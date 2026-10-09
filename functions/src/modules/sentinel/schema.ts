import { createHash } from "node:crypto";

export const SENTINEL_SCHEMA = "PAY0-SECURITY-EVENT@1" as const;
export const MAX_EVENT_BYTES = 4096;
export const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_FUTURE_SKEW_MS = 60_000;
export const EVENT_TYPES = [
  "AUTHORIZATION_DENIED", "SCOPE_MISMATCH", "EXTERNAL_OUTCOME_UNKNOWN",
  "DUPLICATE_EFFECT_SUSPECTED", "AUTHORIZATION_CHANGED_BEFORE_EXECUTION",
  "CLIENT_ROUTE_REPORTED",
] as const;
export type EventType = typeof EVENT_TYPES[number];
export type Origin = "SERVER_AUTH_DECISION" | "SERVER_EXECUTION" | "CLIENT_REPORTED";

/** Created by a trusted transport verifier, never deserialized from the event. */
export interface VerifiedIngress {
  rootId: string;
  actorUid: string;
  publisherId: string;
  source: "SERVER" | "CLIENT";
}
export interface SanitizedEvent {
  schemaVersion: typeof SENTINEL_SCHEMA;
  rootId: string;
  actorUid: string;
  publisherDigest: string;
  eventDigest: string;
  intentionDigest: string | null;
  attemptDigest: string | null;
  effectDigest: string | null;
  origin: Origin;
  eventType: EventType;
  occurredAtMs: number;
}
export class InvalidSecurityEvent extends Error {
  constructor(public readonly code: "INVALID_EVENT" | "INVALID_SCOPE" | "INVALID_ORIGIN" | "STALE_EVENT" | "LOOP_REJECTED") {
    super(code);
  }
}
export const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fields = new Set(["schemaVersion", "rootId", "actorUid", "eventId", "intentionId", "attemptId", "effectId", "origin", "eventType", "occurredAtMs"]);

export function sanitizeSecurityEvent(raw: unknown, ingress: VerifiedIngress, nowMs: number): SanitizedEvent {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidSecurityEvent("INVALID_EVENT");
  }
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) throw new InvalidSecurityEvent("INVALID_EVENT");
  const entries = Object.getOwnPropertyDescriptors(raw);
  // No getters/toJSON or arbitrary provider/client content may enter storage.
  if (Object.keys(entries).some(key => !fields.has(key) || !Object.prototype.hasOwnProperty.call(entries[key], "value"))) {
    throw new InvalidSecurityEvent("INVALID_EVENT");
  }
  const row = raw as Record<string, unknown>;
  if (!identifier(ingress.rootId) || !identifier(ingress.actorUid) || !identifier(ingress.publisherId) ||
      !identifier(row.rootId) || !identifier(row.actorUid) || row.rootId !== ingress.rootId || row.actorUid !== ingress.actorUid) {
    throw new InvalidSecurityEvent("INVALID_SCOPE");
  }
  if (ingress.publisherId.toLowerCase().includes("sentinel")) throw new InvalidSecurityEvent("LOOP_REJECTED");
  if (row.schemaVersion !== SENTINEL_SCHEMA || !identifier(row.eventId) ||
      !EVENT_TYPES.includes(row.eventType as EventType) || !Number.isSafeInteger(row.occurredAtMs)) {
    throw new InvalidSecurityEvent("INVALID_EVENT");
  }
  for (const key of ["intentionId", "attemptId", "effectId"]) {
    if (row[key] !== undefined && row[key] !== null && !identifier(row[key])) throw new InvalidSecurityEvent("INVALID_EVENT");
  }
  if (Buffer.byteLength(JSON.stringify(row), "utf8") > MAX_EVENT_BYTES) throw new InvalidSecurityEvent("INVALID_EVENT");
  const occurredAtMs = row.occurredAtMs as number;
  if (occurredAtMs < 0 || occurredAtMs < nowMs - MAX_EVENT_AGE_MS || occurredAtMs > nowMs + MAX_FUTURE_SKEW_MS) {
    throw new InvalidSecurityEvent("STALE_EVENT");
  }
  if (ingress.source === "CLIENT") {
    if (row.origin !== "CLIENT_REPORTED" || row.eventType !== "CLIENT_ROUTE_REPORTED") throw new InvalidSecurityEvent("INVALID_ORIGIN");
  } else if (ingress.source !== "SERVER" || !["SERVER_AUTH_DECISION", "SERVER_EXECUTION"].includes(String(row.origin)) || row.eventType === "CLIENT_ROUTE_REPORTED") {
    throw new InvalidSecurityEvent("INVALID_ORIGIN");
  }
  return {
    schemaVersion: SENTINEL_SCHEMA, rootId: ingress.rootId, actorUid: ingress.actorUid,
    publisherDigest: digest(ingress.publisherId),
    eventDigest: digest([ingress.publisherId, ingress.actorUid, row.eventId]),
    intentionDigest: row.intentionId ? digest(row.intentionId) : null,
    attemptDigest: row.attemptId ? digest(row.attemptId) : null,
    effectDigest: row.effectId ? digest(row.effectId) : null,
    origin: row.origin as Origin, eventType: row.eventType as EventType, occurredAtMs,
  };
}

/** Versioned semantic binding, not producer authentication. Delivery timestamps,
 * Pub/Sub IDs, signatures and observedAt never enter this tuple. Optional IDs
 * have already been normalized to null and hashed by sanitizeSecurityEvent. */
export const EVENT_CONTENT_BINDING = "PAY0-EVENT-CONTENT@1" as const;
export function securityEventContentDigest(event: SanitizedEvent): string {
  const names = ["schemaVersion", "rootId", "actorUid", "publisherDigest", "eventDigest", "intentionDigest", "attemptDigest", "effectDigest", "origin", "eventType", "occurredAtMs"];
  if (!event || typeof event !== "object" || Array.isArray(event)) throw Error("INVALID_EVENT_BINDING");
  const descriptors = Object.getOwnPropertyDescriptors(event);
  if (Object.keys(descriptors).sort().join(",") !== names.slice().sort().join(",") ||
      Object.values(descriptors).some(row => !Object.prototype.hasOwnProperty.call(row, "value"))) throw Error("INVALID_EVENT_BINDING");
  const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (event.schemaVersion !== SENTINEL_SCHEMA || !identifier(event.rootId) || !identifier(event.actorUid) ||
      !hash(event.publisherDigest) || !hash(event.eventDigest) ||
      [event.intentionDigest, event.attemptDigest, event.effectDigest].some(value => value !== null && !hash(value)) ||
      !["SERVER_AUTH_DECISION", "SERVER_EXECUTION", "CLIENT_REPORTED"].includes(event.origin) ||
      !EVENT_TYPES.includes(event.eventType) || !Number.isSafeInteger(event.occurredAtMs) || event.occurredAtMs < 0) throw Error("INVALID_EVENT_BINDING");
  return digest([EVENT_CONTENT_BINDING, ...names.map(name => event[name as keyof SanitizedEvent])]);
}
