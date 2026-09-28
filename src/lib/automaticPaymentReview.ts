const reasons: Record<string, string> = {
  MISSING_INVOICE_REFERENCE: "Falta la referencia exacta de la factura.",
  NO_EXACT_INVOICE_REFERENCE: "La referencia no identifica una factura de este cliente y empresa.",
  CANDIDATE_LIMIT: "Hay demasiadas facturas para decidir automáticamente.",
  MISSING_CURRENCY: "Falta confirmar la moneda del pago.",
  CURRENCY_MISMATCH: "La moneda de la factura no coincide con el pago.",
  INVOICE_NOT_PAYABLE: "La factura está cerrada, cancelada o sin saldo pendiente.",
  DUPLICATE_INVOICE_IDENTITY: "Varias solicitudes contienen la misma identidad fiscal.",
  MULTIPLE_INVOICES_REQUIRE_ALLOCATION: "El importe requiere definir cómo repartirlo entre las facturas.",
  AMOUNT_EXCEEDS_INVOICE: "El importe supera el saldo de la factura identificada.",
  APPLICATION_PERMISSION_DENIED: "Los permisos del usuario de origen requieren revisión.",
  APPLICATION_UNAUTHENTICATED: "El usuario de origen requiere revisión.",
  APPLICATION_FAILED_PRECONDITION: "El pago o la factura cambió y requiere revisión.",
  APPLICATION_NOT_FOUND: "El pago o la factura ya no está disponible.",
  APPLICATION_INVALID_ARGUMENT: "La aplicación propuesta requiere revisión.",
  APPLICATION_ALREADY_EXISTS: "Hay una aplicación previa que debe revisarse.",
};
export function automaticPaymentReviewMessage(state: { status?: string; reason?: string } | undefined): string {
  if (state?.status !== "REQUIRES_REVIEW") return "";
  return reasons[state.reason || ""] || "La aplicación automática requiere revisión manual.";
}
