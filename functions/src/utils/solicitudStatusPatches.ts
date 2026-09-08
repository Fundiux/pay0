import type { SatCancelCode } from "./solicitudStatusMachine";

export function buildSolicitudCanceladaPatch(input: {
  uid: string;
  motivo?: any;
  motivoCancelacionDetalle?: any;
  satCode: SatCancelCode | null;
  uuidCfdiSustituto?: any;
  relatedSolicitud?: { id?: string | null; folio?: string | null } | null;
  serverTimestamp: any;
}) {
  const {
    uid,
    motivo,
    motivoCancelacionDetalle,
    satCode,
    uuidCfdiSustituto,
    relatedSolicitud,
    serverTimestamp,
  } = input;

  const patch: any = {
    cancelReason: motivo ? String(motivo) : null,
    motivoCancelacionSAT: satCode,
    motivoCancelacionDetalle: motivoCancelacionDetalle ? String(motivoCancelacionDetalle) : null,
    cancelledBy: uid,
    cancelledAt: serverTimestamp,
  };

  if (satCode === "01") {
    patch.sustitucionStatus = "CANCELADA_POR_SUSTITUCION";
    patch.relatedSolicitudId = relatedSolicitud?.id || null;
    patch.relatedSolicitudFolio = relatedSolicitud?.folio || null;
    patch.uuidCfdiSustituto = uuidCfdiSustituto ? String(uuidCfdiSustituto) : null;
  }

  return patch;
}

export function buildSolicitudEnSustitucionPatch(input: {
  satCode: SatCancelCode | null;
  uuidCfdiSustituido?: any;
  uuidCfdiSustituto?: any;
  relatedSolicitud?: { id?: string | null; folio?: string | null } | null;
  serverTimestamp: any;
}) {
  const { satCode, uuidCfdiSustituido, uuidCfdiSustituto, relatedSolicitud, serverTimestamp } = input;

  return {
    motivoCancelacionSAT: satCode || "01",
    sustitucionStatus: "EN_PROCESO",
    sustitucionAt: serverTimestamp,
    relatedSolicitudId: relatedSolicitud?.id || null,
    relatedSolicitudFolio: relatedSolicitud?.folio || null,
    uuidCfdiSustituido: uuidCfdiSustituido ? String(uuidCfdiSustituido) : null,
    uuidCfdiSustituto: uuidCfdiSustituto ? String(uuidCfdiSustituto) : null,
  };
}

export function getSolicitudCanceladaEventMeta(
  solicitudRef: string,
  satCode: SatCancelCode | null,
  motivo?: any
) {
  return {
    event: "SOLICITUD_CANCELADA",
    description: `Solicitud cancelada ${solicitudRef}${satCode ? ` | SAT ${satCode}` : ""}${motivo ? ` | Motivo: ${motivo}` : ""}`,
  };
}

export function getSolicitudEnSustitucionEventMeta(solicitudRef: string) {
  return {
    event: "SOLICITUD_EN_SUSTITUCION",
    description: `Solicitud en sustitucion ${solicitudRef}`,
  };
}
