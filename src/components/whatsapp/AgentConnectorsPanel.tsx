"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCw, ShieldOff } from "lucide-react";
import {
  createWhatsAppAgentEnrollment,
  getWhatsAppAgentActivity,
  getWhatsAppAgentObservers,
  getWhatsAppAgentReplyConfig,
  setWhatsAppAgentReplyConfig,
  saveWhatsAppAgentObservers,
  listWhatsAppAgentChats,
  listWhatsAppAgentConnectors,
  requestWhatsAppConnectorRestart,
  revokeWhatsAppAgentConnector,
  type WhatsAppAgentActivityRow,
  type WhatsAppAgentChats,
  type WhatsAppAgentConnector,
  type WhatsAppAgentMode,
  type WhatsAppAgentObserversConfig,
  type WhatsAppReplyMetricsBucket,
  type WhatsAppObservationSummary,
  type WhatsAppAgentObserversState,
  type WhatsAppReplyMode,
  decideWhatsAppPlaybookEntry,
  getWhatsAppAgentPlaybook,
  getWhatsAppSimulatedReplies,
  setWhatsAppReplySimulation,
  type WhatsAppSimulatedReply,
  listWhatsAppAgentReplies,
  markWhatsAppReplyCorrection,
  type WhatsAppAgentReply,
  type WhatsAppCorrectionCategory,
  getWhatsAppAgentReplyMetrics,
  type WhatsAppPlaybookEntry,
  setWhatsAppGroupAgentMode,
} from "@/services/whatsappQr";

const formatMinutes = (ms: number | null) => (ms === null ? "—" : `${(ms / 60000).toFixed(1)} min`);

// Grupos que ve el conector de un agente: aquí se elige cuáles observa y a qué usuario de PAY0 pertenece cada uno.
// De los chats privados solo se cuenta cuántos hay.
const norm = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
type Note = { ok: boolean; text: string };

function Switch({ on, busy, label, onClick }: { on: boolean; busy: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-emerald-500" : "bg-slate-600"}`}
    >
      <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-6" : "left-1"}`} />
    </button>
  );
}

