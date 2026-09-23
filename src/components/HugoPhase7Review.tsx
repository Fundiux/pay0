"use client";

import { useEffect, useMemo, useState } from "react";
import catalog from "../../evals/hugo/phase7/phase7-review-catalog.json";
import dashboard from "../../evals/hugo/phase7/phase7-dashboard.json";
import importedReview from "../../evals/hugo/phase7/phase7-human-review-analysis.json";
import { listAgent007HumanReviews, saveAgent007HumanReview, type HugoHumanReview, type HugoHumanReviewChoice } from "@/services/agent007";

const choices: Array<[HugoHumanReviewChoice, string]> = [["A_BETTER", "A mejor"], ["B_BETTER", "B mejor"], ["EQUIVALENT", "Equivalentes"], ["BOTH_ACCEPTABLE", "Ambas aceptables"], ["BOTH_UNACCEPTABLE", "Ambas inaceptables"]];
const reasonOptions = [["CORRECTNESS", "Correccion"], ["EVIDENCE_USE", "Uso de evidencia"], ["CLARITY", "Claridad"], ["CALIBRATION", "Calibracion"], ["AMBIGUITY", "Ambiguedad"], ["EXPERIENCE_USE", "Uso de experiencia"], ["OTHER", "Otro"]] as const;
const rows = catalog.groups.flatMap(group => group.cases.map(row => ({ ...row, phase: group.phase, evalRunId: group.evalRunId })));
const importedDecisions = Object.fromEntries(Object.values(importedReview.phases).flatMap(phase => phase.decisions.map(decision => [`${phase.evalRunId}:${decision.caseId}`, decision])));

