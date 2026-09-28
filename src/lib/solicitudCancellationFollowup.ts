type SolicitudCancellationRecord = {
  id?: unknown;
  companyId?: unknown;
  facturaUuid?: unknown;
  uuidCfdi?: unknown;
  facturaTotal?: unknown;
  monto?: unknown;
  facturamaInvoiceId?: unknown;
  facturamaEnvironment?: unknown;
  facturamaAutoDraftStatus?: unknown;
  facturamaCancellationStatus?: unknown;
  sustitucionStatus?: unknown;
  status?: unknown;
  cancellationReceiptUploadId?: unknown;
};

const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();

// This only schedules a status read. The callable remains responsible for
// authorization and the authoritative invoice/RFC metadata checks.
export function canAutomaticallyRefreshCancellation(
  solicitud: SolicitudCancellationRecord,
  isSuperadmin: boolean,
): boolean {
  if (!isSuperadmin || !text(solicitud.id) || !text(solicitud.facturamaInvoiceId)) return false;

  const environment = upper(solicitud.facturamaEnvironment);
  const issuedStatus = upper(solicitud.facturamaAutoDraftStatus);
  if (environment ? environment !== "PRODUCTION" : issuedStatus !== "PRODUCTION_ISSUED") return false;
  if (issuedStatus && !["PRODUCTION_ISSUED", "EMITTED"].includes(issuedStatus)) return false;

  const uuid = text(solicitud.facturaUuid || solicitud.uuidCfdi);
  const total = Number(solicitud.facturaTotal || solicitud.monto);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid) ||
      !text(solicitud.companyId) || !Number.isFinite(total) || total <= 0) return false;

  const cancellationStatus = upper(solicitud.facturamaCancellationStatus);
  const cancellationRequested = ["PENDING", "REQUESTED"].includes(cancellationStatus) ||
    upper(solicitud.sustitucionStatus) === "CANCELACION_SOLICITADA";
  const needsReceipt = ["CANCELADA", "CANCELADO"].includes(upper(solicitud.status)) &&
    ["CANCELADO", "CANCELED", "ACEPTED", "ACCEPTED", "EXPIRED"].includes(cancellationStatus) &&
    !text(solicitud.cancellationReceiptUploadId);

  // Missing display metadata or a replacement still being prepared does not
  // mean that a cancellation has been requested. Metadata recovery is separate.
  return cancellationRequested || needsReceipt;
}
