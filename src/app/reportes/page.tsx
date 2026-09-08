"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileDown, RefreshCw } from "lucide-react";

import DateScopeBar from "@/components/DateScopeBar";
import NoAccess from "@/components/NoAccess";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { CustomRange, DateScopeMode, getScopeRange, shiftBaseDate } from "@/lib/dateScope";
import {
  getEarningsByClientReport,
  getOperationalIntelligenceReport,
  getPaymentsFinancialPostingIssuesReport,
  type EarningsByClientReportResult,
  type EarningsByClientReportRow,
  type OperationalAlertRow,
  type OperationalClientRankingRow,
  type OperationalIntelligenceReportResult,
  type OperationalUserActivityRow,
  type PaymentsFinancialPostingIssuesReportResult,
  type PaymentsFinancialPostingIssuesReportRow,
} from "@/services/reports";

type ReportTab = "earnings" | "operational" | "postingIssues";

function money(value: number | null | undefined) {
  const amount = Number(value || 0);

  return amount.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatExportDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function severityClass(severity: string) {
  if (severity === "CRITICAL") {
    return "border-rose-400/30 bg-rose-500/10 text-rose-200";
  }

  if (severity === "WARNING") {
    return "border-amber-400/30 bg-amber-500/10 text-amber-200";
  }

  return "border-sky-400/30 bg-sky-500/10 text-sky-200";
}

function statusClass(status: string) {
  if (status === "POSTED") {
    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  }

  if (status.startsWith("SKIPPED_") || status === "PENDING_CONFIGURATION" || status === "SIN_POSTEO") {
    return "border-rose-400/30 bg-rose-500/10 text-rose-200";
  }

  if (status === "PENDING") {
    return "border-amber-400/30 bg-amber-500/10 text-amber-200";
  }

  return "border-white/10 bg-white/5 text-slate-300";
}

async function exportToExcel(filename: string, sheetName: string, rows: Record<string, unknown>[]) {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename);
}

