"use client";

import { useEffect, useRef, useState } from "react";
import { listAgent007LearningDiagnostics, listAgent007LearningLineage, listAgent007SupervisedReview, reviewAgent007LearningRule,
  type HugoLearningDiagnostic, type HugoLearningEvent, type HugoSupervisedReview, type HugoSupervisedCandidate, type HugoSupervisedRule } from "@/services/agent007";
import { useUserProfile } from "@/lib/useUserProfile";
import Modal from "@/components/Modal";
import phase5 from "../../evals/hugo/learning/phase5-experiment-results.json";

export default function HugoLearningDiagnostics() {
  const { profile, profileUid } = useUserProfile();
  const canReview = !!profileUid && profile?.role === "superadmin" && profile?.active !== false;
  return <LearningDiagnosticsContent key={JSON.stringify([profileUid, profile?.rootId, profile?.role, profile?.active])} canReview={canReview} />;
}
function LearningDiagnosticsContent({ canReview }: { canReview: boolean }) {
  const [rows, setRows] = useState<HugoLearningDiagnostic[]>([]), [events, setEvents] = useState<HugoLearningEvent[]>([]);
  const [selected, setSelected] = useState(""), [message, setMessage] = useState(""), [loading, setLoading] = useState(false);
  const [queriedAt, setQueriedAt] = useState("");
  const loadGeneration = useRef(0), lineageGeneration = useRef(0);
  useEffect(() => () => { loadGeneration.current++; lineageGeneration.current++; }, []);
  async function load() { const version = ++loadGeneration.current; setLoading(true); setMessage(""); try { const result = await listAgent007LearningDiagnostics(); if (version === loadGeneration.current) { setRows(result.experiences); setQueriedAt(new Date().toISOString()); } }
    catch (error: any) { if (version === loadGeneration.current) setMessage(error?.message || "No se pudo consultar el aprendizaje."); } finally { if (version === loadGeneration.current) setLoading(false); } }
  async function lineage(id: string) { const version = ++lineageGeneration.current; setSelected(id); setEvents([]); try { const result = await listAgent007LearningLineage(id); if (version === lineageGeneration.current) setEvents(result.events); }
    catch (error: any) { if (version === lineageGeneration.current) setMessage(error?.message || "No se pudo consultar la procedencia."); } }
  const count = (check: (row: HugoLearningDiagnostic) => boolean) => rows.filter(check).length;
  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
    <div className="flex items-center justify-between"><div><h2 className="font-semibold text-white">Aprendizaje de María</h2><p className="text-xs text-slate-500">Experiencias recientes, procedencia y elegibilidad. Vista limitada a 100 registros.</p></div><button onClick={() => void load()} disabled={loading} className="rounded bg-violet-600 px-3 py-2 text-white">Consultar</button></div>
    {message && <p className="mt-2 text-rose-300">{message}</p>}
    {queriedAt && <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400"><p>Consulta completada · {rows.length} registros · Voz excluida.</p><p>Fuente: experiencias verificables de aprendizaje · Rango: últimos 100 registros · Última actualización: {new Date(queriedAt).toLocaleString("es-MX")}</p>{rows.length === 0 && <p>0 registros. No hay experiencias con resultado medido en el alcance consultado.</p>}</div>}
    <p className="mt-3 text-xs">{rows.length} almacenadas · {count(x => x.state === "VERIFIED")} verificadas · {count(x => x.state === "WAITING_FOR_OUTCOME")} esperando resultado · {count(x => x.state === "REJECTED")} rechazadas · {count(x => x.trainingEligible)} aptas por calidad (uso sujeto a revisión)</p>
    <p className="mt-2 text-xs text-slate-400">Prueba sintética Phase 5: {phase5.learningEffect.before} → {phase5.learningEffect.after}; mejora controlada: {phase5.learningEffect.improved ? "sí" : "no"}; contraejemplo copiado: {phase5.counterexample.copiedPriorExperience ? "sí" : "no"}. Sin prueba de mejora en Gemini de producción.</p>
    {!!rows.length && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Dominio", "Tarea", "Estado", "Resultado", "Corrección", "Calidad", "Procedencia"].map(x => <th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-slate-800"><td className="p-2">{row.domain}</td><td className="p-2">{row.taskType}</td><td className="p-2">{row.state}{row.supersededById ? ` → ${row.supersededById}` : ""}</td><td className="p-2">{row.outcomeType || "pendiente"}</td><td className="p-2">{row.correctionCode || "sin corrección"}</td><td className="p-2">{row.trainingEligible ? "apta por calidad" : row.reasons.join(", ")}</td><td className="p-2"><button className="text-violet-300 underline" onClick={() => void lineage(row.id)}>Ver eventos</button></td></tr>)}</tbody></table></div>}
    {selected && <div className="mt-3 rounded bg-slate-950 p-3 text-xs"><p className="text-violet-300">{selected}: observado → decisión → resultado → experiencia → uso medido</p>{events.length ? events.map(event => <p key={event.eventId} className="mt-1">{event.at} · {event.type} · {event.references.map(x => `${x.kind}:${x.id}`).join(", ")}</p>) : <p className="mt-1 text-slate-500">No hay eventos adicionales en el ledger; una recuperación puede aparecer en la traza de conversación.</p>}</div>}
    <p className="mt-2 text-xs text-slate-500">Almacenada, recuperada y usada describen etapas distintas. «Aprendida» requiere mejora conductual medida; aquí no se infiere solo por conteos.</p>
    {canReview && <SupervisedReviewPanel />}
  </section>;
}

