export type LedgerHolderType = "CLIENT" | "USER";
export type LedgerDirection = "IN" | "OUT" | "";

export interface LedgerBalanceSummary {
  holderType: LedgerHolderType;
  holderId: string;
  holderName: string;
  holderRole: string | null;
  rootId: string | null;
  adminId: string | null;
  operadorId: string | null;
  availableBalance: number;
  pendingAdvance: number;
  netBalance: number;
  totalGenerated: number;
  totalSpent: number;
  totalReturned: number;
  totalAdjusted: number;
  lastMovementAtMillis: number | null;
  updatedAtMillis: number | null;
}

export interface LedgerStatementRow {
  id: string;
  holderType: LedgerHolderType;
  holderId: string;
  movementType: string;
  movementSubType: string | null;
  direction: LedgerDirection;
  amount: number;
  beforeBalance: number;
  afterBalance: number;
  sourceModule: string;
  referenceType: string;
  referenceId: string;
  referenceFolio: string | null;
  folio: string | null;
  pagoFolio: string | null;
  solicitudFolio: string | null;
  dispersionFolio: string | null;
  sourceFolio: string | null;
  pagoId: string | null;
  solicitudId: string | null;
  dispersionId: string | null;
  clienteId: string | null;
  empresaId: string | null;
  empresaNombre: string | null;
  note: string | null;
  createdBy: string | null;
  actorUsername: string | null;
  isSystemGenerated: boolean;
  createdAtMillis: number | null;
}

export interface LedgerStatementResult {
  ok: boolean;
  summary: LedgerBalanceSummary;
  rows: LedgerStatementRow[];
}