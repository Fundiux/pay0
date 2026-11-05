import { isConfirmedFacturamaCancellation } from "./cancellationStatus";

export const PENDING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const upper = (value: unknown) => String(value ?? "").trim().toUpperCase();
const millis = (value: any) => value?.toMillis?.() ?? 0;

// Server rule for a Facturama cancellation. The screen repeats part of it, but
// this is the check that protects an invoice with payments from a direct call.
export function facturamaCancellationBlock(input: {
  solicitud: Record<string, any>;
  invoice: Record<string, any>;
  motive: string;
  appliedPayments: number;
  now?: number;
}): string | null {
  const { solicitud, invoice, motive, appliedPayments } = input;
  if (["CANCELADA", "CANCELADO"].includes(upper(solicitud.status)) || isConfirmedFacturamaCancellation(invoice.cancellationStatus))
    return "La factura ya está cancelada.";
  if ((Number(solicitud.totalAbonado || 0) > 0 || appliedPayments > 0) && motive !== "01")
    return "La solicitud con abonos solo puede cancelarse por sustitución (SAT 01).";
  const requestedAt = millis(invoice.cancellationRequestedAt);
  const failed = upper(invoice.cancellationStatus) === "REQUEST_FAILED";
  if (requestedAt && !failed && (input.now ?? Date.now()) - requestedAt < PENDING_WINDOW_MS)
    return "Ya hay una cancelación en curso; PAY0 está dando seguimiento a su respuesta.";
  return null;
}
