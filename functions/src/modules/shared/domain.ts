export type Pay0Role = "superadmin" | "admin" | "operador";

export type HolderType = "CLIENT" | "USER";

export type BalanceMovementType =
  | "SALDO_GENERADO"
  | "COMISION_CLIENTE_COBRADA"
  | "PAGO_RECIBIDO_BRUTO"
  | "UTILIDAD_GENERADA"
  | "DISPERSION"
  | "TRASPASO_SALIDA"
  | "TRASPASO_ENTRADA"
  | "DEVOLUCION"
  | "CORRECCION_MOVIMIENTO"
  | "AJUSTE_MANUAL"
  | "ADELANTO_OTORGADO"
  | "DISPERSION_REGISTRADA"
  | "DISPERSION_REINTEGRADA"
  | "ADELANTO_LIQUIDADO"
  | "ADELANTO_CANCELADO"
  | "ADELANTO_CORREGIDO";

export type DispersionType =
  | "TRANSFERENCIA"
  | "TDC"
  | "EFECTIVO"
  | "MONEDERO"
  | "NOMINA"
  | "OTRO";

export type DepositStatus =
  | "REGISTRADO"
  | "PENDIENTE_CONCILIACION"
  | "CONCILIADO"
  | "RECHAZADO"
  | "DEVOLUCION_PENDIENTE"
  | "DEVUELTO"
  | "CANCELADO";

export type BankStatus =
  | "PENDIENTE"
  | "CONCILIADO"
  | "RECHAZADO";

export type AdvanceStatus =
  | "OTORGADO"
  | "LIQUIDADO_PARCIAL"
  | "LIQUIDADO_TOTAL"
  | "CANCELADO"
  | "CORREGIDO";

export type ReferenceType =
  | "DEPOSIT"
  | "DISPERSION"
  | "TRANSFER"
  | "RETURN"
  | "ADJUSTMENT"
  | "CORRECTION"
  | "ADVANCE";

export type SourceModule =
  | "DEPOSITS"
  | "DISPERSIONS"
  | "BALANCES"
  | "EARNINGS"
  | "FINANCING"
  | "SYSTEM";

export interface RateSnapshot {
  despachoRate: number;
  superadminFloorRate: number;
  adminFloorRate: number;
  operadorFloorRate: number;
  finalClientRate: number;
  rateType: "PERCENT" | "FIXED";
}

export interface ResultSnapshot {
  despachoCostAmount: number;
  superadminEarningAmount: number;
  adminEarningAmount: number;
  operadorEarningAmount: number;
  totalEarningsAmount: number;
  clientChargeAmount: number;
  clientNetAmount: number;
}

export interface BalanceAccountDoc {
  rootId: string;
  holderType: HolderType;
  holderId: string;
  holderRole: Pay0Role | null;
  holderName: string;
  adminId?: string | null;
  operadorId?: string | null;
  availableBalance: number;
  totalGenerated: number;
  totalSpent: number;
  totalReturned: number;
  totalAdjusted: number;
  lastMovementAt?: unknown;
  updatedAt?: unknown;
}

export interface BalanceMovementDoc {
  rootId: string;
  holderType: HolderType;
  holderId: string;
  holderRole: Pay0Role | null;
  holderName: string;
  movementType: BalanceMovementType;
  movementSubType?: string | null;
  direction: "IN" | "OUT";
  amount: number;
  beforeBalance: number;
  afterBalance: number;
  sourceModule: SourceModule;
  referenceType: ReferenceType;
  referenceId: string;
    referenceFolio?: string | null;
  folio?: string | null;
  pagoFolio?: string | null;
  solicitudFolio?: string | null;
  dispersionFolio?: string | null;
  sourceFolio?: string | null;depositId?: string | null;
  dispersionId?: string | null;
  transferId?: string | null;
  correctionOfMovementId?: string | null;
  clienteId?: string | null;
  empresaId?: string | null;
  empresaNombre?: string | null;
  beneficiaryId?: string | null;
  beneficiaryNombre?: string | null;
  methodId?: string | null;
  methodTipo?: string | null;
  destinationKind?: string | null;
  bankName?: string | null;
  operationalReference?: string | null;
  displayConcept?: string | null;
  currency?: string | null;
  actorDisplayName?: string | null;
  asociadoId?: string | null;
  adminId?: string | null;
  operadorId?: string | null;
  status: "APPLIED" | "CANCELLED" | "COMPENSATED";
  note?: string | null;
  createdBy: string;
  actorUsername: string;
  isSystemGenerated: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ClientAdvanceDoc {
  rootId: string;
  clienteId: string;
  clienteNombre: string;
  adminId?: string | null;
  operadorId?: string | null;
  empresaId?: string | null;
  empresaNombre?: string | null;
  beneficiaryId?: string | null;
  beneficiaryNombre?: string | null;
  methodId?: string | null;
  methodTipo?: string | null;
  destinationKind?: string | null;
  bankName?: string | null;
  operationalReference?: string | null;
  displayConcept?: string | null;
  currency?: string | null;
  actorDisplayName?: string | null;
  asociadoId?: string | null;
  amount: number;
  pendingAmount: number;
  status: AdvanceStatus;
  reason: string;
  note?: string | null;
  reference?: string | null;
  grantedBy: string;
  grantedUsername: string;
  approvedBy: string;
  approvedUsername: string;
  balanceMovementId?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/**
 * Adelanto != prestamo.
 * El adelanto aumenta saldo cliente y debe liquidarse automaticamente
 * con los siguientes depositos conciliados. Si se requiere interes,
 * debe ir en otro modulo distinto.
 */
