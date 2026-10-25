"use client";

import { useEffect, useState } from "react";
import { getAgentOperations, reviewAgentProposal, setAgentKillSwitch, type AgentOperations } from "@/services/agentOperations";

const card = "rounded-2xl border border-slate-700 bg-slate-900 p-5";

export default function AgentOperationsPage() {
  const [data, setData] = useState<AgentOperations | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => getAgentOperations().then(setData).catch(error => setError(String(error?.message || error)));
  useEffect(() => { void refresh(); }, []);

  const toggle = async () => {
    if (!data || busy) return;
    setBusy(true); setError("");
    try { await setAgentKillSwitch(!data.killSwitch); await refresh(); }
    catch (error: any) { setError(String(error?.message || error)); }
    finally { setBusy(false); }
  };
  const review = async (proposalId: string, status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED") => {
    if (busy) return;
    setBusy(true); setError("");
    try { await reviewAgentProposal(proposalId, status); await refresh(); }
    catch (error: any) { setError(String(error?.message || error)); }
    finally { setBusy(false); }
  };

  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <a href="/hugo" className="text-sm text-violet-300">← Hugo</a>
        <h1 className="mt-3 text-3xl font-bold">Operaciones de Agentes</h1>
        <p className="mt-2 text-sm text-slate-400">Estado del servidor. La configuración de un proveedor no confirma su disponibilidad en vivo.</p>
      </header>
      {error && <p role="alert" className="rounded-xl border border-red-700 p-3 text-red-300">{error}</p>}
      {!data ? <p>Cargando operaciones…</p> : <>
        <section className={card}>
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="font-semibold">Kill switch</h2><p className="text-sm text-slate-400">Bloquea nuevas ejecuciones automáticas de cotizaciones.</p></div>
            <button disabled={busy} onClick={() => void toggle()} className="rounded-lg bg-violet-700 px-4 py-2 text-sm disabled:opacity-50">{data.killSwitch ? "Desactivar bloqueo" : "Activar bloqueo"}</button>
          </div>
          <p className="mt-2 text-sm">Estado: {data.killSwitch ? "ACTIVO" : "INACTIVO"}</p>
        </section>

        <section className={card}>
          <h2 className="font-semibold">Sistemas y aislamiento</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">{data.systems.map(system => <div key={system.id} className="rounded-lg bg-slate-950 p-3 text-sm">
            <b>{system.name}</b><p className="text-xs text-slate-400">{system.status} · contexto {system.contextNamespace}</p>
            <p className="text-xs text-slate-500">Agentes: {system.agentIds.length} · conexiones aprobadas: {system.connections.filter(connection => connection.approved).length}</p>
          </div>)}</div>
        </section>

        <section className={card}>
          <h2 className="font-semibold">Proveedores configurados</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-3">{Object.entries(data.providers).map(([id, provider]) => <p key={id} className="rounded-lg bg-slate-950 p-3 text-sm">{id}: {provider.status} · {provider.model || "Sin modelo"}</p>)}</div>
          <p className="mt-2 text-xs text-slate-500">Configuración del servidor; no es una prueba de salud en vivo.</p>
        </section>

        <section className={card}>
          <h2 className="font-semibold">Agentes</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">{data.agents.map(agent => <div key={agent.id} className="rounded-lg bg-slate-950 p-3">
            <b>{agent.name}</b><p className="text-sm text-slate-400">{agent.specialty} · {agent.enabled ? "Habilitado en contrato" : "Sin ejecución habilitada"}</p>
            <p className="text-xs text-slate-500">{agent.provider && agent.model ? `${agent.provider} / ${agent.model} · estado no comprobado` : "Sin proveedor configurado"}</p>
          </div>)}</div>
        </section>

        <section className={card}>
          <h2 className="font-semibold">Reporte operacional · {data.report.day}</h2>
          <p className="mt-2 text-sm">Solicitudes revisadas: {data.report.reviewed} · Ejecuciones: {data.report.detected} · Incidencias: {data.report.incidents} · Cotizaciones normales: {data.report.generated} · Correcciones: {data.report.corrected} · Verificadas: {data.report.verified} · Bloqueadas o escaladas: {data.report.escalated} · Reintentables: {data.report.retryable}</p>
          <div className="mt-3 space-y-1 text-xs text-slate-300">{data.report.causes.map(row => <p key={row.cause}>{row.count} × {row.cause}</p>)}</div>
          <p className="mt-2 text-xs text-amber-300">{data.reportScope}</p>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className={card}>
            <h2 className="font-semibold">Últimas ejecuciones</h2>
            {data.runs.length ? data.runs.map(row => <p key={row.id} className="mt-2 text-sm"><a className="text-violet-300" href={`/solicitudes?q=${encodeURIComponent(row.entityId)}`}>{row.entityId}</a> · {row.agentId} · {row.status} {row.reason}</p>) : <p className="mt-2 text-sm text-slate-500">Sin ejecuciones registradas.</p>}
          </section>
          <section className={card}>
            <h2 className="font-semibold">Incidencias y propuestas</h2>
            {data.incidents.map(row => <p key={row.id} className="mt-2 text-sm">{row.entityType === "solicitud" ? <a className="text-violet-300" href={`/solicitudes?q=${encodeURIComponent(row.entityId)}`}>{row.entityId}</a> : row.entityId} · {row.status} · {row.cause}</p>)}
            {data.proposals.map(row => <div key={row.id} className="mt-3 rounded-lg border border-slate-700 p-3 text-sm">
              <p>Propuesta {row.status}: {row.problem}</p>
              <p className="mt-1 text-xs text-slate-400">Impacto: {row.impact} · Riesgo: {row.risk} · Alcance: {row.scope} · Reversión: {row.rollback}</p>
              <p className="mt-1 text-xs text-slate-500">Evidencia: {(row.evidence || []).join(", ")}</p>
              <div className="mt-2 flex gap-2">
                {row.status === "DRAFT" && <button disabled={busy} onClick={() => void review(row.id, "PENDING_APPROVAL")} className="rounded border border-violet-500 px-2 py-1">Enviar a aprobación</button>}
                {row.status === "PENDING_APPROVAL" && <>
                  <button disabled={busy} onClick={() => void review(row.id, "APPROVED")} className="rounded border border-emerald-500 px-2 py-1">Aprobar propuesta</button>
                  <button disabled={busy} onClick={() => void review(row.id, "REJECTED")} className="rounded border border-rose-500 px-2 py-1">Rechazar</button>
                </>}
              </div>
            </div>)}
            {!data.incidents.length && !data.proposals.length && <p className="mt-2 text-sm text-slate-500">Sin registros.</p>}
            <p className="mt-3 text-xs text-amber-300">Aprobar una propuesta no ejecuta cambios ni despliegues.</p>
          </section>
        </div>
      </>}
    </div>
  </main>;
}
