import { getSolicitudCoverageState, normalizeSolicitudBackendStatus } from "../solicitudes/domain";

type Row = Record<string, any>;
export type UnmatchedCase = "A" | "B";

/** Solicitudes read per client when classifying; a client above it is never case A. */
export const UNMATCHED_SOLICITUD_LIMIT = 300;
/**
 * Owner decision pending (2026-11-07): does an open solicitud that has no invoice
 * yet count as a pending invoice? Default yes, because a payment made before its
 * invoice exists is exactly that situation. Flip this single constant to change it.
 */
export const OPEN_SOLICITUD_WITHOUT_INVOICE_IS_PENDING = true;
/** Automatic-application review reasons that mean "no invoice was identified for this pago". */
export const UNMATCHED_REVIEW_REASONS: ReadonlySet<string> = new Set(["MISSING_INVOICE_REFERENCE", "NO_EXACT_INVOICE_REFERENCE"]);
export const UNMATCHED_DECISION_OPTIONS = ["FACTURAR_PUE", "ESPERAR_FACTURA", "APLICAR_A_FACTURA_EXISTENTE", "DEVOLVER"] as const;
export type UnmatchedDecisionOption = typeof UNMATCHED_DECISION_OPTIONS[number];

const clean = (value: unknown) => String(value ?? "").trim();
const CLOSED_STATUSES = new Set(["RECHAZADA", "CANCELADA", "ELIMINADA", "COMPLETADA"]);

export function countsAsPendingInvoice(solicitud: Row): boolean {
  if (CLOSED_STATUSES.has(normalizeSolicitudBackendStatus(solicitud.status))) return false;
  if (getSolicitudCoverageState(solicitud).pending <= 0) return false;
  return !!clean(solicitud.facturaUuid || solicitud.uuidCfdi) || OPEN_SOLICITUD_WITHOUT_INVOICE_IS_PENDING;
}

/**
 * A: no pending invoice for the client at all (PAGO_SIN_SOLICITUD).
 * B: the client has pending invoices but this pago matches none of them.
 * Returns null when the review reason is not an "unidentified invoice" one.
 */
export function classifyUnmatchedPayment(input: { pago: Row; reason: string; solicitudes: Row[]; limitReached: boolean }): { case: UnmatchedCase | null; pendingCount: number } {
  const { pago, reason, solicitudes, limitReached } = input;
  if (!UNMATCHED_REVIEW_REASONS.has(reason)) return { case: null, pendingCount: 0 };
  const pendingCount = solicitudes.filter(row => clean(row.rootId) === clean(pago.rootId) && clean(row.clienteId) === clean(pago.clienteId) &&
    clean(row.companyId || row.empresaId) === clean(pago.companyId) && countsAsPendingInvoice(row)).length;
  // Not every solicitud of the client was read, so "no pending invoice" cannot be proven.
  return { case: limitReached || pendingCount > 0 ? "B" : "A", pendingCount };
}
