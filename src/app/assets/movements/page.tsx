"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AssetsEmpty, AssetsError, AssetsLoading } from "@/components/assets/AssetsStates";
import { useAssetsOverview } from "@/components/assets/useAssetsOverview";
import { dateLabel, displayPositionName, money, movementIsInflow, movementLabel, sourceLabel } from "@/lib/assetsUi";

type Filter = "ALL" | "VEHICLE" | "LOAN" | "INFLOW" | "OUTFLOW";
export default function MovementsPage() {
  const { data, loading, error } = useAssetsOverview();
  const [filter, setFilter] = useState<Filter>("ALL");
  if (loading && !data) return <AssetsLoading/>;
  if (error && !data) return <AssetsError message={error}/>;
  const positions = new Map((data?.positions || []).filter((item) => item.includedInMetrics).map((item) => [item.id, item]));
  const rows = (data?.movements || []).filter((item) => {
    const position = positions.get(item.positionId);
    if (!position) return false;
    if (filter === "VEHICLE" || filter === "LOAN") return position.kind === filter;
    if (filter === "INFLOW") return movementIsInflow(item.movementType);
    if (filter === "OUTFLOW") return !movementIsInflow(item.movementType);
    return true;
  });
  const filters: [Filter, string][] = [["ALL", "Todos"], ["VEHICLE", "Vehículos"], ["LOAN", "Préstamos"], ["INFLOW", "Entradas"], ["OUTFLOW", "Salidas"]];
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-1.5">{filters.map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={`rounded-md px-3 py-1.5 text-[11px] ${filter === value ? "bg-[var(--assets-accent-soft)] text-white" : "border border-[var(--assets-border)] text-[var(--assets-muted)] hover:text-white"}`}>{label}</button>)}</div>
    {rows.length ? <section className="assets-panel overflow-hidden"><div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[760px] table-fixed text-left text-xs"><thead className="border-b border-[var(--assets-border)] bg-white/[0.025] text-[10px] uppercase tracking-wider text-[var(--assets-muted)]"><tr><th className="w-[100px] px-3 py-2 font-medium">Fecha</th><th className="w-[170px] px-3 py-2 font-medium">Tipo</th><th className="px-3 py-2 font-medium">Posición</th><th className="w-[150px] px-3 py-2 font-medium">Origen</th><th className="w-[130px] px-3 py-2 text-right font-medium">Monto</th><th className="w-[54px] px-3 py-2"></th></tr></thead><tbody className="divide-y divide-[var(--assets-border)]">{rows.map((item) => { const position = positions.get(item.positionId)!; const inflow = movementIsInflow(item.movementType); return <tr key={item.id} className="hover:bg-white/[0.025]"><td className="px-3 py-2 text-[var(--assets-muted)]">{dateLabel(item.effectiveDate || item.createdAt)}</td><td className="px-3 py-2 text-[var(--assets-secondary)]">{movementLabel(item.movementType)}</td><td className="truncate px-3 py-2">{displayPositionName(position)}</td><td className="px-3 py-2 text-[var(--assets-muted)]">{sourceLabel(item.source)}</td><td className={`px-3 py-2 text-right font-medium tabular-nums ${inflow ? "text-[var(--assets-positive)]" : "text-[var(--assets-text)]"}`}>{inflow ? "+" : "−"}{money(item.amountMinor)}</td><td className="px-3 py-2"><Link href={`/assets/positions/${position.id}`} title="Ver posición" className="text-[var(--assets-muted)] hover:text-white"><ArrowRight size={14}/></Link></td></tr>; })}</tbody></table></div><div className="divide-y divide-[var(--assets-border)] sm:hidden">{rows.map((item) => { const position = positions.get(item.positionId)!; const inflow = movementIsInflow(item.movementType); return <Link key={item.id} href={`/assets/positions/${position.id}`} className="grid grid-cols-[1fr_auto] gap-2 px-3 py-3 text-xs"><div className="min-w-0"><p className="truncate">{movementLabel(item.movementType)} · {displayPositionName(position)}</p><p className="mt-1 text-[10px] text-[var(--assets-muted)]">{dateLabel(item.effectiveDate || item.createdAt)} · {sourceLabel(item.source)}</p></div><span className={`font-medium tabular-nums ${inflow ? "text-[var(--assets-positive)]" : ""}`}>{inflow ? "+" : "−"}{money(item.amountMinor)}</span></Link>; })}</div></section> : <AssetsEmpty>No hay movimientos para este filtro.</AssetsEmpty>}
    {data?.truncated?.movements && <p className="text-[10px] text-[var(--assets-warning)]">Se muestran los 500 movimientos disponibles en esta vista. El historial está preparado para paginación.</p>}
  </div>;
}
