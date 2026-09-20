"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, RefreshCw } from "lucide-react";

import type { ControlCenterSnapshot } from "@/services/controlCenter";

const money = (value: number) => Number(value || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

function HealthIcon({ status }: { status: string }) {
  if (status === "HEALTHY") return <CheckCircle2 className="text-emerald-400" size={18} />;
  if (status === "CRITICAL") return <AlertTriangle className="text-rose-400" size={18} />;
  if (status === "WARNING") return <AlertTriangle className="text-amber-400" size={18} />;
  return <CircleHelp className="text-slate-500" size={18} />;
}

export default function ControlCenterOverview({ snapshot, loading, error, onRefresh, canRefresh }: { snapshot: ControlCenterSnapshot | null; loading: boolean; error: string; onRefresh: () => void; canRefresh: boolean }) {
  if (!snapshot) {
    return <section className="rounded-2xl border border-white/10 bg-[#111827] p-8 text-center"><p className="text-lg font-bold">El Control Center todavía no tiene una fotografía agregada.</p><p className="mt-2 text-sm text-slate-400">Generarla no modifica operaciones; únicamente consolida indicadores existentes.</p>{canRefresh ? <button onClick={onRefresh} disabled={loading} className="mt-5 rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{loading ? "Generando..." : "Generar Control Center"}</button> : null}{error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}</section>;
  }

  const cards = [
    ["Solicitudes activas", snapshot.summary.solicitudesActive, "text-sky-300"],
    ["Pagos registrados", snapshot.summary.pagosCount, "text-violet-300"],
    ["Dinero registrado", money(snapshot.summary.pagosAmount), "text-emerald-300"],
    ["Monto pendiente", money(snapshot.summary.pendingPagosAmount), "text-amber-300"],
    ["CFDI emitidos", snapshot.summary.invoicesIssued, "text-cyan-300"],
    ["Alertas críticas", snapshot.summary.criticalAlerts, "text-rose-300"],
  ];

  return <div className="space-y-5">
    {!snapshot.coverage?.complete && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">Resumen histórico limitado. Consolida el histórico en el panel superior antes de usar estos valores como totales definitivos.</p>}
    <div className="flex items-center justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.25em] text-sky-400">PAY0 Control Center</p><h2 className="mt-1 text-2xl font-black">Lo que requiere tu atención</h2></div>{canRefresh ? <button onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/5 disabled:opacity-50"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Actualizar métricas</button> : null}</div>
    {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">{cards.map(([label, value, color]) => <article key={String(label)} className="rounded-2xl border border-white/10 bg-[#111827] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p><p className={`mt-3 text-2xl font-black ${color}`}>{value}</p></article>)}</section>
    <section className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
      <div className="rounded-2xl border border-white/10 bg-[#111827] p-5"><h3 className="font-black">Atención inmediata</h3><div className="mt-4 space-y-3">{snapshot.alerts.length ? snapshot.alerts.map((alert) => <Link key={alert.id} href={alert.href} className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-[#070d1d] p-4 hover:border-sky-400/30"><div><p className={alert.severity === "CRITICAL" ? "text-sm font-bold text-rose-300" : "text-sm font-bold text-amber-300"}>{alert.title}</p><p className="mt-1 text-xs text-slate-400">{alert.explanation}</p></div><ArrowRight size={16} className="mt-1 shrink-0 text-slate-500" /></Link>) : <p className="rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-300">No hay alertas consolidadas pendientes.</p>}</div></div>
      <div className="rounded-2xl border border-white/10 bg-[#111827] p-5"><h3 className="font-black">Salud del sistema</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries(snapshot.health).map(([module, item]) => <div key={module} className="rounded-xl border border-white/10 bg-[#070d1d] p-3"><div className="flex items-center gap-2"><HealthIcon status={item.status} /><p className="text-sm font-bold capitalize">{module}</p></div><p className="mt-2 text-xs leading-5 text-slate-400">{item.explanation}</p></div>)}</div></div>
    </section>
    <section className="rounded-2xl border border-white/10 bg-[#111827] p-5"><h3 className="font-black">Conteos por módulo · no es un embudo de conversión</h3><div className="mt-5 grid gap-2 md:grid-cols-5">{snapshot.pipeline.map((stage, index) => <Link href={stage.href} key={stage.key} className="group relative rounded-xl border border-white/10 bg-[#070d1d] p-4 hover:border-sky-400/40"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Módulo {index + 1}</p><p className="mt-2 text-sm font-bold">{stage.label}</p><p className="mt-3 text-2xl font-black text-sky-300">{stage.count}</p></Link>)}</div></section>
  </div>;
}
