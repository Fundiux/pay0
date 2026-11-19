import { Timestamp } from "firebase-admin/firestore";

// Failures that say nothing about the complement itself: a safety budget that
// ended the run, a provider that did not answer in time or answered 5xx/429,
// or an IQ deposit that is not reconciled yet. They are retried at the next
// daily review. Everything else (permissions, configuration, mismatches,
// UNKNOWN after a send) keeps its existing stop.
const SAFETY_RUN_STOPS = new Set(["SAFETY_PAUSED", "SAFETY_FENCE_LOST", "SAFETY_EXTERNAL_BUDGET", "SAFETY_DURATION_BUDGET"]);
const DOMAIN_WAITS = new Set(["IQ_REP_DEPOSIT_NOT_RECONCILED"]);
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "EPIPE", "ENETUNREACH", "EHOSTUNREACH",
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
// Admissions one daily batch may spend per REP safety scope (root + provider).
// The scope's breaker opens at 20 in 10 minutes and needs a manual reset; the
// ceiling is checked inside the safety claim and leaves room for the trigger.
export const REP_DAILY_BATCH_ADMISSIONS = 16;
export const REP_PROVIDER_TIMEOUT = "REP_PROVIDER_TIMEOUT";
export const REP_PROVIDER_NETWORK = "REP_PROVIDER_NETWORK";

/** A persisted code that is safe to retry on the next daily review. */
export function isRetryableComplementCode(code: unknown): boolean {
  const value = typeof code === "string" ? code : "";
  if (!/^[A-Z0-9_]{1,100}$/.test(value)) return false;
  return SAFETY_RUN_STOPS.has(value) || DOMAIN_WAITS.has(value) || NETWORK_CODES.has(value) ||
    value === REP_PROVIDER_TIMEOUT || value === REP_PROVIDER_NETWORK ||
    /_HTTP_(5\d\d|429|408)$/.test(value) || /(^|_)TIMEOUT$/.test(value);
}

/** The retry code for a transient failure, or null when the failure must keep its stop. */
export function transientComplementFailure(error: unknown): string | null {
  const e = error as { name?: string; message?: string; code?: string; cause?: { code?: string; name?: string } } | null;
  if (!e) return null;
  if (e.name === "TimeoutError" || e.name === "AbortError" || e.cause?.name === "TimeoutError") return REP_PROVIDER_TIMEOUT;
  const message = typeof e.message === "string" ? e.message : "";
  if (isRetryableComplementCode(message)) return message;
  if (NETWORK_CODES.has(String(e.code || "")) || NETWORK_CODES.has(String(e.cause?.code || ""))) return REP_PROVIDER_NETWORK;
  if (e instanceof TypeError && message === "fetch failed") return REP_PROVIDER_NETWORK;
  return null;
}

// The daily review runs at 19:00; +12 h keeps the next weekday run eligible
// even when today's run started late (same convention as the B follow-up).
export const nextDailyCheck = (now: Date) => Timestamp.fromMillis(now.getTime() + 12 * 60 * 60 * 1000);