export default function ReportesPage() {
  const { profile, loading: profileLoading } = useUserProfile();

  const [activeTab, setActiveTab] = useState<ReportTab>("earnings");
  const [mode, setMode] = useState<DateScopeMode>("month");
  const [baseDate, setBaseDate] = useState(new Date());
  const [customRange, setCustomRange] = useState<CustomRange>({});

  const [earningsLoading, setEarningsLoading] = useState(false);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [operationalLoading, setOperationalLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [earningsError, setEarningsError] = useState("");
  const [issuesError, setIssuesError] = useState("");
  const [operationalError, setOperationalError] = useState("");
  const [exportError, setExportError] = useState("");

  const [earningsResult, setEarningsResult] = useState<EarningsByClientReportResult | null>(null);
  const [issuesResult, setIssuesResult] = useState<PaymentsFinancialPostingIssuesReportResult | null>(null);
  const [operationalResult, setOperationalResult] = useState<OperationalIntelligenceReportResult | null>(null);

  const range = useMemo(() => getScopeRange(mode, baseDate, customRange), [mode, baseDate, customRange]);

  const { canAccess: canViewReports } = useModuleAccess(profile, "reportes", "view");

  async function loadEarningsReport() {
    setEarningsLoading(true);
    setEarningsError("");

    try {
      const data = await getEarningsByClientReport({
        dateFrom: range.from.toISOString(),
        dateTo: range.to.toISOString(),
        includeCompensated: false,
        limit: 5000,
      });

      setEarningsResult(data);
    } catch (err: any) {
      console.error("getEarningsByClientReport error", err);
      setEarningsError(err?.message || "No se pudo cargar el reporte de ganancias.");
    } finally {
      setEarningsLoading(false);
    }
  }

  async function loadPostingIssuesReport() {
    setIssuesLoading(true);
    setIssuesError("");

    try {
      const data = await getPaymentsFinancialPostingIssuesReport({
        dateFrom: range.from.toISOString(),
        dateTo: range.to.toISOString(),
        includePosted: false,
        includeNotConciliated: false,
        limit: 5000,
      });

      setIssuesResult(data);
    } catch (err: any) {
      console.error("getPaymentsFinancialPostingIssuesReport error", err);
      setIssuesError(err?.message || "No se pudo cargar el reporte de alertas.");
    } finally {
      setIssuesLoading(false);
    }
  }

  async function loadOperationalReport() {
    setOperationalLoading(true);
    setOperationalError("");

    try {
      const isLocalhost =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

      if (isLocalhost) {
        const localPreview = {
          scopeRole: "local-preview",
          docsScanned: 0,
          summary: {
            pagosCount: 0,
            pagosAmount: 0,
            dispersionesCount: 0,
            dispersionesAmount: 0,
            adelantosCount: 0,
            adelantosAmount: 0,
            activityEventsCount: 0,
            alertsCount: 0,
            pendingFinancialPostingsCount: 0,
            openDispersionIncidentsCount: 0,
          },
          clientRanking: [],
          userActivity: [],
          alerts: [],
        } as OperationalIntelligenceReportResult;

        setOperationalResult(localPreview);
        return;
      }

      const data = await getOperationalIntelligenceReport({
        dateFrom: range.from.toISOString(),
        dateTo: range.to.toISOString(),
        limit: 5000,
      });

      setOperationalResult(data);
    } catch (err: any) {
      console.error("getOperationalIntelligenceReport error", err);
      setOperationalError(err?.message || "No se pudo cargar inteligencia operativa.");
    } finally {
      setOperationalLoading(false);
    }
  }

  async function loadCurrentTab() {
    if (activeTab === "earnings") {
      await loadEarningsReport();
      return;
    }

    if (activeTab === "operational") {
      await loadOperationalReport();
      return;
    }

    await loadPostingIssuesReport();
  }

  async function exportActiveTab() {
    setExportError("");
    setExporting(true);

    try {
      const from = formatExportDate(range.from);
      const to = formatExportDate(range.to);

      if (activeTab === "earnings") {
        const rows = (earningsResult?.rows || []).map((row) => ({
          Cliente: row.clienteNombre || row.clienteId,
          ClienteId: row.clienteId,
          Operaciones: row.operationsCount,
          Bruto: row.grossAmount,
          CargoCliente: row.clientChargeAmount,
          CostoDespacho: row.despachoCostAmount,
          Superadmin: row.superadminEarningAmount,
          Admin: row.adminEarningAmount,
          Operador: row.operadorEarningAmount,
          GananciaTotal: row.totalEarningsAmount,
          NetoCliente: row.clientNetAmount,
          Ultimo: formatDate(row.lastCreatedAt),
        }));

        if (rows.length === 0) {
          setExportError("No hay datos para exportar.");
          return;
        }

        await exportToExcel(`pay0-ganancias-cliente-${from}-a-${to}.xlsx`, "Ganancias cliente", rows);
        return;
      }

      if (activeTab === "operational") {
        const rows = [
          ...clientRankingRows.map((row) => ({
            Tipo: "Cliente",
            Cliente: row.clienteNombre || row.clienteId,
            ClienteId: row.clienteId,
            PagosMonto: row.pagosAmount,
            PagosCount: row.pagosCount,
            DispersionesMonto: row.dispersionesAmount,
            DispersionesCount: row.dispersionesCount,
            Ganancias: row.earningsAmount,
            Actividad: row.activityCount,
            Ultimo: formatDate(row.lastActivityAt),
          })),
          ...userActivityRows.map((row) => ({
            Tipo: "Usuario",
            Usuario: row.actorUsername || "Usuario sin nombre",
            Eventos: row.eventsCount,
            Ultimo: formatDate(row.lastActivityAt),
          })),
          ...operationalAlertRows.map((row) => ({
            Tipo: "Alerta",
            Alerta: row.title,
            Referencia: row.referenceFolio || row.referenceId || "",
            Monto: row.amount,
            Severidad: row.severity,
            Estatus: row.status || "",
            Fecha: formatDate(row.createdAt),
            Descripcion: row.description,
          })),
        ];

        if (rows.length === 0) {
          setExportError("No hay datos para exportar.");
          return;
        }

        await exportToExcel(`pay0-inteligencia-operativa-${from}-a-${to}.xlsx`, "Inteligencia operativa", rows);
        return;
      }

      const rows = (issuesResult?.rows || []).map((row) => ({
        Pago: row.folio,
        PagoId: row.pagoId,
        Cliente: row.clienteNombre || row.clienteId || "",
        Empresa: row.empresaNombre || row.companyId || "",
        Monto: row.amount,
        EstatusPago: row.status,
        Posteo: row.financialPostingStatus,
        Severidad: row.severity,
        Accion: row.actionLabel,
        Error: row.financialPostingError || "",
        Fecha: formatDate(row.createdAt),
      }));

      if (rows.length === 0) {
        setExportError("No hay datos para exportar.");
        return;
      }

      await exportToExcel(`pay0-alertas-financieras-${from}-a-${to}.xlsx`, "Alertas financieras", rows);
    } catch (err: any) {
      console.error("Export report error", err);
      setExportError(err?.message || "No se pudo exportar el reporte.");
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    if (!profileLoading && canViewReports) {
      loadEarningsReport();
      loadOperationalReport();
      loadPostingIssuesReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading, canViewReports, range.from.getTime(), range.to.getTime()]);

  if (profileLoading) {
    return (
      <div className="mx-auto w-full max-w-[1600px] py-6 text-slate-400">
        Cargando reportes...
      </div>
    );
  }

  if (!canViewReports) {
    return <NoAccess message="No tienes acceso a Reportes." />;
  }

  const earningsSummary = earningsResult?.summary;
  const earningsRows: EarningsByClientReportRow[] = earningsResult?.rows || [];

  const issuesSummary = issuesResult?.summary;
  const issueRows: PaymentsFinancialPostingIssuesReportRow[] = issuesResult?.rows || [];

  const operationalSummary = operationalResult?.summary;
  const clientRankingRows: OperationalClientRankingRow[] = operationalResult?.clientRanking || [];
  const userActivityRows: OperationalUserActivityRow[] = operationalResult?.userActivity || [];
  const operationalAlertRows: OperationalAlertRow[] = operationalResult?.alerts || [];

  const currentLoading =
    activeTab === "earnings" ? earningsLoading : activeTab === "operational" ? operationalLoading : issuesLoading;

  const activeRowsCount =
    activeTab === "earnings"
      ? earningsRows.length
      : activeTab === "operational"
        ? clientRankingRows.length + userActivityRows.length + operationalAlertRows.length
        : issueRows.length;

  return (
    <div className="mx-auto w-full max-w-[1600px] min-w-0 pb-10 text-white">
      <header className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-sky-400">
            Reportes
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white">
            Centro financiero
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Ganancias, alertas de posteo e inteligencia operativa.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={exportActiveTab}
            disabled={exporting || activeRowsCount === 0}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 text-[11px] font-bold uppercase tracking-wide text-emerald-300 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileDown size={15} />
            {exporting ? "Exportando" : "Exportar Excel"}
          </button>

          <button
            type="button"
            onClick={loadCurrentTab}
            disabled={currentLoading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-sky-400/40 bg-sky-400/10 px-4 text-[11px] font-bold uppercase tracking-wide text-sky-300 transition hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={15} className={currentLoading ? "animate-spin" : ""} />
            {currentLoading ? "Cargando" : "Actualizar"}
          </button>
        </div>
      </header>

      <div className="mb-5 grid min-w-0 grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-center">
        <DateScopeBar
          className="min-w-0 w-full"
          mode={mode}
          baseDate={baseDate}
          customRange={customRange}
          onModeChange={(m) => {
            setMode(m);
            if (m !== "custom") {
              setCustomRange({});
              setBaseDate(new Date());
            }
          }}
          onNavigate={(direction) => setBaseDate((prev) => shiftBaseDate(mode, prev, direction))}
          onCustomRangeChange={(rangeValue) => {
            setCustomRange(rangeValue);
            if (rangeValue.start && rangeValue.end) {
              setMode("custom");
            }
          }}
        />

        <div className="rounded-xl border border-white/10 bg-[#111827] px-3 py-2 text-xs text-slate-400">
          {formatDate(range.from.toISOString())} - {formatDate(range.to.toISOString())}
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-2 rounded-2xl border border-white/10 bg-[#111827] p-2 sm:flex-row">
        <button
          type="button"
          onClick={() => setActiveTab("earnings")}
          className={
            activeTab === "earnings"
              ? "h-11 flex-1 rounded-xl bg-sky-400/15 px-4 text-[11px] font-bold uppercase tracking-wide text-sky-300"
              : "h-11 flex-1 rounded-xl px-4 text-[11px] font-bold uppercase tracking-wide text-slate-400 hover:bg-white/5"
          }
        >
          Ganancias por cliente
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("operational")}
          className={
            activeTab === "operational"
              ? "h-11 flex-1 rounded-xl bg-emerald-400/15 px-4 text-[11px] font-bold uppercase tracking-wide text-emerald-300"
              : "h-11 flex-1 rounded-xl px-4 text-[11px] font-bold uppercase tracking-wide text-slate-400 hover:bg-white/5"
          }
        >
          Inteligencia operativa
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("postingIssues")}
          className={
            activeTab === "postingIssues"
              ? "h-11 flex-1 rounded-xl bg-rose-400/15 px-4 text-[11px] font-bold uppercase tracking-wide text-rose-300"
              : "h-11 flex-1 rounded-xl px-4 text-[11px] font-bold uppercase tracking-wide text-slate-400 hover:bg-white/5"
          }
        >
          Alertas financieras
        </button>
      </div>

      {exportError ? (
        <div className="mb-5 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          {exportError}
        </div>
      ) : null}

      {activeTab === "earnings" ? (
        <>
          {earningsError ? (
            <div className="mb-5 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {earningsError}
            </div>
          ) : null}

          <section className="mb-5 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-4">
            <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111827] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Clientes</p>
              <p className="mt-2 text-3xl font-black text-white">{earningsSummary?.clientsCount || 0}</p>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111827] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Operaciones</p>
              <p className="mt-2 text-3xl font-black text-white">{earningsSummary?.operationsCount || 0}</p>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111827] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Monto bruto</p>
              <p className="mt-2 break-words font-mono text-2xl font-black text-white">
                {money(earningsSummary?.grossAmount)}
              </p>
            </div>

            <div className="min-w-0 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">Ganancia total</p>
              <p className="mt-2 break-words font-mono text-2xl font-black text-emerald-300">
                {money(earningsSummary?.totalEarningsAmount)}
              </p>
            </div>
          </section>

          <div className="min-w-0 overflow-x-auto rounded-2xl border border-white/10 bg-[#111827] shadow-2xl">
            <table className="pay0-table min-w-[1200px]">
              <thead>
                <tr>
                  <th>CLIENTE</th>
                  <th>OPS</th>
                  <th>BRUTO</th>
                  <th>CARGO CLIENTE</th>
                  <th>COSTO DESPACHO</th>
                  <th>SUPERADMIN</th>
                  <th>ADMIN</th>
                  <th>OPERADOR</th>
                  <th>GANANCIA TOTAL</th>
                  <th>NETO CLIENTE</th>
                  <th>ULTIMO</th>
                </tr>
              </thead>

              <tbody>
                {earningsLoading && earningsRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-400">
                      Cargando reporte...
                    </td>
                  </tr>
                ) : earningsRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-400">
                      Sin datos de ganancias generadas.
                    </td>
                  </tr>
                ) : (
                  earningsRows.map((row) => (
                    <tr key={row.clienteId}>
                      <td>
                        <div className="max-w-[260px] truncate font-bold text-white">
                          {row.clienteNombre || row.clienteId}
                        </div>
                        <div className="max-w-[260px] truncate text-[10px] text-slate-500">
                          {row.clienteId}
                        </div>
                      </td>
                      <td>{row.operationsCount}</td>
                      <td>{money(row.grossAmount)}</td>
                      <td>{money(row.clientChargeAmount)}</td>
                      <td>{money(row.despachoCostAmount)}</td>
                      <td>{money(row.superadminEarningAmount)}</td>
                      <td>{money(row.adminEarningAmount)}</td>
                      <td>{money(row.operadorEarningAmount)}</td>
                      <td className="font-bold text-emerald-300">{money(row.totalEarningsAmount)}</td>
                      <td>{money(row.clientNetAmount)}</td>
                      <td>{formatDate(row.lastCreatedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-slate-500">
            Scope: {earningsResult?.scopeRole || "-"} | Docs leidos: {earningsResult?.docsScanned || 0}
          </div>
        </>
      ) : activeTab === "postingIssues" ? (
        <>
          {issuesError ? (
            <div className="mb-5 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {issuesError}
            </div>
          ) : null}

          <section className="mb-5 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-4">
            <div className="min-w-0 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-300">Alertas</p>
              <p className="mt-2 text-3xl font-black text-rose-200">{issuesSummary?.paymentsCount || 0}</p>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111827] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Monto revisado</p>
              <p className="mt-2 break-words font-mono text-2xl font-black text-white">
                {money(issuesSummary?.totalAmount)}
              </p>
            </div>

            <div className="min-w-0 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Pendientes</p>
              <p className="mt-2 text-3xl font-black text-amber-200">
                {(issuesSummary?.pendingCount || 0) + (issuesSummary?.configurationCount || 0)}
              </p>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111827] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Sin costo</p>
              <p className="mt-2 text-3xl font-black text-white">
                {(issuesSummary?.missingClientRateCount || 0) + (issuesSummary?.missingDespachoCostCount || 0)}
              </p>
            </div>
          </section>

          <div className="mb-5 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
              <div>
                <p className="font-bold">Este reporte no recalcula dinero.</p>
                <p className="mt-1 text-amber-100/80">
                  Solo muestra pagos conciliados que no llegaron a POSTED o que tienen configuracion incompleta.
                </p>
              </div>
            </div>
          </div>

          <div className="min-w-0 overflow-x-auto rounded-2xl border border-white/10 bg-[#111827] shadow-2xl">
            <table className="pay0-table min-w-[1250px]">
              <thead>
                <tr>
                  <th>PAGO</th>
                  <th>CLIENTE</th>
                  <th>MONTO</th>
                  <th>ESTATUS PAGO</th>
                  <th>POSTEO</th>
                  <th>SEVERIDAD</th>
                  <th>ACCION</th>
                  <th>ERROR</th>
                  <th>FECHA</th>
                </tr>
              </thead>

              <tbody>
                {issuesLoading && issueRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      Cargando alertas...
                    </td>
                  </tr>
                ) : issueRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      Sin alertas financieras.
                    </td>
                  </tr>
                ) : (
                  issueRows.map((row) => (
                    <tr key={row.pagoId}>
                      <td>
                        <div className="max-w-[180px] truncate font-bold text-white">{row.folio}</div>
                        <div className="max-w-[180px] truncate text-[10px] text-slate-500">{row.pagoId}</div>
                      </td>
                      <td>
                        <div className="max-w-[240px] truncate font-bold text-white">
                          {row.clienteNombre || row.clienteId || "-"}
                        </div>
                        <div className="max-w-[240px] truncate text-[10px] text-slate-500">
                          {row.empresaNombre || row.companyId || "-"}
                        </div>
                      </td>
                      <td>{money(row.amount)}</td>
                      <td>{row.status}</td>
                      <td>
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${statusClass(row.financialPostingStatus)}`}>
                          {row.financialPostingStatus}
                        </span>
                      </td>
                      <td>
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${severityClass(row.severity)}`}>
                          {row.severity}
                        </span>
                      </td>
                      <td>
                        <div className="max-w-[220px] truncate text-slate-200">{row.actionLabel}</div>
                      </td>
                      <td>
                        <div className="max-w-[320px] truncate text-slate-400">
                          {row.financialPostingError || "-"}
                        </div>
                      </td>
                      <td>{formatDate(row.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-slate-500">
            Scope: {issuesResult?.scopeRole || "-"} | Docs leidos: {issuesResult?.docsScanned || 0}
          </div>
        </>
      ) : (
        <>
          {operationalError ? (
            <div className="mb-5 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {operationalError}
            </div>
          ) : null}

          <section className="mb-5 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-4">
            <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111827] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Pagos</p>
              <p className="mt-2 text-3xl font-black text-white">{operationalSummary?.pagosCount || 0}</p>
              <p className="mt-1 break-words font-mono text-sm text-slate-400">{money(operationalSummary?.pagosAmount)}</p>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111827] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Dispersiones</p>
              <p className="mt-2 text-3xl font-black text-white">{operationalSummary?.dispersionesCount || 0}</p>
              <p className="mt-1 break-words font-mono text-sm text-slate-400">{money(operationalSummary?.dispersionesAmount)}</p>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111827] p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Adelantos</p>
              <p className="mt-2 text-3xl font-black text-white">{operationalSummary?.adelantosCount || 0}</p>
              <p className="mt-1 break-words font-mono text-sm text-slate-400">{money(operationalSummary?.adelantosAmount)}</p>
            </div>

            <div className="min-w-0 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Alertas</p>
              <p className="mt-2 text-3xl font-black text-amber-200">{operationalSummary?.alertsCount || 0}</p>
              <p className="mt-1 text-sm text-amber-100/70">
                Posteo: {operationalSummary?.pendingFinancialPostingsCount || 0} | Incidencias: {operationalSummary?.openDispersionIncidentsCount || 0}
              </p>
            </div>
          </section>

          <section className="mb-5 grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="min-w-0 overflow-x-auto rounded-2xl border border-white/10 bg-[#111827] shadow-2xl">
              <div className="border-b border-white/10 px-4 py-3">
                <h2 className="text-sm font-black uppercase tracking-wide text-white">Ranking clientes</h2>
                <p className="mt-1 text-xs text-slate-500">Pagos, dispersiones, ganancias y actividad.</p>
              </div>

              <table className="pay0-table min-w-[900px]">
                <thead>
                  <tr>
                    <th>CLIENTE</th>
                    <th>PAGOS</th>
                    <th>DISP</th>
                    <th>GANANCIA</th>
                    <th>ACT</th>
                    <th>ULTIMO</th>
                  </tr>
                </thead>

                <tbody>
                  {operationalLoading && clientRankingRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        Cargando inteligencia...
                      </td>
                    </tr>
                  ) : clientRankingRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        Sin ranking de clientes.
                      </td>
                    </tr>
                  ) : (
                    clientRankingRows.map((row) => (
                      <tr key={row.clienteId}>
                        <td>
                          <div className="max-w-[240px] truncate font-bold text-white">
                            {row.clienteNombre || row.clienteId}
                          </div>
                          <div className="max-w-[240px] truncate text-[10px] text-slate-500">
                            {row.clienteId}
                          </div>
                        </td>
                        <td>
                          <div>{money(row.pagosAmount)}</div>
                          <div className="text-[10px] text-slate-500">{row.pagosCount} pagos</div>
                        </td>
                        <td>
                          <div>{money(row.dispersionesAmount)}</div>
                          <div className="text-[10px] text-slate-500">{row.dispersionesCount} dispersiones</div>
                        </td>
                        <td className="font-bold text-emerald-300">{money(row.earningsAmount)}</td>
                        <td>{row.activityCount}</td>
                        <td>{formatDate(row.lastActivityAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="min-w-0 overflow-x-auto rounded-2xl border border-white/10 bg-[#111827] shadow-2xl">
              <div className="border-b border-white/10 px-4 py-3">
                <h2 className="text-sm font-black uppercase tracking-wide text-white">Actividad usuarios</h2>
                <p className="mt-1 text-xs text-slate-500">Eventos registrados por actor en el periodo.</p>
              </div>

              <table className="pay0-table min-w-[650px]">
                <thead>
                  <tr>
                    <th>USUARIO</th>
                    <th>EVENTOS</th>
                    <th>ULTIMO</th>
                  </tr>
                </thead>

                <tbody>
                  {operationalLoading && userActivityRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-400">
                        Cargando actividad...
                      </td>
                    </tr>
                  ) : userActivityRows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-400">
                        Sin actividad de usuarios.
                      </td>
                    </tr>
                  ) : (
                    userActivityRows.map((row) => (
                      <tr key={row.actorUid}>
                        <td>
                          <div className="max-w-[260px] truncate font-bold text-white">
                            {row.actorUsername || "Usuario sin nombre"}
                          </div>
                        </td>
                        <td>{row.eventsCount}</td>
                        <td>{formatDate(row.lastActivityAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="min-w-0 overflow-x-auto rounded-2xl border border-white/10 bg-[#111827] shadow-2xl">
            <div className="border-b border-white/10 px-4 py-3">
              <h2 className="text-sm font-black uppercase tracking-wide text-white">Alertas operativas</h2>
              <p className="mt-1 text-xs text-slate-500">Posteos financieros pendientes e incidencias abiertas.</p>
            </div>

            <table className="pay0-table min-w-[1100px]">
              <thead>
                <tr>
                  <th>TIPO</th>
                  <th>REF</th>
                  <th>MONTO</th>
                  <th>SEVERIDAD</th>
                  <th>ESTATUS</th>
                  <th>FECHA</th>
                  <th>DESC</th>
                </tr>
              </thead>

              <tbody>
                {operationalLoading && operationalAlertRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      Cargando alertas...
                    </td>
                  </tr>
                ) : operationalAlertRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      Sin alertas operativas.
                    </td>
                  </tr>
                ) : (
                  operationalAlertRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="max-w-[230px] truncate font-bold text-white">{row.title}</div>
                        <div className="max-w-[230px] truncate text-[10px] text-slate-500">{row.type}</div>
                      </td>
                      <td>
                        <div className="max-w-[160px] truncate text-slate-200">
                          {row.referenceFolio || row.referenceId || "-"}
                        </div>
                      </td>
                      <td>{money(row.amount)}</td>
                      <td>
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${severityClass(row.severity)}`}>
                          {row.severity}
                        </span>
                      </td>
                      <td>{row.status || "-"}</td>
                      <td>{formatDate(row.createdAt)}</td>
                      <td>
                        <div className="max-w-[320px] truncate text-slate-400">
                          {row.description}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-slate-500">
            Scope: {operationalResult?.scopeRole || "-"} | Docs leidos: {operationalResult?.docsScanned || 0}
          </div>
        </>
      )}
    </div>
  );
}
