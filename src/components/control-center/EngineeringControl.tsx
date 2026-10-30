"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUserProfile } from "@/lib/useUserProfile";
import RecoveryReview from "./RecoveryReview";
import { getControlCenterEngineering, assignControlCenterEngineeringTask, importControlCenterEngineeringEvidence, type EngineeringCatalog, type EngineeringRunEvidence } from "@/services/controlCenter";
import { listAgent007Observations, reconcileAgent007RecommendationsNow, listAgent007Traces, recordAgent007Observation, type Agent007Observation, type HugoTrace } from "@/services/agent007";

const panel = "rounded-2xl border border-white/10 bg-slate-950/60 p-5";
const input = "rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-slate-100";
const stages = ["Pendiente de desarrollo", "En desarrollo", "Bloqueado", "Pendiente de integración", "Implementado sin publicar", "Pendiente de certificación", "Publicado sin verificar", "Verificado", "Revertido"];
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "No se pudo consultar la evidencia.";
type EngineeringObservation = Agent007Observation & { engineeringEvidence?: EngineeringRunEvidence; source?: string; engineeringAssignment?: { assigneeName: string; assigneeUid: string } };

function RunEvidence({ report }: { report: EngineeringRunEvidence }) {
  return <div className="mt-3 space-y-2 rounded-lg bg-slate-900 p-3">
    <p className="font-medium text-sky-200">Evidencia local importada por usuario</p>
    <dl className="grid gap-2 text-xs sm:grid-cols-2">
      <div><dt className="text-slate-500">Desarrollo</dt><dd>Commit reportado: {report.sourceCommit.slice(0, 12)}</dd></div>
      <div><dt className="text-slate-500">Integración</dt><dd>{report.mainOnly === 0 ? "Contiene la referencia main local reportada" : "Divergencia reportada con main"}; incorporación en main no verificada</dd></div>
      <div><dt className="text-slate-500">Pruebas locales reportadas</dt><dd>{report.status === "validated-source-candidate" ? "Controles del candidato aprobados" : "Proceso de candidato fallido"}</dd></div>
      <div><dt className="text-slate-500">Publicación y verificación productiva</dt><dd>Sin evidencia verificada</dd></div>
    </dl>
    <p className="text-xs text-slate-400">Finalizó: {new Date(report.finishedAt).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })} · Autenticidad no verificada independientemente.</p>
    {report.blockingFindings.map(finding => <p key={finding.code} className="text-xs text-amber-200">Bloqueo reportado: {finding.summary}</p>)}
    {report.integration && <details className="text-xs text-slate-300"><summary className="cursor-pointer">Integración modular reportada</summary>
      <p className="mt-2 text-slate-400">Inventario local del candidato; no acredita integración ni publicación de otras ramas.</p>
      {!!report.integration.unavailableWorktreeCount && <p className="text-amber-200">No se pudieron inspeccionar {report.integration.unavailableWorktreeCount} worktrees adicionales.</p>}
      <ul className="my-2 space-y-1">{report.integration.modules.map(module => <li key={module.id}>{module.id}: {module.changedFiles} archivos · depende de {module.dependencies.join(", ") || "ningún módulo registrado"}</li>)}</ul>
      <ul className="space-y-1">{report.integration.worktrees.map((worktree, index) => <li key={`${worktree.branch}-${index}`} className="break-all">{worktree.branch} · {worktree.head.slice(0, 12)} · {worktree.dirty ? "cambios sin commit" : "sin cambios de código pendientes"} · {worktree.overlapCount} rutas compartidas con el candidato</li>)}</ul>
    </details>}
    <details className="text-xs text-slate-400"><summary className="cursor-pointer">Resultados y huellas de la evidencia</summary><ul className="my-2 space-y-1">{report.checks.map(check => <li key={check.name}>{check.name}: {check.status === "passed" ? "aprobado" : "fallido"}</li>)}</ul><p className="break-all">Commit: {report.sourceCommit}</p><p className="break-all">Árbol: {report.sourceTree}</p><p className="break-all">Main local: {report.mainCommit}</p><p className="break-all">SHA-256 del archivo fuente declarado: {report.sourceArchiveSha256 || "No disponible"}</p><p className="break-all">Huella del registro normalizado: {report.digest}</p><p className="break-all">Importado por: {report.importedBy}</p></details>
  </div>;
}

