"use client";

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
  const groups = [
    { label: "Vehículos", value: active.filter((p) => p.kind === "VEHICLE").reduce((sum, p) => sum + p.snapshot.outstandingPrincipalMinor, 0) },
    { label: "Préstamos con interés", value: active.filter((p) => p.kind === "LOAN" && Number(p.rateBasisPoints || 0) > 0).reduce((sum, p) => sum + p.snapshot.outstandingPrincipalMinor, 0) },
    { label: "Préstamos sin interés", value: active.filter((p) => p.kind === "LOAN" && Number(p.rateBasisPoints || 0) === 0).reduce((sum, p) => sum + p.snapshot.outstandingPrincipalMinor, 0) },
  ];
  const max = Math.max(...groups.map((item) => item.value), 1);
  const metrics = [
    ["Capital recuperado", data?.totals.recoveredPrincipalMinor],
    ["Utilidad realizada", data?.totals.realizedProfitMinor],
    ["Interés pendiente", data?.totals.pendingInterestMinor],
  ] as const;
  return <div className="space-y-4">
    <div className="flex items-center justify-end gap-2">
      <button onClick={() => void reload()} className="assets-control p-2 text-[var(--assets-secondary)] hover:text-white" title="Actualizar" aria-label="Actualizar"><RefreshCw size={15}/></button>
      <Link href="/assets/positions/new" className="flex items-center gap-1.5 rounded-lg bg-[var(--assets-accent)] px-3 py-2 text-xs font-semibold text-[#111518]"><Plus size={15}/>Nueva posición</Link>
    </div>
    {error && <AssetsError message={error}/>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
      <div className="assets-panel p-4 sm:col-span-2"><p className="text-[11px] text-[var(--assets-secondary)]" title="Capital actualmente colocado en posiciones activas.">Capital trabajando</p><p className="mt-1 text-2xl font-semibold tabular-nums">{money(data?.totals.workingMinor)}</p></div>
      {metrics.map(([label, value]) => <div key={label} className="assets-panel p-4"><p className="text-[11px] text-[var(--assets-muted)]">{label}</p><p className="mt-1 text-base font-semibold tabular-nums">{money(Number(value || 0))}</p></div>)}
      <div className="assets-panel p-4"><p className="text-[11px] text-[var(--assets-muted)]">Vehículos activos</p><p className="mt-1 text-xl font-semibold">{data?.counts?.activeVehicles || 0}</p></div>
      <div className="assets-panel p-4"><p className="text-[11px] text-[var(--assets-muted)]">Vehículos vendidos</p><p className="mt-1 text-xl font-semibold">{data?.counts?.soldVehicles || 0}</p></div>
      <div className="assets-panel p-4"><p className="text-[11px] text-[var(--assets-muted)]">Préstamos activos</p><p className="mt-1 text-xl font-semibold">{data?.counts?.activeLoans || 0}</p></div>
    </section>
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="assets-panel p-4"><h2 className="text-sm font-semibold">Dónde está tu dinero</h2><div className="mt-4 space-y-3">{groups.map((item) => <div key={item.label}><div className="mb-1.5 flex justify-between gap-4 text-xs"><span className="text-[var(--assets-secondary)]">{item.label}</span><span className="tabular-nums">{money(item.value)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-black/35"><div className="h-full rounded-full bg-[var(--assets-accent)]" style={{ width: `${Math.max(item.value ? 4 : 0, item.value / max * 100)}%` }}/></div></div>)}</div></div>
      <div className="assets-panel p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Posiciones relevantes</h2><Link href="/assets/positions" className="flex items-center gap-1 text-[11px] text-[var(--assets-accent)]">Ver todas <ArrowRight size={13}/></Link></div><div className="mt-2 divide-y divide-[var(--assets-border)]">{active.slice(0, 5).map((position) => <Link href={`/assets/positions/${position.id}`} key={position.id} className="flex items-center justify-between gap-4 py-2.5"><div className="min-w-0"><p className="truncate text-xs font-medium">{displayPositionName(position)}</p><p className="mt-0.5 text-[10px] text-[var(--assets-muted)]">{position.kind === "VEHICLE" ? displayCounterpartyName(position) : interestLabel(position)}</p></div><p className="shrink-0 text-xs font-medium tabular-nums">{money(position.snapshot.outstandingPrincipalMinor)}</p></Link>)}{!active.length && <p className="py-5 text-center text-xs text-[var(--assets-muted)]">No hay posiciones activas.</p>}</div></div>
    </section>
    <section className="assets-panel overflow-hidden"><div className="flex items-center justify-between border-b border-[var(--assets-border)] px-4 py-3"><h2 className="text-sm font-semibold">Actividad reciente</h2><Link href="/assets/movements" className="flex items-center gap-1 text-[11px] text-[var(--assets-accent)]">Ver todos <ArrowRight size={13}/></Link></div>{recent.length ? <div className="divide-y divide-[var(--assets-border)]">{recent.map((item) => { const position = positionById.get(item.positionId)!; const inflow = movementIsInflow(item.movementType); return <div key={item.id} className="grid grid-cols-[74px_1fr_auto] items-center gap-3 px-4 py-2 text-xs"><span className="text-[10px] text-[var(--assets-muted)]">{dateLabel(item.effectiveDate || item.createdAt)}</span><span className="truncate text-[var(--assets-secondary)]">{movementLabel(item.movementType)} · {displayPositionName(position)}</span><span className={`font-medium tabular-nums ${inflow ? "text-[var(--assets-positive)]" : "text-[var(--assets-text)]"}`}>{inflow ? "+" : "−"}{money(item.amountMinor)}</span></div>; })}</div> : <AssetsEmpty>Aún no hay actividad patrimonial.</AssetsEmpty>}</section>
    {!!data?.excludedPositionCount && <p className="text-[10px] text-[var(--assets-muted)]">{data.excludedPositionCount} {data.excludedPositionCount === 1 ? "registro está excluido" : "registros están excluidos"} de los indicadores.</p>}
  </div>;
}
