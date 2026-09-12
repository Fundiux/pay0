import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebaseClient";
import { CALLABLES } from "@/lib/callableNames";

export type EarningsByClientReportRow = {
  clienteId: string;
  clienteNombre: string | null;
  operationsCount: number;
  grossAmount: number;
  baseAmount: number;
  despachoCostAmount: number;
  superadminEarningAmount: number;
  adminEarningAmount: number;
  operadorEarningAmount: number;
  totalEarningsAmount: number;
  clientChargeAmount: number;
  clientNetAmount: number;
  lastCreatedAt: string | null;
};

export type EarningsByClientReportSummary = {
  clientsCount: number;
  operationsCount: number;
  grossAmount: number;
  baseAmount: number;
  despachoCostAmount: number;
  superadminEarningAmount: number;
  adminEarningAmount: number;
  operadorEarningAmount: number;
  totalEarningsAmount: number;
  clientChargeAmount: number;
  clientNetAmount: number;
};

export type EarningsByClientReportResult = {
  ok: boolean;
  scopeRole: string;
  rootId: string;
  dateFrom: string | null;
  dateTo: string | null;
  includeCompensated: boolean;
  docsScanned: number;
  rows: EarningsByClientReportRow[];
  summary: EarningsByClientReportSummary;
};

export type PaymentsFinancialPostingIssuesReportRow = {
  pagoId: string;
  folio: string;
  clienteId: string | null;
  clienteNombre: string | null;
  companyId: string | null;
  empresaNombre: string | null;
  operationTypeKey: string | null;
  status: string;
  financialPostingStatus: string;
  financialPostingError: string | null;
  amount: number;
  actionLabel: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  createdAt: string | null;
  updatedAt: string | null;
};

export type PaymentsFinancialPostingIssuesReportSummary = {
  paymentsCount: number;
  totalAmount: number;
  pendingCount: number;
  configurationCount: number;
  skippedCount: number;
  notConciliatedCount: number;
  missingClientRateCount: number;
  missingDespachoCostCount: number;
  postedCount: number;
};

export type PaymentsFinancialPostingIssuesReportResult = {
  ok: boolean;
  scopeRole: string;
  rootId: string;
  dateFrom: string | null;
  dateTo: string | null;
  includePosted: boolean;
  includeNotConciliated: boolean;
  docsScanned: number;
  rows: PaymentsFinancialPostingIssuesReportRow[];
  summary: PaymentsFinancialPostingIssuesReportSummary;
};

export async function getEarningsByClientReport(input: {
  dateFrom?: string | null;
  dateTo?: string | null;
  includeCompensated?: boolean;
  limit?: number;
} = {}): Promise<EarningsByClientReportResult> {
  const callable = httpsCallable<typeof input, EarningsByClientReportResult>(
    functions,
    CALLABLES.getEarningsByClientReport
  );

  const response = await callable(input);
  return response.data;
}

export type OperationalMetricsReportResult = {
  ok: boolean;
  docsScanned: number;
  summary: { received: number; resolved: number; averageMs: number | null; medianMs: number | null; firstResponses: number; averageFirstResponseMs: number | null; medianFirstResponseMs: number | null };
  byCaseType: Array<{ caseType: string; received: number; resolved: number; totalMs: number; averageMs: number | null; firstResponses: number; firstResponseTotalMs: number; averageFirstResponseMs: number | null }>;
};

export async function getOperationalMetricsReport(input: { dateFrom?: string | null; dateTo?: string | null } = {}) {
  const callable = httpsCallable<typeof input, OperationalMetricsReportResult>(functions, CALLABLES.getOperationalMetricsReport);
  return (await callable(input)).data;
}

export async function getPaymentsFinancialPostingIssuesReport(input: {
  dateFrom?: string | null;
  dateTo?: string | null;
  includePosted?: boolean;
  includeNotConciliated?: boolean;
  limit?: number;
} = {}): Promise<PaymentsFinancialPostingIssuesReportResult> {
  const callable = httpsCallable<typeof input, PaymentsFinancialPostingIssuesReportResult>(
    functions,
    CALLABLES.getPaymentsFinancialPostingIssuesReport
  );

  const response = await callable(input);
  return response.data;
}
export type OperationalIntelligenceReportSummary = {
  pagosCount: number;
  pagosAmount: number;
  dispersionesCount: number;
  dispersionesAmount: number;
  adelantosCount: number;
  adelantosAmount: number;
  adelantosPendingAmount: number;
  adelantosLiquidatedAmount: number;
  earningsAmount: number;
  activityEventsCount: number;
  alertsCount: number;
  pendingFinancialPostingsCount: number;
  openDispersionIncidentsCount: number;
};

export type OperationalClientRankingRow = {
  clienteId: string;
  clienteNombre: string | null;
  pagosAmount: number;
  pagosCount: number;
  dispersionesAmount: number;
  dispersionesCount: number;
  earningsAmount: number;
  activityCount: number;
  lastActivityAt: string | null;
};

export type OperationalUserActivityRow = {
  actorUid: string;
  actorUsername: string | null;
  eventsCount: number;
  lastActivityAt: string | null;
};

export type OperationalAlertRow = {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  description: string;
  referenceId: string | null;
  referenceFolio: string | null;
  amount: number;
  status: string | null;
  createdAt: string | null;
};

export type OperationalIntelligenceReportResult = {
  ok: boolean;
  scopeRole: string;
  rootId: string;
  dateFrom: string | null;
  dateTo: string | null;
  docsScanned: number;
  summary: OperationalIntelligenceReportSummary;
  clientRanking: OperationalClientRankingRow[];
  userActivity: OperationalUserActivityRow[];
  alerts: OperationalAlertRow[];
};

export async function getOperationalIntelligenceReport(input: {
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
} = {}): Promise<OperationalIntelligenceReportResult> {
  const callable = httpsCallable<typeof input, OperationalIntelligenceReportResult>(
    functions,
    CALLABLES.getOperationalIntelligenceReport
  );

  const response = await callable(input);
  return response.data;
}
