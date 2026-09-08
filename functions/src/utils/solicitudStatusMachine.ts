export type SolicitudBackendStatus =
  | "PROCESANDO"
  | "CONCILIACION_PENDIENTE"
  | "RECHAZADA"
  | "COMPLETADA"
  | "CANCELADA"
  | "EN_SUSTITUCION"
  | "ELIMINADA";

export type SatCancelCode = "01" | "02" | "03" | "04";

const STATUS_MAP: Record<string, SolicitudBackendStatus> = {
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

const ALLOWED_STATUS = new Set<SolicitudBackendStatus>([
  "PROCESANDO",
  "CONCILIACION_PENDIENTE",
  "RECHAZADA",
  "COMPLETADA",
  "CANCELADA",
  "EN_SUSTITUCION",
  "ELIMINADA",
]);

const TRANSITIONS: Record<SolicitudBackendStatus, SolicitudBackendStatus[]> = {
  PROCESANDO: ["PROCESANDO", "CONCILIACION_PENDIENTE", "RECHAZADA", "CANCELADA", "ELIMINADA", "COMPLETADA", "EN_SUSTITUCION"],
  CONCILIACION_PENDIENTE: ["CONCILIACION_PENDIENTE", "PROCESANDO", "RECHAZADA", "CANCELADA", "ELIMINADA", "COMPLETADA", "EN_SUSTITUCION"],
  COMPLETADA: ["COMPLETADA", "EN_SUSTITUCION", "CANCELADA"],
  EN_SUSTITUCION: ["EN_SUSTITUCION", "CANCELADA"],
  RECHAZADA: ["RECHAZADA"],
  CANCELADA: ["CANCELADA"],
  ELIMINADA: ["ELIMINADA"],
};

export function normalizeSolicitudBackendStatus(input: any): SolicitudBackendStatus {
  const raw = String(input || "").trim().toUpperCase();
  const normalized = STATUS_MAP[raw] || (raw as SolicitudBackendStatus);
  return ALLOWED_STATUS.has(normalized) ? normalized : "PROCESANDO";
}

export function canTransitionSolicitudBackendStatus(
  currentStatus: SolicitudBackendStatus,
  nextStatus: SolicitudBackendStatus
): boolean {
  return !!TRANSITIONS[currentStatus]?.includes(nextStatus);
}

export function normalizeSatCancelCode(input: any): SatCancelCode | null {
  const raw = String(input || "").trim();
  return ["01", "02", "03", "04"].includes(raw) ? (raw as SatCancelCode) : null;
}

export function isSolicitudBackendTerminalStatus(status: SolicitudBackendStatus): boolean {
  return ["RECHAZADA", "CANCELADA", "ELIMINADA"].includes(status);
}

export function canRejectSolicitudBackendStatus(status: SolicitudBackendStatus): boolean {
  if (isSolicitudBackendTerminalStatus(status)) return false;
  if (["COMPLETADA", "EN_SUSTITUCION"].includes(status)) return false;
  return true;
}

export function canCancelSolicitudBackendStatus(status: SolicitudBackendStatus): boolean {
  return !isSolicitudBackendTerminalStatus(status);
}