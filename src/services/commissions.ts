import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type CommissionRuleLeg = { kind: "BASE" | "COMMISSIONER"; alias: string; rateBps: number; beneficiaryId: string; methodId: string; active?: boolean; order?: number };
export type ClientCommissionRule = { clientId: string; totalRateBps: number; legs: CommissionRuleLeg[]; active: boolean; automationEnabled: boolean; version: number };
export type CommissionReportRow = { distributionId: string; operationalDate: string; paymentId: string; pay0Folio: string; originalReference: string | null; clientId: string; clientName: string | null; kind: string; commissioner: string; rateBps: number; amount: number; beneficiaryName: string | null; instrumentMasked: string | null; iqFolio: string | null; status: string; reportStatus: string };
export type CommissionReportResult = { ok: boolean; rows: CommissionReportRow[]; summary: { movements: number; legs: number; totalAmount: number; baseAmount: number; pending: number; errors: number } };

async function call<I, O>(name: string, input: I): Promise<O> {
  return (await httpsCallable<I, O>(functions, name)(input)).data;
}
export const getClientCommissionRule = (clientId: string) => call<{ clientId: string }, { ok: boolean; rule: ClientCommissionRule | null }>("getClientCommissionRule", { clientId });
export const saveClientCommissionRule = (input: { clientId: string; totalRateBps: number; legs: CommissionRuleLeg[]; active: boolean; automationEnabled: boolean }) => call<typeof input, { ok: boolean; version: number }>("saveClientCommissionRule", input);
export const previewPaymentCommissionDistribution = (paymentId: string) => call<{ paymentId: string }, any>("previewPaymentCommissionDistribution", { paymentId });
export const processPaymentCommissionDistribution = (paymentId: string) => call<{ paymentId: string }, any>("processPaymentCommissionDistribution", { paymentId });
export const getCommissionDistributionsReport = (input: { dateFrom?: string; dateTo?: string; commissioner?: string; clientId?: string; status?: string } = {}) => call<typeof input, CommissionReportResult>("getCommissionDistributionsReport", input);

