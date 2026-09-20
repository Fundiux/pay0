"use client";

import Link from "next/link";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import { AssetsEmpty, AssetsError, AssetsLoading } from "@/components/assets/AssetsStates";
import { useAssetsOverview } from "@/components/assets/useAssetsOverview";
import { dateLabel, displayPositionName, interestLabel, money, movementIsInflow, movementLabel } from "@/lib/assetsUi";

export default function AssetsPage() {
  const { data, loading, error, reload } = useAssetsOverview();
  if (loading && !data) return <AssetsLoading />;
  if (error && !data) return <AssetsError message={error} />;
  const positions = (data?.positions || []).filter((item) => item.includedInMetrics);
  const active = positions.filter((item) => item.status === "ACTIVE");
  const positionById = new Map(positions.map((item) => [item.id, item]));
  const recent = (data?.movements || []).filter((item) => positionById.has(item.positionId)).slice(0, 6);
  const groups = [
    { label: "U-PRO", value: active.filter((p) => p.kind === "VEHICLE").reduce((sum, p) => sum + p.snapshot.outstandingPrincipalMinor, 0) },
    { label: "Préstamos con interés", value: active.filter((p) => p.kind === "LOAN" && Number(p.rateBasisPoints || 0) > 0).reduce((sum, p) => sum + p.snapshot.outstandingPrincipalMinor, 0) },
    { label: "Préstamos sin interés", value: active.filter((p) => p.kind === "LOAN" && Number(p.rateBasisPoints || 0) === 0).reduce((sum, p) => sum + p.snapshot.outstandingPrincipalMinor, 0) },
  ];
  const max = Math.max(...groups.map((item) => item.value), 1);
  return <div className="space-y-10">
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div><p className="text-xs font-semibold uppercase tracking-[.25em] text-amber-300">Resumen patrimonial</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Tu capital, con contexto</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-stone-400">Una vista limpia de cuánto trabaja, cuánto regresó y qué utilidad produjo.</p></div>
      <div className="flex gap-2"><button onClick={() => void reload()} className="rounded-xl border border-emerald-900 p-3 text-emerald-200" aria-label="Actualizar"><RefreshCw size={17}/></button><Link href="/assets/positions/new" className="flex items-center gap-2 rounded-xl bg-emerald-300 px-4 py-3 text-sm font-semibold text-emerald-950"><Plus size={17}/>Nueva posición</Link></div>
    </header>
    {error && <AssetsError message={error}/>}
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <div className="rounded-3xl border border-emerald-700/40 bg-gradient-to-br from-emerald-500/15 to-transparent p-6 sm:col-span-2"><p className="text-sm text-emerald-200/70">Capital trabajando</p><p className="mt-3 text-4xl font-semibold text-emerald-100">{money(data?.totals.workingMinor)}</p></div>
      {[["Capital recuperado", data?.totals.recoveredPrincipalMinor], ["Utilidad realizada", data?.totals.realizedProfitMinor], ["Intereses pendientes", data?.totals.pendingInterestMinor]].map(([label, value]) => <div key={String(label)} className="rounded-3xl border border-emerald-950 bg-[#0b1a16] p-5"><p className="text-xs text-stone-500">{label}</p><p className="mt-3 text-xl font-semibold text-stone-100">{money(Number(value || 0))}</p></div>)}
      <div className="rounded-3xl border border-amber-900/40 bg-amber-400/5 p-5"><p className="text-xs text-amber-200/60">Posiciones activas</p><p className="mt-3 text-3xl font-semibold text-amber-200">{active.length}</p></div>
    </section>
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl border border-emerald-950 bg-[#0b1a16] p-6"><h2 className="text-lg font-semibold">Dónde está tu dinero</h2><div className="mt-7 space-y-6">{groups.map((item) => <div key={item.label}><div className="mb-2 flex justify-between gap-4 text-sm"><span className="text-stone-400">{item.label}</span><span className="font-medium">{money(item.value)}</span></div><div className="h-2 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.max(item.value ? 5 : 0, item.value / max * 100)}%` }}/></div></div>)}</div></div>
      <div className="rounded-3xl border border-emerald-950 bg-[#0b1a16] p-6"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Posiciones relevantes</h2><Link href="/assets/positions" className="flex items-center gap-1 text-xs text-emerald-300">Ver todas <ArrowRight size={14}/></Link></div><div className="mt-4 divide-y divide-emerald-950">{active.slice(0, 4).map((position) => <Link href={`/assets/positions/${position.id}`} key={position.id} className="flex items-center justify-between gap-4 py-4"><div><p className="font-medium">{displayPositionName(position)}</p><p className="mt-1 text-xs text-stone-500">{interestLabel(position)}</p></div><p className="font-medium text-emerald-200">{money(position.snapshot.outstandingPrincipalMinor)}</p></Link>)}{!active.length && <p className="py-10 text-center text-sm text-stone-500">No hay posiciones activas.</p>}</div></div>
    </section>
    <section className="rounded-3xl border border-emerald-950 bg-[#0b1a16] p-6"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Actividad reciente</h2><Link href="/assets/movements" className="flex items-center gap-1 text-xs text-emerald-300">Ver todos <ArrowRight size={14}/></Link></div>{recent.length ? <div className="mt-4 divide-y divide-emerald-950">{recent.map((item) => { const position = positionById.get(item.positionId)!; const positive = movementIsInflow(item.movementType); return <div key={item.id} className="flex items-center justify-between gap-4 py-4"><div className="flex min-w-0 gap-4"><span className="w-20 shrink-0 text-xs text-stone-500">{dateLabel(item.effectiveDate)}</span><div className="min-w-0"><p className="truncate text-sm">{movementLabel(item.movementType)} · {displayPositionName(position)}</p><p className="mt-1 text-xs text-stone-600">{item.description || "Movimiento confirmado"}</p></div></div><p className={`shrink-0 font-medium ${positive ? "text-emerald-300" : "text-stone-200"}`}>{positive ? "+" : "−"}{money(item.amountMinor)}</p></div>; })}</div> : <AssetsEmpty>Aún no hay actividad patrimonial.</AssetsEmpty>}</section>
    {!!data?.excludedPositionCount && <p className="text-xs text-stone-600">{data.excludedPositionCount} {data.excludedPositionCount === 1 ? "registro de prueba fue excluido" : "registros de prueba fueron excluidos"} de los indicadores.</p>}
  </div>;
}
