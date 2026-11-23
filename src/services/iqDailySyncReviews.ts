import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type IqPendingReview = {
  kind: string;
  clientName: string | null;
  rfc: string | null;
  beneficiaryName: string | null;
  bank: string | null;
  amount: number | null;
  currency: string | null;
  date: string | null;
  /** The number IQ itself shows for the operation, to search for it in IQ. */
  iqNumber: string;
  partner: string;
  reason: string;
  detailKnown: boolean;
  openedAt: number | null;
  seenCount: number;
};

export async function listIqDailySyncReviews(): Promise<{ ok: boolean; truncated: boolean; isSuperadmin: boolean; rows: IqPendingReview[] }> {
  const fn = httpsCallable(functions, "listIqDailySyncReviews");
  const res: any = await fn({});
  return res.data;
}
