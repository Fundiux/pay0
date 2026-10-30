import type { Agent007ReportExport } from "@/services/agent007";

// Reuse the jsPDF/autotable stack already used by Reportes. Values stay canonical.
export async function downloadHugoReportPdf(report: Agent007ReportExport, signal?: AbortSignal): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  if (signal?.aborted) return;
  const doc = new jsPDF({ orientation: "landscape", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  doc.setTextColor(15, 23, 42); doc.setFontSize(16);
  doc.text("PAY0 | Utilidades por cliente", 12, 15);
  doc.setFontSize(9);
  doc.text(`Periodo: ${report.dateFrom} a ${report.dateTo} | Compensados: ${report.includeCompensated ? "incluidos" : "excluidos"}`, 12, 23);
  doc.text(`Clientes: ${report.exportedClients} de ${report.matchedClients} | Documentos revisados: ${report.docsScanned} | Límite de revisión: ${report.scanLimit}`, 12, 29);
  let tableY = 36;
  if (report.truncatedByScan || report.truncatedByExport) {
    doc.setTextColor(146, 64, 14);
    doc.text(`RESULTADO PARCIAL: ${report.truncatedByScan ? "límite de revisión alcanzado. " : ""}${report.truncatedByExport ? "límite de exportación alcanzado." : ""}`, 12, 36);
    tableY = 42;
  }
  autoTable(doc, {
    startY: tableY, margin: { left: 12, right: 12, top: 30, bottom: 14 },
    head: [["Cliente / ID / Último registro", "Ops.", "Bruto", "Base", "Costo\ndespacho", "Utilidad\nSuperadmin", "Utilidad\nAdmin", "Utilidad\nOperador", "Ganancia\ntotal", "Cargo\ncliente", "Neto\ncliente"]],
    body: report.rows.map(row => [`${row.clienteNombre || row.clienteId}\nID: ${row.clienteId}\n${row.lastCreatedAt || "Sin fecha"}`, String(row.operationsCount), String(row.grossAmount), String(row.baseAmount), String(row.despachoCostAmount), String(row.superadminEarningAmount), String(row.adminEarningAmount), String(row.operadorEarningAmount), String(row.totalEarningsAmount), String(row.clientChargeAmount), String(row.clientNetAmount)]),
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2, overflow: "linebreak", textColor: [15, 23, 42] },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: { 0: { cellWidth: 51 }, 1: { cellWidth: 12 } },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    didDrawPage: data => {
      if (data.pageNumber <= 1) return;
      doc.setFontSize(10); doc.setTextColor(15, 23, 42);
      doc.text("PAY0 | Utilidades por cliente", 12, 12);
      doc.setFontSize(8); doc.text(`${report.dateFrom} a ${report.dateTo} | Compensados: ${report.includeCompensated ? "incluidos" : "excluidos"}`, 12, 18);
      doc.text(`${report.truncatedByScan || report.truncatedByExport ? "Resultado parcial | " : ""}Clientes: ${report.exportedClients} de ${report.matchedClients} | Documentos: ${report.docsScanned} | Límite: ${report.scanLimit}`, 12, 24);
    },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text("PAY0 | Reporte de utilidades por cliente", 12, doc.internal.pageSize.getHeight() - 6);
    doc.text(`Página ${page} de ${pages}`, width - 12, doc.internal.pageSize.getHeight() - 6, { align: "right" });
  }
  if (!signal?.aborted) doc.save(report.fileName);
}
