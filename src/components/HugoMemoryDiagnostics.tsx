"use client";

import { useState } from "react";
import { listAgent007MemoryDiagnostics, listAgent007Traces, type HugoMemoryDiagnostic } from "@/services/agent007";

export default function HugoMemoryDiagnostics() {
  const [rows, setRows] = useState<HugoMemoryDiagnostic[]>([]);
  const [used, setUsed] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setMessage("");
    try {
      const [memory, traces] = await Promise.all([listAgent007MemoryDiagnostics(), listAgent007Traces({ limit: 50 })]);
      const count: Record<string, number> = {};
      for (const trace of traces.traces) for (const ref of trace.memoryUsage?.includedReferences || []) count[ref.id] = (count[ref.id] || 0) + 1;
      setRows(memory.memories); setUsed(count);
    } catch (error: any) { setMessage(error?.message || "No se pudo consultar la memoria."); }
    finally { setLoading(false); }
  }
  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
    <div className="flex items-center justify-between"><div><h2 className="font-semibold text-white">Memoria de Hugo</h2><p className="text-xs text-slate-500">Registros de Memory v2 y uso observado en las últimas 50 trazas.</p></div><button disabled={loading} onClick={() => void load()} className="rounded bg-violet-600 px-3 py-2 text-white">Consultar</button></div>
    {message && <p className="mt-2 text-rose-300">{message}</p>}
    {!!rows.length && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Tipo", "Fuente", "Entidad", "Verificación", "Confianza", "Creada", "Vigencia", "Estado", "Sustituida por", "Usos recientes"].map(x => <th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-slate-800"><td className="p-2">{row.kind}</td><td className="p-2">{row.sourceSystem} · {row.source}</td><td className="p-2">{row.entityReference?.displayReference || row.entityReference?.entityId || "raíz"}</td><td className="p-2">{row.lastVerifiedAt || "pendiente"}</td><td className="p-2">{row.confidence == null ? "—" : `${Math.round(row.confidence * 100)}%`}</td><td className="p-2">{row.createdAt}</td><td className="p-2">{row.validUntil || "sin vencimiento declarado"}</td><td className="p-2">{row.status}</td><td className="p-2">{row.supersededBy || "—"}</td><td className="p-2">{used[row.id] || 0}</td></tr>)}</tbody></table></div>}
  </section>;
}
