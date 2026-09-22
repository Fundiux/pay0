"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Loader2, MessageCircle, Send, X } from "lucide-react";
import { useUserProfile } from "@/lib/useUserProfile";
import { listAgent007Messages, listAgent007Recommendations, markAgent007MessagesRead, resolveAgent007Recommendation, sendAgent007Message, type Agent007Message, type Agent007Recommendation } from "@/services/agent007";

function messageTime(value: any) {
  const date = value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : null);
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "";
}

export default function HugoFloatingBubble() {
  const { profile } = useUserProfile();
  const allowed = profile?.role === "superadmin";
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Agent007Recommendation[]>([]);
  const [messages, setMessages] = useState<Agent007Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const [recommendations, conversation] = await Promise.all([listAgent007Recommendations(), listAgent007Messages()]);
      setItems(recommendations.recommendations || []);
      setMessages(conversation.messages || []);
      setError("");
    } catch (cause: any) {
      setError(cause?.message || "No pude cargar la conversación.");
    }
  }, [allowed]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 20000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { if (!open || !allowed) return; void markAgent007MessagesRead().then(() => setMessages((current) => current.map((message) => ({ ...message, read: true })))).catch(() => undefined); }, [open, allowed]);
  useEffect(() => { if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, open]);

  const pending = useMemo(() => items.filter((item) => item.status === "PENDING_REVIEW" && item.requiresHumanDecision !== false), [items]);
  const unread = useMemo(() => messages.filter((message) => message.role === "assistant" && message.read === false).length, [messages]);
  if (!allowed) return null;

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    const optimisticId = `local-${Date.now()}`;
    setMessages((current) => [...current, { id: optimisticId, role: "user", text: value, source: "USER", read: true }]);
    setText(""); setSending(true); setError("");
    try {
      const result = await sendAgent007Message(value);
      setMessages((current) => [...current.filter((message) => message.id !== optimisticId), { id: `${optimisticId}-user`, role: "user", text: value, source: "USER", read: true }, result.message]);
    } catch (cause: any) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setText(value); setError(cause?.message || "Hugo no pudo responder. Intenta nuevamente.");
    } finally { setSending(false); }
  };

  const resolve = async (id: string, decision: "APPROVED" | "REJECTED") => {
    try { await resolveAgent007Recommendation(id, decision, decision === "REJECTED" ? text.trim() : ""); setText(""); await load(); }
    catch (cause: any) { setError(cause?.message || "No pude guardar tu decisión."); }
  };

  return <>
    <button type="button" aria-label="Abrir Hugo" onClick={() => setOpen((value) => !value)} className="fixed bottom-6 right-6 z-[101] grid h-14 w-14 place-items-center rounded-full bg-blue-600 text-white shadow-2xl transition hover:scale-105">
      <MessageCircle size={25} />{unread + pending.length > 0 && <span className="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-rose-500 px-1 text-xs">{Math.min(99, unread + pending.length)}</span>}
    </button>
    {open && <aside className="fixed bottom-24 right-6 z-[100] flex h-[min(660px,calc(100vh-8rem))] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-violet-500/30 bg-slate-950 shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-4 py-3"><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-full bg-violet-500/15 text-violet-300"><Bot size={19} /></span><div><h3 className="font-semibold text-white">Hugo</h3><p className="text-[11px] text-emerald-300">Asistente interno · solo superadmin</p></div></div><button type="button" aria-label="Cerrar Hugo" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={16} /></button></header>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {!messages.length && <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 text-sm text-slate-300">Hola. Estoy listo para revisar contigo lo que ocurra en PAY0. Puedes preguntarme por una solicitud, pago, factura o decirme qué debo aprender.</div>}
        {messages.map((message) => <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${message.role === "user" ? "rounded-br-sm bg-blue-600 text-white" : "rounded-bl-sm border border-slate-800 bg-slate-900 text-slate-200"}`}><p className="whitespace-pre-wrap">{message.text}</p><div className={`mt-1 flex gap-2 text-[10px] ${message.role === "user" ? "text-blue-100" : "text-slate-500"}`}><span>{message.role === "assistant" ? "Hugo" : "Tú"}</span><span>{messageTime(message.createdAt)}</span></div></div></div>)}
        {sending && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="animate-spin" size={14} /> Hugo está revisando el sistema…</div>}
        {pending.slice(0, 4).map((item) => <div key={item.id} className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">Necesito tu confirmación</p><p className="mt-1 text-sm font-semibold text-slate-100">{item.title || "Revisión operativa"}</p><p className="mt-1 text-xs text-slate-300">{item.explanation || item.proposal || "Dato por revisar"}</p>{item.actionPrompt && <p className="mt-2 text-sm text-white">{item.actionPrompt}</p>}<p className="mt-1 text-[11px] text-slate-500">{item.caseType} · {item.caseId} · {Math.round((item.confidence || 0) * 100)}%</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => void resolve(item.id, "APPROVED")} className="rounded-lg bg-emerald-500 px-2 py-1 text-xs font-medium text-slate-950"><Check size={13} className="mr-1 inline" />Correcto</button><button type="button" onClick={() => void resolve(item.id, "REJECTED")} className="rounded-lg border border-rose-500/50 px-2 py-1 text-xs text-rose-300">Corregir</button></div></div>)}
      </div>
      {error && <p className="mx-4 mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
      <footer className="border-t border-slate-800 p-3"><div className="flex items-end gap-2"><textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={1} placeholder="Escribe a Hugo…" className="max-h-28 min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-violet-400" /><button type="button" aria-label="Enviar mensaje" disabled={!text.trim() || sending} onClick={() => void send()} className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500 text-white disabled:cursor-not-allowed disabled:opacity-40"><Send size={16} /></button></div><p className="mt-2 text-[10px] text-slate-600">Hugo puede observar y proponer; no ejecuta movimientos financieros.</p></footer>
    </aside>}
  </>;
}
