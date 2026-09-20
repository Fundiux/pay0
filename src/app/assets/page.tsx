"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import { AssetsEmpty, AssetsError, AssetsLoading } from "@/components/assets/AssetsStates";
import { useAssetsOverview } from "@/components/assets/useAssetsOverview";
import { dateLabel, displayCounterpartyName, displayPositionName, interestLabel, money, movementIsInflow, movementLabel } from "@/lib/assetsUi";

export default function AssetsPage() {
  const { data, loading, error, reload } = useAssetsOverview();
  if (loading && !data) return <AssetsLoading/>;
  if (error && !data) return <AssetsError message={error}/>;

  const positions = (data?.positions || []).filter((item) => item.includedInMetrics);
  const active = positions.filter((item) => item.status === "ACTIVE");
  const positionById = new Map(positions.map((item) => [item.id, item]));
  const recent = (data?.movements || []).filter((item) => positionById.has(item.positionId)).slice(0, 6);
  const activeVehicles = Number(data?.counts?.activeVehicles || 0);
  const soldVehicles = Number(data?.counts?.soldVehicles || 0);
  const activeLoans = Number(data?.counts?.activeLoans || 0);
  const statusTotal = Math.max(activeVehicles + soldVehicles + activeLoans, 1);
  const vehicleEnd = activeVehicles / statusTotal * 360;
  const soldEnd = vehicleEnd + soldVehicles / statusTotal * 360;
  const groups = [
    { label: "Vehículos activos", value: active.filter((p) => p.kind === "VEHICLE").reduce((sum, p) => sum + p.snapshot.outstandingPrincipalMinor, 0), color: "var(--assets-accent)" },
    { label: "Préstamos con interés", value: active.filter((p) => p.kind === "LOAN" && Number(p.rateBasisPoints || 0) > 0).reduce((sum, p) => sum + p.snapshot.outstandingPrincipalMinor, 0), color: "var(--assets-accent-2)" },
    { label: "Préstamos sin interés", value: active.filter((p) => p.kind === "LOAN" && Number(p.rateBasisPoints || 0) === 0).reduce((sum, p) => sum + p.snapshot.outstandingPrincipalMinor, 0), color: "var(--assets-accent-3)" },
  ];
  const max = Math.max(...groups.map((item) => item.value), 1);
  const metrics = [
    ["Capital recuperado", data?.totals.recoveredPrincipalMinor],
    ["Utilidad realizada", data?.totals.realizedProfitMinor],
    ["Interés pendiente", data?.totals.pendingInterestMinor],
  ] as const;

  return <div className="space-y-3">
    <div className="flex items-center justify-end gap-2">
      <button onClick={() => void reload()} className="assets-control p-2 text-[var(--assets-secondary)] hover:border-[var(--assets-accent)] hover:text-white" title="Actualizar" aria-label="Actualizar"><RefreshCw size={15}/></button>
      <Link href="/assets/positions/new" className="flex items-center gap-1.5 rounded-lg bg-[var(--assets-accent)] px-3 py-2 text-xs font-semibold text-[#17191b] transition hover:brightness-110"><Plus size={15}/>Nueva posición</Link>
    </div>
    {error && <AssetsError message={error}/>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
      <div className="assets-panel assets-kpi p-4 sm:col-span-2"><p className="text-[10px] uppercase tracking-[0.14em] text-[var(--assets-accent)]">Capital trabajando</p><p className="mt-1 text-2xl font-semibold tabular-nums">{money(data?.totals.workingMinor)}</p><p className="mt-1 text-[10px] text-[var(--assets-muted)]">Capital vigente en posiciones activas</p></div>
      {metrics.map(([label, value], index) => <div key={label} className="assets-panel assets-kpi p-4" style={{ "--assets-accent": index === 1 ? "var(--assets-positive)" : index === 2 ? "var(--assets-accent-3)" : "var(--assets-accent-2)" } as CSSProperties}><p className="text-[10px] uppercase tracking-wide text-[var(--assets-muted)]">{label}</p><p className={`mt-2 text-base font-semibold tabular-nums ${index === 1 ? "text-[var(--assets-positive)]" : ""}`}>{money(Number(value || 0))}</p></div>)}
      <div className="assets-panel grid grid-cols-3 divide-x divide-[var(--assets-border)] sm:col-span-2">
        {[["Vehículos activos", activeVehicles], ["Vehículos vendidos", soldVehicles], ["Préstamos activos", activeLoans]].map(([label, value]) => <div key={String(label)} className="flex min-h-20 flex-col justify-between p-3"><p className="text-[9px] uppercase leading-4 tracking-wide text-[var(--assets-muted)]">{label}</p><p className="text-xl font-semibold tabular-nums text-[var(--assets-accent)]">{value}</p></div>)}
      </div>
    </section>

    <section className="grid gap-3 xl:grid-cols-12">
      <div className="assets-panel xl:col-span-7">
        <div className="border-b border-[var(--assets-border)] px-4 py-3"><h2 className="text-sm font-semibold">Dónde está trabajando tu capital</h2><p className="mt-0.5 text-[10px] text-[var(--assets-muted)]">Sólo saldos vigentes de posiciones activas</p></div>
        <div className="assets-chart-grid grid min-h-56 items-end gap-5 px-5 pb-4 pt-6 sm:grid-cols-3">
          {groups.map((item) => { const height = Math.max(item.value ? 14 : 2, item.value / max * 100); return <div key={item.label} className="flex h-44 flex-col justify-end"><p className="mb-2 text-right text-[11px] font-semibold tabular-nums">{money(item.value)}</p><div className="relative flex h-32 items-end rounded-t-md bg-black/10"><div className="w-full rounded-t-md transition-all" style={{ height: `${height}%`, backgroundColor: item.color }}/></div><p className="mt-2 truncate text-center text-[10px] text-[var(--assets-secondary)]" title={item.label}>{item.label}</p></div>; })}
        </div>
      </div>

      <div className="assets-panel p-4 xl:col-span-5">
        <h2 className="text-sm font-semibold">Estado del portafolio</h2>
        <div className="mt-4 grid items-center gap-5 sm:grid-cols-[150px_1fr]">
          <div className="relative mx-auto h-36 w-36 rounded-full" style={{ background: `conic-gradient(var(--assets-accent) 0deg ${vehicleEnd}deg, var(--assets-accent-2) ${vehicleEnd}deg ${soldEnd}deg, var(--assets-accent-3) ${soldEnd}deg 360deg)` }}><div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-[var(--assets-surface)]"><span className="text-2xl font-semibold tabular-nums">{activeVehicles + soldVehicles + activeLoans}</span><span className="text-[9px] uppercase tracking-wide text-[var(--assets-muted)]">posiciones</span></div></div>
          <div className="space-y-3">{[["Vehículos activos", activeVehicles, "var(--assets-accent)"], ["Vehículos vendidos", soldVehicles, "var(--assets-accent-2)"], ["Préstamos activos", activeLoans, "var(--assets-accent-3)"]].map(([label, value, color]) => <div key={String(label)} className="flex items-center justify-between gap-3 border-b border-[var(--assets-border)] pb-2 text-xs last:border-0"><span className="flex items-center gap-2 text-[var(--assets-secondary)]"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: String(color) }}/>{label}</span><strong className="tabular-nums">{value}</strong></div>)}</div>
        </div>
      </div>
    </section>

    <section className="grid gap-3 xl:grid-cols-12">
      <div className="assets-panel overflow-hidden xl:col-span-7"><div className="flex items-center justify-between border-b border-[var(--assets-border)] px-4 py-3"><h2 className="text-sm font-semibold">Actividad reciente</h2><Link href="/assets/movements" className="flex items-center gap-1 text-[11px] text-[var(--assets-accent)]">Ver todos <ArrowRight size={13}/></Link></div>{recent.length ? <div className="divide-y divide-[var(--assets-border)]">{recent.map((item) => { const position = positionById.get(item.positionId)!; const inflow = movementIsInflow(item.movementType); return <div key={item.id} className="grid grid-cols-[74px_1fr_auto] items-center gap-3 px-4 py-2 text-xs"><span className="text-[10px] text-[var(--assets-muted)]">{dateLabel(item.effectiveDate || item.createdAt)}</span><span className="truncate text-[var(--assets-secondary)]">{movementLabel(item.movementType)} · {displayPositionName(position)}</span><span className={`font-medium tabular-nums ${inflow ? "text-[var(--assets-positive)]" : "text-[var(--assets-negative)]"}`}>{inflow ? "+" : "−"}{money(item.amountMinor)}</span></div>; })}</div> : <AssetsEmpty>Aún no hay actividad patrimonial.</AssetsEmpty>}</div>
      <div className="assets-panel p-4 xl:col-span-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Posiciones relevantes</h2><Link href="/assets/positions" className="flex items-center gap-1 text-[11px] text-[var(--assets-accent)]">Ver todas <ArrowRight size={13}/></Link></div><div className="mt-2 divide-y divide-[var(--assets-border)]">{active.slice(0, 5).map((position) => <Link href={`/assets/positions/${position.id}`} key={position.id} className="flex items-center justify-between gap-4 py-2.5 hover:text-[var(--assets-accent)]"><div className="min-w-0"><p className="truncate text-xs font-medium">{displayPositionName(position)}</p><p className="mt-0.5 text-[10px] text-[var(--assets-muted)]">{position.kind === "VEHICLE" ? displayCounterpartyName(position) : interestLabel(position)}</p></div><p className="shrink-0 text-xs font-medium tabular-nums">{money(position.snapshot.outstandingPrincipalMinor)}</p></Link>)}{!active.length && <p className="py-5 text-center text-xs text-[var(--assets-muted)]">No hay posiciones activas.</p>}</div></div>
    </section>

    {!!data?.excludedPositionCount && <p className="text-[10px] text-[var(--assets-muted)]">{data.excludedPositionCount} {data.excludedPositionCount === 1 ? "registro está excluido" : "registros están excluidos"} de los indicadores.</p>}
  </div>;
}
