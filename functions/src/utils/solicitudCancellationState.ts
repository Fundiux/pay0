const upper = (value: unknown) => String(value ?? "").trim().toUpperCase();

// While a cancellation is open, or closed but under review, no payment can be applied.
export function hasOpenCancellation(solicitud: Record<string, any>): boolean {
  return ["REQUESTED", "OUTCOME_UNKNOWN", "CONFIRMED_REVIEW_REQUIRED"].includes(upper(solicitud.iqCancellationStatus)) ||
    ["REQUESTED", "PENDING"].includes(upper(solicitud.facturamaCancellationStatus)) ||
    solicitud.facturamaCancellationReviewRequired === true;
}

// A provider can confirm a cancellation after payments were applied. Only a SAT 01
// substitution keeps them valid, so anything else needs a person to decide.
export function cancellationNeedsPaymentReview(solicitud: Record<string, any>, appliedPayments: number): boolean {
  return (Number(solicitud.totalAbonado || 0) > 0 || appliedPayments > 0) && String(solicitud.motivoCancelacionSAT ?? "").trim() !== "01";
}