type ReviewPages = { candidateCursor?: string; ruleCursor?: string };
type ReviewDecision = { action: "APPROVE"; supportingIds: string[] } | { action: "REVOKE"; ruleId: string };
function SupervisedReviewPanel() {
  const [data, setData] = useState<HugoSupervisedReview | null>(null);
  const [pages, setPages] = useState<ReviewPages>({});
  const [candidateBack, setCandidateBack] = useState<Array<string | undefined>>([]), [ruleBack, setRuleBack] = useState<Array<string | undefined>>([]);
  const [selected, setSelected] = useState<string[]>([]), [detail, setDetail] = useState<HugoSupervisedCandidate | null>(null);
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function load(next: ReviewPages = pages, focusedRuleId?: string) {
    const version = ++generation.current;
    setBusy(true); setMessage(""); setSelected([]); setDetail(null); setData(null); setDecision(null);
    try {
      const result = await listAgent007SupervisedReview({ ...next, ...(focusedRuleId ? { focusedRuleId } : {}), limit: 20 });
      if (version !== generation.current) return false;
      setData(result); setPages(next); return true;
    } catch (error: any) { if (version === generation.current) setMessage(error?.message || "No se pudo consultar la revisión supervisada."); return false; }
    finally { if (version === generation.current) setBusy(false); }
  }
  async function confirm() {
    if (!decision || saving) return;
    const current = decision, version = ++generation.current;
    setSaving(true); setMessage("");
    try {
      const result = await reviewAgent007LearningRule(current);
      if (version !== generation.current) return;
      setSaving(false); setDecision(null); setRuleBack([]);
      if (await load({ candidateCursor: pages.candidateCursor }, result.ruleId)) setMessage("Decisión guardada. Estado consultado nuevamente en el servidor.");
    } catch (error: any) {
      if (version === generation.current) { setSaving(false); setDecision(null); setMessage(error?.message || "No se pudo guardar la decisión. Consulta nuevamente antes de reintentar."); }
    }
  }
  function nextPage(kind: "candidate" | "rule", cursor: string) {
    if (kind === "candidate") { setCandidateBack([...candidateBack, pages.candidateCursor]); void load({ ...pages, candidateCursor: cursor }); }
    else { setRuleBack([...ruleBack, pages.ruleCursor]); void load({ ...pages, ruleCursor: cursor }); }
  }
  function previousPage(kind: "candidate" | "rule") {
    if (kind === "candidate") { const stack = [...candidateBack]; const cursor = stack.pop(); setCandidateBack(stack); void load({ ...pages, candidateCursor: cursor }); }
    else { const stack = [...ruleBack]; const cursor = stack.pop(); setRuleBack(stack); void load({ ...pages, ruleCursor: cursor }); }
  }
  function ruleRow(rule: HugoSupervisedRule) {
    return <li key={rule.id} className="rounded border border-slate-700 p-3">
      <p className="break-all text-white">{rule.id} · versión {rule.version}</p>
      <p>Estado guardado: {rule.status}{rule.expired ? " · vigencia vencida" : ""}. Vence: {rule.expiresAt || "sin fecha válida"}.</p>
      <p className="break-all">Aprobó: {rule.approvedBy || "sin dato"} · {rule.approvedAt || "sin fecha"}</p>
      <p className="break-all">Soporte: {rule.supportingIds.join(", ") || "sin soporte"}</p>
      {rule.invalidatedBy && <p>Motivo de invalidación: {rule.invalidatedBy}</p>}
      <button type="button" disabled={busy || saving || rule.status !== "ACTIVE"} onClick={() => setDecision({ action: "REVOKE", ruleId: rule.id })} className="mt-2 rounded border border-rose-700 px-3 py-2 text-rose-200 disabled:opacity-40">Revocar regla</button>
    </li>;
  }
  return <div className="mt-6 border-t border-slate-700 pt-4" aria-label="Revisión humana de reglas">
    <h3 className="font-semibold text-white">Revisión humana de reglas supervisadas</h3>
    <p className="mt-1 text-xs text-slate-400">Selecciona de dos a cinco experiencias para recomendar revisar documentación. No ejecuta pagos ni cambia solicitudes. El servidor comprueba compatibilidad, contradicciones y evidencia al aprobar.</p>
    <button type="button" disabled={busy || saving} onClick={() => { setCandidateBack([]); setRuleBack([]); void load({}); }} className="mt-3 rounded bg-violet-700 px-3 py-2 text-white disabled:opacity-40">Consultar revisión supervisada</button>
    {message && <p role="status" className="mt-2 text-amber-200">{message}</p>}
    {busy && <p role="status">Consultando evidencia y reglas…</p>}
    {data && <>
      <p className="mt-3 text-xs text-slate-400">Consulta: {data.queriedAt}. Disponibilidad de aprobación: por confirmar con el servidor. Aplicación de reglas en María: no verificada. Si la revisión está pausada, el servidor lo indicará al confirmar.</p>
      <h4 className="mt-4 font-medium text-white">Experiencias para revisión · página limitada a {data.limit}</h4>
      {!data.candidates.length && <p>No hay experiencias en esta página del ámbito consultado.</p>}
      <ul className="mt-2 space-y-2">{data.candidates.map(row => <li key={row.id} className="rounded border border-slate-700 p-3">
        <label className="flex items-start gap-2"><input type="checkbox" checked={selected.includes(row.id)} disabled={saving || !row.selectionEligible || selected.length >= 5 && !selected.includes(row.id)}
          onChange={() => setSelected(previous => previous.includes(row.id) ? previous.filter(id => id !== row.id) : [...previous, row.id])} aria-label={`Seleccionar experiencia ${row.id}`} />
          <span className="break-all">{row.id} · revisión {row.revision} · {row.state}</span></label>
        {!row.selectionEligible && <p className="mt-1 text-xs text-slate-400">No seleccionable: {row.reasons.join(", ")}</p>}
        <button type="button" onClick={() => setDetail(row)} className="mt-1 text-violet-300 underline">Ver evidencia de {row.id}</button>
      </li>)}</ul>
      <div className="mt-2 flex gap-2"><button disabled={busy || saving || !candidateBack.length} onClick={() => previousPage("candidate")}>Experiencias anteriores</button><button disabled={busy || saving || !data.nextCandidateCursor} onClick={() => data.nextCandidateCursor && nextPage("candidate", data.nextCandidateCursor)}>Experiencias siguientes</button></div>
      <button type="button" disabled={busy || saving || selected.length < 2 || selected.length > 5} onClick={() => setDecision({ action: "APPROVE", supportingIds: [...selected] })} className="mt-3 rounded bg-emerald-800 px-3 py-2 text-white disabled:opacity-40">Revisar aprobación ({selected.length}/5)</button>
      {detail && <div className="mt-3 rounded bg-slate-950 p-3 text-xs" aria-label="Evidencia de experiencia">
        <p className="break-all">{detail.id} · {detail.domain}/{detail.taskType} · partición {detail.split}</p>
        <p>{detail.features.entityType} · {detail.features.status} · {detail.features.issueCode}</p>
        <p>Conducta: {detail.expectedBehavior}. Corrección: {detail.correctionCode}.</p>
        <p>Resultado: {detail.outcomeType} · {detail.outcomeAt || "sin fecha"}</p>
        <ul>{detail.evidence.map((ref, index) => <li key={index} className="break-all">{ref.system} · {ref.kind} · {ref.id}</li>)}</ul>
      </div>}
      <h4 className="mt-5 font-medium text-white">Reglas guardadas · página limitada a {data.limit}</h4>
      <p className="text-xs text-slate-400">El estado guardado no garantiza aplicabilidad: el soporte y los permisos se revalidan al usar la regla.</p>
      {!data.rules.length && <p>No hay reglas en esta página del ámbito consultado.</p>}
      <ul className="mt-2 space-y-2">{data.rules.map(ruleRow)}</ul>
      <div className="mt-2 flex gap-2"><button disabled={busy || saving || !ruleBack.length} onClick={() => previousPage("rule")}>Reglas anteriores</button><button disabled={busy || saving || !data.nextRuleCursor} onClick={() => data.nextRuleCursor && nextPage("rule", data.nextRuleCursor)}>Reglas siguientes</button></div>
      {data.focusedRule && !data.rules.some(row => row.id === data.focusedRule?.id) && <><h4 className="mt-4 text-white">Regla recién consultada</h4><ul>{ruleRow(data.focusedRule)}</ul></>}
    </>}
    <Modal open={!!decision} title={decision?.action === "APPROVE" ? "Confirmar aprobación supervisada" : "Confirmar revocación"} onClose={() => !saving && setDecision(null)} closeButtonDisabled={saving}>
      <p>{decision?.action === "APPROVE" ? "Se evaluará una recomendación de revisión documental con estas experiencias. No confirma documentos faltantes ni autoriza operaciones." : "La regla dejará de estar activa; su historial y evidencia se conservarán."}</p>
      <p className="mt-2 break-all text-sm">{decision?.action === "APPROVE" ? decision.supportingIds.join(", ") : decision?.ruleId}</p>
      <div className="mt-4 flex gap-3"><button disabled={saving} onClick={() => setDecision(null)}>Cancelar</button><button disabled={saving} onClick={() => void confirm()} className="rounded bg-violet-700 px-3 py-2 text-white">{saving ? "Guardando…" : "Confirmar decisión"}</button></div>
    </Modal>
  </div>;
}
