"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getControlCenterEngineering, type EngineeringCatalog } from "@/services/controlCenter";
import { listAgent007Observations, listAgent007Traces, recordAgent007Observation, type Agent007Observation, type HugoTrace } from "@/services/agent007";

const panel = "rounded-2xl border border-white/10 bg-slate-950/60 p-5";
const input = "rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-slate-100";
const stages = ["Pendiente de desarrollo", "En desarrollo", "Bloqueado", "Pendiente de integración", "Implementado sin publicar", "Pendiente de certificación", "Publicado sin verificar", "Verificado", "Revertido"];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "No se pudo consultar la evidencia.";

export default function EngineeringControl() {
  const [catalog, setCatalog] = useState<EngineeringCatalog | null>(null);
  const [observations, setObservations] = useState<Agent007Observation[]>([]);
  const [traces, setTraces] = useState<HugoTrace[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [moduleId, setModuleId] = useState("pagos");
  const [caseId, setCaseId] = useState("");
  const [title, setTitle] = useState("");
  const [evidence, setEvidence] = useState("");
  const [stage, setStage] = useState(stages[0]);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    const results = await Promise.allSettled([getControlCenterEngineering(), listAgent007Observations(), listAgent007Traces({ limit: 10 })]);
    const failures: string[] = [];
    const [contracts, notes, activity] = results;
    if (contracts.status === "fulfilled") setCatalog(contracts.value); else failures.push(`Catálogo: ${errorMessage(contracts.reason)}`);
    if (notes.status === "fulfilled") setObservations(notes.value.observations.filter(row => row.caseType === "ENGINEERING")); else failures.push(`Seguimiento: ${errorMessage(notes.reason)}`);
    if (activity.status === "fulfilled") setTraces(activity.value.traces); else failures.push(`Trazas de Hugo: ${errorMessage(activity.reason)}`);
    setErrors(failures);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    setSaving(true); setMessage("");
    try {
      await recordAgent007Observation({ caseType: "ENGINEERING", caseId: caseId || `${moduleId}:${crypto.randomUUID()}`, intent: title.trim(), humanDecision: evidence.trim(), outcome: stage });
      setTitle(""); setEvidence(""); setCaseId("");
      setMessage("Avance registrado con tu identidad en las observaciones de Hugo y en el registro de actividad.");
      await load();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setSaving(false); }
  }

  const name = (id: string) => catalog?.modules.find(module => module.id === id)?.name || "Módulo fuera del catálogo inicial";
  return <section className={panel} aria-label="Control de ingeniería">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">Ingeniería y seguimiento</h2><p className="mt-1 text-sm text-slate-400">Contratos del código y avances declarados por superadmin, con evidencia conservada.</p></div><button className={input} disabled={loading || saving} onClick={() => void load()}>{loading ? "Consultando…" : "Actualizar ingeniería"}</button></div>
    {errors.map(error => <p key={error} role="alert" className="mt-3 text-sm text-amber-300">{error}</p>)}
    <div className="my-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-100">
      <p>Sol y Astra se usan en Codex para ingeniería. Hugo es el agente operativo existente en PAY0.</p>
      <p className="mt-1">Versión desplegada, certificación y verificación productiva: sin evidencia conectada. Un avance declarado aquí no acredita una publicación ni ejecuta un despliegue.</p>
    </div>
    {catalog && <details className="mb-4"><summary className="cursor-pointer font-medium text-slate-200">Módulos y dependencias · catálogo inicial ({catalog.modules.length})</summary><p className="my-3 text-xs text-slate-400">Selección inicial de contratos, no inventario exhaustivo. Comparten Firebase y publicación de Functions; no son servicios independientes. Responsables técnicos pendientes de asignación.</p><div className="grid gap-3 md:grid-cols-2">{catalog.modules.map(module => <article key={module.id} className="rounded-xl border border-white/10 p-3 text-sm"><h3 className="font-semibold text-white">{module.name}</h3><p className="mt-1 text-slate-300">{module.responsibility}</p><p className="mt-2 text-slate-400">Dependencias revisadas: {module.dependencies.map(name).join(", ") || "Base de autorización"}</p><p className="mt-1 text-slate-400">Frontera: {module.boundary}</p><p className="mt-1 text-slate-400">Verificación requerida: {module.checks.join("; ")}. Estado: sin resultado conectado.</p><details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Referencia técnica</summary><p className="break-all">{module.source}</p><p>Datos: {module.data.join(", ")}</p></details></article>)}</div></details>}
    <form className="space-y-3 border-t border-white/10 pt-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h3 className="font-medium text-white">{caseId ? "Registrar avance de la incidencia" : "Registrar incidencia o mejora"}</h3>
      <p className="text-xs text-slate-400">Se agrega una observación al historial existente de Hugo. Incluye referencia de commit, prueba, bloqueo o reversión cuando corresponda; no incluyas credenciales ni datos de clientes.</p>
      <div className="flex flex-wrap gap-3"><label className="flex flex-col gap-1 text-xs text-slate-400">Módulo<select className={input} value={moduleId} disabled={!!caseId || !catalog || saving} onChange={event => setModuleId(event.target.value)}>{catalog?.modules.map(module => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label><label className="flex flex-col gap-1 text-xs text-slate-400">Estado declarado<select className={input} value={stage} disabled={saving} onChange={event => setStage(event.target.value)}>{stages.map(value => <option key={value}>{value}</option>)}</select></label></div>
      <label className="flex flex-col gap-1 text-xs text-slate-400">Incidencia o mejora<input className={input} value={title} disabled={saving} required maxLength={500} onChange={event => setTitle(event.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">Decisión, avance y evidencia<textarea className={input} value={evidence} disabled={saving} required maxLength={500} rows={3} onChange={event => setEvidence(event.target.value)} /></label>
      <div className="flex gap-3"><button className={input} disabled={saving || !catalog || !title.trim() || !evidence.trim()}>{saving ? "Guardando…" : "Registrar seguimiento"}</button>{caseId && <button type="button" className={input} disabled={saving} onClick={() => { setCaseId(""); setTitle(""); setEvidence(""); }}>Nueva incidencia</button>}</div>
      <p role="status" className="text-sm text-sky-200">{message}</p>
    </form>
    <div className="mt-5 space-y-3"><h3 className="font-medium text-white">Historial de ingeniería</h3><p className="text-xs text-slate-400">Filtrado de las últimas 50 observaciones generales de Hugo; puede omitir registros anteriores. Cada avance conserva la observación original.</p>{!observations.length && <p className="text-sm text-slate-400">Sin observaciones de ingeniería en la muestra disponible.</p>}{observations.map(row => <article key={row.id} className="rounded-xl border border-white/10 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><h4 className="font-medium text-white">{row.intent}</h4><span className="text-amber-200">{row.outcome}</span></div><p className="mt-1 text-xs text-slate-500">{name(row.caseId.split(":")[0])} · Declaración humana</p><p className="mt-2 whitespace-pre-wrap text-slate-300">{row.humanDecision}</p><button className={`${input} mt-2`} disabled={saving} onClick={() => { setCaseId(row.caseId); setModuleId(row.caseId.split(":")[0]); setTitle(row.intent); setEvidence(""); setStage(stages.includes(row.outcome) ? row.outcome : stages[0]); setMessage(""); }}>Agregar avance</button></article>)}</div>
    <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-slate-200">Actividad real de Hugo · últimas 10 trazas consultadas</summary><p className="mt-2 text-xs text-slate-400">Actividad operativa, no ejecuciones de Sol o Astra. Consulta limitada al periodo predeterminado de trazas.</p>{traces.map(trace => <p key={trace.id} className="mt-2 text-sm text-slate-300">{trace.resultStatus === "ERROR" ? "Error registrado" : "Ejecución registrada"} · {trace.toolsExecuted?.length || 0} herramientas · {trace.errorCode || trace.task || "Conversación"}</p>)}{!traces.length && <p className="mt-2 text-sm text-slate-400">Sin trazas en la muestra disponible.</p>}</details>
    <div className="mt-4 flex gap-4 text-sm text-sky-300"><Link href="/hugo">Abrir Hugo y su evidencia</Link><Link href="/activity-log">Ver registro de actividad</Link></div>
  </section>;
}
