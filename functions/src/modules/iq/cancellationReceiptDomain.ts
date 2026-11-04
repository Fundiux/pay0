function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export type IqCancellationReceiptAction = "SKIP" | "NOT_APPLICABLE" | "LOOKUP";

export function solicitudHadInvoice(solicitud: Record<string, unknown>): boolean {
  return !!(clean(solicitud.facturaUuid) || clean(solicitud.uuidCfdi) || clean(solicitud.iqInvoiceUuid)) ||
    clean(solicitud.iqInvoiceImportStatus).toUpperCase() === "IMPORTED";
}

// A solicitud cancelled before its invoice existed never has an acuse. This is
// recalculated on each run because the invoice can be imported after the cancellation.
export function iqCancellationReceiptAction(solicitud: Record<string, unknown>): IqCancellationReceiptAction {
  if (solicitud.isDeleted === true || clean(solicitud.iqCancellationReceiptStatus) === "READY") return "SKIP";
  if (!clean(solicitud.rootId) || !clean(solicitud.iqFolio ?? solicitud.iqId) || clean(solicitud.facturamaInvoiceId)) return "SKIP";
  return solicitudHadInvoice(solicitud) ? "LOOKUP" : "NOT_APPLICABLE";
}
