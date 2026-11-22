export const IQ_HISTORICAL_IMPORT_SOURCE = "IQ_IMPORT" as const;
/** Marker of rows recovered by the automatic daily IQ → PAY0 sync (iqDailySync). */
export const IQ_DAILY_SYNC_IMPORT_MODE = "DAILY_SYNC" as const;

const text = (value: unknown): string => String(value ?? "").trim();

export function isIqHistoricalImport(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.source === IQ_HISTORICAL_IMPORT_SOURCE &&
    text(row.importRunId).length >= 8 &&
    Number.isInteger(Number(row.importVersion)) &&
    Number(row.importVersion) >= 1 &&
    Boolean(text(row.canonicalIqProfileId)) &&
    Boolean(text(row.originalIqEntityId));
}

/** A row recovered by the daily sync: an IQ import that represents a live operation, not legacy history. */
export function isIqDailySyncImport(value: unknown): boolean {
  return isIqHistoricalImport(value) && (value as Record<string, unknown>).importMode === IQ_DAILY_SYNC_IMPORT_MODE;
}

/** A legacy P4 historical import (manual superadmin flow): every operational effect stays suppressed. */
export function isLegacyIqHistoricalImport(value: unknown): boolean {
  return isIqHistoricalImport(value) && !isIqDailySyncImport(value);
}

/**
 * Suppresses EVERY trigger for any IQ import, including daily-sync rows. Used by effects that would write
 * to IQ/Facturama or create financial records IQ is the authority for (automatic application, IQ application
 * plan, payment complements and their follow-up). IQ already holds those facts for an IQ-originated row.
 */
export function shouldSuppressIqHistoricalImport(before: unknown, after: unknown): boolean {
  return isIqHistoricalImport(after) || (!after && isIqHistoricalImport(before));
}

/**
 * Suppresses only legacy historical imports. Daily-sync rows run these effects normally. Used by local,
 * idempotent projections (materiality, Control Center, Hugo reconciliation) and by effects gated on PAY0
 * financial state the daily sync never sets (commission distribution needs a POSTED wallet posting).
 */
export function shouldSuppressLegacyIqHistoricalImport(before: unknown, after: unknown): boolean {
  return isLegacyIqHistoricalImport(after) || (!after && isLegacyIqHistoricalImport(before));
}