// Interruptor de las respuestas del agente en los grupos. Apagado por defecto; el servidor aplica además
// los 3 días de aprendizaje, el horario y la espera a que conteste una persona del equipo.
function ReplySwitchBlock({ agentName }: { agentName: string }) {
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<WhatsAppReplyMode>("GREETINGS_ONLY");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    getWhatsAppAgentReplyConfig()
      .then(result => { if (alive) { setEnabled(result.enabled); setMode(result.mode); } })
      .catch((e: any) => { if (alive) setNote({ ok: false, text: `No se pudo cargar: ${e?.message || e}` }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function save(nextEnabled: boolean, nextMode: WhatsAppReplyMode) {
    setSaving(true);
    setNote(null);
    try {
      const result = await setWhatsAppAgentReplyConfig({ enabled: nextEnabled, mode: nextMode });
      setEnabled(result.enabled);
      setMode(result.mode);
      setNote({ ok: true, text: result.enabled ? "Modo Actuando: las respuestas están encendidas." : "Modo Observador: las respuestas están apagadas." });
    } catch (e: any) {
      setNote({ ok: false, text: `No se pudo guardar: ${e?.message || e}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-100">Respuestas de {agentName} en los grupos</h4>
          <p className="mt-0.5 text-xs text-slate-400">
            {loading ? "Cargando..." : enabled ? `Actuando: ${mode === "STANDARD" ? "saludos y \"permítanos validarlo\"" : "solo saludos"}.` : `Observador: ${agentName} solo observa y no contesta nada.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={mode}
            disabled={loading || saving}
            aria-label="Qué contesta"
            onChange={e => { const next = e.target.value as WhatsAppReplyMode; setMode(next); if (enabled) void save(true, next); }}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
          >
            <option value="GREETINGS_ONLY">Solo saludos</option>
            <option value="STANDARD">Saludos y validación</option>
          </select>
          <Switch on={enabled} busy={loading || saving} label={enabled ? "Apagar las respuestas" : "Encender las respuestas"} onClick={() => void save(!enabled, mode)} />
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Solo contesta en grupos con usuario y en horario de trabajo. Los saludos, desde el primer día y enseguida; lo demás, después de 3 días observando el grupo y si nadie del equipo contestó en 3 minutos.
      </p>
      {note && <p className={`mt-1 text-xs ${note.ok ? "text-emerald-300" : "text-rose-300"}`}>{note.text}</p>}
    </div>
  );
}

const KIND_LABELS: Record<string, string> = { GREETING: "Saludos", PROCESSING: "En proceso", VALIDATING: "Validando", REQUEST_DATA: "Pidió datos" };
const monthOptions = () => Array.from({ length: 3 }, (_, index) => {
  const date = new Date(); date.setMonth(date.getMonth() - index, 1);
  return date.toISOString().slice(0, 7);
});

// Monthly measurement per agent and per group: is each agent worth keeping?
function ReplyMetricsBlock({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [month, setMonth] = useState(monthOptions()[0]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [buckets, setBuckets] = useState<WhatsAppReplyMetricsBucket[] | null>(null);
  const [observation, setObservation] = useState<WhatsAppObservationSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true); setError("");
    getWhatsAppAgentReplyMetrics(month)
      .then(result => { if (alive) { setBuckets(result.buckets.filter(row => row.agentId === agentId)); setObservation(result.observation ?? null); } })
      .catch((e: any) => { if (alive) setError(`No se pudo cargar: ${e?.message || e}`); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, month, agentId]);

  const total = buckets?.find(row => row.chatId === null);
  const groups = (buckets || []).filter(row => row.chatId !== null);
  return (
    <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3" onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Medición del mes de {agentName}</summary>
      <div className="mt-2 flex items-center gap-2">
        <select value={month} onChange={e => setMonth(e.target.value)} aria-label="Mes" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100">
          {monthOptions().map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
      </div>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {observation && (
        <p className="mt-2 text-xs text-slate-300">
          Observando {observation.observedGroups} grupos: {observation.groupsWithConversation} con conversación ({observation.conversationMessages} mensajes), {observation.humanAnswers} respuestas de una persona donde Hugo calló
          (en {observation.humanAnswerGroups} grupos). Envíos de documentos, aparte: {observation.documentMessages} en {observation.groupsWithDocuments} grupos.
          {observation.truncated ? " Conteo parcial." : ""}
        </p>
      )}
      {buckets && !total && <p className="mt-2 text-xs text-slate-500">Sin respuestas ni cambios de modo en este mes.</p>}
      {total && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="text-slate-500"><tr>
              <th className="py-1 pr-3 font-medium">Grupo</th><th className="pr-3 font-medium">Respuestas</th><th className="pr-3 font-medium">Correcciones</th>
              <th className="pr-3 font-medium">Escalaciones</th><th className="pr-3 font-medium">Tiempo medio</th><th className="pr-3 font-medium">Regresos a Observador</th>
            </tr></thead>
            <tbody>
              {[total, ...groups].map(row => (
                <tr key={row.chatId || "total"} className={row.chatId === null ? "border-t border-slate-700 font-semibold text-slate-100" : "border-t border-slate-800"}>
                  <td className="py-1 pr-3">{row.chatId === null ? "Total" : row.groupName || "Grupo"}</td>
                  <td className="pr-3" title={Object.entries(row.byKind).map(([kind, count]) => `${KIND_LABELS[kind] || kind}: ${count}`).join(" · ")}>{row.replies}</td>
                  <td className="pr-3">{row.humanCorrections}</td><td className="pr-3">{row.escalations}</td><td className="pr-3">{formatMinutes(row.avgResponseMs)}</td>
                  <td className="pr-3" title={row.returnReasons.join(" · ")}>{row.returnsToObserver}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-500">Las correcciones son las respuestas que una persona marcó como mal dadas. Consumo de IA: {total.aiTokens} tokens (las respuestas actuales son texto fijo).</p>
        </div>
      )}
    </details>
  );
}

const PLAYBOOK_TITLES: Record<string, string> = {
  "MISSED_QUESTION|STATUS_INQUIRY": "Preguntas de estatus sin respuesta",
  "MISSED_QUESTION|QUESTION": "Preguntas sin respuesta",
  "HUMAN_ANSWERED|GREETING": "Saludos que contestó una persona",
  "HUMAN_ANSWERED|STATUS_INQUIRY": "Preguntas de estatus que contestó una persona",
  "HUMAN_ANSWERED|QUESTION": "Consultas que contestó una persona",
  "CORRECTION|WRONG_FACT": "Respuestas con datos incorrectos",
  "CORRECTION|TONE": "Respuestas con tono que no gustó",
  "CORRECTION|NOT_NEEDED": "Respuestas que no hacían falta",
  "CORRECTION|TOO_LATE": "Respuestas tardías",
  "CORRECTION|OTHER": "Respuestas corregidas por una persona",
};
const playbookTitle = (entry: WhatsAppPlaybookEntry) => PLAYBOOK_TITLES[`${entry.type}|${entry.type === "CORRECTION" ? entry.category : entry.kind}`] || "Aprendizaje del grupo";

// What Hugo learned per group. Three cases of the same kind propose a rule; only the owner approves, and an approved one runs 3 days in simulation.
function PlaybookEntryRow({ entry, onDecided }: { entry: WhatsAppPlaybookEntry; onDecided: () => Promise<void> }) {
  const [guidance, setGuidance] = useState(entry.suggestedGuidance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(decision: "APPROVE" | "REJECT") {
    setBusy(true); setError("");
    try { await decideWhatsAppPlaybookEntry({ id: entry.id, decision, guidance }); await onDecided(); }
    catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  return (
    <li className="rounded-lg border border-slate-800 p-2 text-xs text-slate-300">
      <p className="font-semibold text-slate-100">{entry.groupName || "Grupo"} · {playbookTitle(entry)} <span className="font-normal text-slate-500">({entry.evidenceCount} casos)</span></p>
      {entry.examples.length > 0 && <ul className="mt-1 list-disc pl-4 text-slate-400">{entry.examples.map(text => <li key={text}>{text}</li>)}</ul>}
      {entry.status === "PROPOSED" ? (
        <div className="mt-2 space-y-1">
          <textarea value={guidance} onChange={e => setGuidance(e.target.value)} maxLength={400} rows={3} aria-label="Indicación para Hugo en este grupo" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100" />
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void decide("APPROVE")} className="rounded-lg bg-emerald-600 px-2 py-1 text-white disabled:opacity-50">Aprobar (3 días en simulación)</button>
            <button type="button" disabled={busy} onClick={() => void decide("REJECT")} className="rounded-lg bg-slate-700 px-2 py-1 text-white disabled:opacity-50">Rechazar</button>
            {busy && <Loader2 size={14} className="animate-spin text-slate-400" />}
          </div>
          {error && <p className="text-rose-300">{error}</p>}
        </div>
      ) : (
        <p className="mt-1 text-slate-400">{entry.status === "APPROVED" ? `Aprobado: ${entry.guidance}${entry.simulationEndsAtMs ? ` · simulación hasta ${new Date(entry.simulationEndsAtMs).toLocaleDateString("es-MX")}` : ""}` : "Rechazado"}</p>
      )}
    </li>
  );
}

const CORRECTION_LABELS: Record<WhatsAppCorrectionCategory, string> = { WRONG_FACT: "Dato incorrecto", TONE: "Tono", NOT_NEEDED: "No hacía falta", TOO_LATE: "Llegó tarde", OTHER: "Otro" };

// What Hugo sent in groups this month. The owner marks one as corrected (and why) or unmarks it; corrections feed the monthly measurement and the per-group learning.
function ReplyRow({ reply, onChanged }: { reply: WhatsAppAgentReply; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<WhatsAppCorrectionCategory>("WRONG_FACT");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(corrected: boolean) {
    setBusy(true); setError("");
    try { await markWhatsAppReplyCorrection({ jobId: reply.id, corrected, ...(corrected ? { category, reason: reason.trim() } : {}) }); setEditing(false); setReason(""); await onChanged(); }
    catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  return (
    <li className="rounded-lg border border-slate-800 p-2 text-xs text-slate-300">
      <p className="font-semibold text-slate-100">{reply.groupName || "Grupo"} <span className="font-normal text-slate-500">· {KIND_LABELS[reply.kind] || reply.kind} · {new Date(reply.atMs).toLocaleString("es-MX")}</span></p>
      <p className="mt-1 text-slate-400">{reply.text || "(texto no disponible)"}</p>
      {reply.humanCorrection ? (
        <p className="mt-1 flex items-center gap-2 text-amber-300">Marcada como corregida <button type="button" disabled={busy} onClick={() => void save(false)} className="rounded bg-slate-700 px-2 py-0.5 text-white disabled:opacity-50">Quitar marca</button></p>
      ) : editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <select value={category} onChange={e => setCategory(e.target.value as WhatsAppCorrectionCategory)} aria-label="Tipo de corrección" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100">
            {(Object.keys(CORRECTION_LABELS) as WhatsAppCorrectionCategory[]).map(key => <option key={key} value={key}>{CORRECTION_LABELS[key]}</option>)}
          </select>
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="Qué estuvo mal" aria-label="Motivo de la corrección" className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100" />
          <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void save(true)} className="rounded-lg bg-amber-600 px-2 py-1 text-white disabled:opacity-50">Guardar</button>
          <button type="button" disabled={busy} onClick={() => setEditing(false)} className="px-1 text-slate-400">Cancelar</button>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="mt-1 rounded bg-slate-700 px-2 py-0.5 text-white">Marcar como corregida</button>
      )}
      {error && <p className="mt-1 text-rose-300">{error}</p>}
    </li>
  );
}

function RepliesBlock() {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<WhatsAppAgentReply[] | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    try { setReplies((await listWhatsAppAgentReplies()).replies); setError(""); }
    catch (e: any) { setError(`No se pudo cargar: ${e?.message || e}`); }
  };
  useEffect(() => { if (open) void load(); }, [open]);
  return (
    <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3" onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Respuestas de Hugo</summary>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {replies && replies.length === 0 && <p className="mt-2 text-xs text-slate-500">Hugo todavía no ha respondido en grupos este mes.</p>}
      {replies && replies.length > 0 && <ul className="mt-2 space-y-2">{replies.map(reply => <ReplyRow key={`${reply.id}:${reply.humanCorrection}`} reply={reply} onChanged={load} />)}</ul>}
    </details>
  );
}

const SIMULATION_STATUS: Record<string, string> = { SIMULATED: "Borrador válido", REJECTED_BY_GUARD: "Bloqueado por los frenos", MODEL_UNAVAILABLE: "El modelo no respondió" };

// Simulation of free-text replies: switch (off by default) and the drafts to review. Nothing here is ever sent to a client.
function SimulationBlock() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [replies, setReplies] = useState<WhatsAppSimulatedReply[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    try { const result = await getWhatsAppSimulatedReplies(); setEnabled(result.enabled); setReplies(result.replies); setError(""); }
    catch (e: any) { setError(`No se pudo cargar: ${e?.message || e}`); }
  };
  useEffect(() => { if (open) void load(); }, [open]);
  async function toggle() {
    if (enabled === null) return;
    setBusy(true); setError("");
    try { await setWhatsAppReplySimulation(!enabled); await load(); }
    catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  return (
    <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3" onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Simulación de respuestas de texto libre</summary>
      <p className="mt-2 text-xs text-slate-400">Hugo redacta borradores solo en los grupos con un aprendizaje aprobado, durante sus 3 días de simulación. Los borradores no se envían a ningún cliente: son para que usted los revise.</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={busy || enabled === null} aria-pressed={enabled === true} onClick={() => void toggle()}
          className={`rounded-full px-3 py-1 text-xs text-white disabled:opacity-50 ${enabled ? "bg-emerald-600" : "bg-slate-600"}`}>{enabled === null ? "Cargando…" : enabled ? "Simulación encendida" : "Simulación apagada"}</button>
        {busy && <Loader2 size={14} className="animate-spin text-slate-400" />}
      </div>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {replies && replies.length === 0 && <p className="mt-2 text-xs text-slate-500">Todavía no hay borradores.</p>}
      {replies && replies.length > 0 && (
        <ul className="mt-2 space-y-2">
          {replies.slice(0, 50).map(reply => (
            <li key={reply.id} className="rounded-lg border border-slate-800 p-2 text-xs text-slate-300">
              <p className="font-semibold text-slate-100">{reply.groupName || "Grupo"} <span className="font-normal text-slate-500">· {SIMULATION_STATUS[reply.status] || reply.status}{reply.createdAtMs ? ` · ${new Date(reply.createdAtMs).toLocaleString("es-MX")}` : ""}</span></p>
              {reply.clientPhrase && <p className="text-slate-400">El cliente preguntó: {reply.clientPhrase}</p>}
              {reply.usable && reply.draft ? <p className="mt-1 text-emerald-200">Hugo diría: {reply.draft}</p> : reply.guardReasons.length > 0 && <p className="mt-1 text-amber-300">{reply.guardReasons.join(" · ")}</p>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function PlaybookBlock() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<WhatsAppPlaybookEntry[] | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    try { setEntries((await getWhatsAppAgentPlaybook()).entries); setError(""); }
    catch (e: any) { setError(`No se pudo cargar: ${e?.message || e}`); }
  };
  useEffect(() => { if (open) void load(); }, [open]);
  const pending = entries?.filter(entry => entry.status === "PROPOSED").length ?? 0;
  return (
    <details className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3" onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Lo que Hugo aprende por grupo{pending > 0 ? ` (${pending} por revisar)` : ""}</summary>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {entries && entries.length === 0 && <p className="mt-2 text-xs text-slate-500">Todavía no hay propuestas: se crean cuando un grupo acumula 3 casos del mismo tipo.</p>}
      {entries && entries.length > 0 && <ul className="mt-2 space-y-2">{entries.map(entry => <PlaybookEntryRow key={`${entry.id}:${entry.status}`} entry={entry} onDecided={load} />)}</ul>}
    </details>
  );
}

// Observador / Actuando for one agent in one group. Going back to Observador asks for the reason.
function GroupModeControl({ agentId, agentName, config, onChanged }: { agentId: string; agentName: string; config: WhatsAppAgentObserversConfig; onChanged: () => Promise<void> }) {
  const acting = config.agentModes?.[agentId] === "ACTING";
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function change(mode: WhatsAppAgentMode, why?: string) {
    setBusy(true); setNote(null);
    try {
      await setWhatsAppGroupAgentMode({ groupChatId: config.groupChatId, agentId, mode, reason: why });
      await onChanged();
      setReasonOpen(false); setReason("");
      setNote({ ok: true, text: mode === "ACTING" ? `${agentName} está actuando en este grupo.` : `${agentName} volvió a Observador.` });
    } catch (e: any) {
      setNote({ ok: false, text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  const base = "px-2.5 py-0.5 text-xs transition-colors disabled:opacity-50";
  return (
    <div className="flex flex-col items-end gap-1">
      <div role="group" aria-label={`Modo de ${agentName} en ${config.groupName}`} className="inline-flex overflow-hidden rounded-full border border-slate-600">
        <button type="button" disabled={busy || !acting && !reasonOpen} aria-pressed={!acting} onClick={() => { if (acting) setReasonOpen(true); }} className={`${base} ${!acting ? "bg-slate-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}>Observador</button>
        <button type="button" disabled={busy || !config.ownerUserUid} aria-pressed={acting} onClick={() => { if (!acting) void change("ACTING"); }} title={config.ownerUserUid ? undefined : "Asigna un usuario al grupo primero"} className={`${base} ${acting ? "bg-emerald-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}>Actuando</button>
      </div>
      {reasonOpen && (
        <div className="flex items-center gap-1">
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo" aria-label="Motivo para volver a Observador" maxLength={300} className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100" />
          <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void change("OBSERVER", reason.trim())} className="rounded-lg bg-slate-700 px-2 py-1 text-xs text-white disabled:opacity-50">Confirmar</button>
          <button type="button" disabled={busy} onClick={() => { setReasonOpen(false); setReason(""); }} className="px-1 text-xs text-slate-400">Cancelar</button>
        </div>
      )}
      {note && <p className={`text-[11px] ${note.ok ? "text-emerald-300" : "text-rose-300"}`}>{note.text}</p>}
    </div>
  );
}

function AgentGroupsBlock({ bindingId, agentId, agentName, meta, onChanged }: { bindingId: string; agentId: string; agentName: string; meta: WhatsAppAgentObserversState; onChanged: () => Promise<void> }) {
  const [chats, setChats] = useState<WhatsAppAgentChats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState("");
  const [draftOwner, setDraftOwner] = useState("");
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [othersOpen, setOthersOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    listWhatsAppAgentChats(bindingId)
      .then(result => { if (alive) setChats(result); })
      .catch((e: any) => { if (alive) setError(`No se pudieron cargar los grupos: ${e?.message || e}`); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [bindingId]);

  const configFor = (chatId: string) => meta.configs.find(row => row.groupChatId === chatId);
  const isObserved = (chatId: string) => { const config = configFor(chatId); return !!config && config.active && config.observers.some(o => o.agentId === agentId); };
  const userName = (uid: string) => meta.users.find(user => user.uid === uid)?.name || "Sin usuario";

  // Un toque guarda: este agente se agrega o se quita de los observadores del grupo sin tocar a los demás.
  async function apply(chatId: string, observe: boolean, owner: string, done: string) {
    const config = configFor(chatId);
    const others = (config?.observers || []).filter(o => o.agentId !== agentId);
    const mine = config?.observers.find(o => o.agentId === agentId);
    const observers = observe ? [...others, { agentId, phone: mine?.phone || "" }] : others;
    setSaving(chatId);
    setNotes(current => ({ ...current, [chatId]: { ok: true, text: "Guardando..." } }));
    try {
      await saveWhatsAppAgentObservers({ groupChatId: chatId, active: observers.length > 0, ownerUserUid: owner, observers });
      await onChanged();
      setAdding("");
      setEditing("");
      setNotes(current => ({ ...current, [chatId]: { ok: true, text: done } }));
    } catch (e: any) {
      setNotes(current => ({ ...current, [chatId]: { ok: false, text: `No se pudo guardar: ${e?.message || e}` } }));
    } finally {
      setSaving("");
    }
  }

  const groups = chats?.groups || [];
  const query = norm(search.trim());
  const visible = groups.filter(group => !query || norm(group.name || "").includes(query));
  const observing = visible.filter(group => isObserved(group.chatId));
  const others = visible.filter(group => !isObserved(group.chatId));
  const observedTotal = groups.filter(group => isObserved(group.chatId)).length;
  const othersAreOpen = othersOpen ?? observedTotal === 0;

  const note = (chatId: string) => notes[chatId] && <p className={`mt-1 text-xs ${notes[chatId].ok ? "text-emerald-300" : "text-rose-300"}`}>{notes[chatId].text}</p>;

  return (
    <section id={`grupos-${agentId}`} className="mt-4 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-white">Grupos que observa {agentName}</h3>
        {chats && <span className="text-sm text-slate-300">Observando {observedTotal} de {groups.length} grupos</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">Cada grupo observado debe tener su usuario: el agente solo usa información de ese usuario.</p>
      {agentId === "hugo" && <ReplySwitchBlock agentName={agentName} />}
      <ReplyMetricsBlock agentId={agentId} agentName={agentName} />
      {agentId === "hugo" && <RepliesBlock />}
      {agentId === "hugo" && <PlaybookBlock />}
      {agentId === "hugo" && <SimulationBlock />}
      {loading && <div className="mt-3 flex items-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> Cargando grupos...</div>}
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}

      {chats && (
        <div className="mt-3 space-y-4">
          {groups.length > 6 && (
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar grupo" aria-label="Buscar grupo" className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
          )}
          {groups.length === 0 && <p className="text-sm text-slate-500">Todavía no hay grupos sincronizados.</p>}

          {groups.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Observando ({observing.length})</h4>
              {observing.length === 0 && <p className="mt-2 text-sm text-slate-500">{query ? "Ningún grupo observado coincide con la búsqueda." : "Todavía no observa ningún grupo."}</p>}
              <ul className="mt-2 divide-y divide-slate-800 rounded-lg border border-slate-800">
                {observing.map(group => {
                  const config = configFor(group.chatId);
                  const busy = saving === group.chatId;
                  return (
                    <li key={group.chatId} className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">{group.name || "Grupo sin nombre"}</span>
                        {editing === group.chatId ? (
                          <select
                            autoFocus
                            value={config?.ownerUserUid || ""}
                            disabled={busy}
                            aria-label={`Usuario del grupo ${group.name}`}
                            onChange={e => { if (e.target.value) void apply(group.chatId, true, e.target.value, "Usuario actualizado."); }}
                            onBlur={() => setEditing("")}
                            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                          >
                            <option value="">Elige usuario</option>
                            {meta.users.map(user => <option key={user.uid} value={user.uid}>{user.name}</option>)}
                          </select>
                        ) : (
                          <button type="button" disabled={busy} onClick={() => setEditing(group.chatId)} title="Cambiar usuario" className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-0.5 text-xs text-sky-200 hover:bg-sky-500/20 disabled:opacity-50">
                            {userName(config?.ownerUserUid || "")}
                          </button>
                        )}
                        {config && <GroupModeControl agentId={agentId} agentName={agentName} config={config} onChanged={onChanged} />}
                        <Switch on busy={busy} label={`Dejar de observar ${group.name}`} onClick={() => void apply(group.chatId, false, config?.ownerUserUid || "", "Ya no se observa este grupo.")} />
                      </div>
                      {note(group.chatId)}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {groups.length > 0 && (
            <details open={othersAreOpen} onToggle={e => setOthersOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-400">Otros grupos ({others.length})</summary>
              {others.length === 0 && <p className="mt-2 text-sm text-slate-500">{query ? "Ningún otro grupo coincide con la búsqueda." : "No hay más grupos."}</p>}
              <ul className="mt-2 divide-y divide-slate-800 rounded-lg border border-slate-800">
                {others.map(group => {
                  const busy = saving === group.chatId;
                  const open = adding === group.chatId;
                  return (
                    <li key={group.chatId} className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{group.name || "Grupo sin nombre"}{group.archived ? " (archivado)" : ""}</span>
                        <span className="text-xs text-slate-500">No observado</span>
                        {!open && (
                          <button type="button" onClick={() => { setAdding(group.chatId); setDraftOwner(configFor(group.chatId)?.ownerUserUid || ""); }} className="rounded-lg border border-emerald-500/40 px-3 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/10">
                            + Observar
                          </button>
                        )}
                      </div>
                      {open && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select value={draftOwner} disabled={busy} onChange={e => setDraftOwner(e.target.value)} aria-label={`Usuario del grupo ${group.name}`} className="min-w-[12rem] rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100">
                            <option value="">Usuario al que pertenece</option>
                            {meta.users.map(user => <option key={user.uid} value={user.uid}>{user.name}</option>)}
                          </select>
                          <button type="button" disabled={busy || !draftOwner} onClick={() => void apply(group.chatId, true, draftOwner, "Listo: el agente observa este grupo.")} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                            {busy && <Loader2 size={13} className="animate-spin" />} Confirmar
                          </button>
                          <button type="button" disabled={busy} onClick={() => setAdding("")} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300">Cancelar</button>
                        </div>
                      )}
                      {note(group.chatId)}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          <p className="text-xs text-slate-500">
            Chats privados: {chats.privateChats}. No se muestran ni sus nombres ni sus números.
            {chats.truncated ? " La lista está incompleta." : ""}
          </p>
        </div>
      )}
    </section>
  );
}

export function AgentConnectorsPanel() {
  const [connectors, setConnectors] = useState<WhatsAppAgentConnector[]>([]);
  const [meta, setMeta] = useState<WhatsAppAgentObserversState | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [transfers, setTransfers] = useState<Record<string, string>>({});
  const [connecting, setConnecting] = useState("");
  const [activity, setActivity] = useState<WhatsAppAgentActivityRow[] | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [list, state] = await Promise.all([listWhatsAppAgentConnectors(), getWhatsAppAgentObservers()]);
      setConnectors(list.connectors);
      setMeta(state);
    } catch (e: any) {
      setMessage(`No se pudo cargar: ${e?.message || e}`);
    }
  }

  useEffect(() => { void load(); }, []);

  // WhatsApp rotates its QR every ~20 seconds: while one is waiting to be scanned, keep the page in step with the connector.
  const qrPending = connectors.some(c => c.state === "ACTIVE" && c.agentId !== "pay0" && c.status === "QR_REQUIRED");
  useEffect(() => {
    if (!qrPending) return;
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => clearInterval(timer);
  }, [qrPending]);

  async function enroll(agentId: string) {
    setBusy(agentId);
    setMessage("");
    try {
      const result = await createWhatsAppAgentEnrollment(agentId, keys[agentId] || "");
      setTransfers({ ...transfers, [agentId]: JSON.stringify({ protocol: "pay0-wa-enrollment-transfer-v1", enrollment: result.enrollment }) });
      setMessage("Enrolamiento creado. Es válido 10 minutos: pégalo en el conector local del agente.");
      await load();
    } catch (e: any) {
      setMessage(`No se pudo crear el enrolamiento: ${e?.message || e}`);
    } finally {
      setBusy("");
    }
  }

  async function revoke(bindingId: string) {
    setBusy(bindingId);
    try { await revokeWhatsAppAgentConnector(bindingId); await load(); }
    catch (e: any) { setMessage(`No se pudo revocar: ${e?.message || e}`); }
    finally { setBusy(""); }
  }

  async function restart(agentId: string, agentLabel: string, bindingId: string) {
    if (!window.confirm(`¿Reiniciar el conector de ${agentLabel}? Se desconecta unos segundos y vuelve solo; la sesión de WhatsApp se conserva.`)) return;
    setBusy(`restart-${bindingId}`);
    setMessage("");
    try { setMessage((await requestWhatsAppConnectorRestart(agentId)).message); await load(); }
    catch (e: any) { setMessage(`No se pudo solicitar el reinicio: ${e?.message || e}`); }
    finally { setBusy(""); }
  }

  async function loadActivity() {
    setBusy("activity");
    try { setActivity((await getWhatsAppAgentActivity(7)).rows); }
    catch (e: any) { setMessage(`No se pudo cargar la actividad: ${e?.message || e}`); }
    finally { setBusy(""); }
  }

  const agentName = (id: string) => meta?.agents.find(a => a.id === id)?.name || id;
  const groupName = (id: string) => meta?.groups.find(g => g.chatId === id)?.name || id;
  const observedCount = (agentId: string) => meta?.configs.filter(c => c.active && c.observers.some(o => o.agentId === agentId)).length ?? 0;
  const activeByAgent = new Map(connectors.filter(c => c.state === "ACTIVE" && c.agentId !== "pay0").map(c => [c.agentId, c]));
  const connectedAgents = (meta?.agents || []).filter(agent => activeByAgent.has(agent.id));
  const disconnectedAgents = (meta?.agents || []).filter(agent => !activeByAgent.has(agent.id));

  return (
    <details open className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <summary className="cursor-pointer text-lg font-semibold text-white">Conexión de WhatsApp por agente</summary>
      <p className="mt-2 max-w-3xl text-sm text-slate-400">
        Solo se leen los grupos que actives aquí, cada uno con su usuario; los mensajes se borran a los 30 días.
      </p>

      {!meta ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> Cargando...</div>
      ) : (
        <>
          {connectedAgents.length > 0 && (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {connectedAgents.map(agent => {
                const connector = activeByAgent.get(agent.id)!;
                return (
                  <div key={agent.id} className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-medium text-white">{agent.name}</h3>
                      <span className="text-xs text-slate-400">{connector.status || "Sin señal"}</span>
                    </div>
                    {connector.qrDataUrl && <img src={connector.qrDataUrl} alt={`QR de ${agent.name}`} className="mt-2 h-40 w-40 rounded bg-white p-1" />}
                    {connector.status === "QR_REQUIRED" && <p className="mt-1 text-xs text-amber-300">Escanee el QR desde WhatsApp &gt; Dispositivos vinculados. Se actualiza solo cada pocos segundos; si no conecta, escanee el más reciente.</p>}
                    {connector.error && <p className="mt-1 text-xs text-rose-300">{connector.error}</p>}
                    <p className="mt-1 text-xs text-slate-500">{connector.lastSeenAtMs ? `Última señal: ${new Date(connector.lastSeenAtMs).toLocaleString("es-MX")}` : "Sin señal todavía"}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <button type="button" onClick={() => void load()} className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-200">Actualizar</button>
                      <p className="text-xs text-slate-300">
                        Observando {observedCount(agent.id)} {observedCount(agent.id) === 1 ? "grupo" : "grupos"}
                        {" · "}
                        <button type="button" onClick={() => document.getElementById(`grupos-${agent.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })} className="text-sky-300 underline-offset-2 hover:underline">ver</button>
                      </p>
                      <button type="button" disabled={busy === `restart-${connector.bindingId}`} onClick={() => void restart(agent.id, agent.name, connector.bindingId)} className="inline-flex items-center gap-2 rounded-lg border border-sky-500/40 px-2.5 py-1 text-xs text-sky-200 disabled:opacity-40">
                        <RotateCw size={13} /> Reiniciar {agent.name}
                      </button>
                      <button type="button" disabled={busy === connector.bindingId} onClick={() => void revoke(connector.bindingId)} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs text-rose-200 disabled:opacity-40">
                        <ShieldOff size={13} /> Revocar conexión
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {connectedAgents.map(agent => (
            <AgentGroupsBlock key={agent.id} bindingId={activeByAgent.get(agent.id)!.bindingId} agentId={agent.id} agentName={agent.name} meta={meta} onChanged={load} />
          ))}

          {disconnectedAgents.length > 0 && (
            <details className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-300">Agentes sin conexión ({disconnectedAgents.length})</summary>
              <ul className="divide-y divide-slate-800 border-t border-slate-800">
                {disconnectedAgents.map(agent => (
                  <li key={agent.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{agent.name}</span>
                      <span className="text-xs text-slate-500">Sin conexión</span>
                      <button type="button" onClick={() => setConnecting(connecting === agent.id ? "" : agent.id)} className="rounded-lg border border-emerald-500/40 px-3 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/10">
                        {connecting === agent.id ? "Cerrar" : "Conectar"}
                      </button>
                    </div>
                    {(connecting === agent.id || transfers[agent.id]) && (
                      <div className="mt-2 space-y-2">
                        <textarea value={keys[agent.id] || ""} onChange={e => setKeys({ ...keys, [agent.id]: e.target.value })} rows={3} placeholder="Llave pública del conector local de este agente" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100" />
                        <button type="button" disabled={busy === agent.id || !(keys[agent.id] || "").trim()} onClick={() => void enroll(agent.id)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">
                          {busy === agent.id ? "Creando..." : "Crear enrolamiento"}
                        </button>
                        {transfers[agent.id] && <textarea readOnly value={transfers[agent.id]} rows={4} className="w-full rounded-lg border border-emerald-500/30 bg-slate-950 px-3 py-2 text-xs text-emerald-100" />}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <div className="mt-5">
        <button type="button" disabled={busy === "activity"} onClick={() => void loadActivity()} className="rounded-lg border border-emerald-500/40 px-3 py-2 text-xs font-medium text-emerald-200 disabled:opacity-40">
          {busy === "activity" ? "Cargando..." : "Ver actividad de los últimos 7 días"}
        </button>
        {activity && (activity.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">Todavía no hay mensajes capturados.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[640px] w-full text-left text-sm">
              <thead className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-400">
                <tr><th className="p-2">Agente</th><th className="p-2">Grupo</th><th className="p-2 text-right">Enviados</th><th className="p-2 text-right">Recibidos</th><th className="p-2 text-right">Respondidos</th><th className="p-2 text-right">Sin responder</th><th className="p-2 text-right">Respuesta media</th></tr>
              </thead>
              <tbody>
                {activity.map(row => (
                  <tr key={row.agentId + row.chatId} className="border-b border-slate-800/80">
                    <td className="p-2 text-slate-100">{agentName(row.agentId)}</td>
                    <td className="p-2 text-slate-300">{groupName(row.chatId)}</td>
                    <td className="p-2 text-right text-slate-100">{row.sent}</td>
                    <td className="p-2 text-right text-slate-100">{row.received}</td>
                    <td className="p-2 text-right text-slate-100">{row.answered}</td>
                    <td className="p-2 text-right text-slate-100">{row.unanswered}</td>
                    <td className="p-2 text-right text-slate-100">{formatMinutes(row.avgResponseMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {message && <p className="mt-3 text-sm text-slate-300">{message}</p>}
    </details>
  );
}
