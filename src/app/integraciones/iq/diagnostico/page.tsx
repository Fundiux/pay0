"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Layers3,
  Loader2,
  PauseCircle,
  RefreshCw,
  Search,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import {
  debugFindPagoIqDepositCandidates,
  debugPagoIqDepositHttpShadow,
  getIqAutomationDashboard,
  getIqDispersionDiagnostic,
  probeIqDispersionModule,
  manualLinkPagoIqDeposit,
  omitIqAutomationJob,
  omitPagoIqDepositAutomation,
  syncIqSolicitudInvoice,
  type OmitIqAutomationArea,
  type IqDispersionDiagnosticRow,
  type IqDispersionModuleProbeResult,
  type DebugPagoIqDepositHttpShadowResult,
} from "@/services/iq";

type ActiveTab = "solicitudes" | "pagos" | "dispersiones" | "aplicacion" | "control";

type JobRow = {
  id?: string | null;
  status?: string | null;
  solicitudId?: string | null;
  pagoId?: string | null;
  folio?: string | null;
  iqFolio?: string | null;
  profileAlias?: string | null;
  attempts?: number | null;
  nextRunAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  error?: string | null;
};

type SelectedOmit = {
  area: OmitIqAutomationArea;
  jobId?: string;
  folio?: string;
  pagoId?: string;
  solicitudId?: string;
  label: string;
};

const tabs: Array<{ id: ActiveTab; label: string; description: string }> = [
  { id: "solicitudes", label: "Solicitudes", description: "Tabla de jobs, facturas, creacion y estado." },
  { id: "pagos", label: "Pagos", description: "Depositos IQ: tabla, omision y vinculacion manual." },
  { id: "dispersiones", label: "Dispersiones", description: "Diagnostico PAY0 de preparacion para IQ, solo lectura." },
  { id: "aplicacion", label: "Aplicacion de pagos", description: "Espacio reservado para payment-applications." },
  { id: "control", label: "Control", description: "Resumen general, corridas y modo seguro." },
];

function asData(dashboard: any) {
  return dashboard?.data || dashboard || null;
}

function rowsOf(dashboard: any, key: string): JobRow[] {
  const data = asData(dashboard);
  const rows = data?.recent?.[key];
  return Array.isArray(rows) ? rows : [];
}

function summaryOf(dashboard: any, key: string): any {
  const data = asData(dashboard);
  return data?.summary?.[key] || {};
}

function queueRunsOf(dashboard: any): any[] {
  const data = asData(dashboard);
  const rows = data?.recent?.queueRuns;
  return Array.isArray(rows) ? rows : [];
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function pickReference(row: JobRow): string {
  return clean(row.folio) || clean(row.pagoId) || clean(row.solicitudId) || clean(row.id) || "---";
}

function formatDate(value?: string | null): string {
  if (!value) return "---";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("es-MX", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusClass(status?: string | null): string {
  const s = clean(status).toUpperCase();

  if (["IMPORTED", "CREATED", "CONFIRMED", "CONCILIATED", "OMITTED"].includes(s)) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  }

  if (["FAILED", "ERROR", "ERROR_RETRYABLE", "NOT_FOUND"].includes(s)) {
    return "border-red-500/30 bg-red-500/10 text-red-100";
  }

  if (["RUNNING", "PROCESSING"].includes(s)) {
    return "border-sky-500/30 bg-sky-500/10 text-sky-100";
  }

  if (["QUEUED", "WAITING", "WAITING_FOR_OPERATING_WINDOW", "PENDING_RECONCILIATION"].includes(s)) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  }

  return "border-slate-600 bg-slate-800/50 text-slate-200";
}

function SummaryCard({ title, summary }: { title: string; summary: any }) {
  const byStatus = summary?.byStatus || {};
  const statusText = Object.entries(byStatus)
    .sort((a: any, b: any) => Number(b[1]) - Number(a[1]))
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{title}</div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-xl font-semibold text-white">{summary?.active ?? 0}</div>
          <div className="text-[11px] text-slate-500">activos</div>
        </div>
        <div>
          <div className="text-xl font-semibold text-amber-200">{summary?.due ?? 0}</div>
          <div className="text-[11px] text-slate-500">vencidos</div>
        </div>
        <div>
          <div className="text-xl font-semibold text-red-200">{summary?.failed ?? 0}</div>
          <div className="text-[11px] text-slate-500">errores</div>
        </div>
      </div>
      <div className="mt-3 truncate text-xs text-slate-400" title={statusText || "Sin estados"}>
        {statusText || "Sin estados"}
      </div>
    </div>
  );
}

