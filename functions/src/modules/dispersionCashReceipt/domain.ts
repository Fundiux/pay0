// Recibo firmado de dispersiones en EFECTIVO.
// Una dispersion en efectivo solo se considera terminada cuando existe la firma
// de quien recibe el dinero. El monto nunca viene del navegador: se toma de la
// dispersion en el servidor al momento de firmar.

export const CASH_RECEIPT_VERSION = "PAY0-RECIBO-EFECTIVO-2026-11-05.v1";
export const CASH_RECEIPT_DOCUMENT_TYPE = "FIRMA_RECEPCION_EFECTIVO";
export const CASH_RECEIPT_DOCUMENT_LABEL = "Firma de recepcion de efectivo";
export const CASH_RECEIPT_LINK_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export const CASH_RECEIPT_STATUS = {
  PENDING: "PENDIENTE_FIRMA",
  SIGNED: "FIRMADA",
  /** Cash dispersions created before the feature: no receipt was ever required. */
  LEGACY: "SIN_FIRMA_ANTERIOR",
} as const;

export const CASH_RECEIPT_REPLACEMENT_REASON_MIN = 5;

export type CashReceiptStatus = typeof CASH_RECEIPT_STATUS[keyof typeof CASH_RECEIPT_STATUS];

const TERMINAL_DISPERSION_STATUSES = new Set([
  "CANCELADA", "CANCELADO", "CANCELACION_APLICADA",
  "DEVUELTA", "DEVOLUCION_APLICADA",
  "RECHAZADA", "RECHAZADO",
  "REINTEGRADA", "REINTEGRADO", "RESERVA_LIBERADA",
  "ELIMINADA", "ELIMINADO", "DELETED",
]);

export function cleanText(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function upperText(value: unknown): string {
  return cleanText(value).toUpperCase();
}

export function toMoney(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function formatMoney(value: unknown): string {
  return "$" + toMoney(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function normalizePersonName(value: unknown): string {
  return cleanText(value, 180)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** True when the dispersion pays out cash (operation type, method or destination say EFECTIVO). */
export function isCashDispersion(row: any): boolean {
  return [row?.operationTypeKey, row?.methodTipo, row?.destinationKind, row?.tipo, row?.dispersionType]
    .some((value) => upperText(value) === "EFECTIVO");
}

export function isTerminalDispersionStatus(status: unknown): boolean {
  return TERMINAL_DISPERSION_STATUSES.has(upperText(status));
}

/** Status stamped at creation; null for non-cash dispersions so the field stays absent of meaning. */
export function initialCashReceiptStatus(operationTypeKey: unknown): CashReceiptStatus | null {
  return upperText(operationTypeKey) === "EFECTIVO" ? CASH_RECEIPT_STATUS.PENDING : null;
}

/**
 * Derived receipt status. A stored FIRMADA always wins; PENDIENTE_FIRMA is only
 * stamped at creation from the deploy onwards, so cash dispersions without the
 * field predate the feature and are exempt (SIN_FIRMA_ANTERIOR), not pending.
 */
export function cashReceiptStatusOf(row: any): CashReceiptStatus | null {
  if (!isCashDispersion(row)) return null;
  // Commission withdrawals paid to a user never carry a client receipt.
  if (row?.fundingSource?.holderType === "USER") return null;
  const stored = upperText(row?.cashReceiptStatus || row?.cashReceipt?.status);
  if (stored === CASH_RECEIPT_STATUS.SIGNED) return CASH_RECEIPT_STATUS.SIGNED;
  if (stored === CASH_RECEIPT_STATUS.PENDING) return CASH_RECEIPT_STATUS.PENDING;
  return CASH_RECEIPT_STATUS.LEGACY;
}

export function isCashReceiptSigned(row: any): boolean {
  return cashReceiptStatusOf(row) === CASH_RECEIPT_STATUS.SIGNED;
}

export function isCashReceiptPending(row: any): boolean {
  return cashReceiptStatusOf(row) === CASH_RECEIPT_STATUS.PENDING;
}

/**
 * A dispersion counts as finished (terminada / conciliada) only when it is not
 * cash, or when its cash receipt is not pending (signed, or exempt because it
 * predates the receipt). Terminal statuses (cancelled, returned) are not
 * "finished deliveries" either.
 */
export function isDispersionDeliveryComplete(row: any): boolean {
  if (isTerminalDispersionStatus(row?.status)) return false;
  if (!isCashDispersion(row)) return true;
  return !isCashReceiptPending(row);
}

/** Status text shown in lists and exports next to the dispersion status. */
export function cashReceiptStatusLabel(status: CashReceiptStatus | null): string {
  if (status === CASH_RECEIPT_STATUS.SIGNED) return "Firmada";
  if (status === CASH_RECEIPT_STATUS.PENDING) return "Pendiente de firma";
  if (status === CASH_RECEIPT_STATUS.LEGACY) return "Sin firma (anterior)";
  return "";
}

export function validateReplacementReason(value: unknown): string {
  const reason = cleanText(value, 300);
  if (reason.length < CASH_RECEIPT_REPLACEMENT_REASON_MIN) throw new Error("REPLACEMENT_REASON_REQUIRED");
  return reason;
}

export function expectedReceiverName(row: any): string {
  return cleanText(row?.beneficiaryNombre || row?.beneficiaryName || row?.beneficiario, 180);
}

export function receiverNamesMatch(expected: unknown, signer: unknown): boolean {
  const a = normalizePersonName(expected);
  const b = normalizePersonName(signer);
  if (!a || !b) return false;
  if (a === b) return true;
  const tokensA = new Set(a.split(" ").filter((t) => t.length > 1));
  const tokensB = b.split(" ").filter((t) => t.length > 1);
  if (tokensA.size === 0 || tokensB.length === 0) return false;
  const shared = tokensB.filter((t) => tokensA.has(t)).length;
  // Same person written with fewer surnames still matches; a different person does not.
  return shared >= 2 && shared >= Math.min(tokensA.size, tokensB.length);
}

export function cashReceiptAcceptanceText(input: { amount: unknown; currency?: unknown; folio?: unknown }): string {
  const currency = upperText(input.currency) || "MXN";
  const folio = cleanText(input.folio, 80);
  return `Recibi la cantidad de ${formatMoney(input.amount)} ${currency} en efectivo` +
    (folio ? ` correspondiente a la dispersion ${folio}` : "") +
    ", completa y a mi entera satisfaccion.";
}

export function validateSignerName(value: unknown): string {
  const name = cleanText(value, 180);
  if (name.length < 3) throw new Error("SIGNER_NAME_REQUIRED");
  if (!/[A-Za-zÀ-ɏ]{2,}/.test(name)) throw new Error("SIGNER_NAME_INVALID");
  return name;
}
