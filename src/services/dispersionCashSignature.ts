import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";
import { CALLABLES } from "@/lib/callableNames";

export const CASH_RECEIPT_STATUS = {
  PENDING: "PENDIENTE_FIRMA",
  SIGNED: "FIRMADA",
  /** Cash dispersions created before the receipt existed; exempt, not pending. */
  LEGACY: "SIN_FIRMA_ANTERIOR",
} as const;

export type CashReceiptStatus = typeof CASH_RECEIPT_STATUS[keyof typeof CASH_RECEIPT_STATUS];

export const CASH_RECEIPT_MISMATCH_MARK = "(FIRMA DISTINTA DEL BENEFICIARIO)";

/** Mirrors functions/src/modules/dispersionCashReceipt/domain.ts for display only. */
export function isCashDispersionRow(row: any): boolean {
  return [row?.operationTypeKey, row?.methodTipo, row?.destinationKind]
    .some((value) => String(value || "").trim().toUpperCase() === "EFECTIVO");
}

export function cashReceiptStatusOfRow(row: any): CashReceiptStatus | null {
  if (!isCashDispersionRow(row)) return null;
  const stored = String(row?.cashReceiptStatus || row?.cashReceipt?.status || "").trim().toUpperCase();
  if (stored === CASH_RECEIPT_STATUS.SIGNED) return CASH_RECEIPT_STATUS.SIGNED;
  if (stored === CASH_RECEIPT_STATUS.PENDING) return CASH_RECEIPT_STATUS.PENDING;
  return CASH_RECEIPT_STATUS.LEGACY;
}

export function cashReceiptStatusLabel(status: CashReceiptStatus | null): string {
  if (status === CASH_RECEIPT_STATUS.SIGNED) return "Firmada";
  if (status === CASH_RECEIPT_STATUS.PENDING) return "Pendiente de firma";
  if (status === CASH_RECEIPT_STATUS.LEGACY) return "Sin firma (anterior)";
  return "";
}

export function cashReceiverMismatch(row: any): boolean {
  return cashReceiptStatusOfRow(row) === CASH_RECEIPT_STATUS.SIGNED && row?.cashReceipt?.receiverMatches === false;
}

export async function createDispersionCashSignatureLink(dispersionId: string, reason?: string) {
  const fn = httpsCallable<
    { dispersionId: string; origin?: string; reason?: string },
    { ok: boolean; token: string; url: string; folio: string; alreadySigned: boolean; expiresAtMillis: number }
  >(functions, CALLABLES.createDispersionCashSignatureLink);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (await fn({ dispersionId, origin, ...(reason ? { reason } : {}) })).data;
}

export type DispersionCashSignatureRequest = {
  ok: boolean;
  dispersionFolio?: string | null;
  expectedReceiverName?: string | null;
  amount: number;
  currency: string;
  acceptanceText: string;
  acceptanceVersion: string;
  expiresAtMillis: number;
};

export async function getDispersionCashSignatureRequest(token: string) {
  const fn = httpsCallable<{ token: string }, DispersionCashSignatureRequest>(
    functions,
    CALLABLES.getDispersionCashSignatureRequest,
  );
  return (await fn({ token })).data;
}

export async function submitDispersionCashSignature(input: {
  token: string;
  signerName: string;
  acceptedReceipt: boolean;
  signatureDataUrl: string;
}) {
  const fn = httpsCallable<
    typeof input,
    { ok: boolean; uploadId: string; version: number; receiverMatches: boolean; folio: string }
  >(functions, CALLABLES.submitDispersionCashSignature);
  return (await fn(input)).data;
}
