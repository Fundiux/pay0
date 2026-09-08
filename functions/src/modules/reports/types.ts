export interface ReportFilterRange {
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface EarningsByClientReportInput extends ReportFilterRange {
  includeCompensated?: boolean;
  limit?: number;
}

export interface EarningsByClientReportRow {
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
}

export interface EarningsByClientReportSummary {
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
}

export interface EarningsByClientReportResult {
  ok: boolean;
  scopeRole: string;
  rootId: string;
  dateFrom: string | null;
  dateTo: string | null;
  includeCompensated: boolean;
  docsScanned: number;
  rows: EarningsByClientReportRow[];
  summary: EarningsByClientReportSummary;
}

export interface PaymentsFinancialPostingIssuesReportInput extends ReportFilterRange {
  includePosted?: boolean;
  includeNotConciliated?: boolean;
  limit?: number;
}

export interface PaymentsFinancialPostingIssuesReportRow {
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
}

export interface PaymentsFinancialPostingIssuesReportSummary {
  paymentsCount: number;
  totalAmount: number;
  pendingCount: number;
  configurationCount: number;
  skippedCount: number;
  notConciliatedCount: number;
  missingClientRateCount: number;
  missingDespachoCostCount: number;
  postedCount: number;
}

export interface PaymentsFinancialPostingIssuesReportResult {
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
}
export interface OperationalIntelligenceReportInput extends ReportFilterRange {
  limit?: number;
}

export interface OperationalIntelligenceReportSummary {
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
}

export interface OperationalClientRankingRow {
  clienteId: string;
  clienteNombre: string | null;
  pagosAmount: number;
  pagosCount: number;
  dispersionesAmount: number;
  dispersionesCount: number;
  earningsAmount: number;
  activityCount: number;
  lastActivityAt: string | null;
}

export interface OperationalUserActivityRow {
  actorUid: string;
  actorUsername: string | null;
  eventsCount: number;
  lastActivityAt: string | null;
}

export interface OperationalAlertRow {
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
}

export interface OperationalIntelligenceReportResult {
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
}
