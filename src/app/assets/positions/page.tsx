"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Plus } from "lucide-react";
import { AssetsEmpty, AssetsError, AssetsLoading } from "@/components/assets/AssetsStates";
import { useAssetsOverview } from "@/components/assets/useAssetsOverview";
import { assetStatusLabel, displayCounterpartyName, displayPositionName, interestLabel, money } from "@/lib/assetsUi";
import type { AssetPosition } from "@/services/assets";

function PositionCard({ position, historical = false }: { position: AssetPosition; historical?: boolean }) {
  const balanceLabel = position.kind === "LOAN"
    ? (position.interestModel === "CAPITALIZED" ? "Saldo sujeto a interés" : "Capital pendiente")
    : "Capital trabajando";
  return <Link href={`/assets/positions/${position.id}`} className="group assets-panel block p-4 transition hover:border-[var(--assets-accent)]/60">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{displayPositionName(position)}</h2><p className="mt-0.5 truncate text-[11px] text-[var(--assets-muted)]">{position.kind === "VEHICLE" ? displayCounterpartyName(position) : interestLabel(position)}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] ${historical ? "bg-white/[0.05] text-[var(--assets-secondary)]" : "bg-[var(--assets-accent-soft)] text-[var(--assets-accent)]"}`}>{assetStatusLabel(position.status, position.kind)}</span></div>
    {historical && position.kind === "VEHICLE" ? <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]"><span className="text-[var(--assets-muted)]">Invertido</span><span className="text-right tabular-nums">{money(position.snapshot.originalPrincipalMinor)}</span><span className="text-[var(--assets-muted)]">Recibido</span><span className="text-right tabular-nums">{money(position.snapshot.totalRecoveredMinor)}</span><span className="text-[var(--assets-muted)]">Utilidad</span><span className="text-right tabular-nums text-[var(--assets-positive)]">+{money(position.snapshot.realizedProfitMinor)}</span><span className="text-[var(--assets-muted)]">ROI</span><span className="text-right tabular-nums">{position.snapshot.roi == null ? "—" : `${(position.snapshot.roi * 100).toLocaleString("es-MX", { maximumFractionDigits: 2 })}%`}</span></div> : <div className="mt-3 flex items-end justify-between"><div><p className="text-[10px] text-[var(--assets-muted)]">{balanceLabel}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{money(position.snapshot.outstandingPrincipalMinor)}</p></div><ArrowRight size={14} className="text-[var(--assets-muted)] transition group-hover:translate-x-0.5"/></div>}
  </Link>;
}

export default function PositionsPage() {
  const { data, loading, error } = useAssetsOverview();
  const [kind, setKind] = useState<"VEHICLE" | "LOAN">("VEHICLE");
  const [historyOpen, setHistoryOpen] = useState(false);
  if (loading && !data) return <AssetsLoading/>;
  if (error && !data) return <AssetsError message={error}/>;
  const real = (data?.positions || []).filter((item) => item.includedInMetrics && item.kind === kind);
  const active = real.filter((item) => item.status === "ACTIVE");
  const historical = real.filter((item) => item.status !== "ACTIVE");
  const excluded = (data?.positions || []).filter((item) => !item.includedInMetrics);
  const historyLabel = kind === "VEHICLE" ? "Vehículos vendidos" : "Préstamos pagados";
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex rounded-lg border border-[var(--assets-border)] bg-[var(--assets-sidebar)] p-1">{(["VEHICLE", "LOAN"] as const).map((value) => <button key={value} onClick={() => { setKind(value); setHistoryOpen(false); }} className={`rounded-md px-4 py-1.5 text-xs ${kind === value ? "bg-[var(--assets-accent-soft)] text-white" : "text-[var(--assets-muted)] hover:text-white"}`}>{value === "VEHICLE" ? "Vehículos" : "Préstamos"}</button>)}</div><Link href="/assets/positions/new" className="flex items-center gap-1.5 rounded-lg bg-[var(--assets-accent)] px-3 py-2 text-xs font-semibold text-[#111518]"><Plus size={15}/>Nueva posición</Link></div>
    <section><div className="mb-2 flex items-center gap-2"><h1 className="text-xs font-semibold uppercase tracking-wider text-[var(--assets-secondary)]">{kind === "VEHICLE" ? "Vehículos activos" : "Préstamos activos"}</h1><span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-[var(--assets-muted)]">{active.length}</span></div>{active.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{active.map((position) => <PositionCard key={position.id} position={position}/>)}</div> : <AssetsEmpty>{kind === "VEHICLE" ? "No hay vehículos activos." : "No hay préstamos activos."}</AssetsEmpty>}</section>
    <section className="assets-panel overflow-hidden"><button onClick={() => setHistoryOpen((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left"><span className="text-xs font-medium">{historyLabel} ({historical.length})</span><span className="flex items-center gap-2 text-[11px] text-[var(--assets-muted)]">{historical.length ? "Ver historial" : "Sin registros"}<ChevronDown size={14} className={`transition ${historyOpen ? "rotate-180" : ""}`}/></span></button>{historyOpen && <div className="border-t border-[var(--assets-border)] p-3">{historical.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{historical.map((position) => <PositionCard key={position.id} position={position} historical/>)}</div> : <p className="py-3 text-center text-xs text-[var(--assets-muted)]">{kind === "VEHICLE" ? "No hay vehículos vendidos todavía." : "No hay préstamos pagados todavía."}</p>}</div>}</section>
    {!!excluded.length && <details className="rounded-lg border border-[var(--assets-border)] px-4 py-3"><summary className="cursor-pointer text-[11px] text-[var(--assets-muted)]">Registros excluidos de métricas ({excluded.length})</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{excluded.map((position) => <div key={position.id} className="flex justify-between gap-3 rounded-lg bg-black/20 p-2 text-[11px] text-[var(--assets-muted)]"><span>{displayPositionName(position)}</span><span>{money(position.snapshot.outstandingPrincipalMinor)}</span></div>)}</div></details>}
  </div>;
}
