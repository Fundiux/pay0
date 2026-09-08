import { normalizeSolicitudStatus } from "@/lib/solicitudStatus";

export type SolicitudActionLike = {
  status?: string;
  monto?: number;
  totalAbonado?: number;
  oculto?: boolean;
  relatedSolicitudId?: string;
  relatedSolicitudFolio?: string;
  uuidCfdiSustituto?: string;
};

function money2(v: any): number {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}

export function getSolicitudSaldo(sol: SolicitudActionLike | null | undefined): number {
  return money2(Math.max(0, money2(sol?.monto || 0) - money2(sol?.totalAbonado || 0)));
}

export function isSolicitudHidden(sol: SolicitudActionLike | null | undefined): boolean {
  return !!sol?.oculto;
}

export function isSolicitudTerminalForOps(sol: SolicitudActionLike | null | undefined): boolean {
  const status = normalizeSolicitudStatus(sol?.status);
  return isSolicitudHidden(sol) || ["RECHAZADA", "CANCELADA", "ELIMINADA", "EN_SUSTITUCION"].includes(status);
}

export function canApplyPagoFromPagos(sol: SolicitudActionLike | null | undefined): boolean {
  return !isSolicitudTerminalForOps(sol) && getSolicitudSaldo(sol) > 0;
}

export function canRejectSolicitudUI(sol: SolicitudActionLike | null | undefined): boolean {
  const status = normalizeSolicitudStatus(sol?.status);

  if (isSolicitudHidden(sol)) return false;
  if (["RECHAZADA", "CANCELADA", "ELIMINADA", "EN_SUSTITUCION"].includes(status)) return false;
  if (status === "COMPLETADA") return false;
  if (money2(sol?.totalAbonado || 0) > 0) return false;

  return true;
}

export function needsCompletarSustitucion(sol: SolicitudActionLike | null | undefined): boolean {
  const status = normalizeSolicitudStatus(sol?.status);
  if (status !== "EN_SUSTITUCION") return false;

  const hasRelacion = String(sol?.relatedSolicitudFolio || sol?.relatedSolicitudId || "").trim() !== "";
  const hasUuid = String(sol?.uuidCfdiSustituto || "").trim() !== "";

  return !(hasRelacion && hasUuid);
}

export function canShowCancelSatAction(sol: SolicitudActionLike | null | undefined): boolean {
  const status = normalizeSolicitudStatus(sol?.status);

  if (isSolicitudHidden(sol)) return false;
  if (["RECHAZADA", "CANCELADA", "ELIMINADA"].includes(status)) return false;

  return true;
}

export function getDefaultCancelSatMotivo(sol: SolicitudActionLike | null | undefined): "01" | "02" | "03" | "04" {
  const status = normalizeSolicitudStatus(sol?.status);

  if (status === "EN_SUSTITUCION") return "01";
  if (money2(sol?.totalAbonado || 0) > 0) return "01";

  return "02";
}