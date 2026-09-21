import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type ComplementFollowup = { id: string; applicationFolio: string; solicitudFolio: string; pagoFolio: string; provider: string; status: string; amountMinor: number; installment: number; externalRequestSent: boolean; automationStatus?: string; automationError?: string; automationGateReason?: string };
export type ComplementInventoryCounts = { scanned: number; detected: number; processed: number; pending: number; errors: number; excluded: number; iq: number; facturama: number; emisor: number;
  waitingB: number; requestedC: number; uncertainC: number; attachmentAvailable: number; exceptionBlocked: number; otherPending: number };
export type ComplementInventoryException = { applicationId: string; applicationFolio: string; solicitudFolio: string; pagoFolio: string; provider: string; outcome: "PENDING" | "ERROR"; reason: string; recoveryState?: string; recoveryReason?: string;
  operationalTags?: ("waitingB" | "requestedC" | "uncertainC" | "attachmentAvailable" | "exceptionBlocked")[]; requestStatus?: string; bReadState?: string; bReadReason?: string; nextCheckAt?: string | null };
export type ComplementInventoryPage = { ok: boolean; counts: ComplementInventoryCounts; exceptions: ComplementInventoryException[]; complete: boolean; cursor: string | null; checkedAt: string };
export async function getHugoComplementInventoryPage(cursor?: string, pageSize = 25) {
  return (await httpsCallable<{ cursor?: string; pageSize: number }, ComplementInventoryPage>(functions, "getHugoComplementInventoryPage")({ cursor, pageSize })).data;
}
export async function listPaymentComplementFollowup() {
  return (await httpsCallable<Record<string, never>, { ok: boolean; rows: ComplementFollowup[]; truncated: boolean; automation: { iqEnabled: boolean; iqLookupEnabled: boolean; facturamaEnabled: boolean } }>(functions, "listPaymentComplementFollowup")({})).data;
}
export async function configurePaymentComplementAutomation(input: { iqEnabled: boolean; facturamaEnabled: boolean; confirmation?: string }) {
  return (await httpsCallable<typeof input, { ok: boolean }>(functions, "configurePaymentComplementAutomation")(input)).data;
}
export async function setComplementPaymentForm(requestId: string, paymentForm: string) {
  return (await httpsCallable<{ requestId: string; paymentForm: string }, { ok: boolean }>(functions, "setComplementPaymentForm")({ requestId, paymentForm })).data;
}
export async function refreshPaymentComplementFollowup(cursor?: string) {
  return (await httpsCallable<{ cursor?: string }, { ok: boolean; processed: number; complete: boolean; cursor: string | null }>(functions, "refreshPaymentComplementFollowup")({ cursor })).data;
}
