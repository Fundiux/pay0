"use client";

import { useState } from "react";
import { getAgent007Trace, listAgent007Traces, type HugoTrace, type HugoTraceFilter } from "@/services/agent007";

const date = (value: any) => {
  const d = value?.toDate?.() || (typeof value?.seconds === "number" ? new Date(value.seconds * 1000) : new Date(value || 0));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-MX");
};

export default function HugoTraceInspector() {
  const [filter, setFilter] = useState<HugoTraceFilter>({ limit: 20 });
  const [rows, setRows] = useState<HugoTrace[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<HugoTrace | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function load(nextCursor?: string) {
    setLoading(true); setError("");
    try {
      const result = await listAgent007Traces({ ...filter, cursor: nextCursor });
      setRows(nextCursor ? [...rows, ...result.traces] : result.traces);
      setCursor(result.cursor);
    } catch (e: any) { setError(e?.message || "No se pudieron cargar las trazas."); }
    finally { setLoading(false); }
  }
  async function inspect(id: string) {
    try { setSelected((await getAgent007Trace(id)).trace); }
    catch (e: any) { setError(e?.message || "No se pudo abrir la traza."); }
  }
  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
    <h2 className="font-semibold text-white">Actividad de Hugo</h2>
    <p className="mt-1 text-xs text-slate-500">Procedencia y ejecución de los últimos 30 días. Cada página examina hasta 20 trazas.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <input aria-label="Conversación" placeholder="Conversación" value={filter.conversationId || ""} onChange={e => setFilter({ ...filter, conversationId: e.target.value })} className="rounded bg-slate-950 p-2" />
      <select aria-label="Resultado" value={filter.resultStatus || ""} onChange={e => setFilter({ ...filter, resultStatus: e.target.value })} className="rounded bg-slate-950 p-2"><option value="">Todos los resultados</option><option value="MODEL_RESPONSE">Modelo</option><option value="DETERMINISTIC_FALLBACK">Fallback</option><option value="ERROR">Error</option></select>
      <input aria-label="Tool" placeholder="Tool" value={filter.tool || ""} onChange={e => setFilter({ ...filter, tool: e.target.value })} className="rounded bg-slate-950 p-2" />
      <input aria-label="Sistema fuente" placeholder="Sistema fuente" value={filter.sourceSystem || ""} onChange={e => setFilter({ ...filter, sourceSystem: e.target.value })} className="rounded bg-slate-950 p-2" />
      <select aria-label="Completitud" value={filter.completeness || ""} onChange={e => setFilter({ ...filter, completeness: e.target.value })} className="rounded bg-slate-950 p-2"><option value="">Toda completitud</option><option value="COMPLETE">Completa</option><option value="PARTIAL">Parcial</option><option value="UNKNOWN">Desconocida</option></select>
      <label className="flex items-center gap-1"><input type="checkbox" checked={filter.errorOnly || false} onChange={e => setFilter({ ...filter, errorOnly: e.target.checked })} />Solo errores</label>
      <input aria-label="Desde" type="date" onChange={e => setFilter({ ...filter, from: e.target.value || undefined })} className="rounded bg-slate-950 p-2" />
      <input aria-label="Hasta" type="date" onChange={e => setFilter({ ...filter, to: e.target.value || undefined })} className="rounded bg-slate-950 p-2" />
      <button disabled={loading} onClick={() => void load()} className="rounded bg-violet-600 px-3 py-2 text-white">Consultar</button>
    </div>
    {error && <p className="mt-2 text-rose-300">{error}</p>}
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Fecha", "Conversación", "Canal", "Modelo / prompt", "Resultado", "Tools / fuentes", "Completitud", "Latencia", "Error"].map(x => <th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="cursor-pointer border-t border-slate-800 hover:bg-slate-800" onClick={() => void inspect(row.id)}><td className="p-2">{date(row.timestamp)}</td><td className="p-2">{row.conversationId}</td><td className="p-2">{row.channel}</td><td className="p-2">{row.model} / {row.promptVersion}</td><td className="p-2">{row.resultStatus}</td><td className="p-2">{row.toolsRequested?.join(", ") || "—"}<br />{row.sourceSystems?.join(", ") || "—"}</td><td className="p-2">{[...new Set(row.toolsExecuted?.map(x => x.completeness) || [])].join(", ") || "—"}</td><td className="p-2">{row.latencyMs ?? "—"} ms</td><td className="p-2">{row.errorCode || "—"}</td></tr>)}</tbody></table></div>
    {cursor && <button disabled={loading} onClick={() => void load(cursor)} className="mt-3 rounded border border-slate-700 px-3 py-1">Más trazas</button>}
    {selected && <div className="mt-4 rounded-xl border border-violet-500/30 bg-slate-950 p-4"><div className="flex justify-between"><h3 className="font-medium text-white">Detalle de ejecución</h3><button onClick={() => setSelected(null)}>Cerrar</button></div><p className="mt-2">{selected.model} · {selected.promptVersion} · {selected.resultStatus} · {selected.latencyMs ?? "—"} ms</p><p className="mt-2">Tools: {selected.toolsRequested?.join(", ") || "ninguna"}</p><p className="mt-2">Memorias: {selected.memoryUsage?.considered ?? 0} consideradas · {selected.memoryUsage?.selected ?? 0} seleccionadas · {selected.memoryUsage?.included ?? 0} incluidas</p><pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify({ entities: selected.resolvedEntities || [], calls: selected.toolsExecuted || [], evidence: selected.evidenceReferences || [], memory: selected.memoryUsage?.includedReferences || [], policy: selected.policyDecisions || [], error: selected.errorCode || null }, null, 2)}</pre></div>}
  </section>;
}
