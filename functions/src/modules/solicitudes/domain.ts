import {
  canCancelSolicitudBackendStatus,
  canRejectSolicitudBackendStatus,
  canTransitionSolicitudBackendStatus,
  isSolicitudBackendTerminalStatus,
  normalizeSatCancelCode,
  normalizeSolicitudBackendStatus,
  type SatCancelCode,
  type SolicitudBackendStatus,
} from "../../utils/solicitudStatusMachine";

export {
  canCancelSolicitudBackendStatus,
  canRejectSolicitudBackendStatus,
  canTransitionSolicitudBackendStatus,
  isSolicitudBackendTerminalStatus,
  normalizeSatCancelCode,
  normalizeSolicitudBackendStatus,
};
export type { SatCancelCode, SolicitudBackendStatus };

export type SolicitudCoverageState = { total: number; applied: number; pending: number; };
export type SolicitudApplicationState = SolicitudCoverageState & { previousPending: number; status: SolicitudBackendStatus; };

function money2(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

export function getSolicitudCoverageState(input: Record<string, any> | null | undefined): SolicitudCoverageState {
  const total = money2(input?.monto);
  const applied = money2(input?.totalAbonado);
  return { total, applied, pending: money2(Math.max(0, total - applied)) };
}

export function applySolicitudCoverageAmount(input: Record<string, any> | null | undefined, amount: unknown): SolicitudApplicationState {
  const current = getSolicitudCoverageState(input);
  const applied = money2(current.applied + money2(amount));
  const pending = money2(Math.max(0, current.total - applied));
  const currentStatus = normalizeSolicitudBackendStatus(input?.status);
  return { total: current.total, applied, pending, previousPending: current.pending, status: pending === 0 ? "COMPLETADA" : currentStatus };
}
