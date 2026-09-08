import type { DispersionType, HolderType, Pay0Role } from "../shared/domain";

export interface DispersionDoc {
  rootId: string;
  holderType: HolderType;
  holderId: string;
  holderRole: Pay0Role | null;
  holderName: string;
  dispersionType: DispersionType;
  customTypeLabel?: string | null;
  amount: number;
  status: "REGISTRADA" | "APLICADA" | "CANCELADA" | "DEVUELTA";
  destinationData?: Record<string, unknown> | null;
  reference?: string | null;
  note?: string | null;
  clienteId?: string | null;
  empresaId?: string | null;
  asociadoId?: string | null;
  adminId?: string | null;
  operadorId?: string | null;
  balanceMovementId?: string | null;
  createdBy: string;
  actorUsername: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}
