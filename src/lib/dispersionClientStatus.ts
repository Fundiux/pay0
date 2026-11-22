// Client-facing progress of a dispersion. It never names the external system: everyone but a
// superadmin sees only EN PROCESO, PROCESANDO, GENERADA, COMPLETADA or RECHAZADA.

export type DispersionProgressRow = {
  status?: unknown;
  incidentStatus?: unknown;
  reservationStatus?: unknown;
  reservationReleased?: unknown;
  iqGenerationStatus?: unknown;
  iqReceiptStatus?: unknown;
  iqReceiptUploadId?: unknown;
  forwardOnlyVersion?: unknown;
  fundingSource?: { holderType?: unknown } | null;
};

export type DispersionProgress = "EN PROCESO" | "PROCESANDO" | "GENERADA" | "COMPLETADA" | "RECHAZADA";

const upper = (value: unknown) => String(value ?? "").trim().toUpperCase();
const REJECTED = new Set(["RECHAZADA", "RECHAZADO"]);

/** Only dispersions that go through the automatic generation carry a progress; withdrawals of the user's own funds do not. */
export function dispersionUsesAutomaticGeneration(row: DispersionProgressRow): boolean {
  return upper(row.fundingSource?.holderType) !== "USER" && Boolean(String(row.forwardOnlyVersion ?? "").trim());
}

export function dispersionProgress(row: DispersionProgressRow): DispersionProgress | null {
  if (!dispersionUsesAutomaticGeneration(row)) return null;
  if ([row.status, row.incidentStatus, row.reservationStatus].some((value) => REJECTED.has(upper(value)))) return "RECHAZADA";
  if (upper(row.iqReceiptStatus) === "READY" || String(row.iqReceiptUploadId ?? "").trim()) return "COMPLETADA";
  const generation = upper(row.iqGenerationStatus);
  if (generation === "IQ_GENERADA") return "GENERADA";
  // Review, partial or safe-error results are worked by the system and Hugo as an incident; the user only sees progress.
  if (["IQ_PARCIAL", "IQ_REQUIERE_REVISION", "IQ_ERROR_SEGURO"].includes(generation)) return "PROCESANDO";
  return "EN PROCESO";
}
