"use client";
import { useEffect, useRef, useState } from "react";
import { useUserProfile } from "@/lib/useUserProfile";
import { correctAgent007Response, reviewAgent007MemoryCandidate, type Agent007Message, type Agent007ResponseCorrection, type HugoScope } from "@/services/agent007";

const validCorrection = (value: unknown): value is Agent007ResponseCorrection => {
  const row = value as Agent007ResponseCorrection | undefined;
  return !!row && ["CONFIRMED", "REJECTED"].includes(row.status) && ["CONVERSATION_ONLY", "USER_TOPIC"].includes(row.scope) && typeof row.memoryId === "string" && row.memoryId.length <= 160 &&
    Number.isInteger(row.version) && row.version > 0 && typeof row.content === "string" && !!row.content.trim() && row.content.length <= 1000 &&
    (row.scope === "USER_TOPIC" ? row.expiresAt === null && !!row.topic && ["CLIENT", "TOPIC"].includes(row.topic.kind) && typeof row.topic.id === "string" && typeof row.topic.label === "string" : typeof row.expiresAt === "string" && Number.isFinite(Date.parse(row.expiresAt)));
};

export default function HugoResponseCorrection({ message, scope, onSaved, onTopicSelected }: { message: Agent007Message; scope: HugoScope; onSaved: (correction: Agent007ResponseCorrection) => void; onTopicSelected?: (topic: string) => void }) {
  const { profile, profileUid, loading } = useUserProfile();
  const key = JSON.stringify([profileUid, profile?.rootId, profile?.role, profile?.active, profile?.disabled, loading, message.id, message.text, scope]);
  return <CorrectionContent key={key} message={message} scope={scope} onSaved={onSaved} onTopicSelected={onTopicSelected} allowed={!loading && !!profileUid && profile?.role === "superadmin" && profile?.active !== false && profile?.disabled !== true} />;
}
function CorrectionContent({ message, scope, onSaved, allowed, onTopicSelected }: { message: Agent007Message; scope: HugoScope; onSaved: (correction: Agent007ResponseCorrection) => void; allowed: boolean; onTopicSelected?: (topic: string) => void }) {
  const client = message.reportExport?.rows?.length === 1 ? message.reportExport.rows[0] : null;
  const [rememberKind, setRememberKind] = useState<"CLIENT" | "TOPIC" | "SESSION">(client ? "CLIENT" : "TOPIC"), [topicLabel, setTopicLabel] = useState("");
  const [editing, setEditing] = useState(false), [content, setContent] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [saved, setSaved] = useState<Agent007ResponseCorrection | undefined>(validCorrection(message.responseCorrection) ? message.responseCorrection : undefined);
  const [choices, setChoices] = useState(() => Array.isArray(message.correctionChoices) ? message.correctionChoices.slice(0, 6).filter(row => row && typeof row.id === "string" && row.id.length <= 160 && typeof row.content === "string" && row.content.length <= 1000 && typeof row.topic?.label === "string") : []);
  const [personalNotes, setPersonalNotes] = useState(() => Array.isArray(message.personalNotes) ? message.personalNotes.slice(0, 3).filter(row => row && typeof row.id === "string" && row.id.length <= 160 && typeof row.content === "string" && row.content.length <= 1000 && row.topic?.kind === "CLIENT" && typeof row.topic.label === "string") : []);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { if (validCorrection(message.responseCorrection) && (message.responseCorrection.version > (saved?.version || 0) || message.responseCorrection.version === saved?.version && message.responseCorrection.status === "REJECTED" && saved.status !== "REJECTED")) { generation.current++; setSaved(message.responseCorrection); setEditing(false); setBusy(false); } }, [message.responseCorrection?.version, message.responseCorrection?.status]);
  if (!allowed || message.role !== "assistant" || !message.id || message.id.startsWith("local-")) return null;
  const save = async () => {
    if (busy || !confirmed || !content.trim() || content.length > 1000 || rememberKind === "TOPIC" && !topicLabel.trim()) return;
    const version = generation.current; setBusy(true); setError("");
    try {
      const rememberFor = rememberKind === "CLIENT" ? { kind: "CLIENT" as const } : rememberKind === "TOPIC" ? { kind: "TOPIC" as const, label: topicLabel.trim() } : undefined;
      const result = await correctAgent007Response({ messageId: message.id, scope, expectedText: message.text, expectedVersion: saved?.version || 0, content: content.trim(), ...(rememberFor ? { rememberFor } : {}) });
      if (version !== generation.current) return;
      if (!result.ok || result.status !== "CONFIRMED" || !validCorrection(result.correction) || result.correction.status !== "CONFIRMED" || result.correction.content !== content.trim() || result.correction.version !== (saved?.version || 0) + 1 || result.correction.expiresAt && Date.parse(result.correction.expiresAt) <= Date.now()) throw Error("No se confirmó la corrección. Recarga la conversación.");
      if (rememberFor && (result.correction.scope !== "USER_TOPIC" || result.correction.topic?.kind !== rememberFor.kind || (rememberFor.kind === "TOPIC" ? result.correction.topic.label !== rememberFor.label.replace(/\s+/g, " ") : result.correction.topic.id !== client?.clienteId))) throw Error("El servidor aún no confirmó el alcance personal de este recuerdo.");
      setSaved(result.correction); setEditing(false); onSaved(result.correction);
      if (result.correction.topic?.kind === "TOPIC") onTopicSelected?.(result.correction.topic.label);
    } catch (cause: any) { if (version === generation.current) setError(cause?.message || "No se guardó la corrección. Intenta de nuevo."); }
    finally { if (version === generation.current) setBusy(false); }
  };
  const remove = async () => {
    if (!saved || busy) return;
    const version = generation.current; setBusy(true); setError("");
    try { const result = await reviewAgent007MemoryCandidate(saved.memoryId, "REJECT"); if (version !== generation.current) return; if (!result.ok || result.changed !== true) throw Error("El servidor no confirmó el retiro. Recarga la conversación."); const removed = { ...saved, status: "REJECTED" as const }; setSaved(removed); onSaved(removed); }
    catch (cause: any) { if (version === generation.current) setError(cause?.message || "No se retiró la corrección."); }
    finally { if (version === generation.current) setBusy(false); }
  };
  const removeChoice = async (id: string) => {
    if (busy) return;
    const version = generation.current; setBusy(true); setError("");
    try { const result = await reviewAgent007MemoryCandidate(id, "REJECT"); if (version !== generation.current) return; if (!result.ok || result.changed !== true) throw Error("El servidor no confirmó el retiro. Vuelve a consultar el tema."); setChoices(current => current.filter(row => row.id !== id)); setPersonalNotes(current => current.filter(row => row.id !== id)); }
    catch (cause: any) { if (version === generation.current) setError(cause?.message || "No se retiró el recuerdo."); }
    finally { if (version === generation.current) setBusy(false); }
  };
  return <div className="mt-2 border-t border-slate-700/70 pt-2">
    {!!personalNotes.length && <div aria-label="Tus indicaciones personales del cliente" className="mb-3 space-y-2 rounded-lg border border-sky-500/30 p-2 text-xs"><p>Al consultar este reporte se recuperaron tus indicaciones para el mismo cliente verificado. Son declaraciones tuyas: no cambian los datos ni el archivo del reporte.</p>{personalNotes.map(note => <div key={note.id} className="rounded bg-slate-950 p-2"><p className="text-sky-200">{note.topic?.label}</p><p className="whitespace-pre-wrap">{note.content}</p><button type="button" disabled={busy} onClick={() => void removeChoice(note.id)} className="mt-1 text-rose-300">Retirar esta indicación</button></div>)}<p className="text-[10px] text-slate-500">Para cambiar una indicación, retírala y corrige esta respuesta.</p></div>}
    {!!choices.length && <div aria-label="Revisar recuerdos del tema" className="mb-3 space-y-2 rounded-lg border border-amber-500/30 p-2 text-xs"><p>Al responder había varias declaraciones tuyas para el mismo ámbito. Retira las que ya no correspondan y vuelve a preguntar; ninguna sustituye datos de PAY0.</p>{choices.map(choice => <div key={choice.id} className="rounded bg-slate-950 p-2"><p className="text-amber-200">{choice.topic?.label}</p><p className="whitespace-pre-wrap">{choice.content}</p><button type="button" disabled={busy} onClick={() => void removeChoice(choice.id)} className="mt-1 text-rose-300">Retirar este recuerdo</button></div>)}</div>}
    {saved && <div aria-label="Tu respuesta corregida" className="mb-2 rounded-lg border border-amber-400/25 bg-amber-500/5 p-2 text-xs"><p className="font-semibold text-amber-200">Tu respuesta corregida · {saved.status === "REJECTED" ? "retirada" : "guardada"}</p><p className="mt-1 whitespace-pre-wrap text-slate-200">{saved.content}</p><p className="mt-1 text-[10px] text-slate-400">Declaración tuya, no un dato verificado por María. {saved.status === "REJECTED" ? "Ya no se reutiliza." : saved.scope === "USER_TOPIC" ? `Sólo para tu usuario al tratar ${saved.topic?.kind === "CLIENT" ? "el cliente" : "el tema"} «${saved.topic?.label}», hasta que la retires o sustituyas. Se consideran las 3 últimas por ámbito.` : saved.expiresAt && Date.parse(saved.expiresAt) <= Date.now() ? "Vigencia de reutilización finalizada." : "Sólo esta conversación: hasta 30 minutos o 4 turnos; se consideran las 3 últimas correcciones."}</p>{saved.status === "CONFIRMED" && <button type="button" disabled={busy} onClick={() => void remove()} className="mt-2 text-rose-300">Dejar de recordar esta corrección</button>}</div>}
    <button type="button" onClick={() => { setContent(saved?.content || ""); setRememberKind(saved?.topic?.kind || (client ? "CLIENT" : "TOPIC")); setTopicLabel(saved?.topic?.kind === "TOPIC" ? saved.topic.label : ""); setConfirmed(false); setError(""); setEditing(true); }} className="text-[11px] text-amber-200 hover:text-amber-100">{saved ? "Editar tu corrección" : "Corregir respuesta"}</button>
    {editing && <div role="dialog" aria-modal="false" aria-label="Corregir respuesta de María" className="mt-2 space-y-2 rounded-xl border border-slate-600 bg-slate-950 p-3 text-xs">
      <p className="font-semibold text-white">Esto es lo que María respondió</p><p className="max-h-28 overflow-auto whitespace-pre-wrap text-slate-400">{message.text}</p>
      <label className="block text-slate-200">¿Qué debería decir?<textarea aria-label="Respuesta corregida" value={content} maxLength={1000} disabled={busy} onChange={event => setContent(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white" /></label>
      <label className="block">Recordar para<select aria-label="Alcance del recuerdo" value={rememberKind} disabled={busy} onChange={event => setRememberKind(event.target.value as typeof rememberKind)} className="ml-2 rounded bg-slate-900 p-1">{client && <option value="CLIENT">Nota en reportes de este cliente: {client.clienteNombre}</option>}<option value="TOPIC">Un tema que confirmo</option><option value="SESSION">Sólo esta conversación, temporalmente</option></select></label>
      {rememberKind === "TOPIC" && <label className="block">Tema específico<input aria-label="Tema del recuerdo" maxLength={80} disabled={busy} value={topicLabel} onChange={event => setTopicLabel(event.target.value)} className="ml-2 rounded bg-slate-900 p-1" /></label>}
      <p className="text-[10px] text-slate-400">Recuerdo personal: sólo se reutiliza con el cliente verificado o el tema que selecciones expresamente. Puedes editarlo o retirarlo. No cambia importes, documentos, permisos ni reglas globales.</p>
      <label className="flex items-start gap-2 text-slate-300"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Confirmo esta corrección y el alcance elegido.</label>
      <div className="flex gap-2"><button type="button" disabled={busy || !confirmed || !content.trim() || rememberKind === "TOPIC" && !topicLabel.trim()} onClick={() => void save()} className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-slate-950 disabled:opacity-40">{busy ? "Guardando…" : "Guardar corrección"}</button><button type="button" disabled={busy} onClick={() => { generation.current++; setEditing(false); }} className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300">Cancelar</button></div>
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
  </div>;
}

export function HugoCorrectionTopic({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState("");
  return <div className="my-2 rounded-lg border border-slate-800 p-2 text-xs text-slate-400">{value ? <div>Tema confirmado: <span className="text-amber-200">{value}</span><button type="button" onClick={() => { onChange(""); setDraft(""); }} className="ml-2 text-rose-300">Quitar tema actual</button></div> : <div><label>Tema actual para tus recuerdos<input aria-label="Tema actual" value={draft} maxLength={80} onChange={event => setDraft(event.target.value)} className="ml-2 rounded bg-slate-950 p-1 text-white" /></label><button type="button" disabled={!draft.trim()} onClick={() => onChange(draft.trim())} className="ml-2 text-amber-200 disabled:opacity-40">Confirmar tema</button><p className="mt-1">Sin tema seleccionado no se aplican recuerdos por similitud. Los clientes se identifican con datos autorizados.</p></div>}</div>;
}
