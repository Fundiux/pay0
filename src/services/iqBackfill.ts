import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type IqBackfillMonth = { month: string; status: string; openReviews: number | null; runs: number; lastRunAtMs: number | null; created: Record<string, number> };
export type IqBackfillStatus = { ok: boolean; enabled: boolean; status: string; startMonth: string; endDate: string; cursorMonth: string | null; months: IqBackfillMonth[] };
export type IqBackfillMissingDocument = { kind: string; iqNumber: string; iqFolio: string | null; clientName: string | null; date: string | null; amount: number | null; partner: string; attempts: number; reason: string };

export async function getIqBackfillStatus(): Promise<IqBackfillStatus> {
  const res: any = await httpsCallable(functions, "getIqBackfillStatus")({});
  return res.data;
}
export async function setIqBackfillEnabled(enabled: boolean): Promise<{ ok: boolean; enabled: boolean }> {
  const res: any = await httpsCallable(functions, "setIqBackfillEnabled")({ enabled });
  return res.data;
}
export async function getIqBackfillMissingDocuments(): Promise<{ ok: boolean; truncated: boolean; total: number; rows: IqBackfillMissingDocument[] }> {
  const res: any = await httpsCallable(functions, "getIqBackfillMissingDocuments")({});
  return res.data;
}
