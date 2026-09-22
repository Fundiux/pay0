"use client";

import { useState } from "react";
import { listAgent007LearningDiagnostics, listAgent007LearningLineage, type HugoLearningDiagnostic, type HugoLearningEvent } from "@/services/agent007";
import phase5 from "../../evals/hugo/learning/phase5-experiment-results.json";

export default function HugoLearningDiagnostics() {
  const [rows, setRows] = useState<HugoLearningDiagnostic[]>([]), [events, setEvents] = useState<HugoLearningEvent[]>([]);
  const [selected, setSelected] = useState(""), [message, setMessage] = useState(""), [loading, setLoading] = useState(false);
  async function load() { setLoading(true); setMessage(""); try { const result = await listAgent007LearningDiagnostics(); setRows(result.experiences); }
    catch (error: any) { setMessage(error?.message || "No se pudo consultar el aprendizaje."); } finally { setLoading(false); } }
  async function lineage(id: string) { setSelected(id); setEvents([]); try { setEvents((await listAgent007LearningLineage(id)).events); }
    catch (error: any) { setMessage(error?.message || "No se pudo consultar la procedencia."); } }
  const count = (check: (row: HugoLearningDiagnostic) => boolean) => rows.filter(check).length;
  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
    <div className="flex items-center justify-between"><div><h2 className="font-semibold text-white">Aprendizaje de Hugo</h2><p className="text-xs text-slate-500">Experiencias recientes, procedencia y elegibilidad. Vista limitada a 100 registros.</p></div><button onClick={() => void load()} disabled={loading} className="rounded bg-violet-600 px-3 py-2 text-white">Consultar</button></div>
    {message && <p className="mt-2 text-rose-300">{message}</p>}
    <p className="mt-3 text-xs">{rows.length} almacenadas · {count(x => x.state === "VERIFIED")} verificadas · {count(x => x.state === "WAITING_FOR_OUTCOME")} esperando resultado · {count(x => x.state === "REJECTED")} rechazadas · {count(x => x.trainingEligible)} elegibles</p>
    <p className="mt-2 text-xs text-slate-400">Prueba sintética Phase 5: {phase5.learningEffect.before} → {phase5.learningEffect.after}; mejora controlada: {phase5.learningEffect.improved ? "sí" : "no"}; contraejemplo copiado: {phase5.counterexample.copiedPriorExperience ? "sí" : "no"}. Sin prueba de mejora en Gemini de producción.</p>
    {!!rows.length && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Dominio", "Tarea", "Estado", "Resultado", "Corrección", "Entrenamiento", "Procedencia"].map(x => <th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-slate-800"><td className="p-2">{row.domain}</td><td className="p-2">{row.taskType}</td><td className="p-2">{row.state}</td><td className="p-2">{row.outcomeType || "pendiente"}</td><td className="p-2">{row.correctionCode || "sin corrección"}</td><td className="p-2">{row.trainingEligible ? "elegible" : row.reasons.join(", ")}</td><td className="p-2"><button className="text-violet-300 underline" onClick={() => void lineage(row.id)}>Ver eventos</button></td></tr>)}</tbody></table></div>}
    {selected && <div className="mt-3 rounded bg-slate-950 p-3 text-xs"><p className="text-violet-300">{selected}: observado → decisión → resultado → experiencia → uso medido</p>{events.length ? events.map(event => <p key={event.eventId} className="mt-1">{event.at} · {event.type} · {event.references.map(x => `${x.kind}:${x.id}`).join(", ")}</p>) : <p className="mt-1 text-slate-500">No hay eventos adicionales en el ledger; una recuperación puede aparecer en la traza de conversación.</p>}</div>}
    <p className="mt-2 text-xs text-slate-500">Almacenada, recuperada y usada describen etapas distintas. «Aprendida» requiere mejora conductual medida; aquí no se infiere solo por conteos.</p>
  </section>;
}
