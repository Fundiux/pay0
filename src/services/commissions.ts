import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type CommissionRuleLeg = { kind: "BASE" | "COMMISSIONER"; alias: string; rateBps: number; beneficiaryId: string; methodId: string; active?: boolean; order?: number; deliveryPreference?: "EMAIL" | "WHATSAPP" | "MANUAL" | "NONE"; deliveryContact?: string | null };
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
export const preflightPaymentCommissionDistribution = (distributionId: string) => call<{ distributionId: string }, any>("preflightPaymentCommissionDistribution", { distributionId });
export const resolveCommissionInstrumentIq = (input: { methodId: string; paymentId: string }) => call<typeof input, { ok: boolean; status: string; reason?: string; beneficiaryName?: string; instrumentMasked?: string }>("resolveCommissionInstrumentIq", input);
export const getCommissionDistributionsReport = (input: { dateFrom?: string; dateTo?: string; commissioner?: string; clientId?: string; status?: string } = {}) => call<typeof input, CommissionReportResult>("getCommissionDistributionsReport", input);

export type UserCommissionMode = "CONTRACT_COMMISSION_POINTS" | "USER_EARNINGS_PERCENTAGE";
export type UserCommissionDestination = { beneficiaryId: string; methodId: string; shareBps: number };
export type UserCommissionConfiguration = { clientId: string; clientName: string; ownerUid: string; contractRateBps: number | null; entitlementVersion: number; active: boolean; instruments: Array<{ methodId: string; beneficiaryId: string; beneficiaryName: string; instrumentMasked: string; bankName: string; iqLinkStatus: string; blockedReason: string | null }>; rule: { distributionMode: UserCommissionMode; destinations: UserCommissionDestination[]; version: number; effectiveFrom: number } | null };
export type UserCommissionSettings = { ok: boolean; ownerUid: string; configurations: UserCommissionConfiguration[]; history: Array<{ distributionId: string; clientId: string; requestId: string | null; requestStatus: string | null; totalDebitMinor: number | null; paymentId: string; pay0Folio: string; operationalDate: string; status: string; totalAmountMinor: number; ruleVersion: number; distributionMode: UserCommissionMode; legs: Array<{ amountMinor: number; instrumentMasked: string; beneficiaryName: string; status: string; errorCode: string | null }> }> };
export type CommissionDestinationInput = { clientId: string; distributionMode: UserCommissionMode; destinations: UserCommissionDestination[] };
export const getMyCommissionSettings = (ownerUid?: string) => call<{ ownerUid?: string }, UserCommissionSettings>("getMyCommissionSettings", ownerUid ? { ownerUid } : {});
export const configureUserCommissionEntitlement = (input: { clientId: string; ownerUid: string; referencePaymentId: string; methodIds: string[]; active: boolean; expectedVersion: number }) => call<typeof input, { ok: boolean; version: number }>("configureUserCommissionEntitlement", input);
export const previewMyCommissionDestinations = (input: CommissionDestinationInput & { earnedMinor: number }) => call<typeof input, { ok: boolean; earnedMinor: number; differenceMinor: number; destinations: Array<UserCommissionDestination & { amountMinor: number; beneficiaryName: string; instrumentMasked: string }> }>("previewMyCommissionDestinations", input);
export const saveMyCommissionDestinations = (input: CommissionDestinationInput & { expectedVersion: number }) => call<typeof input, { ok: boolean; version: number }>("saveMyCommissionDestinations", input);
export const requestUserCommissionDispersion = (input: { paymentId: string; ownerUid?: string; acceptTotalDebitMinor: number }) => call<typeof input, { ok: boolean; status?: string; reason?: string; requestId?: string; executionEnabled?: boolean }>("requestUserCommissionDispersion", input);
export const previewUserCommissionWithdrawal = (paymentId: string, clientId?: string) => call<{ paymentId: string; clientId?: string }, { ok: boolean; paymentId: string; status: string; totalAmountMinor: number; totalDebitMinor: number; feeMinor: number; destinations: Array<{ instrumentMasked: string; amountMinor: number; feeMinor: number }> }>("previewUserCommissionWithdrawal", { paymentId, ...(clientId ? { clientId } : {}) });
export const executeUserCommissionDispersion = (requestId: string) => call<{ requestId: string }, { ok: boolean; status: string }>("executeUserCommissionDispersion", { requestId });
export const cancelUserCommissionDispersion = (requestId: string) => call<{ requestId: string }, { ok: boolean; status: string }>("cancelUserCommissionDispersion", { requestId });
export type CommissionAutomationConfig = { enabled: boolean; executionEnabled: boolean; timeZone: "America/Mexico_City"; cutoff: string | null; weekdays: number[]; startDate: string | null; version: number; executionGate: string };
export const getCommissionAutomationConfig = () => call<{}, { ok: boolean; config: CommissionAutomationConfig }>("getCommissionAutomationConfig", {});
export const saveCommissionAutomationConfig = (input: CommissionAutomationConfig & { expectedVersion: number }) => call<typeof input, { ok: boolean; version: number }>("saveCommissionAutomationConfig", input);
export const runDailyUserCommissionPreflight = () => call<{}, { ok: boolean; reason?: string; scanned?: number; externalActions?: number }>("runDailyUserCommissionPreflight", {});
