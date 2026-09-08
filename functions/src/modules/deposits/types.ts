import type { DepositStatus, BankStatus, RateSnapshot, ResultSnapshot } from "../shared/domain";

export interface DepositDoc {
  rootId: string;
  clienteId: string;
  clienteNombre?: string | null;
  adminId?: string | null;
  operadorId?: string | null;
  operationTypeKey: string;
  saleTypeKey: string;
  currency?: string | null;
  grossAmount: number;
  baseAmount?: number | null;
  calculationBaseType?: "TOTAL" | "SUBTOTAL" | "CUSTOM" | null;
  rateSnapshot?: RateSnapshot | null;
  resultSnapshot?: ResultSnapshot | null;
  status: DepositStatus;
  bankStatus: BankStatus;
  companyIds?: string[] | null;
  empresaPrincipalId?: string | null;
  asociadoId?: string | null;
  bankReference?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  conciliatedAt?: unknown;
}