export default function HugoPhase7Review() {
  const [index, setIndex] = useState(0), [reviews, setReviews] = useState<Record<string, HugoHumanReview>>({});
  const [choice, setChoice] = useState<HugoHumanReviewChoice | "">(""), [reasons, setReasons] = useState<string[]>([]), [note, setNote] = useState("");
  const [message, setMessage] = useState(""), [saving, setSaving] = useState(false);
  const row = rows[index], key = `${row.evalRunId}:${row.caseId}`, saved = reviews[key], importedDecision = importedDecisions[key];
  useEffect(() => { void Promise.all(catalog.groups.map(group => listAgent007HumanReviews(group.evalRunId))).then(results => {
    const next: Record<string, HugoHumanReview> = {}; results.flatMap(result => result.reviews).forEach(review => { next[`${review.evalRunId}:${review.caseId}`] = review; }); setReviews(next);
  }).catch(error => setMessage(error?.message || "No se pudieron cargar las revisiones.")); }, []);
  useEffect(() => { setChoice(saved?.choice || ""); setReasons(saved?.reasons || []); setNote(saved?.note || ""); }, [key, saved]);
  const counts = useMemo(() => ({ reviewed: Object.values(reviews).filter(review => review.status === "REVIEWED").length,
    skipped: Object.values(reviews).filter(review => review.status === "SKIPPED").length,
    incomplete: rows.length - Object.keys(reviews).length }), [reviews]);
  async function persist(status: "REVIEWED" | "SKIPPED") {
    if (status === "REVIEWED" && !choice) { setMessage("Selecciona un juicio antes de guardar."); return; }
    setSaving(true); setMessage("");
    try { const result = await saveAgent007HumanReview({ evalRunId: row.evalRunId, caseId: row.caseId, status, choice: status === "REVIEWED" ? choice as HugoHumanReviewChoice : undefined, reasons: status === "REVIEWED" ? reasons : [], note });
      setReviews(current => ({ ...current, [key]: result.review })); setMessage(result.review.revision > 1 ? "Revision guardada; el evento anterior permanece en el historial." : "Revision guardada con identidad y fecha.");
    } catch (error: any) { setMessage(error?.message || "No se pudo guardar la revision."); } finally { setSaving(false); }
  }
  function toggleReason(reason: string) { setReasons(current => current.includes(reason) ? current.filter(value => value !== reason) : [...current, reason]); }
  return <section className="mt-6 rounded-2xl border border-violet-500/30 bg-slate-900 p-4 text-sm text-slate-300">
    <h2 className="font-semibold text-white">Revision humana ciega · Fases 4 y 6</h2>
    <p className="mt-1 text-xs text-slate-500">La identidad de cada respuesta permanece oculta durante el juicio. Cada cambio crea una revision auditable y no se convierte automaticamente en dato de entrenamiento.</p>
    <div className="mt-3 flex flex-wrap gap-2 text-xs">{Object.entries(dashboard.classifications).map(([label, count]) => <span key={label} className="rounded bg-slate-950 px-2 py-1">{label}: {count}</span>)}</div>
    <p className="mt-2 text-xs text-slate-400">Tokens medianos: entrada {dashboard.tokenAndLatency.medianInputTokens ?? "N/D"}, salida visible {dashboard.tokenAndLatency.medianVisibleOutputTokens ?? "N/D"}, razonamiento {dashboard.tokenAndLatency.medianReasoningTokens ?? "N/D"}. Latencia total mediana: {dashboard.tokenAndLatency.medianFullFlowLatencyMs ?? "N/D"} ms. MAX_TOKENS: {dashboard.tokenAndLatency.maxTokensIncidence}.</p>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="p-1">Dominio</th><th>Casos</th><th>Apropiados</th><th>Omitidos</th><th>Transferencia negativa</th><th>Proveedor</th><th>Humano directo</th></tr></thead><tbody>{dashboard.domains.map(row => <tr key={row.domain} className="border-t border-slate-800"><td className="p-1">{row.domain}</td><td>{row.cases}</td><td>{row.appropriateEffects}</td><td>{row.missedBeneficialEffects}</td><td>{row.negativeTransfer}</td><td>{row.providerErrors}</td><td>{row.humanReviewStatus}</td></tr>)}</tbody></table></div>
    <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded bg-emerald-950 px-2 py-1">Evidencia importada: {importedReview.reviewed}/{importedReview.totalCases}</span><span className="rounded bg-slate-950 px-2 py-1">Pendientes importados: {importedReview.incomplete}</span><span className="rounded bg-emerald-950 px-2 py-1">Guardados en este root: {counts.reviewed}</span><span className="rounded bg-amber-950 px-2 py-1">Omitidos en este root: {counts.skipped}</span><span className="rounded bg-slate-950 px-2 py-1">Sin guardar en este root: {counts.incomplete}</span><span className="rounded bg-slate-950 px-2 py-1">Fase 7: {dashboard.humanReviewStatus}</span></div>
    <div className="mt-4 flex items-center gap-3"><button disabled={index === 0} onClick={() => setIndex(index - 1)} className="rounded bg-slate-800 px-2 py-1 disabled:opacity-40">Anterior</button><span>{index + 1}/{rows.length} · {row.phase} · {row.category}</span><button disabled={index === rows.length - 1} onClick={() => setIndex(index + 1)} className="rounded bg-slate-800 px-2 py-1 disabled:opacity-40">Siguiente</button></div>
    <p className="mt-3 text-white">{row.task}</p>
    <details className="mt-2 rounded bg-slate-950 p-2"><summary>Evidencia y criterios de aceptacion</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ evidence: row.controlledEvidence, acceptanceCriteria: row.acceptanceCriteria }, null, 2)}</pre></details>
    <div className="mt-3 grid gap-3 md:grid-cols-2">{[["A", row.responseA], ["B", row.responseB]].map(([label, response]) => <div key={label} className="rounded bg-slate-950 p-3"><strong>Respuesta {label}</strong><p className="mt-2 whitespace-pre-wrap">{response || "Sin respuesta completa"}</p></div>)}</div>
    <div className="mt-3 flex flex-wrap gap-2">{choices.map(([value, label]) => <button key={value} onClick={() => setChoice(value)} className={`rounded px-3 py-1.5 ${choice === value ? "bg-violet-600 text-white" : "bg-slate-800"}`}>{label}</button>)}</div>
    <div className="mt-3 flex flex-wrap gap-2 text-xs">{reasonOptions.map(([value, label]) => <label key={value} className={`cursor-pointer rounded px-2 py-1 ${reasons.includes(value) ? "bg-sky-900" : "bg-slate-800"}`}><input type="checkbox" checked={reasons.includes(value)} onChange={() => toggleReason(value)} className="mr-1" />{label}</label>)}</div>
    <textarea value={note} onChange={event => setNote(event.target.value.slice(0, 1000))} placeholder="Nota opcional" className="mt-3 w-full rounded bg-slate-950 p-2" />
    <div className="mt-3 flex gap-2"><button disabled={saving} onClick={() => void persist("REVIEWED")} className="rounded bg-violet-600 px-3 py-2 text-white disabled:opacity-50">Guardar juicio</button><button disabled={saving} onClick={() => void persist("SKIPPED")} className="rounded border border-slate-600 px-3 py-2 disabled:opacity-50">Omitir caso</button></div>
    {importedDecision && <p className="mt-2 text-xs text-emerald-300">Juicio importado: {importedDecision.choice} · preferencia decodificada: {importedDecision.preferredSource}</p>}
    {saved && <p className="mt-2 text-xs text-slate-400">Estado en este root: {saved.status} · revision {saved.revision} · {new Date(saved.reviewedAt).toLocaleString("es-MX")}</p>}{message && <p className="mt-2 text-xs text-sky-300">{message}</p>}
  </section>;
}
