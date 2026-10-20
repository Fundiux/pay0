"use client";

import { useEffect, useRef, useState } from "react";
import type { Agent007Message, Agent007ReportExport } from "@/services/agent007";
import { downloadSpreadsheetFile } from "@/lib/spreadsheetReader";
import { downloadHugoReportPdf } from "@/lib/hugoReportPdf";

const amounts = ["grossAmount", "baseAmount", "despachoCostAmount", "superadminEarningAmount", "adminEarningAmount", "operadorEarningAmount", "totalEarningsAmount", "clientChargeAmount", "clientNetAmount"] as const;
export function isDownloadableReport(value: Agent007ReportExport | undefined): value is Agent007ReportExport {
  return !!value && value.version === 1 && value.kind === "EARNINGS_BY_CLIENT" && /^\d{4}-\d{2}-\d{2}$/.test(value.dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(value.dateTo) &&
    (value.format === undefined || value.format === "PDF" || value.format === "XLSX") && value.fileName === `pay0-utilidades-${value.dateFrom}-a-${value.dateTo}.${value.format === "PDF" ? "pdf" : "xlsx"}` && typeof value.includeCompensated === "boolean" && typeof value.truncatedByScan === "boolean" && typeof value.truncatedByExport === "boolean" &&
    [value.docsScanned, value.scanLimit, value.matchedClients, value.exportedClients].every(number => Number.isInteger(number) && number >= 0) &&
    Array.isArray(value.rows) && value.rows.length > 0 && value.rows.length <= 250 && value.exportedClients === value.rows.length &&
    value.rows.every(row => !!row && typeof row.clienteId === "string" && Number.isFinite(row.operationsCount) && amounts.every(key => typeof row[key] === "number" && Number.isFinite(row[key])));
}
export function reportSpreadsheetRows(report: Agent007ReportExport) {
  return report.rows.map(row => ({ Cliente: row.clienteNombre || row.clienteId, ClienteId: row.clienteId, Operaciones: row.operationsCount,
    Bruto: row.grossAmount, Base: row.baseAmount, CargoCliente: row.clientChargeAmount, CostoDespacho: row.despachoCostAmount,
    Superadmin: row.superadminEarningAmount, Admin: row.adminEarningAmount, Operador: row.operadorEarningAmount,
    GananciaTotal: row.totalEarningsAmount, NetoCliente: row.clientNetAmount, Ultimo: row.lastCreatedAt || "",
    Desde: report.dateFrom, Hasta: report.dateTo, IncluyeCompensados: report.includeCompensated ? "Sí" : "No",
    DocumentosRevisados: report.docsScanned, LimiteRevision: report.scanLimit, ClientesCoincidentes: report.matchedClients,
    ClientesExportados: report.exportedClients, RevisionParcial: report.truncatedByScan ? "Sí" : "No", ExportacionParcial: report.truncatedByExport ? "Sí" : "No" }));
}
export default function HugoReportAttachment({ message }: { message: Agent007Message }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const report = message.reportExport;
  const activeDownload = useRef<AbortController | null>(null);
  useEffect(() => () => { activeDownload.current?.abort(); }, [message.id, report]);
  if (message.role !== "assistant" || !isDownloadableReport(report)) return null;
  const download = async () => {
    setBusy(true); setError("");
    const controller = new AbortController(); activeDownload.current?.abort(); activeDownload.current = controller;
    try {
      if (report.format === "PDF") await downloadHugoReportPdf(report, controller.signal);
      else await downloadSpreadsheetFile(report.fileName, "Ganancias cliente", reportSpreadsheetRows(report), undefined, controller.signal);
    }
    catch { setError("No se pudo generar el archivo. Intenta descargarlo nuevamente."); }
    finally { setBusy(false); }
  };
  return <section aria-label="Reporte de utilidades disponible" className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
    <p className="font-medium text-emerald-200">Reporte de utilidades por cliente</p>
    <p className="mt-1 text-xs text-slate-300">{report.dateFrom} a {report.dateTo} · Compensados: {report.includeCompensated ? "incluidos" : "excluidos"}</p>
    <p className="mt-1 text-xs text-slate-400">{report.exportedClients} de {report.matchedClients} clientes · {report.docsScanned} documentos revisados · límite {report.scanLimit}</p>
    {(report.truncatedByScan || report.truncatedByExport) && <p role="note" className="mt-2 text-xs text-amber-300">Resultado parcial: {report.truncatedByScan ? "se alcanzó el límite de revisión. " : ""}{report.truncatedByExport ? "se alcanzó el límite de clientes exportados." : ""}</p>}
    <details className="mt-2 text-xs"><summary className="cursor-pointer text-slate-300">Ver importes del reporte</summary><div className="mt-2 overflow-x-auto"><table className="whitespace-nowrap text-left"><thead><tr>{["Cliente", "Operaciones", "Bruto", "Base", "Costo despacho", "Superadmin", "Admin", "Operador", "Ganancia total", "Cargo cliente", "Neto cliente"].map(label => <th key={label} className="pr-4 pb-1">{label}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={row.clienteId}>{[row.clienteNombre || row.clienteId, row.operationsCount, row.grossAmount, row.baseAmount, row.despachoCostAmount, row.superadminEarningAmount, row.adminEarningAmount, row.operadorEarningAmount, row.totalEarningsAmount, row.clientChargeAmount, row.clientNetAmount].map((value, index) => <td key={index} className="pr-4 py-1">{String(value)}</td>)}</tr>)}</tbody></table></div></details>
    <button type="button" disabled={busy} onClick={() => void download()} className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Generando archivo…" : `Descargar ${report.format || "XLSX"}`}</button>
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
  </section>;
}
