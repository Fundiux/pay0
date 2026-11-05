import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";
import { CALLABLES } from "@/lib/callableNames";

export const CASH_RECEIPT_STATUS = {
  PENDING: "PENDIENTE_FIRMA",
  SIGNED: "FIRMADA",
} as const;

export type CashReceiptStatus = typeof CASH_RECEIPT_STATUS[keyof typeof CASH_RECEIPT_STATUS];

/** Mirrors functions/src/modules/dispersionCashReceipt/domain.ts for display only. */
export function isCashDispersionRow(row: any): boolean {
  return [row?.operationTypeKey, row?.methodTipo, row?.destinationKind]
    .some((value) => String(value || "").trim().toUpperCase() === "EFECTIVO");
}

export function cashReceiptStatusOfRow(row: any): CashReceiptStatus | null {
  if (!isCashDispersionRow(row)) return null;
  const stored = String(row?.cashReceiptStatus || row?.cashReceipt?.status || "").trim().toUpperCase();
  return stored === CASH_RECEIPT_STATUS.SIGNED ? CASH_RECEIPT_STATUS.SIGNED : CASH_RECEIPT_STATUS.PENDING;
}

export function cashReceiptStatusLabel(status: CashReceiptStatus | null): string {
  if (status === CASH_RECEIPT_STATUS.SIGNED) return "Firmada";
  if (status === CASH_RECEIPT_STATUS.PENDING) return "Pendiente de firma";
  return "";
}

export async function createDispersionCashSignatureLink(dispersionId: string) {
  const fn = httpsCallable<
    { dispersionId: string; origin?: string },
    { ok: boolean; token: string; url: string; folio: string; alreadySigned: boolean; expiresAtMillis: number }
  >(functions, CALLABLES.createDispersionCashSignatureLink);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (await fn({ dispersionId, origin })).data;
}

export type DispersionCashSignatureRequest = {
  ok: boolean;
  dispersionFolio?: string | null;
  clienteNombre?: string | null;
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
