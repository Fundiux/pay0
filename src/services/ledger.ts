import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export interface OperationalDispatchBalanceRow {
  id: string;
  despachoId: string;
  despachoName?: string | null;
  channel?: string | null;
  currency: string;
  availableBalance: number;
  executableBalance: number;
  reservedBalance: number;
  status: string;
}

export interface LedgerBalanceSummary {
  holderType: "CLIENT" | "USER";
  holderId: string;
  availableBalance: number;
  pendingAdvance: number;
  netBalance: number;
  lastMovementAtMillis?: number | null;
  updatedAtMillis?: number | null;
  dispatchBalances?: OperationalDispatchBalanceRow[];
}
export async function readClientOperationalBalanceSummary(clienteId: string) {
  const cleanClienteId = String(clienteId || "").trim();

  if (!cleanClienteId) {
    return null;
  }

  const callable = httpsCallable<
    { clienteId: string },
    { ok: boolean; summary: LedgerBalanceSummary | null }
  >(functions, "getClientOperationalBalanceSummary");

  const result = await callable({ clienteId: cleanClienteId });
  return result.data?.summary || null;
}

export interface LedgerMovementRow {
  id: string;
  holderType?: string;
  holderId?: string;
  holderName?: string | null;
  holderRole?: string | null;
  movementType?: string;
  movementSubType?: string | null;
  direction?: "IN" | "OUT" | string;
  amount?: number;
  note?: string | null;
  clienteId?: string | null;
  empresaId?: string | null;
  empresaNombre?: string | null;
  referenceId?: string | null;
  referenceFolio?: string | null;
  folio?: string | null;
  pagoFolio?: string | null;
  solicitudFolio?: string | null;
  dispersionFolio?: string | null;
  sourceFolio?: string | null;
  referenceType?: string | null;
  sourceModule?: string | null;
  actorUsername?: string | null;
  createdAtMillis?: number | null;
  createdAt?: Date | null;
}

export interface ScopedWalletOverview {
  ok: boolean;
  totalBalance: number;
  accountsCount: number;
  movements: LedgerMovementRow[];
}

function normalizeMovementDates(rows: LedgerMovementRow[]) {
  return (rows || []).map((row) => ({
    ...row,
    createdAt: typeof row.createdAtMillis === "number" ? new Date(row.createdAtMillis) : null,
  }));
}

export async function readClientWalletOverview() {
  const callable = httpsCallable<Record<string, never>, ScopedWalletOverview>(
    functions,
    "getClientWalletOverview"
  );

  const result = await callable({});
  return {
    ...result.data,
    movements: normalizeMovementDates(result.data?.movements || []),
  };
}

export async function readUserWalletOverview() {
  const callable = httpsCallable<Record<string, never>, ScopedWalletOverview>(
    functions,
    "getUserWalletOverview"
  );

  const result = await callable({});
  return {
    ...result.data,
    movements: normalizeMovementDates(result.data?.movements || []),
  };
}

export interface ClientWalletAccountRow {
  id: string;
  holderId?: string | null;
  holderName?: string | null;
  holderType?: string | null;
  availableBalance?: number;
  pendingAmount?: number;
  totalGranted?: number;
  netBalance?: number;
  lastMovementAtMillis?: number | null;
  updatedAtMillis?: number | null;
  lastMovementAt?: Date | null;
  updatedAt?: Date | null;
}

export interface ClientWalletAccountsOverview {
  ok: boolean;
  accounts: ClientWalletAccountRow[];
}

function normalizeClientAccountDates(rows: ClientWalletAccountRow[]) {
  return (rows || []).map((row) => ({
    ...row,
    lastMovementAt:
      typeof row.lastMovementAtMillis === "number" ? new Date(row.lastMovementAtMillis) : null,
    updatedAt:
      typeof row.updatedAtMillis === "number" ? new Date(row.updatedAtMillis) : null,
  }));
}

export async function readClientWalletAccountsOverview() {
  const callable = httpsCallable<Record<string, never>, ClientWalletAccountsOverview>(
    functions,
    "getClientWalletAccountsOverview"
  );

  const result = await callable({});
  return {
    ...result.data,
    accounts: normalizeClientAccountDates(result.data?.accounts || []),
  };
}

export interface ClientWalletDetailOverview {
  ok: boolean;
  clienteId: string;
  account: ClientWalletAccountRow | null;
  movements: LedgerMovementRow[];
  advances: Array<{
    id: string;
    amount?: number;
    pendingAmount?: number;
    status?: string | null;
    reason?: string | null;
    note?: string | null;
    reference?: string | null;
    createdAtMillis?: number | null;
    lastLiquidatedAtMillis?: number | null;
    createdAt?: Date | null;
    lastLiquidatedAt?: Date | null;
  }>;
  dispersionLookup: Record<string, any>;
}

function normalizeAdvanceDates(rows: ClientWalletDetailOverview["advances"]) {
  return (rows || []).map((row) => ({
    ...row,
    createdAt: typeof row.createdAtMillis === "number" ? new Date(row.createdAtMillis) : null,
    lastLiquidatedAt:
      typeof row.lastLiquidatedAtMillis === "number" ? new Date(row.lastLiquidatedAtMillis) : null,
  }));
}

export async function readClientWalletDetailOverview(clienteId: string) {
  const cleanClienteId = String(clienteId || "").trim();

  if (!cleanClienteId) {
    return null;
  }

  const callable = httpsCallable<
    { clienteId: string },
    ClientWalletDetailOverview
  >(functions, "getClientWalletDetailOverview");

  const result = await callable({ clienteId: cleanClienteId });

  return {
    ...result.data,
    account: result.data?.account
      ? normalizeClientAccountDates([result.data.account])[0]
      : null,
    movements: normalizeMovementDates(result.data?.movements || []),
    advances: normalizeAdvanceDates(result.data?.advances || []),
    dispersionLookup: result.data?.dispersionLookup || {},
  };
}
