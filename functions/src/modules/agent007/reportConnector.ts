import type { CallableRequest } from "firebase-functions/v2/https";
import { getEarningsByClientReportHandler } from "../reports/callables";
import { toSafeMoneyNumber } from "../sharedCallables/helpers";
import type { ToolResult } from "./hugoCore/toolRouter";
import { EarningsReportToolInput, HugoReportExport, validateEarningsReportInput } from "./hugoCore/reportSemantics";

export async function executeEarningsReportTool(request: CallableRequest, input: EarningsReportToolInput): Promise<ToolResult> {
  validateEarningsReportInput(input);
  const started = Date.now();
  const scanLimit = input.limit ?? 5000;
  // The same handler re-loads the current profile and enforces report permission,
  // role and root scope. A model cannot provide an identity or bypass those checks.
  const filters = { dateFrom: input.dateFrom, dateTo: input.dateTo, includeCompensated: input.includeCompensated, limit: scanLimit };
  let report = await getEarningsByClientReportHandler({ ...request, data: filters });
  let compared = input.compareDateFrom && input.compareDateTo
    ? await getEarningsByClientReportHandler({ ...request, data: { ...filters, dateFrom: input.compareDateFrom, dateTo: input.compareDateTo } })
    : null;
  if (compared && (compared.rootId !== report.rootId || compared.scopeRole !== report.scopeRole)) throw Error("HUGO_REPORT_FORBIDDEN_SCOPE_CHANGED");
  let clientResolution: Record<string, unknown> | undefined;
  if (input.clientQuery) {
    const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    const query = normalized(input.clientQuery);
    const exact = report.rows.filter(row => normalized(row.clienteNombre || row.clienteId) === query);
    const matches = exact.length ? exact : report.rows.filter(row => normalized(row.clienteNombre || "").includes(query));
    if (matches.length !== 1) return { sourceSystem: "PAY0", tool: "getEarningsByClientReport", retrievedAt: new Date().toISOString(), scope: { rootId: report.rootId },
      completeness: "PARTIAL", evidence: [], data: { dateFrom: report.dateFrom, dateTo: report.dateTo, rows: [], summary: null,
        docsScanned: report.docsScanned, scanLimit, mayBeTruncated: report.docsScanned >= scanLimit,
        clientResolution: { status: matches.length ? "AMBIGUOUS" : "NOT_FOUND", candidates: matches.slice(0, 5).map(row => (row.clienteNombre || row.clienteId).slice(0, 200)) } },
      trace: { latencyMs: Date.now() - started, result: "OK" } };
    const row = matches[0];
    // Reuse the canonical per-client totals without recomputing any financial formula.
    const { clienteId, clienteNombre, lastCreatedAt, ...totals } = row;
    report = { ...report, rows: [row], summary: { ...totals, clientsCount: 1 } };
    if (compared) {
      const comparisonRow = compared.rows.find(item => item.clienteId === clienteId);
      if (comparisonRow) {
        const { clienteId: ignoredId, clienteNombre: ignoredName, lastCreatedAt: ignoredDate, ...comparisonTotals } = comparisonRow;
        compared = { ...compared, rows: [comparisonRow], summary: { ...comparisonTotals, clientsCount: 1 } };
      } else compared = { ...compared, rows: [], summary: { clientsCount: 0, operationsCount: 0, grossAmount: 0, baseAmount: 0, despachoCostAmount: 0, superadminEarningAmount: 0,
        adminEarningAmount: 0, operadorEarningAmount: 0, totalEarningsAmount: 0, clientChargeAmount: 0, clientNetAmount: 0 } };
    }
    clientResolution = { status: "RESOLVED", clientId: clienteId, clientName: (clienteNombre || clienteId).slice(0, 200) };
  }
  const comparison = compared ? { dateFrom: compared.dateFrom, dateTo: compared.dateTo, summary: compared.summary, docsScanned: compared.docsScanned,
    mayBeTruncated: compared.docsScanned >= scanLimit, consistency: "INDEPENDENT_READS",
    difference: { totalEarningsAmount: toSafeMoneyNumber(report.summary.totalEarningsAmount - compared.summary.totalEarningsAmount), operationsCount: report.summary.operationsCount - compared.summary.operationsCount } } : null;
  const exportRows = report.rows.slice(0, 250).map(row => ({ ...row, clienteId: row.clienteId, clienteNombre: row.clienteNombre === null ? null : String(row.clienteNombre).slice(0, 200) }));
  const numericKeys = ["operationsCount", "grossAmount", "baseAmount", "despachoCostAmount", "superadminEarningAmount", "adminEarningAmount", "operadorEarningAmount", "totalEarningsAmount", "clientChargeAmount", "clientNetAmount"] as const;
  const exportValid = exportRows.every(row => row.clienteId.length <= 160 && numericKeys.every(key => typeof row[key] === "number" && Number.isFinite(row[key])));
  const format = input.format || "XLSX";
  let reportExport: HugoReportExport | undefined = exportRows.length && exportValid ? { version: 1, kind: "EARNINGS_BY_CLIENT", format, fileName: `pay0-utilidades-${input.dateFrom}-a-${input.dateTo}.${format.toLowerCase()}`,
    dateFrom: input.dateFrom!, dateTo: input.dateTo!, includeCompensated: report.includeCompensated, docsScanned: report.docsScanned, scanLimit,
    matchedClients: report.rows.length, exportedClients: Math.min(report.rows.length, 250), truncatedByScan: report.docsScanned >= scanLimit,
    truncatedByExport: report.rows.length > 250 || report.rows.some(row => (row.clienteNombre || "").length > 200), rows: exportRows } : undefined;
  // Reserve ample headroom below Firestore's 1 MiB document limit for message metadata.
  while (reportExport && Buffer.byteLength(JSON.stringify(reportExport), "utf8") > 350_000 && reportExport.rows.length) {
    reportExport.rows.pop(); reportExport.exportedClients = reportExport.rows.length; reportExport.truncatedByExport = true;
  }
  if (reportExport && !reportExport.rows.length) reportExport = undefined;
  return { sourceSystem: "PAY0", tool: "getEarningsByClientReport", retrievedAt: new Date().toISOString(), scope: { rootId: report.rootId },
    completeness: "PARTIAL", evidence: [{ entityType: "report", entityId: "earningsByClient", kind: "CANONICAL_REPORT", sourceSystem: "PAY0", completeness: "PARTIAL" }],
    data: { ...report, rows: report.rows.slice(0, 25), displayedClients: Math.min(report.rows.length, 25), scanLimit, mayBeTruncated: report.docsScanned >= scanLimit,
      ...(clientResolution ? { clientResolution } : {}), ...(reportExport ? { reportExport } : {}), ...(comparison ? { comparison } : {}) },
    trace: { latencyMs: Date.now() - started, result: "OK" } };
}
