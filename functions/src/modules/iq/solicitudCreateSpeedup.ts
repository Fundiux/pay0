/**
 * Pure decisions used to speed up IQ creation without touching the POST guards:
 * recovery of solicitudes that never reached the queue, draining a profile with one login,
 * and re-enqueueing a task that found the profile lock busy (always before the POST).
 */

export const RECOVERY_MAX_ATTEMPTS = 4;
export const RECOVERY_SPACING_MS = 3 * 60 * 1000;
export const LOCK_BUSY_MAX_RETRIES = 3;
export const STATUS_MONITOR_FIRST_CHECK_MS = 3 * 60 * 1000;
export const ON_DEMAND_GATHER_DELAY_SECONDS = 3;

const text = (value: unknown) => String(value ?? "").trim();
const millis = (value: any): number => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
};

export type RecoveryDecision = "RETRY" | "SKIP_STATUS" | "SKIP_HAS_FOLIO" | "SKIP_DELETED" | "SKIP_EXHAUSTED" | "SKIP_TOO_SOON" | "SKIP_NO_REQUESTER";

/** A solicitud stuck as NOT_ENQUEUED is retried a few times, spaced out, and never once it has a folio. */
export function recoveryDecision(solicitud: Record<string, any>, nowMs: number): RecoveryDecision {
  if (text(solicitud.iqCreateQueueStatus).toUpperCase() !== "NOT_ENQUEUED") return "SKIP_STATUS";
  if (text(solicitud.iqId ?? solicitud.iqFolio)) return "SKIP_HAS_FOLIO";
  if (solicitud.isDeleted || solicitud.deletedAt || ["ELIMINADA", "ELIMINADO", "CANCELADA", "CANCELADO", "RECHAZADA"].includes(text(solicitud.status).toUpperCase())) return "SKIP_DELETED";
  const attempts = Number(solicitud.iqCreateRecoveryAttempts ?? 0) || 0;
  if (attempts >= RECOVERY_MAX_ATTEMPTS) return "SKIP_EXHAUSTED";
  if (!recoveryRequester(solicitud)) return "SKIP_NO_REQUESTER";
  const last = millis(solicitud.iqCreateRecoveryAt);
  if (last > 0 && nowMs - last < RECOVERY_SPACING_MS * Math.max(1, attempts)) return "SKIP_TOO_SOON";
  return "RETRY";
}

export function recoveryRequester(solicitud: Record<string, any>): string {
  return text(solicitud.iqCreateQueuedBy ?? solicitud.createdBy ?? solicitud.operationalOwnerId ?? solicitud.ownerId);
}

type DrainCandidate = { id: string; status?: unknown; nextRunAt?: unknown; retryBlocked?: unknown };

/** Other jobs of the same profile that may share the login. Never includes blocked or not-yet-due jobs. */
export function selectDrainJobs<T extends DrainCandidate>(candidates: T[], input: { nowMs: number; excludeIds: Iterable<string>; max: number }): T[] {
  const exclude = new Set(input.excludeIds);
  const due = candidates
    .filter((job) => !exclude.has(job.id))
    .filter((job) => ["QUEUED", "FAILED_RETRYABLE"].includes(text(job.status).toUpperCase()))
    .filter((job) => job.retryBlocked !== true)
    .filter((job) => { const next = millis(job.nextRunAt); return next === 0 || next <= input.nowMs; })
    .sort((a, b) => millis(a.nextRunAt) - millis(b.nextRunAt));
  return due.slice(0, Math.max(0, input.max));
}

/** Lock busy before any browser work: wait and try again a few times instead of leaving it to the next scheduler pass. */
export function lockBusyRetryPlan(previousRetries: number): { retry: boolean; delaySeconds: number; nextRetry: number } {
  const retries = Math.max(0, Math.floor(Number(previousRetries) || 0));
  if (retries >= LOCK_BUSY_MAX_RETRIES) return { retry: false, delaySeconds: 0, nextRetry: retries };
  return { retry: true, delaySeconds: 15 + retries * 7, nextRetry: retries + 1 };
}
