import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type PendingOperationsItems = {
  complementsHeld?: number; complementsLate?: number; cashUnsigned?: number; cancellationReview?: number;
};

export async function getPendingOperationsSummary() {
  return (await httpsCallable<Record<string, never>, { ok: boolean; items: PendingOperationsItems }>(functions, "getPendingOperationsSummary")({})).data.items;
}
