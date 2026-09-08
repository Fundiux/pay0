import { money2 } from "../shared/money";

export function getPagoCoverageState(data: any) {
  const total = money2(data?.montoTotal || 0);
  const applied = money2(
    data?.montoAplicadoSolicitudes ??
    data?.montoAplicado ??
    0
  );
  const available = money2(
    data?.montoDisponibleSolicitudes ??
    data?.montoDisponible ??
    Math.max(0, total - applied)
  );

  return {
    total,
    applied,
    available,
  };
}

export function buildPagoFoundationOnCreate(montoTotal: number) {
  const total = money2(montoTotal);

  return {
    montoAplicado: 0,
    montoDisponible: 0,
    montoAplicadoSolicitudes: 0,
    montoDisponibleSolicitudes: 0,
    walletClientAmount: 0,
    totalComisionCliente: 0,
    retornoCliente: 0,
    despachoAmount: 0,
    superadminAmount: 0,
    adminAmount: 0,
    operadorAmount: 0,
    financialSnapshotId: null,
    financialPostingStatus: "PENDING",
    walletPostingStatus: "PENDING",
    coverageVersion: 1,
    walletVersion: 1,
    statementVersion: 1,
    roundingVersion: "money2_v1",
    montoTotalCanonico: total,
  };
}

export function buildPagoFoundationOnConciliation(data: any) {
  const state = getPagoCoverageState(data);
  const available = money2(Math.max(0, state.total - state.applied));

  return {
    montoAplicado: state.applied,
    montoDisponible: available,
    montoAplicadoSolicitudes: state.applied,
    montoDisponibleSolicitudes: available,
    coverageVersion: 1,
    walletVersion: 1,
    statementVersion: 1,
    roundingVersion: "money2_v1",
  };
}

export function buildPagoCoverageApplyPatch(data: any, montoAplicadoStep: number) {
  const state = getPagoCoverageState(data);
  const nextApplied = money2(state.applied + money2(montoAplicadoStep));
  const nextAvailable = money2(Math.max(0, state.total - nextApplied));

  return {
    montoAplicado: nextApplied,
    montoDisponible: nextAvailable,
    montoAplicadoSolicitudes: nextApplied,
    montoDisponibleSolicitudes: nextAvailable,
  };
}
