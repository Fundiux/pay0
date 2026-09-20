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
  paymentRule?: string | null;
  metadata?: Record<string, unknown>;
  operationId?: string | null;
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
  counts: {
    activeVehicles: number;
    soldVehicles: number;
    activeLoans: number;
    paidLoans: number;
  };
  truncated?: { positions: boolean; movements: boolean; documents: boolean };
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
export const closeAssetPosition = (positionId: string) =>
  call<
    { positionId: string; confirmation: string },
    { ok: true; positionId: string; status: "LIQUIDATED" | "PAID" }
  >("closeAssetPosition", {
    positionId,
    confirmation: "CONFIRM_ASSET_POSITION_CLOSE",
  });
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

export type AssetDocumentType =
  | "ASSIGNMENT_OFFER"
  | "LIQUIDATION"
  | "SPEI"
  | "CEP"
  | "ACCOUNT_STATEMENT"
  | "TRANSFER_RECEIPT"
  | "OTHER";
export type InitAssetDocumentUploadInput = {
  originalFileName: string;
  contentType: string;
  fileSize: number;
  sha256: string;
  documentType: AssetDocumentType;
  description?: string;
  positionId?: string;
  operationId?: string;
  movementId?: string;
};
export const initAssetDocumentUpload = (input: InitAssetDocumentUploadInput) =>
  call<typeof input, { ok: true; duplicate: boolean; documentId: string; storagePath: string; maxSizeBytes: number }>(
    "initAssetDocumentUpload",
    input,
  );
export const finalizeAssetDocumentUpload = (documentId: string) =>
  call<{ documentId: string }, { ok: true; documentId: string; duplicate: boolean }>(
    "finalizeAssetDocumentUpload",
    { documentId },
  );
