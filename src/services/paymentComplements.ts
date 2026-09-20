import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type ComplementFollowup = { id: string; applicationFolio: string; solicitudFolio: string; pagoFolio: string; provider: string; status: string; amountMinor: number; installment: number; externalRequestSent: boolean; automationStatus?: string; automationError?: string };
export async function listPaymentComplementFollowup() {
  return (await httpsCallable<Record<string, never>, { ok: boolean; rows: ComplementFollowup[]; truncated: boolean; automation: { iqEnabled: boolean; facturamaEnabled: boolean } }>(functions, "listPaymentComplementFollowup")({})).data;
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
