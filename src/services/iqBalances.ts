import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type IqBalanceStatus = "MATCH" | "DIFFERENT" | "UNMAPPED";

export type IqBalanceExplanation = {
  month: string;
  previousBalance: number | null;
  totalCredits: number | null;
  totalCharges: number | null;
  iqMovements: number;
  pay0Movements: number;
  unexplainedIqCount: number;
  unmatchedPay0Count: number;
  unexplainedIq: Array<{ day: string; concept: string; credit: number; charge: number }>;
  unmatchedPay0: Array<{ day: string; folio: string; concept: string; direction: "IN" | "OUT"; amount: number }>;
};

export type IqBalanceRow = {
  rowKey: string;
  status: IqBalanceStatus;
  reason: string | null;
  clientName: string;
  clientNumber: number | null;
  ownerLabel: string | null;
  sources: string[];
  partners: Array<{ name: string; balance: number | null }>;
  iqBalance: number | null;
  pay0Balance: number | null;
  difference: number | null;
  signInverted: boolean;
  partnerOwnerMismatch: boolean;
  explanationStatus: string | null;
  explanation: IqBalanceExplanation | null;
  checkedAt: number | null;
};

export type IqBalanceComparison = {
  ok: boolean;
  isSuperadmin: boolean;
  run: { day: string; ranAt: number | null; complete: boolean; counts: { match: number; different: number; unmapped: number } } | null;
  rows: IqBalanceRow[];
  owners: Array<{ id: string; label: string }>;
};

/** The server decides what each user may see; ownerId is only honoured for superadmin. */
export async function getIqBalanceComparison(ownerId?: string) {
  const call = httpsCallable<{ ownerId?: string }, IqBalanceComparison>(functions, "getIqBalanceComparison");
  return (await call(ownerId ? { ownerId } : {})).data;
}
