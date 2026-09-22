"use client";

import { useEffect, useState } from "react";
import blind from "../../evals/hugo/phase4-model-results-blind-review.json";

type Choice = "A_BETTER" | "B_BETTER" | "EQUIVALENT" | "BOTH_UNACCEPTABLE";
type Decision = { choice?: Choice; note: string };
const key = `hugo-blind-review-${blind.evalRunId}`;
const options: Array<[Choice, string]> = [["A_BETTER", "A mejor"], ["B_BETTER", "B mejor"], ["EQUIVALENT", "Equivalentes"], ["BOTH_UNACCEPTABLE", "Ambas inaceptables"]];
export default function HugoBlindReview() {
  const [index, setIndex] = useState(0), [answers, setAnswers] = useState<Record<string, Decision>>({});
  useEffect(() => { try { setAnswers(JSON.parse(localStorage.getItem(key) || "{}")); } catch { setAnswers({}); } }, []);
  const row = blind.cases[index], current = answers[row.caseId];
  function update(value: Decision) { const next = { ...answers, [row.caseId]: value }; setAnswers(next); localStorage.setItem(key, JSON.stringify(next)); }
  function download() { const decisions = Object.fromEntries(Object.entries(answers).filter(([, value]) => value.choice)); const payload = { evalRunId: blind.evalRunId, completed: Object.keys(decisions).length, reviewedAt: new Date().toISOString(), decisions };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url;
    link.download = `hugo-phase4-blind-review-${blind.evalRunId}.json`; link.click(); URL.revokeObjectURL(url); }
  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300"><h2 className="font-semibold text-white">Revisión humana ciega · Fase 4</h2>
    <p className="mt-1 text-xs text-slate-500">{Object.values(answers).filter(x => x.choice).length}/{blind.cases.length} comparaciones guardadas en este navegador. Exporta el archivo para conservarlas; no se envían a Firebase.</p>
    <div className="mt-3 flex items-center gap-3"><button disabled={index === 0} onClick={() => setIndex(index - 1)} className="rounded bg-slate-800 px-2 py-1">Anterior</button><span>{index + 1}/{blind.cases.length} · {row.category}</span><button disabled={index === blind.cases.length - 1} onClick={() => setIndex(index + 1)} className="rounded bg-slate-800 px-2 py-1">Siguiente</button></div>
    <p className="mt-3">Entrada: {row.userInput}</p><div className="mt-2 grid gap-3 md:grid-cols-2">{[["A", row.responseA], ["B", row.responseB]].map(([label, response]) => <div key={label} className="rounded bg-slate-950 p-3"><strong>Respuesta {label}</strong><p className="mt-2 whitespace-pre-wrap">{response || "Sin respuesta completa"}</p></div>)}</div>
    <div className="mt-3 flex flex-wrap gap-2">{options.map(([value, label]) => <button key={value} onClick={() => update({ choice: value, note: current?.note || "" })} className={`rounded px-3 py-1.5 ${current?.choice === value ? "bg-violet-600 text-white" : "bg-slate-800"}`}>{label}</button>)}</div>
    <label className="mt-3 block text-xs">Nota opcional<textarea value={current?.note || ""} onChange={event => update({ choice: current?.choice, note: event.target.value.slice(0, 1000) })} className="mt-1 w-full rounded bg-slate-950 p-2" /></label>
    <button onClick={download} className="mt-3 rounded border border-violet-500 px-3 py-2 text-violet-200">Exportar revisión</button>
  </section>;
}
