"use client";

import { useEffect, useState } from "react";
import report from "../../evals/hugo/phase6/phase6-dashboard.json";
import blind from "../../evals/hugo/phase6/phase6-blind-review.json";
import workload from "../../evals/hugo/phase6/phase6-workload.json";
import tokenDiagnostic from "../../evals/hugo/phase6/phase6-token-diagnostic.json";

type Choice = "A_BETTER" | "B_BETTER" | "EQUIVALENT" | "BOTH_ACCEPTABLE" | "BOTH_UNACCEPTABLE";
type Decision = { choice?: Choice; reason?: string; note?: string };
const key = `hugo-phase6-blind-${blind.evalRunId}`;
const choices: Array<[Choice, string]> = [["A_BETTER", "A mejor"], ["B_BETTER", "B mejor"], ["EQUIVALENT", "Equivalentes"],
  ["BOTH_ACCEPTABLE", "Ambas aceptables"], ["BOTH_UNACCEPTABLE", "Ambas inaceptables"]];
const reasons = [["CORRECTNESS", "Corrección"], ["CLARITY", "Claridad"], ["CONFIDENCE", "Confianza"], ["EVIDENCE_USE", "Uso de evidencia"], ["AMBIGUITY", "Ambigüedad"], ["OTHER", "Otro"]];
export default function HugoPhase6Review() {
  const [index, setIndex] = useState(0), [decisions, setDecisions] = useState<Record<string, Decision>>({});
  useEffect(() => { try { setDecisions(JSON.parse(localStorage.getItem(key) || "{}")); } catch { setDecisions({}); } }, []);
  const row = blind.cases[index], decision = decisions[row.caseId], completed = Object.values(decisions).filter(x => x.choice).length;
  function update(next: Decision) { const all = { ...decisions, [row.caseId]: next }; setDecisions(all); localStorage.setItem(key, JSON.stringify(all)); }
  function download() { const payload = { evalRunId: blind.evalRunId, reviewedAt: new Date().toISOString(), decisions: Object.fromEntries(Object.entries(decisions).filter(([, value]) => value.choice)) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `hugo-phase6-review-${blind.evalRunId}.json`; link.click(); URL.revokeObjectURL(url); }
  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
    <h2 className="font-semibold text-white">Aprendizaje controlado · Fase 6</h2>
    <p className="mt-1 text-xs text-slate-500">Casos sintéticos con Gemini. Las clasificaciones automáticas requieren revisión humana; no representan producción.</p>
    <div className="mt-3 flex flex-wrap gap-2 text-xs">{Object.entries(report.classifications).filter(([, count]) => count > 0).map(([label, count]) =>
      <span key={label} className="rounded bg-slate-950 px-2 py-1">{label}: {count}</span>)}</div>
    <p className="mt-2 text-xs">Experiencia pertinente incluida: {report.retrieval.expectedRelevantIncluded}/{report.retrieval.familyDenominator}. Contraejemplo excluido: {report.retrieval.expectedCounterexamplesExcluded}/{report.retrieval.familyDenominator}. Mediana de tokens de entrada: {report.tokenAndLatency.medianInputTokens}. Revisiones humanas: {completed}/{blind.cases.length} en este navegador.</p>
    <p className="mt-1 text-xs text-slate-400">Sin modelo: {workload.safelyResolvedWithoutModel}/{workload.totalTasks} tareas sintéticas resueltas. Diagnóstico de tokens: {tokenDiagnostic.results.filter(row => row.finish === "MAX_TOKENS").length} variante agotó el límite; la causa observada incluye tokens de razonamiento elevados.</p>
    <div className="mt-3 flex items-center gap-3"><button disabled={index === 0} onClick={() => setIndex(index - 1)} className="rounded bg-slate-800 px-2 py-1">Anterior</button>
      <span>{index + 1}/{blind.cases.length} · {row.category}</span><button disabled={index === blind.cases.length - 1} onClick={() => setIndex(index + 1)} className="rounded bg-slate-800 px-2 py-1">Siguiente</button></div>
    <p className="mt-3">{row.userInput}</p><details className="mt-2 rounded bg-slate-950 p-2"><summary>Evidencia actual controlada</summary><pre className="mt-2 whitespace-pre-wrap text-xs">{JSON.stringify(row.controlledEvidence, null, 2)}</pre></details>
    <div className="mt-2 grid gap-3 md:grid-cols-2">{[["A", row.responseA], ["B", row.responseB]].map(([label, value]) => <div key={label} className="rounded bg-slate-950 p-3"><strong>Respuesta {label}</strong><p className="mt-2 whitespace-pre-wrap">{value}</p></div>)}</div>
    <div className="mt-3 flex flex-wrap gap-2">{choices.map(([value, label]) => <button key={value} onClick={() => update({ ...decision, choice: value })}
      className={`rounded px-3 py-1.5 ${decision?.choice === value ? "bg-violet-600 text-white" : "bg-slate-800"}`}>{label}</button>)}</div>
    <label className="mt-3 block text-xs">Motivo opcional<select value={decision?.reason || ""} onChange={event => update({ ...decision, reason: event.target.value })} className="mt-1 w-full rounded bg-slate-950 p-2"><option value="">Sin motivo</option>{reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="mt-3 block text-xs">Nota opcional<textarea value={decision?.note || ""} onChange={event => update({ ...decision, note: event.target.value.slice(0, 1000) })} className="mt-1 w-full rounded bg-slate-950 p-2" /></label>
    <button onClick={download} className="mt-3 rounded border border-violet-500 px-3 py-2 text-violet-200">Exportar revisión</button>
  </section>;
}
