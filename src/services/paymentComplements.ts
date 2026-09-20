import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type ComplementFollowup = { id: string; applicationFolio: string; solicitudFolio: string; pagoFolio: string; provider: string; status: string; amountMinor: number; installment: number; externalRequestSent: boolean };
export async function listPaymentComplementFollowup() {
  return (await httpsCallable<Record<string, never>, { ok: boolean; rows: ComplementFollowup[]; truncated: boolean; externalContractReady: false }>(functions, "listPaymentComplementFollowup")({})).data;
}
export async function refreshPaymentComplementFollowup(cursor?: string) {
  return (await httpsCallable<{ cursor?: string }, { ok: boolean; processed: number; complete: boolean; cursor: string | null }>(functions, "refreshPaymentComplementFollowup")({ cursor })).data;
}
