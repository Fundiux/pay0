"use client";

import React, { useCallback, useEffect, useState } from "react";
import { DatabaseBackup } from "lucide-react";
import NoAccess from "@/components/NoAccess";
import WalletNavigation from "@/components/WalletNavigation";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { getIqBackfillMissingDocuments, getIqBackfillStatus, setIqBackfillEnabled, type IqBackfillMissingDocument, type IqBackfillStatus } from "@/services/iqBackfill";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthLabel = (month: string) => { const [y, m] = month.split("-").map(Number); return `${MONTHS[(m || 1) - 1]} ${y}`; };
const MONTH_STATUS: Record<string, { label: string; className: string }> = {
  CUADRADO: { label: "Cuadrado", className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" },
  CON_PENDIENTES: { label: "Con pendientes", className: "border-amber-400/30 bg-amber-500/10 text-amber-300" },
  EN_CURSO: { label: "En curso", className: "border-sky-400/30 bg-sky-500/10 text-sky-300" },
};
const TYPE_LABEL: Record<string, string> = { CLIENT: "clientes", SOLICITUD: "solicitudes", PAYMENT: "pagos", APPLICATION: "aplicaciones" };
const money = (value: number | null) => (value === null ? "—" : `$${Number(value).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dateTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—");
const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export default function RespaldoHistoricoPage() {
  const { profile } = useUserProfile();
  const { canAccess } = useModuleAccess(profile, "wallet", "saldos");
  const isSuperadmin = profile?.role === "superadmin";
  const [data, setData] = useState<IqBackfillStatus | null>(null);
  const [missing, setMissing] = useState<{ total: number; truncated: boolean; rows: IqBackfillMissingDocument[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setError(""); setData(await getIqBackfillStatus()); } catch { setError("No se pudo cargar el estado del respaldo."); }
  }, []);
  useEffect(() => { if (canAccess && isSuperadmin) void load(); }, [canAccess, isSuperadmin, load]);

  if (!canAccess || !isSuperadmin) return <NoAccess className="p-6 text-slate-400" message="Solo el superadministrador puede ver el respaldo histórico." />;

  async function toggle() {
    const next = !(data?.enabled === true);
    const ok = window.confirm(next
      ? "Se activa el respaldo histórico: el sistema trae de IQ, mes por mes desde enero de 2025, lo que ya se concretó, con su fecha original. No se envía nada a los clientes. ¿Activar?"
      : "Se pausa el respaldo histórico. Lo que ya se trajo se conserva. ¿Pausar?");
    if (!ok) return;
    setBusy(true);
    try { await setIqBackfillEnabled(next); await load(); } catch { setError("No se pudo cambiar el estado del respaldo."); } finally { setBusy(false); }
  }
  async function loadMissing() {
    setBusy(true);
    try { const r = await getIqBackfillMissingDocuments(); setMissing({ total: r.total, truncated: r.truncated, rows: r.rows }); } catch { setError("No se pudo armar el reporte de archivos faltantes."); } finally { setBusy(false); }
  }
  function downloadCsv() {
    if (!missing) return;
    const head = ["Tipo", "Número en IQ", "Folio IQ", "Cliente", "Socio", "Fecha", "Monto", "Intentos", "Motivo"];
    const lines = missing.rows.map(r => [r.kind, r.iqNumber, r.iqFolio, r.clientName, r.partner, r.date, r.amount, r.attempts, r.reason].map(csvCell).join(","));
    const blob = new Blob(["﻿" + [head.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "archivos-faltantes-iq.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  const closed = data?.months.filter(m => m.status === "CUADRADO" || m.status === "CON_PENDIENTES").length ?? 0;
  return (
    <div className="mx-auto w-full min-w-0 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex items-center gap-2">
          <DatabaseBackup size={18} className="text-sky-400" aria-hidden="true" />
          <h1 className="text-sm font-semibold uppercase tracking-widest text-white">Respaldo histórico de IQ</h1>
        </div>
        <button type="button" onClick={toggle} disabled={busy || !data} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${data?.enabled ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"}`}>
          {data?.enabled ? "Pausar respaldo" : "Activar respaldo"}
        </button>
      </header>
      {error && <p className="mb-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
      <p className="mb-4 text-sm text-slate-400">
        Trae de IQ, de enero de 2025 al 23 de noviembre de 2026, lo que ya se concretó, con su fecha original. Avanza lo más rápido que permite IQ, un mes tras otro. No se envía nada a los clientes.
      </p>
      {data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs text-slate-400">Estado</p><p className="text-sm font-semibold text-white">{data.enabled ? (data.status === "DONE" ? "Terminado" : "Trabajando") : "En pausa"}</p></div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs text-slate-400">Mes en curso</p><p className="text-sm font-semibold text-white">{data.cursorMonth ? monthLabel(data.cursorMonth) : "—"}</p></div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3"><p className="text-xs text-slate-400">Meses cerrados</p><p className="text-sm font-semibold text-white">{closed} de 23</p></div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-xs text-slate-200">
          <thead className="bg-white/5 uppercase tracking-wider text-slate-400"><tr><th className="p-2">Mes</th><th className="p-2">Estado</th><th className="p-2">Pendientes</th><th className="p-2">Lo último que trajo</th><th className="p-2">Última corrida</th></tr></thead>
          <tbody>
            {(data?.months || []).map(m => {
              const st = MONTH_STATUS[m.status] || { label: m.status, className: "border-white/15 text-slate-300" };
              const made = Object.entries(m.created).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${TYPE_LABEL[t] || t}`).join(", ");
              return (
                <tr key={m.month} className="border-t border-white/5">
                  <td className="p-2 font-medium capitalize">{monthLabel(m.month)}</td>
                  <td className="p-2"><span className={`rounded-full border px-2 py-0.5 ${st.className}`}>{st.label}</span></td>
                  <td className="p-2">{m.openReviews === null ? "—" : m.openReviews}</td>
                  <td className="p-2 text-slate-400">{made || "—"}</td>
                  <td className="p-2 text-slate-400">{dateTime(m.lastRunAtMs)}</td>
                </tr>
              );
            })}
            {data && !data.months.length && <tr><td colSpan={5} className="p-4 text-center text-slate-400">Todavía no empieza. Actívalo para comenzar con enero de 2025.</td></tr>}
          </tbody>
        </table>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-white">Archivos que IQ no entregó</h2>
        <p className="mt-1 text-sm text-slate-400">Facturas y comprobantes que el sistema no pudo traer. Al terminar el respaldo, descarga la lista y pídelos a IQ directamente.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={loadMissing} disabled={busy} className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 disabled:opacity-50">Armar reporte</button>
          {missing && missing.total > 0 && <button type="button" onClick={downloadCsv} className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-200">Descargar lista (Excel)</button>}
        </div>
        {missing && (
          <div className="mt-3">
            <p className="text-sm text-slate-300">{missing.total ? `${missing.total} archivos faltan${missing.truncated ? " (la lista puede ser más larga)" : ""}.` : "No falta ningún archivo."}</p>
            {missing.total > 0 && (
              <div className="mt-2 overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-left text-xs text-slate-200">
                  <thead className="bg-white/5 uppercase tracking-wider text-slate-400"><tr><th className="p-2">Archivo</th><th className="p-2">Cliente</th><th className="p-2">Socio</th><th className="p-2">Fecha</th><th className="p-2 text-right">Monto</th><th className="p-2">N.º en IQ</th><th className="p-2">Motivo</th></tr></thead>
                  <tbody>
                    {missing.rows.slice(0, 300).map((r, i) => (
                      <tr key={`${r.kind}-${r.iqNumber}-${i}`} className="border-t border-white/5">
                        <td className="p-2">{r.kind}</td><td className="p-2">{r.clientName || "—"}</td><td className="p-2">{r.partner}</td><td className="p-2">{r.date || "—"}</td>
                        <td className="p-2 text-right">{money(r.amount)}</td><td className="p-2">{r.iqNumber}</td><td className="p-2 text-slate-400">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
      <WalletNavigation />
    </div>
  );
}
