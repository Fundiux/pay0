import type { SatCancelCode, SolicitudBackendStatus } from "./solicitudStatusMachine";

export function canCancelSolicitudWithAbonos(totalAbonadoActual: any, satCode: SatCancelCode | null): boolean {
  return !(Number(totalAbonadoActual || 0) > 0 && satCode !== "01");
}

export function needsUuidOrRelatedForSatCancel01(
  satCode: SatCancelCode | null,
  uuidCfdiSustituto: any,
  relatedSolicitud: any
): boolean {
  return satCode === "01" && !String(uuidCfdiSustituto || "").trim() && !relatedSolicitud;
}

export function needsUuidOrRelatedForEnSustitucion(
  uuidCfdiSustituto: any,
  relatedSolicitud: any
): boolean {
  return !String(uuidCfdiSustituto || "").trim() && !relatedSolicitud;
}

export function getSolicitudStatusEventMeta(
  currentStatus: SolicitudBackendStatus,
  nextStatus: SolicitudBackendStatus,
  solicitudRef: string
) {
  if (nextStatus === "CONCILIACION_PENDIENTE") {
    return {
      event: "SOLICITUD_EN_CONCILIACION",
      description: `Solicitud enviada a conciliacion ${solicitudRef}`,
    };
  }

  if (nextStatus === "COMPLETADA") {
    return {
      event: "SOLICITUD_COMPLETADA",
      description: `Solicitud completada ${solicitudRef}`,
    };
  }

  if (nextStatus === "ELIMINADA") {
    return {
      event: "SOLICITUD_ELIMINADA",
      description: `Solicitud eliminada ${solicitudRef}`,
    };
  }

  return {
    event: "SOLICITUD_STATUS_ACTUALIZADO",
    description: `Solicitud ${solicitudRef} cambio de ${currentStatus} a ${nextStatus}`,
  };
}

export function getSolicitudRechazadaEventMeta(
  solicitudRef: string,
  motivoRechazo?: any
) {
  return {
    event: "SOLICITUD_RECHAZADA",
    description: `Solicitud rechazada ${solicitudRef}${motivoRechazo ? ` | Motivo: ${motivoRechazo}` : ""}`,
  };
}