function JobsTable({
  title,
  rows,
  area,
  onSelect,
  onQuickOmit,
  onSyncSolicitud,
}: {
  title: string;
  rows: JobRow[];
  area: OmitIqAutomationArea;
  onSelect: (area: OmitIqAutomationArea, row: JobRow) => void;
  onQuickOmit: (area: OmitIqAutomationArea, row: JobRow) => void;
  onSyncSolicitud?: (row: JobRow) => void;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="text-xs text-slate-500">{rows.length} recientes</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-400">
          Sin registros recientes para mostrar.
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-[1100px] w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-800">
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">PAY0</th>
                <th className="px-3 py-2">Folio IQ</th>
                <th className="px-3 py-2">Perfil</th>
                <th className="px-3 py-2">Intentos</th>
                <th className="px-3 py-2">Siguiente / actualizado</th>
                <th className="px-3 py-2">Error</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const ref = pickReference(row);

                return (
                  <tr key={`${row.id || ref}-${index}`} className="border-b border-slate-800/70 align-top text-slate-300">
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClass(row.status)}`}>
                        {row.status || "UNKNOWN"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-100">{ref}</div>
                      <div className="mt-1 text-[11px] text-slate-500">job: {row.id || "---"}</div>
                    </td>
                    <td className="px-3 py-3">{row.iqFolio || "---"}</td>
                    <td className="px-3 py-3">{row.profileAlias || "---"}</td>
                    <td className="px-3 py-3">{row.attempts ?? 0}</td>
                    <td className="px-3 py-3">
                      <div>{formatDate(row.nextRunAt)}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{formatDate(row.updatedAt || row.createdAt)}</div>
                    </td>
                    <td className="max-w-[260px] px-3 py-3">
                      <div className="line-clamp-3 text-slate-400" title={row.error || ""}>
                        {row.error || "---"}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onSelect(area, row)}
                          className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-sky-400 hover:text-sky-100"
                        >
                          Seleccionar
                        </button>

                        <button
                          type="button"
                          onClick={() => onQuickOmit(area, row)}
                          className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-500/20"
                        >
                          Omitir
                        </button>

                        {onSyncSolicitud && row.solicitudId && (
                          <button
                            type="button"
                            onClick={() => onSyncSolicitud(row)}
                            className="rounded-lg border border-sky-500/50 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-500/20"
                          >
                            Sync factura
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function IqDiagnosticoPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("solicitudes");
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<any>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [solicitudId, setSolicitudId] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);

  const [selectedOmit, setSelectedOmit] = useState<SelectedOmit | null>(null);
  const [omitArea, setOmitArea] = useState<OmitIqAutomationArea>("all");
  const [omitReference, setOmitReference] = useState("");
  const [omitComment, setOmitComment] = useState("");
  const [omitBusy, setOmitBusy] = useState(false);

  const [pagoId, setPagoId] = useState("");
  const [iqDepositId, setIqDepositId] = useState("");
  const [reconciliationStatus, setReconciliationStatus] = useState<"LINKED" | "CONCILIATED">("LINKED");
  const [manualNote, setManualNote] = useState("");
  const [omitPagoReason, setOmitPagoReason] = useState("");
  const [omitPagoComment, setOmitPagoComment] = useState("");
  const [busyPago, setBusyPago] = useState<"link" | "omit" | "debug" | "shadow" | null>(null);
  const [debugCandidates, setDebugCandidates] = useState<any[]>([]);
  const [httpShadow, setHttpShadow] = useState<DebugPagoIqDepositHttpShadowResult | null>(null);
  const [debugExpected, setDebugExpected] = useState<any>(null);
  const [debugIqErrors, setDebugIqErrors] = useState<string[]>([]);
  const [dispersionDiagnostic, setDispersionDiagnostic] = useState<any>(null);
  const [dispersionLoading, setDispersionLoading] = useState(false);
  const [dispersionProbe, setDispersionProbe] = useState<IqDispersionModuleProbeResult | null>(null);
  const [dispersionProbeLoading, setDispersionProbeLoading] = useState(false);

  async function loadDispersionDiagnostic() {
    setDispersionLoading(true);
    setError("");

    try {
      const res = await getIqDispersionDiagnostic(100);
      setDispersionDiagnostic(res.data);
    } catch (err: any) {
      setError(err?.message || "No se pudo cargar diagnostico de dispersiones.");
    } finally {
      setDispersionLoading(false);
    }
  }

  async function runDispersionModuleProbe() {
    setDispersionProbeLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await probeIqDispersionModule();
      setDispersionProbe(res.data);
      setMessage(res.message);
    } catch (err: any) {
      setError(err?.message || "No se pudo explorar el modulo IQ de dispersiones.");
    } finally {
      setDispersionProbeLoading(false);
    }
  }

  async function loadDashboard() {
    setLoading(true);
    setError("");

    try {
      const res = await getIqAutomationDashboard();
      setDashboard(res.data);
    } catch (err: any) {
      setError(err?.message || "No se pudo cargar diagnostico IQ.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    loadDispersionDiagnostic();
  }, []);

  const invoiceRows = rowsOf(dashboard, "invoiceJobs");
  const createRows = rowsOf(dashboard, "createJobs");
  const statusRows = rowsOf(dashboard, "statusJobs");
  const pagoReceiptRows = rowsOf(dashboard, "pagoReceiptJobs");
  const pagoDepositStatusRows = rowsOf(dashboard, "pagoDepositStatusJobs");
  const queueRuns = queueRunsOf(dashboard);

  const controlSummary = useMemo(() => {
    return [
      { label: "Schedulers IQ", value: "Detenidos por H4-D53A/H4-D55A" },
      { label: "Modo actual", value: "Manual controlado desde diagnostico" },
      { label: "Crear IQ", value: "Solo por accion manual / nuevos casos" },
    ];
  }, []);

  function selectForOmit(area: OmitIqAutomationArea, row: JobRow) {
    const ref = pickReference(row);
    setSelectedOmit({
      area,
      jobId: clean(row.id) || undefined,
      folio: clean(row.folio) || undefined,
      pagoId: clean(row.pagoId) || undefined,
      solicitudId: clean(row.solicitudId) || undefined,
      label: ref,
    });
    setOmitArea(area);
    setOmitReference(ref);
    setOmitComment(`Omitido desde diagnostico PAY0: ${ref}`);
    setActiveTab("control");
  }

  async function omitRow(area: OmitIqAutomationArea, row: JobRow) {
    const ref = pickReference(row);
    const ok = window.confirm(`Omitir seguimiento IQ para ${ref}?`);
    if (!ok) return;

    setError("");
    setMessage("");
    setOmitBusy(true);

    try {
      const res = await omitIqAutomationJob({
        area,
        jobId: clean(row.id) || undefined,
        folio: clean(row.folio) || undefined,
        pagoId: clean(row.pagoId) || undefined,
        solicitudId: clean(row.solicitudId) || undefined,
        reason: "Omitido desde tablero",
        comment: `Omitido desde diagnostico PAY0: ${ref}`,
      });

      setMessage(res.message || `Seguimiento IQ omitido: ${ref}`);
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message || "No se pudo omitir seguimiento IQ.");
    } finally {
      setOmitBusy(false);
    }
  }

  async function omitSelected(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    const reference = omitReference.trim();
    const comment = omitComment.trim() || "Omitido desde diagnostico PAY0";

    if (!reference && !selectedOmit) {
      setError("Selecciona un renglon o captura una referencia.");
      return;
    }

    setOmitBusy(true);

    try {
      const payload = selectedOmit
        ? {
            area: selectedOmit.area,
            jobId: selectedOmit.jobId,
            folio: selectedOmit.folio,
            pagoId: selectedOmit.pagoId,
            solicitudId: selectedOmit.solicitudId,
            reason: "Omitido desde diagnostico",
            comment,
          }
        : {
            area: omitArea,
            jobId: reference,
            folio: reference,
            pagoId: reference,
            solicitudId: reference,
            reason: "Omitido desde diagnostico",
            comment,
          };

      const res = await omitIqAutomationJob(payload);
      setMessage(res.message || "Seguimiento IQ omitido.");
      setSelectedOmit(null);
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message || "No se pudo omitir seguimiento IQ.");
    } finally {
      setOmitBusy(false);
    }
  }

  async function syncSolicitud(row?: JobRow) {
    setError("");
    setMessage("");

    const cleanSolicitudId = clean(row?.solicitudId) || solicitudId.trim();
    if (!cleanSolicitudId) {
      setError("Solicitud PAY0 obligatoria.");
      return;
    }

    setSyncBusy(true);

    try {
      const result = await syncIqSolicitudInvoice(cleanSolicitudId, { force: true });
      setMessage(JSON.stringify(result, null, 2));
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message || "No se pudo sincronizar factura IQ.");
    } finally {
      setSyncBusy(false);
    }
  }

  async function onSyncSolicitudInvoice(event: FormEvent) {
    event.preventDefault();
    await syncSolicitud();
  }

  async function onDebugFindPago(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setDebugCandidates([]);
    setDebugExpected(null);
    setDebugIqErrors([]);
    setHttpShadow(null);

    const cleanPagoId = pagoId.trim();

    if (!cleanPagoId) {
      setError("Folio PAY0 obligatorio para buscar candidatos IQ.");
      return;
    }

    setBusyPago("debug");

    try {
      const res = await debugFindPagoIqDepositCandidates(cleanPagoId, { limit: 15, maxRows: 1000 });
      setDebugCandidates(res.data.candidates || []);
      setDebugExpected(res.data.expected || null);
      setDebugIqErrors(res.data.errors || []);
      setMessage(`${res.message || "Busqueda IQ terminada."} Revisados: ${res.data.rowsFetched}. Paginas: ${res.data.pagesFetched}.`);
    } catch (err: any) {
      setError(err?.message || "No se pudieron buscar candidatos IQ.");
    } finally {
      setBusyPago(null);
    }
  }

  async function onHttpShadowPago() {
    setError("");
    setMessage("");
    setHttpShadow(null);

    const cleanPagoId = pagoId.trim();

    if (!cleanPagoId) {
      setError("Folio PAY0 obligatorio para probar HTTP sombra.");
      return;
    }

    setBusyPago("shadow");

    try {
      const res = await debugPagoIqDepositHttpShadow(cleanPagoId, { maxRows: 300 });
      setHttpShadow(res.data);
      setMessage(res.message || "Comparacion HTTP sombra terminada.");
    } catch (err: any) {
      setError(err?.message || "No se pudo ejecutar HTTP sombra de depositos IQ.");
    } finally {
      setBusyPago(null);
    }
  }

  // H4_D85_A1_UI_DEPOSIT_HTTP_READ_ONLY_SHADOW

  // H4_D61A_UI_DEBUG_FIND_PAGO_IQ_DEPOSIT_CANDIDATES
  // H4_D61B_UI_PAGO_FOLIO_FIRST_CANDIDATES

  async function onManualLinkPago(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    const cleanPagoId = pagoId.trim();
    const cleanIqDepositId = iqDepositId.trim();

    if (!cleanPagoId || !cleanIqDepositId) {
      setError("Folio PAY0 y Folio/ID IQ son obligatorios.");
      return;
    }

    setBusyPago("link");

    try {
      const res = await manualLinkPagoIqDeposit({
        pagoId: cleanPagoId,
        iqDepositId: cleanIqDepositId,
        reconciliationStatus,
        note: manualNote.trim(),
      });

      setMessage(res.message || "Deposito IQ vinculado manualmente.");
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message || "No se pudo vincular el deposito IQ.");
    } finally {
      setBusyPago(null);
    }
  }

  async function onOmitPago(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    const cleanPagoId = pagoId.trim();
    const cleanReason = omitPagoReason.trim();

    if (!cleanPagoId || !cleanReason) {
      setError("Folio PAY0 y motivo son obligatorios para omitir seguimiento.");
      return;
    }

    setBusyPago("omit");

    try {
      const res = await omitPagoIqDepositAutomation({
        pagoId: cleanPagoId,
        reason: cleanReason,
        comment: omitPagoComment.trim(),
      });

      setMessage(res.message || "Seguimiento IQ Pagos omitido.");
      await loadDashboard();
    } catch (err: any) {
      setError(err?.message || "No se pudo omitir seguimiento IQ.");
    } finally {
      setBusyPago(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 md:px-8">
      <div className="mx-auto max-w-7xl">
        <Link href="/integraciones/iq" className="mb-3 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-sky-200">
          <ArrowLeft className="h-4 w-4" />
          Volver a Integraciones IQ
        </Link>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-sky-300">PAY0 / IQ</p>
              <h1 className="mt-2 text-2xl font-semibold text-white">Diagnostico IQ</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Tablero unico para ver pendientes, errores, intentos y seleccionar jobs IQ para omitir, sincronizar o vincular.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/integraciones/iq/automatizacion"
                className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/15"
              >
                Automatización
              </Link>
            <button
              type="button"
              onClick={() => { loadDashboard(); loadDispersionDiagnostic(); }}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/20 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Recargar
            </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {controlSummary.map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{item.label}</div>
                <div className="mt-2 text-sm font-semibold text-slate-100">{item.value}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-5">
            <SummaryCard title="Facturas" summary={summaryOf(dashboard, "invoices")} />
            <SummaryCard title="Creacion" summary={summaryOf(dashboard, "creations")} />
            <SummaryCard title="Estado" summary={summaryOf(dashboard, "statuses")} />
            <SummaryCard title="Pagos" summary={summaryOf(dashboard, "pagoReceipts")} />
            <SummaryCard title="Conciliacion pago" summary={summaryOf(dashboard, "pagoDepositStatuses")} />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "rounded-2xl border px-4 py-3 text-left transition",
                    selected
                      ? "border-sky-400 bg-sky-500/15 text-white"
                      : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-600 hover:text-slate-100",
                  ].join(" ")}
                >
                  <div className="text-sm font-semibold">{tab.label}</div>
                  <div className="mt-1 max-w-52 text-xs">{tab.description}</div>
                </button>
              );
            })}
          </div>

          {error && (
            <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
              {error}
            </div>
          )}

          {message && (
            <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100 whitespace-pre-wrap">
              {message}
            </div>
          )}
        </section>

        {activeTab === "solicitudes" && (
          <section className="mt-6 space-y-6">
            <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
              <form onSubmit={onSyncSolicitudInvoice} className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-sky-300" />
                  <div>
                    <h2 className="text-lg font-semibold text-white">Sincronizar solicitud puntual</h2>
                    <p className="text-sm text-slate-400">Usa ID de solicitud PAY0 o selecciona un renglon.</p>
                  </div>
                </div>

                <label className="block text-sm">
                  <span className="text-slate-300">Solicitud PAY0 ID</span>
                  <input
                    value={solicitudId}
                    onChange={(event) => setSolicitudId(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-400"
                    placeholder="ID de solicitud PAY0"
                  />
                </label>

                <button
                  type="submit"
                  disabled={syncBusy}
                  className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-60"
                >
                  {syncBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Sincronizar factura
                </button>
              </form>

              <form onSubmit={omitSelected} className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
                <div className="flex items-center gap-3">
                  <PauseCircle className="h-5 w-5 text-amber-300" />
                  <div>
                    <h2 className="text-lg font-semibold text-white">Omitir seguimiento seleccionado</h2>
                    <p className="text-sm text-slate-400">
                      Selecciona desde una tabla o captura una referencia. Esto marca el job como OMITTED.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                  <label className="block text-sm">
                    <span className="text-slate-300">Area</span>
                    <select
                      value={omitArea}
                      onChange={(event) => {
                        setOmitArea(event.target.value as OmitIqAutomationArea);
                        setSelectedOmit(null);
                      }}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-400"
                    >
                      <option value="all">Todas</option>
                      <option value="invoice">Facturas</option>
                      <option value="create">Creacion</option>
                      <option value="status">Estado</option>
                      <option value="pagoReceipt">Pagos</option>
                      <option value="pagoDepositStatus">Conciliacion pago</option>
                    </select>
                  </label>

                  <label className="block text-sm">
                    <span className="text-slate-300">Referencia</span>
                    <input
                      value={omitReference}
                      onChange={(event) => {
                        setOmitReference(event.target.value);
                        setSelectedOmit(null);
                      }}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-400"
                      placeholder="jobId, folio PAY0, pagoId o solicitudId"
                    />
                  </label>
                </div>

                {selectedOmit && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                    Seleccionado: {selectedOmit.label} / area {selectedOmit.area}
                  </div>
                )}

                <label className="block text-sm">
                  <span className="text-slate-300">Comentario</span>
                  <textarea
                    value={omitComment}
                    onChange={(event) => setOmitComment(event.target.value)}
                    className="mt-2 min-h-20 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-400"
                    placeholder="Motivo para auditoria"
                  />
                </label>

                <button
                  type="submit"
                  disabled={omitBusy}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
                >
                  {omitBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Omitir seguimiento
                </button>
              </form>
            </div>

            <JobsTable title="Facturas pendientes / recientes" rows={invoiceRows} area="invoice" onSelect={selectForOmit} onQuickOmit={omitRow} onSyncSolicitud={syncSolicitud} />
            <JobsTable title="Creacion IQ reciente" rows={createRows} area="create" onSelect={selectForOmit} onQuickOmit={omitRow} />
            <JobsTable title="Estado / rechazo reciente" rows={statusRows} area="status" onSelect={selectForOmit} onQuickOmit={omitRow} />
          </section>
        )}

        {activeTab === "pagos" && (
          <section className="mt-6 space-y-6">
            <JobsTable title="Pagos / depositos IQ recientes" rows={pagoReceiptRows} area="pagoReceipt" onSelect={selectForOmit} onQuickOmit={omitRow} />
            <JobsTable title="Conciliacion pagos IQ reciente" rows={pagoDepositStatusRows} area="pagoDepositStatus" onSelect={selectForOmit} onQuickOmit={omitRow} />

            <div className="grid gap-6 lg:grid-cols-3">
              <form onSubmit={onDebugFindPago} className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
                <div className="flex items-center gap-3">
                  <Search className="h-5 w-5 text-sky-300" />
                  <div>
                    <h2 className="text-lg font-semibold text-white">Buscar candidatos IQ</h2>
                    <p className="text-sm text-slate-400">No crea, no vincula y no cambia estado. Solo lee /deposits para encontrar coincidencias.</p>
                  </div>
                </div>

                <label className="block text-sm">
                  <span className="text-slate-300">Folio PAY0</span>
                  <input value={pagoId} onChange={(event) => setPagoId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-sky-400" placeholder="Ej. P2C7U1E1" />
                </label>

                <button type="submit" disabled={busyPago === "debug"} className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-60">
                  {busyPago === "debug" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Buscar en IQ
                </button>

                <button type="button" onClick={onHttpShadowPago} disabled={busyPago === "shadow"} className="ml-2 inline-flex items-center gap-2 rounded-xl border border-violet-400/50 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-100 hover:bg-violet-500/20 disabled:opacity-60">
                  {busyPago === "shadow" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Probar HTTP sombra
                </button>

                {httpShadow && (
                  <div className={`rounded-2xl border p-4 text-xs ${httpShadow.shadow.summary.readyForOperationalPilot ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : "border-amber-500/30 bg-amber-500/10 text-amber-100"}`}>
                    <div className="font-semibold">
                      {httpShadow.shadow.summary.readyForOperationalPilot ? "HTTP directo coincide con navegador" : "HTTP sombra requiere revision"}
                    </div>
                    <div className="mt-2 grid gap-1">
                      <div>Pago PAY0: {httpShadow.pagoFolio}</div>
                      <div>
                        Ruta IQ: {httpShadow.searchMode === "EXACT_IQ_ID"
                          ? `filter[id]=${httpShadow.expectedIqFolio || "SIN FOLIO IQ"}`
                          : `start_date=${(httpShadow.createdAtLowerBoundIso || "").slice(0, 10)}`}
                      </div>
                      <div>BÃºsqueda desde: {httpShadow.createdAtLowerBoundIso || "---"}</div>
                      <div>URL final IQ: {httpShadow.shadow.finalRequestPath || "---"}</div>
                      <div>Cliente: {httpShadow.clientName || "---"}</div>
                      <div>Empresa: {httpShadow.companyName || "---"}</div>
                      <div>Perfil IQ: {httpShadow.profileAlias || "---"}</div>
                      <div>Navegador: HTTP {httpShadow.shadow.browserReference.httpStatus} / {httpShadow.shadow.browserReference.rowsFetched} filas / {httpShadow.shadow.browserReference.elapsedMs} ms</div>
                      <div>HTTP directo: HTTP {httpShadow.shadow.directHttp.httpStatus} / {httpShadow.shadow.directHttp.rowsFetched} filas / {httpShadow.shadow.directHttp.elapsedMs} ms</div>
                      <div>Coincidencias: {httpShadow.shadow.summary.equivalent}/{httpShadow.shadow.summary.compared}</div>
                      <div>Navegador cerrado antes del HTTP: {httpShadow.shadow.browserClosedBeforeHttp ? "SI" : "NO"}</div>
                      <div>Operaciones IQ: solo GET, sin escrituras.</div>
                    </div>
                    {httpShadow.shadow.comparisons.map((comparison, index) => (
                      <div key={`${comparison.key}-${index}`} className="mt-3 rounded-xl border border-current/20 p-3">
                        <div>Navegador: {comparison.browser.found ? `IQ ${comparison.browser.iqId}` : "No encontrado"} / {comparison.browser.operationStatus || "---"} / {comparison.browser.reconciliationStatus || "---"}</div>
                        <div>HTTP: {comparison.http.found ? `IQ ${comparison.http.iqId}` : "No encontrado"} / {comparison.http.operationStatus || "---"} / {comparison.http.reconciliationStatus || "---"}</div>
                        <div>Paridad: {comparison.parity.equivalent ? "COINCIDE" : "DIFERENTE"}</div>
                      </div>
                    ))}
                    {httpShadow.shadow.errors.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {httpShadow.shadow.errors.slice(0, 5).map((item, index) => (
                          <div key={`${item}-${index}`}>{item}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {debugExpected && (
                  <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-xs text-slate-300">
                    <div className="font-semibold text-slate-100">PAY0 buscaba</div>
                    <div>Cliente: {debugExpected.clientName || "---"}</div>
                    <div>Empresa: {debugExpected.companyName || "---"}</div>
                    <div>Monto: {debugExpected.amount ?? "---"}</div>
                  </div>
                )}

                {debugIqErrors.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                    <div className="font-semibold">Avisos de busqueda IQ</div>
                    <div className="mt-1 space-y-1">
                      {debugIqErrors.slice(0, 5).map((item, index) => (
                        <div key={`${item}-${index}`}>{item}</div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="max-h-96 space-y-3 overflow-auto pr-1">
                  {debugCandidates.map((row, index) => (
                    <div key={`${row.iqId}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-100">IQ {row.iqId} / score {row.score}</div>
                          <div className="mt-1 text-slate-400">{(row.matchReasons || []).join(" + ") || "CANDIDATO"}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setIqDepositId(row.iqId || "");
                            setReconciliationStatus(/CONCILIAD|CONCILIATED/i.test(row.reconciliationStatus || row.operationStatus || "") ? "CONCILIATED" : "LINKED");
                            setManualNote(`Vinculacion por candidato IQ H4-D61A. Score ${row.score}. Razones: ${(row.matchReasons || []).join(" + ")}`);
                          }}
                          className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-500/20"
                        >
                          Usar folio
                        </button>
                      </div>
                      <div className="mt-2 grid gap-1 text-slate-400">
                        <div>Cliente: {row.client || "---"}</div>
                        <div>Empresa: {row.company || "---"}</div>
                        <div>Monto: {row.amount ?? row.sum ?? row.subtotal ?? "---"}</div>
                        <div>Estado: {row.operationStatus || "---"} / {row.reconciliationStatus || "---"}</div>
                        <div>Creado: {row.createdAt || "---"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </form>

              <form onSubmit={onManualLinkPago} className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                  <div>
                    <h2 className="text-lg font-semibold text-white">Vincular / corregir deposito IQ</h2>
                    <p className="text-sm text-slate-400">Usar cuando IQ si creo el deposito, pero PAY0 no logro confirmarlo automaticamente.</p>
                  </div>
                </div>

                <label className="block text-sm">
                  <span className="text-slate-300">Folio PAY0</span>
                  <input value={pagoId} onChange={(event) => setPagoId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-400" placeholder="Ej. P2C7U1E1" />
                </label>

                <label className="block text-sm">
                  <span className="text-slate-300">Folio / ID deposito IQ</span>
                  <input value={iqDepositId} onChange={(event) => setIqDepositId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-400" placeholder="Ej. 206936" />
                </label>

                <label className="block text-sm">
                  <span className="text-slate-300">Estado</span>
                  <select value={reconciliationStatus} onChange={(event) => setReconciliationStatus(event.target.value as "LINKED" | "CONCILIATED")} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-400">
                    <option value="LINKED">LINKED</option>
                    <option value="CONCILIATED">CONCILIATED</option>
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="text-slate-300">Nota</span>
                  <textarea value={manualNote} onChange={(event) => setManualNote(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-emerald-400" placeholder="Ej. Vinculacion manual por diagnostico. IQ visible en tabla." />
                </label>

                <button type="submit" disabled={busyPago === "link"} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-60">
                  {busyPago === "link" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Vincular deposito IQ
                </button>
              </form>

              <form onSubmit={onOmitPago} className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
                <div className="flex items-center gap-3">
                  <PauseCircle className="h-5 w-5 text-amber-300" />
                  <div>
                    <h2 className="text-lg font-semibold text-white">Omitir pago directo</h2>
                    <p className="text-sm text-slate-400">Omitir seguimiento por folio PAY0 cuando no esta visible en tabla.</p>
                  </div>
                </div>

                <label className="block text-sm">
                  <span className="text-slate-300">Folio PAY0</span>
                  <input value={pagoId} onChange={(event) => setPagoId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-400" placeholder="Ej. P2C7U1E1" />
                </label>

                <label className="block text-sm">
                  <span className="text-slate-300">Motivo</span>
                  <input value={omitPagoReason} onChange={(event) => setOmitPagoReason(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-400" placeholder="Ej. Prueba, duplicado, cancelado, cerrado manualmente" />
                </label>

                <label className="block text-sm">
                  <span className="text-slate-300">Comentario</span>
                  <textarea value={omitPagoComment} onChange={(event) => setOmitPagoComment(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-400" placeholder="Detalle para auditoria" />
                </label>

                <button type="submit" disabled={busyPago === "omit"} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60">
                  {busyPago === "omit" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Omitir pago
                </button>
              </form>
            </div>
          </section>
        )}

        {activeTab === "dispersiones" && (
          <section className="mt-6 space-y-5">
            <div className="rounded-3xl border border-purple-500/20 bg-slate-900/70 p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <WalletCards className="h-5 w-5 text-purple-300" />
                  <div>
                    <h2 className="text-lg font-semibold text-white">Dispersiones / H4-D61-A1</h2>
                    <p className="text-sm text-slate-400">Inventario PAY0 para preparar el mapeo IQ. Solo lectura: no crea, concilia ni modifica dispersiones.</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={loadDispersionDiagnostic} disabled={dispersionLoading} className="inline-flex items-center gap-2 rounded-xl border border-purple-500/40 bg-purple-500/10 px-4 py-2 text-sm font-semibold text-purple-100 hover:bg-purple-500/20 disabled:opacity-60">
                    {dispersionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Recargar dispersiones
                  </button>
                  <button type="button" onClick={runDispersionModuleProbe} disabled={dispersionProbeLoading} className="inline-flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/20 disabled:opacity-60">
                    {dispersionProbeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Explorar modulo IQ
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                {[
                  ["Total", dispersionDiagnostic?.summary?.total ?? 0],
                  ["Listas", dispersionDiagnostic?.summary?.ready ?? 0],
                  ["Vinculadas", dispersionDiagnostic?.summary?.linked ?? 0],
                  ["Bloqueadas", dispersionDiagnostic?.summary?.blocked ?? 0],
                  ["Con comprobante", dispersionDiagnostic?.summary?.withReceipt ?? 0],
                  ["Terminales", dispersionDiagnostic?.summary?.terminal ?? 0],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-center">
                    <div className="text-xl font-semibold text-white">{String(value)}</div>
                    <div className="text-[11px] text-slate-500">{String(label)}</div>
                  </div>
                ))}
              </div>
            </div>

            {dispersionProbe && (
              <div className="rounded-3xl border border-sky-500/20 bg-slate-900/70 p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-white">Mapa real del modulo IQ</h3>
                    <p className="text-sm text-slate-400">Solo login y navegacion GET. No se pulso Crear, Guardar ni Enviar.</p>
                  </div>
                  <div className="text-xs text-slate-400">Perfil: {dispersionProbe.profileAlias} | Asociado: {dispersionProbe.associatedName || "---"}</div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Entrada IQ</div>
                    <div className="mt-1 text-sm font-semibold text-white">{dispersionProbe.landingPath}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Rutas candidatas</div>
                    <div className="mt-1 text-sm font-semibold text-white">{dispersionProbe.candidateLinks.length}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Paginas inspeccionadas</div>
                    <div className="mt-1 text-sm font-semibold text-white">{dispersionProbe.pages.length}</div>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {dispersionProbe.pages.map((page) => (
                    <details key={page.path} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-sky-100">
                        {page.path} | HTTP {page.httpStatus} | campos {page.fields.length} | acciones {page.actions.length}
                      </summary>
                      <div className="mt-3 text-xs text-slate-400">{page.title || "Sin titulo"}</div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <div>
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Campos</div>
                          <div className="max-h-72 overflow-auto rounded-xl border border-slate-800 p-3 font-mono text-[11px] text-slate-300">
                            {page.fields.length ? page.fields.map((field, index) => (
                              <div key={`${page.path}-field-${index}`} className="border-b border-slate-800 py-2 last:border-0">
                                {field.tag}/{field.type || "---"} | name={field.name || "---"} | label={field.label || field.placeholder || "---"}
                                {field.options.length > 0 && <div className="mt-1 text-slate-500">Opciones: {field.options.map((option) => option.text || option.value).filter(Boolean).slice(0, 12).join(" | ")}</div>}
                              </div>
                            )) : "Sin campos visibles."}
                          </div>
                        </div>
                        <div>
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Acciones visibles</div>
                          <div className="max-h-72 overflow-auto rounded-xl border border-slate-800 p-3 font-mono text-[11px] text-slate-300">
                            {page.actions.length ? page.actions.map((action, index) => (
                              <div key={`${page.path}-action-${index}`} className="border-b border-slate-800 py-2 last:border-0">
                                {action.type || action.tag} | {action.text || action.name || action.id || "sin texto"}
                              </div>
                            )) : "Sin acciones visibles."}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 rounded-xl border border-slate-800 p-3 text-xs text-slate-400">{page.bodySnippet || "Sin texto visible."}</div>
                    </details>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-auto rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
              <table className="min-w-[1250px] w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr className="border-b border-slate-800">
                    <th className="px-3 py-2">Estado integracion</th>
                    <th className="px-3 py-2">Folio PAY0</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Beneficiario</th>
                    <th className="px-3 py-2">Destino</th>
                    <th className="px-3 py-2">Monto</th>
                    <th className="px-3 py-2">Comprobante</th>
                    <th className="px-3 py-2">IQ</th>
                    <th className="px-3 py-2">Bloqueos</th>
                    <th className="px-3 py-2">Creada</th>
                  </tr>
                </thead>
                <tbody>
                  {(dispersionDiagnostic?.rows || []).map((row: IqDispersionDiagnosticRow) => (
                    <tr key={row.id} className="border-b border-slate-800/70 align-top text-slate-300">
                      <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${row.integrationState === "LINKED" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : row.integrationState === "READY_FOR_IQ_MAPPING" ? "border-sky-500/30 bg-sky-500/10 text-sky-100" : "border-amber-500/30 bg-amber-500/10 text-amber-100"}`}>{row.integrationState}</span></td>
                      <td className="px-3 py-3"><div className="font-semibold text-white">{row.folio}</div><div className="mt-1 text-slate-500">{row.status}</div></td>
                      <td className="px-3 py-3">{row.clientName || "---"}</td>
                      <td className="px-3 py-3">{row.beneficiaryName || "---"}</td>
                      <td className="px-3 py-3"><div>{row.methodType || row.destinationKind || "---"}</div><div className="mt-1 text-slate-500">{row.bankName || ""} {row.destinationMasked || ""}</div></td>
                      <td className="px-3 py-3">{Number(row.amount || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" })}</td>
                      <td className="px-3 py-3">{row.hasReceipt ? `Si (${row.documentCount})` : "No"}</td>
                      <td className="px-3 py-3"><div>{row.iqFolio || "---"}</div><div className="mt-1 text-slate-500">{row.iqStatus || ""}</div></td>
                      <td className="max-w-[300px] px-3 py-3">{row.blockers.length ? row.blockers.join(" | ") : "---"}</td>
                      <td className="px-3 py-3">{formatDate(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!dispersionLoading && !(dispersionDiagnostic?.rows || []).length && <div className="p-4 text-sm text-slate-400">Sin dispersiones para mostrar.</div>}
            </div>
          </section>
        )}

        {activeTab === "aplicacion" && (
          <section className="mt-6 rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center gap-3">
              <Layers3 className="h-5 w-5 text-indigo-300" />
              <div>
                <h2 className="text-lg font-semibold text-white">Aplicacion de pagos</h2>
                <p className="text-sm text-slate-400">Pendiente para /payment-applications. Se mantiene centralizado aqui para no crear paginas sueltas.</p>
              </div>
            </div>
          </section>
        )}

        {activeTab === "control" && (
          <section className="mt-6 space-y-6">
            <form onSubmit={omitSelected} className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
              <h2 className="text-lg font-semibold text-white">Control de omision</h2>
              <p className="text-sm text-slate-400">Los schedulers IQ estan detenidos. Esta accion limpia/omite jobs viejos para que no queden en backlog.</p>

              <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                <label className="block text-sm">
                  <span className="text-slate-300">Area</span>
                  <select value={omitArea} onChange={(event) => setOmitArea(event.target.value as OmitIqAutomationArea)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-400">
                    <option value="all">Todas</option>
                    <option value="invoice">Facturas</option>
                    <option value="create">Creacion</option>
                    <option value="status">Estado</option>
                    <option value="pagoReceipt">Pagos</option>
                    <option value="pagoDepositStatus">Conciliacion pago</option>
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="text-slate-300">Referencia</span>
                  <input value={omitReference} onChange={(event) => setOmitReference(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-400" placeholder="jobId, folio PAY0, pagoId o solicitudId" />
                </label>
              </div>

              {selectedOmit && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                  Seleccionado: {selectedOmit.label} / area {selectedOmit.area}
                </div>
              )}

              <label className="block text-sm">
                <span className="text-slate-300">Comentario</span>
                <textarea value={omitComment} onChange={(event) => setOmitComment(event.target.value)} className="mt-2 min-h-20 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-400" placeholder="Motivo para auditoria" />
              </label>

              <button type="submit" disabled={omitBusy} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60">
                {omitBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                Omitir seguimiento
              </button>
            </form>

            <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
              <div className="mb-4 flex items-center gap-3">
                <Search className="h-5 w-5 text-sky-300" />
                <div>
                  <h2 className="text-lg font-semibold text-white">Corridas recientes</h2>
                  <p className="text-sm text-slate-400">Ultimas ejecuciones registradas antes del corte.</p>
                </div>
              </div>

              <div className="space-y-2">
                {queueRuns.length === 0 ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-400">Sin corridas recientes.</div>
                ) : (
                  queueRuns.map((row, index) => (
                    <div key={`${row.id || index}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-300">
                      <div className="font-semibold text-slate-100">{row.type || row.id || "Run"}</div>
                      <div className="mt-1 text-slate-500">{formatDate(row.createdAt)}</div>
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-400">
                        {JSON.stringify(row.summary || row, null, 2)}
                      </pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* IQ2G_H4_D57B_OPERATIONAL_TABLES */}
    </main>
  );
}