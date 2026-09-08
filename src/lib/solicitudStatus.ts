export const SOLICITUD_STATUS_VALUES = [
  "PROCESANDO",
  "CONCILIACION_PENDIENTE",
  "RECHAZADA",
  "COMPLETADA",
  "CANCELADA",
  "EN_SUSTITUCION",
  "ELIMINADA",
] as const;

export type SolicitudStatus = typeof SOLICITUD_STATUS_VALUES[number];
export type SatMotivoCancelacion = "01" | "02" | "03" | "04";

const STATUS_SET = new Set<string>(SOLICITUD_STATUS_VALUES);

const LEGACY_MAP: Record<string, SolicitudStatus> = {
  "ABIERTA": "PROCESANDO",
  "ACTIVA": "PROCESANDO",
  "EN PROCESO": "PROCESANDO",
  "EN_PROCESO": "PROCESANDO",
  "PROCESO": "PROCESANDO",
  "PENDIENTE": "PROCESANDO",

  "CONCILIACION": "CONCILIACION_PENDIENTE",
  "CONCILIACION PENDIENTE": "CONCILIACION_PENDIENTE",
  "CONCILIACION_PENDIENTE": "CONCILIACION_PENDIENTE",

  "LIQUIDADA": "COMPLETADA",
  "PAGADA": "COMPLETADA",
  "PAGADO": "COMPLETADA",
  "COMPLETA": "COMPLETADA",
  "FINALIZADA": "COMPLETADA",

  "CANCELADO": "CANCELADA",
  "CANCELADA": "CANCELADA",

  "RECHAZADO": "RECHAZADA",
  "RECHAZADA": "RECHAZADA",

  "EN SUSTITUCION": "EN_SUSTITUCION",
  "EN_SUSTITUCION": "EN_SUSTITUCION",
  "SUSTITUCION": "EN_SUSTITUCION",

  "ELIMINADO": "ELIMINADA",
  "ELIMINADA": "ELIMINADA",
};

export function normalizeSolicitudStatus(input: any): SolicitudStatus {
  const raw = String(input || "").trim().toUpperCase();
  const mapped = LEGACY_MAP[raw] || raw;
  return STATUS_SET.has(mapped) ? (mapped as SolicitudStatus) : "PROCESANDO";
}

export function isTerminalSolicitudStatus(input: any): boolean {
  const status = normalizeSolicitudStatus(input);
  return ["RECHAZADA", "CANCELADA", "ELIMINADA"].includes(status);
}

export function isVisibleActiveSolicitudStatus(input: any): boolean {
  const status = normalizeSolicitudStatus(input);
  return !["RECHAZADA", "CANCELADA", "ELIMINADA"].includes(status);
}

export const SOLICITUD_STATUS_LABELS: Record<SolicitudStatus, string> = {
  PROCESANDO: "Procesando",
  CONCILIACION_PENDIENTE: "Conciliación pendiente",
  RECHAZADA: "Rechazada",
  COMPLETADA: "Completada",
  CANCELADA: "Cancelada",
  EN_SUSTITUCION: "En sustitución",
  ELIMINADA: "Eliminada",
};