import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type AssetPosition = {
  id: string;
  kind: "VEHICLE" | "LOAN";
  name: string;
  status: string;
  counterpartyName?: string | null;
  interestModel?: string | null;
  rateBasisPoints?: number;
  includedInMetrics: boolean;
  dataClassification: "REAL" | "TEST" | "UNCLASSIFIED" | string;
  snapshot: {
    originalPrincipalMinor: number;
    outstandingPrincipalMinor: number;
    recoveredPrincipalMinor: number;
    pendingInterestMinor: number;
    realizedProfitMinor: number;
    capitalizedInterestMinor: number;
    totalRecoveredMinor: number;
    roi: number | null;
  };
};
export type AssetOverview = {
  positions: AssetPosition[];
  movements: any[];
  documents: any[];
  totals: {
    workingMinor: number;
    recoveredPrincipalMinor: number;
    realizedProfitMinor: number;
    pendingInterestMinor: number;
  };
  excludedPositionCount: number;
};
const call = <I, O>(name: string, input: I) =>
  httpsCallable<I, O>(functions, name)(input).then((result) => result.data);
export const listAssetOverview = () =>
  call<Record<string, never>, { ok: true } & AssetOverview>(
    "listAssetOverview",
    {},
  );
export const createAssetPosition = (input: {
  kind: "VEHICLE" | "LOAN";
  name: string;
  counterpartyName?: string;
  initialMinor?: number;
  effectiveDate?: string;
  interestModel?: string;
  rateBasisPoints?: number;
  paymentRule?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}) =>
  call<typeof input, { ok: true; positionId: string }>(
    "createAssetPosition",
    input,
  );
export const recordAssetMovement = (input: {
  positionId: string;
  movementType: string;
  amountMinor: number;
  source: string;
  effectiveDate: string;
  description?: string;
  idempotencyKey: string;
  documentIds?: string[];
}) =>
  call<typeof input, { ok: true; movementId: string }>(
    "recordAssetMovement",
    input,
  );
export const accrueAssetLoanInterest = (input: {
  positionId: string;
  periodKey: string;
}) =>
  call<
    typeof input,
    { ok: true; amountMinor: number; duplicate?: boolean; skipped?: boolean }
  >("accrueAssetLoanInterest", input);
export const seedUproAssetPortfolio = () =>
  call<Record<string, never>, { ok: true; alreadySeeded: boolean }>(
    "seedUproAssetPortfolio",
    {},
  );
export const linkPay0PaymentToAsset = (input: {
  pagoId: string;
  positionId: string;
  amountMinor: number;
  rule: "MANUAL" | "INTEREST_FIRST" | "PRINCIPAL_FIRST";
  interestMinor?: number;
  principalMinor?: number;
  effectiveDate?: string;
  idempotencyKey: string;
}) =>
  call<
    typeof input,
    { ok: true; movementIds: string[]; remainingLinkableAmount: number }
  >("linkPay0PaymentToAsset", input);
