"use client";

import { useEffect, useState } from "react";
import { listHugoTeamTurns, sendHugoTeamTurn, type HugoTeamAgent, type HugoTeamTurn } from "@/services/hugoTeam";

const agents: Array<{ id: HugoTeamAgent; name: string; role: string }> = [
  { id: "hugo", name: "Hugo", role: "Coordinador" },
  { id: "maria", name: "María", role: "Operación" },
  { id: "sofia", name: "Sofía", role: "Documentos" },
  { id: "sentinel", name: "Sentinel", role: "Diagnóstico" },
];
const label = (id: HugoTeamAgent) => agents.find(agent => agent.id === id)?.name || id;

export default function HugoTeamPanel() {
  const [agent, setAgent] = useState<HugoTeamAgent>("hugo");
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<HugoTeamTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; setTurns([]); listHugoTeamTurns(agent).then(result => { if (active) setTurns(result.turns); }).catch(() => { if (active) setError("No se pudo cargar esta conversación."); }); return () => { active = false; }; }, [agent]);
  const send = async () => {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true); setError("");
    const selected = agent;
    try {
      const turn = await sendHugoTeamTurn({ agent: selected, channel: "TEXT", message: text, turnId: crypto.randomUUID() });
      setTurns(current => [...current, turn]);
      setMessage("");
      if (turn.agent !== selected) setAgent(turn.agent);
    } catch (cause: any) { setError(cause?.message || "No se pudo consultar PAY0."); }
    finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-violet-500/30 bg-slate-900/80 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-violet-300">Equipo de Hugo</p><h2 className="mt-1 text-xl font-semibold text-white">Consulta PAY0 con evidencia</h2><p className="mt-1 text-sm text-slate-400">Agente activo: {label(agent)}. Las acciones operativas requieren vista previa y autorización separada.</p></div><span className="rounded-full border border-amber-500/30 px-3 py-1 text-xs text-amber-200">Consultas y diagnósticos</span></div>
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Seleccionar agente">{agents.map(item => <button key={item.id} type="button" onClick={() => { setAgent(item.id); setError(""); }} className={`rounded-lg border px-3 py-2 text-left text-sm ${agent === item.id ? "border-violet-400 bg-violet-500/20 text-white" : "border-slate-700 text-slate-300"}`}><span className="block font-medium">{item.name}</span><span className="block text-xs opacity-70">{item.role}</span></button>)}</div>
    <div className="mt-4 max-h-80 space-y-3 overflow-auto rounded-xl bg-slate-950 p-4">{!turns.length && <p className="text-sm text-slate-500">Aún no hay turnos con {label(agent)}.</p>}{turns.map(turn => <div key={turn.turnId} className="rounded-lg border border-slate-800 p-3 text-sm"><p className="text-violet-200">Tú: {turn.message}</p><p className="mt-2 whitespace-pre-wrap text-slate-200">{label(turn.agent)}: {turn.reply}</p><p className="mt-2 text-xs text-slate-500">{turn.action === "READ" ? "Consulta completada" : "Pendiente de autorización"} · {turn.activity}</p>{turn.evidence.length > 0 && <details className="mt-2 text-xs text-slate-400"><summary className="cursor-pointer">Evidencia ({turn.evidence.length})</summary><ul className="mt-1 list-disc pl-5">{turn.evidence.map((item, index) => <li key={index}>{item.kind} · {item.folio}</li>)}</ul></details>}</div>)}</div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    <div className="mt-3 flex gap-2"><textarea value={message} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={`Pregunta a ${label(agent)}…`} className="min-h-12 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"/><button type="button" onClick={() => void send()} disabled={busy || !message.trim()} className="rounded-xl bg-violet-600 px-4 text-sm text-white disabled:opacity-40">{busy ? "Consultando…" : "Enviar"}</button></div>
  </section>;
}
