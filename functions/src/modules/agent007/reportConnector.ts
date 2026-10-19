import type { CallableRequest } from "firebase-functions/v2/https";
import { getEarningsByClientReportHandler } from "../reports/callables";
import { toSafeMoneyNumber } from "../sharedCallables/helpers";
import type { ToolResult } from "./hugoCore/toolRouter";
import { EarningsReportToolInput, validateEarningsReportInput } from "./hugoCore/reportSemantics";

export async function executeEarningsReportTool(request: CallableRequest, input: EarningsReportToolInput): Promise<ToolResult> {
  validateEarningsReportInput(input);
  const started = Date.now();
  const scanLimit = input.limit ?? 5000;
  // The same handler re-loads the current profile and enforces report permission,
  // role and root scope. A model cannot provide an identity or bypass those checks.
  const filters = { dateFrom: input.dateFrom, dateTo: input.dateTo, includeCompensated: input.includeCompensated, limit: scanLimit };
  const report = await getEarningsByClientReportHandler({ ...request, data: filters });
  const compared = input.compareDateFrom && input.compareDateTo
    ? await getEarningsByClientReportHandler({ ...request, data: { ...filters, dateFrom: input.compareDateFrom, dateTo: input.compareDateTo } })
    : null;
  if (compared && (compared.rootId !== report.rootId || compared.scopeRole !== report.scopeRole)) throw Error("HUGO_REPORT_FORBIDDEN_SCOPE_CHANGED");
  const comparison = compared ? { dateFrom: compared.dateFrom, dateTo: compared.dateTo, summary: compared.summary, docsScanned: compared.docsScanned,
    mayBeTruncated: compared.docsScanned >= scanLimit, consistency: "INDEPENDENT_READS",
    difference: { totalEarningsAmount: toSafeMoneyNumber(report.summary.totalEarningsAmount - compared.summary.totalEarningsAmount), operationsCount: report.summary.operationsCount - compared.summary.operationsCount } } : null;
  return { sourceSystem: "PAY0", tool: "getEarningsByClientReport", retrievedAt: new Date().toISOString(), scope: { rootId: report.rootId },
    completeness: "PARTIAL", evidence: [{ entityType: "report", entityId: "earningsByClient", kind: "CANONICAL_REPORT", sourceSystem: "PAY0", completeness: "PARTIAL" }],
    data: { ...report, rows: report.rows.slice(0, 25), displayedClients: Math.min(report.rows.length, 25), scanLimit, mayBeTruncated: report.docsScanned >= scanLimit, ...(comparison ? { comparison } : {}) },
    trace: { latencyMs: Date.now() - started, result: "OK" } };
}
