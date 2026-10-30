export const IQ_HISTORICAL_IMPORT_SOURCE = "IQ_IMPORT" as const;

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

export function shouldSuppressIqHistoricalImport(before: unknown, after: unknown): boolean {
  return isIqHistoricalImport(after) || (!after && isIqHistoricalImport(before));
}
