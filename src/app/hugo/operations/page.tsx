"use client";

import { useEffect, useState } from "react";
import { getAgentOperations, setAgentKillSwitch, type AgentOperations } from "@/services/agentOperations";

const card = "rounded-2xl border border-slate-700 bg-slate-900 p-5";
export default function AgentOperationsPage() {
  const [data, setData] = useState<AgentOperations | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => getAgentOperations().then(setData).catch(e => setError(String(e?.message || e)));
  useEffect(() => { void refresh(); }, []);
  const toggle = async () => {
    if (!data || busy) return;
    setBusy(true); setError("");
    try { await setAgentKillSwitch(!data.killSwitch); await refresh(); }
    catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
    <div className="mx-auto max-w-6xl space-y-6">
      <header><a href="/hugo" className="text-sm text-violet-300">← Hugo</a><h1 className="mt-3 text-3xl font-bold">Operaciones de Agentes</h1><p className="mt-2 text-sm text-slate-400">Estado local del sistema publicado. La configuración de un proveedor no confirma su disponibilidad en este momento.</p></header>
      {error && <p role="alert" className="rounded-xl border border-red-700 p-3 text-red-300">{error}</p>}
      {!data ? <p>Cargando operaciones…</p> : <>
        <section className={card}><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold">Kill switch</h2><p className="text-sm text-slate-400">Bloquea nuevas ejecuciones automáticas de cotizaciones.</p></div><button disabled={busy} onClick={() => void toggle()} className="rounded-lg bg-violet-700 px-4 py-2 text-sm disabled:opacity-50">{data.killSwitch ? "Desactivar bloqueo" : "Activar bloqueo"}</button></div><p className="mt-2 text-sm">Estado: {data.killSwitch ? "ACTIVO" : "INACTIVO"}</p></section>
        <section className={card}><h2 className="font-semibold">Agentes</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{data.agents.map(agent => <div key={agent.id} className="rounded-lg bg-slate-950 p-3"><b>{agent.name}</b><p className="text-sm text-slate-400">{agent.specialty} · {agent.enabled ? "Habilitado en contrato" : "Sin ejecución habilitada"}</p><p className="text-xs text-slate-500">{agent.provider && agent.model ? `${agent.provider} / ${agent.model} · estado no comprobado` : "Sin proveedor configurado"}</p></div>)}</div></section>
        <section className={card}><h2 className="font-semibold">Reporte de trabajos de cotización</h2><p className="mt-2 text-sm">Revisados: {data.report.reviewed} · Con problema: {data.report.detected} · Completados: {data.report.corrected} · Bloqueados o escalados: {data.report.escalated}</p><p className="mt-2 text-xs text-amber-300">{data.reportScope}</p></section>
        <div className="grid gap-6 lg:grid-cols-2"><section className={card}><h2 className="font-semibold">Últimas ejecuciones</h2>{data.runs.length ? data.runs.map(row => <p key={row.id} className="mt-2 text-sm">{row.agentId} · {row.entityId} · {row.status} {row.reason}</p>) : <p className="mt-2 text-sm text-slate-500">Sin ejecuciones registradas.</p>}</section><section className={card}><h2 className="font-semibold">Incidencias y propuestas</h2>{data.incidents.map(row => <p key={row.id} className="mt-2 text-sm">{row.entityId} · {row.status} · {row.cause}</p>)}{data.proposals.map(row => <p key={row.id} className="mt-2 text-sm">Propuesta {row.status}: {row.problem}</p>)}{!data.incidents.length && !data.proposals.length && <p className="mt-2 text-sm text-slate-500">Sin registros.</p>}</section></div>
      </>}
    </div>
  </main>;
}
