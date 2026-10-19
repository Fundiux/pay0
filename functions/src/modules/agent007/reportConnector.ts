import type { CallableRequest } from "firebase-functions/v2/https";
import { getEarningsByClientReportHandler } from "../reports/callables";
import type { ToolResult } from "./hugoCore/toolRouter";
import { EarningsReportToolInput, validateEarningsReportInput } from "./hugoCore/reportSemantics";

export async function executeEarningsReportTool(request: CallableRequest, input: EarningsReportToolInput): Promise<ToolResult> {
  validateEarningsReportInput(input);
  const started = Date.now();
  const scanLimit = input.limit ?? 5000;
  // The same handler re-loads the current profile and enforces report permission,
  // role and root scope. A model cannot provide an identity or bypass those checks.
  const report = await getEarningsByClientReportHandler({ ...request, data: { ...input, limit: scanLimit } });
  return { sourceSystem: "PAY0", tool: "getEarningsByClientReport", retrievedAt: new Date().toISOString(), scope: { rootId: report.rootId },
    completeness: "PARTIAL", evidence: [{ entityType: "report", entityId: "earningsByClient", kind: "CANONICAL_REPORT", sourceSystem: "PAY0", completeness: "PARTIAL" }],
    data: { ...report, rows: report.rows.slice(0, 25), displayedClients: Math.min(report.rows.length, 25), scanLimit, mayBeTruncated: report.docsScanned >= scanLimit },
    trace: { latencyMs: Date.now() - started, result: "OK" } };
}
