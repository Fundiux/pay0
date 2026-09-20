"use client";

import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { AssetsEmpty, AssetsError, AssetsLoading } from "@/components/assets/AssetsStates";
import { useAssetsOverview } from "@/components/assets/useAssetsOverview";
import { assetKindLabel, assetStatusLabel, displayPositionName, interestLabel, money } from "@/lib/assetsUi";

export default function PositionsPage() {
  const { data, loading, error } = useAssetsOverview();
  if (loading && !data) return <AssetsLoading/>;
  if (error && !data) return <AssetsError message={error}/>;
  const real = (data?.positions || []).filter((item) => item.includedInMetrics);
  const excluded = (data?.positions || []).filter((item) => !item.includedInMetrics);
  return <div className="space-y-8"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.25em] text-amber-300">Portafolio</p><h1 className="mt-2 text-3xl font-semibold">Posiciones</h1><p className="mt-2 text-sm text-stone-400">Vehículos y préstamos que explican tu patrimonio.</p></div><Link href="/assets/positions/new" className="flex items-center gap-2 rounded-xl bg-emerald-300 px-4 py-3 text-sm font-semibold text-emerald-950"><Plus size={17}/>Nueva posición</Link></header>
    {real.length ? <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{real.map((position) => <Link key={position.id} href={`/assets/positions/${position.id}`} className="group rounded-3xl border border-emerald-950 bg-[#0b1a16] p-6 transition hover:border-emerald-700"><div className="flex justify-between gap-3"><span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">{assetKindLabel(position.kind)}</span><span className="text-xs text-stone-500">{assetStatusLabel(position.status, position.kind)}</span></div><h2 className="mt-6 text-xl font-semibold">{displayPositionName(position)}</h2><p className="mt-1 text-sm text-stone-500">{position.counterpartyName || interestLabel(position)}</p><div className="mt-7"><p className="text-xs text-stone-500">Capital trabajando</p><p className="mt-1 text-2xl font-semibold text-emerald-100">{money(position.snapshot.outstandingPrincipalMinor)}</p></div><div className="mt-5 flex items-center justify-between text-xs text-stone-500"><span>{interestLabel(position)}</span><ArrowRight className="text-emerald-300 transition group-hover:translate-x-1" size={16}/></div></Link>)}</section> : <AssetsEmpty>No hay posiciones confirmadas.</AssetsEmpty>}
    {!!excluded.length && <details className="rounded-2xl border border-stone-800 bg-stone-950/30 p-5"><summary className="cursor-pointer text-sm text-stone-500">Registros de prueba excluidos ({excluded.length})</summary><div className="mt-4 space-y-2">{excluded.map((position) => <div key={position.id} className="flex justify-between gap-4 rounded-xl bg-black/20 p-3 text-sm text-stone-600"><span>{position.name}</span><span>{money(position.snapshot.outstandingPrincipalMinor)}</span></div>)}</div></details>}
  </div>;
}
