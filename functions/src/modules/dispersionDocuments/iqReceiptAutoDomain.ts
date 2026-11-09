// Pure rules for the automatic IQ dispersion receipt download. No I/O here so
// the scheduler stays thin and the decisions are testable.

export const RECEIPT_AUTO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const RECEIPT_AUTO_RECHECK_MS = 30 * 60 * 1000;
export const RECEIPT_AUTO_MAX_PER_ROOT = 10;
export const RECEIPT_AUTO_PAGE_SIZE = 50;

export type ReceiptAutoDecision =
  | { action: "CHECK" }
  | { action: "EXPIRED" }
  | { action: "SKIP"; reason: string };

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function receiptAutoMillis(value: unknown): number {
  if (!value) return 0;
  const candidate = value as { toMillis?: () => number; seconds?: number };
  if (typeof candidate.toMillis === "function") return candidate.toMillis();
  if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function receiptAutoFolio(principal: Record<string, unknown>): string {
  const folio = clean(principal.iqDispersionFolio || principal.iqDispersionId);
  return /^[1-9][0-9]{0,15}$/.test(folio) ? folio : "";
}

// Only a dispersion IQ actually generated, with one unique folio and no receipt yet.
export function decideReceiptAuto(principal: Record<string, unknown>, rootId: string, nowMs: number): ReceiptAutoDecision {
  if (clean(principal.rootId) !== rootId) return { action: "SKIP", reason: "OTHER_ROOT" };
  if (principal.deleted === true || principal.isDeleted === true || principal.deletedAt != null) return { action: "SKIP", reason: "DELETED" };
  if (principal.iqExecutionHeld === true) return { action: "SKIP", reason: "HELD" };
  if (clean(principal.iqGenerationStatus).toUpperCase() !== "IQ_GENERADA") return { action: "SKIP", reason: "NOT_PROCESSED_BY_IQ" };
  if (!receiptAutoFolio(principal)) return { action: "SKIP", reason: "NO_UNIQUE_FOLIO" };
  if (clean(principal.iqReceiptStatus).toUpperCase() === "READY" || clean(principal.iqReceiptUploadId)) return { action: "SKIP", reason: "HAS_RECEIPT" };
  const auto = clean(principal.iqReceiptAutoStatus).toUpperCase();
  if (["HAS_RECEIPT", "EXPIRED", "REVIEW"].includes(auto)) return { action: "SKIP", reason: auto };
  if (receiptAutoMillis(principal.iqReceiptAutoNextCheckAt) > nowMs) return { action: "SKIP", reason: "WAITING_NEXT_CHECK" };
  const since = receiptAutoMillis(principal.iqGenerationUpdatedAt) || receiptAutoMillis(principal.createdAt);
  if (since > 0 && nowMs - since > RECEIPT_AUTO_WINDOW_MS) return { action: "EXPIRED" };
  return { action: "CHECK" };
}