export default function EngineeringControl() {
  const { profile, profileUid, loading: profileLoading } = useUserProfile();
  const reviewIdentity = !profileLoading && profileUid && profile?.role === "superadmin" && profile?.active !== false
    ? JSON.stringify([profileUid, profile.rootId || profileUid, profile.role, profile.active !== false]) : null;
  const [catalog, setCatalog] = useState<EngineeringCatalog | null>(null);
  const [observations, setObservations] = useState<EngineeringObservation[]>([]);
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
  const [runReport, setRunReport] = useState<unknown>(null);
  const [runFile, setRunFile] = useState("");
  const [linkedObservationId, setLinkedObservationId] = useState("");
  const [importMessage, setImportMessage] = useState("");

  const [assignment, setAssignment] = useState({ observationId: "", assigneeUid: "", note: "", requestId: "" });
  const [actionMessage, setActionMessage] = useState("");
  useEffect(() => {
    if (assignment.observationId) document.getElementById("engineering-assignee")?.focus();
  }, [assignment.observationId]);
  async function assign() {
    setSaving(true); setActionMessage("");
    try {
      await assignControlCenterEngineeringTask(assignment);
      setAssignment({ observationId: "", assigneeUid: "", note: "", requestId: "" });
      setActionMessage("Responsable registrado en el historial del caso."); await load();
    } catch (error) { setActionMessage(errorMessage(error)); }
    finally { setSaving(false); }
  }
  async function reconcile() {
    setSaving(true); setActionMessage("");
    try {
      const result = await reconcileAgent007RecommendationsNow();
      setActionMessage(`Revisión ejecutada: ${result.changed} recomendaciones actualizadas. Resultado guardado en el historial.`); await load();
    } catch (error) { setActionMessage(errorMessage(error)); }
    finally { setSaving(false); }
  }

  async function readReport(file?: File) {
    setRunReport(null); setRunFile(""); setImportMessage("");
    if (!file) return;
    try {
      if (file.size > 64_000) throw Error("El reporte debe tener como máximo 64 KB.");
      setRunReport(JSON.parse(await file.text())); setRunFile(file.name);
    } catch (error) { setImportMessage(errorMessage(error)); }
  }

  async function importReport() {
    setSaving(true); setImportMessage("");
    try {
      const result = await importControlCenterEngineeringEvidence({ report: runReport, moduleId, ...(linkedObservationId ? { observationId: linkedObservationId } : {}) });
      setImportMessage(result.created ? "Evidencia importada con tu identidad. No acredita publicación ni certificación productiva." : "Esta misma evidencia ya está registrada para este seguimiento; no se duplicó.");
      await load();
    } catch (error) { setImportMessage(errorMessage(error)); }
    finally { setSaving(false); }
  }

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
      const saved = await recordAgent007Observation({ caseType: "ENGINEERING", caseId: caseId || `${moduleId}:${crypto.randomUUID()}`, intent: title.trim(), humanDecision: evidence.trim(), outcome: stage });
      setTitle(""); setEvidence(""); setCaseId(""); setLinkedObservationId(saved.observationId);
      setMessage("Avance registrado con tu identidad en las observaciones de Hugo y en el registro de actividad.");
      await load();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setSaving(false); }
  }

  const name = (id: string) => catalog?.modules.find(module => module.id === id)?.name || "Módulo fuera del catálogo inicial";
  return <section className={panel} aria-label="Control de ingeniería">
    {reviewIdentity && <RecoveryReview key={reviewIdentity} />}
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">Ingeniería y seguimiento</h2><p className="mt-1 text-sm text-slate-400">Contratos del código y avances declarados por superadmin, con evidencia conservada.</p></div><button className={input} disabled={loading || saving} onClick={() => void load()}>{loading ? "Consultando…" : "Actualizar ingeniería"}</button></div>
    {errors.map(error => <p key={error} role="alert" className="mt-3 text-sm text-amber-300">{error}</p>)}
    <div className="my-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-100">
      <p>Sol y Astra se usan en Codex para ingeniería. Hugo es el agente operativo existente en PAY0.</p>
      <p className="mt-1">Los controles locales pueden importarse desde su reporte. Versión publicada y verificación productiva permanecen sin acreditar. PAY0 no ejecuta Sol ni Astra desde esta pantalla.</p>
    </div>
    {catalog && <details className="mb-4"><summary className="cursor-pointer font-medium text-slate-200">Módulos y dependencias · catálogo inicial ({catalog.modules.length})</summary><p className="my-3 text-xs text-slate-400">Selección inicial de contratos, no inventario exhaustivo. Comparten Firebase y publicación de Functions; no son servicios independientes. Responsables técnicos pendientes de asignación.</p><div className="grid gap-3 md:grid-cols-2">{catalog.modules.map(module => <article key={module.id} className="rounded-xl border border-white/10 p-3 text-sm"><h3 className="font-semibold text-white">{module.name}</h3><p className="mt-1 text-slate-300">{module.responsibility}</p><p className="mt-2 text-slate-400">Dependencias revisadas: {module.dependencies.map(name).join(", ") || "Base de autorización"}</p><p className="mt-1 text-slate-400">Frontera: {module.boundary}</p><p className="mt-1 text-slate-400">Verificación requerida: {module.checks.join("; ")}. Estado: sin resultado conectado.</p><details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Referencia técnica</summary><p className="break-all">{module.source}</p><p>Datos: {module.data.join(", ")}</p></details></article>)}</div></details>}
    <div className="mb-4 space-y-3 rounded-xl border border-white/10 p-3">
      <h3 className="font-medium text-white">Acciones operativas</h3>
      <p className="text-xs text-slate-400">La revisión de Hugo actualiza hasta 100 recomendaciones pendientes según documentos y estados existentes. Conserva un resultado en el historial; no ejecuta modelos ni proveedores externos.</p>
      <button className={input} disabled={saving || !catalog} onClick={() => void reconcile()}>Revisar recomendaciones de Hugo</button>
      {assignment.observationId && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void assign(); }}>
        <h4 className="text-sm text-white">Asignar responsable al caso seleccionado</h4>
        <label htmlFor="engineering-assignee" className="flex flex-col gap-1 text-xs text-slate-400">Responsable</label><select id="engineering-assignee" required className={input} disabled={saving} value={assignment.assigneeUid} onChange={event => setAssignment(current => ({ ...current, assigneeUid: event.target.value, requestId: crypto.randomUUID() }))}><option value="">Selecciona un responsable</option>{catalog?.assignees.map(user => <option key={user.uid} value={user.uid}>{user.name}</option>)}</select>
        <label className="flex flex-col gap-1 text-xs text-slate-400">Acuerdo de asignación<textarea required maxLength={500} className={input} disabled={saving} value={assignment.note} onChange={event => setAssignment(current => ({ ...current, note: event.target.value, requestId: crypto.randomUUID() }))} /></label>
        <p className="text-xs text-slate-400">Superadmins con acceso vigente del mismo ámbito. {catalog?.assigneesTruncated ? "Lista limitada a los primeros 100 usuarios consultados." : ""}</p>
        <button className={input} disabled={saving || !assignment.assigneeUid || !assignment.note.trim()}>Guardar responsable</button>
        <button type="button" className={`${input} ml-2`} disabled={saving} onClick={() => setAssignment({ observationId: "", assigneeUid: "", note: "", requestId: "" })}>Cancelar asignación</button>
      </form>}
      <p role="status" className="text-sm text-sky-200">{actionMessage}</p>
    </div>
    <form className="space-y-3 border-t border-white/10 pt-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h3 className="font-medium text-white">{caseId ? "Registrar avance de la incidencia" : "Registrar incidencia o mejora"}</h3>
      <p className="text-xs text-slate-400">Se agrega una observación al historial existente de Hugo. Incluye referencia de commit, prueba, bloqueo o reversión cuando corresponda; no incluyas credenciales ni datos de clientes.</p>
      <div className="flex flex-wrap gap-3"><label className="flex flex-col gap-1 text-xs text-slate-400">Módulo<select className={input} value={moduleId} disabled={!!caseId || !catalog || saving} onChange={event => { setModuleId(event.target.value); setLinkedObservationId(""); }}>{catalog?.modules.map(module => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label><label className="flex flex-col gap-1 text-xs text-slate-400">Estado declarado<select className={input} value={stage} disabled={saving} onChange={event => setStage(event.target.value)}>{stages.map(value => <option key={value}>{value}</option>)}</select></label></div>
      <label className="flex flex-col gap-1 text-xs text-slate-400">Incidencia o mejora<input className={input} value={title} disabled={saving} required maxLength={500} onChange={event => setTitle(event.target.value)} /></label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">Decisión, avance y evidencia<textarea className={input} value={evidence} disabled={saving} required maxLength={500} rows={3} onChange={event => setEvidence(event.target.value)} /></label>
      <div className="flex gap-3"><button className={input} disabled={saving || !catalog || !title.trim() || !evidence.trim()}>{saving ? "Guardando…" : "Registrar seguimiento"}</button>{caseId && <button type="button" className={input} disabled={saving} onClick={() => { setCaseId(""); setLinkedObservationId(""); setTitle(""); setEvidence(""); }}>Nueva incidencia</button>}</div>
      <p role="status" className="text-sm text-sky-200">{message}</p>
    </form>
    <div className="mt-5 space-y-3 rounded-xl border border-sky-400/20 p-4">
      <h3 className="font-medium text-white">Conectar evidencia de pruebas y candidato</h3>
      <p className="text-xs text-slate-400">Importa el archivo evidence.json generado por el proceso de candidato del repositorio. Se guardan commit, fechas, resultados y huellas; se omiten comandos y rutas locales. La procedencia es humana: el servidor valida el formato, no autentica una ejecución de CI.</p>
      <p className="text-sm text-slate-300">Destino: {name(moduleId)} · {linkedObservationId ? "incidencia seleccionada" : "candidato del módulo"}</p>
      {linkedObservationId && <button type="button" className={input} disabled={saving} onClick={() => setLinkedObservationId("")}>Desvincular incidencia</button>}
      <label className="flex flex-col gap-1 text-xs text-slate-400">Reporte local del candidato<input type="file" accept="application/json,.json" disabled={saving} onChange={event => void readReport(event.target.files?.[0])} className={input} /></label>
      <div className="flex flex-wrap items-center gap-3"><button type="button" className={input} disabled={saving || !catalog || !runReport} onClick={() => void importReport()}>Importar evidencia local</button><span className="text-xs text-slate-400">{runFile}</span></div>
      <p role="status" className="text-sm text-sky-200">{importMessage}</p>
    </div>
    <div className="mt-5 space-y-3"><h3 className="font-medium text-white">Historial de ingeniería</h3><p className="text-xs text-slate-400">Filtrado de las últimas 50 observaciones generales de Hugo; puede omitir registros anteriores. Cada avance conserva la observación original.</p>{!observations.length && <p className="text-sm text-slate-400">Sin observaciones de ingeniería en la muestra disponible.</p>}{observations.map(row => <article key={row.id} className="rounded-xl border border-white/10 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><h4 className="font-medium text-white">{row.intent}</h4><span className="text-amber-200">{row.outcome}</span></div><p className="mt-1 text-xs text-slate-500">{name(row.caseId.split(":")[0])} · {row.source === "SERVER_RECONCILIATION" ? "Resultado del servidor" : "Declaración humana"}</p>{row.engineeringAssignment && <p className="mt-2 text-sky-200">Responsable: {row.engineeringAssignment.assigneeName}</p>}<p className="mt-2 whitespace-pre-wrap text-slate-300">{row.humanDecision}</p>{row.engineeringEvidence && <RunEvidence report={row.engineeringEvidence} />}<button className={`${input} mt-2 mr-2`} disabled={saving || !catalog} onClick={() => { setAssignment({ observationId: row.id, assigneeUid: "", note: "", requestId: crypto.randomUUID() }); setActionMessage(""); }}>Asignar responsable</button><button className={`${input} mt-2 mr-2`} disabled={saving} onClick={() => { setLinkedObservationId(row.id); setModuleId(row.caseId.split(":")[0]); setCaseId(""); setImportMessage("Incidencia seleccionada para vincular el reporte local."); }}>Vincular evidencia</button><button className={`${input} mt-2`} disabled={saving} onClick={() => { setCaseId(row.caseId); setLinkedObservationId(row.id); setModuleId(row.caseId.split(":")[0]); setTitle(row.intent); setEvidence(""); setStage(stages.includes(row.outcome) ? row.outcome : stages[0]); setMessage(""); }}>Agregar avance</button></article>)}</div>
    <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-slate-200">Actividad real de Hugo · últimas 10 trazas consultadas</summary><p className="mt-2 text-xs text-slate-400">Actividad operativa, no ejecuciones de Sol o Astra. Consulta limitada al periodo predeterminado de trazas.</p>{traces.map(trace => <p key={trace.id} className="mt-2 text-sm text-slate-300">{trace.resultStatus === "ERROR" ? "Error registrado" : "Ejecución registrada"} · {trace.toolsExecuted?.length || 0} herramientas · {trace.errorCode || trace.task || "Conversación"}</p>)}{!traces.length && <p className="mt-2 text-sm text-slate-400">Sin trazas en la muestra disponible.</p>}</details>
    <div className="mt-4 flex flex-wrap gap-4 text-sm text-sky-300"><Link href="/hugo">Abrir Hugo y su evidencia</Link><Link href="/activity-log">Ver registro de actividad</Link><Link href="/administracion/recursos-corporativos">Documentos de empresas propias</Link><Link href="/pagos">Comprobantes en Pagos</Link></div>
  </section>;
}
