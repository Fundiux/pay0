"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  getWhatsAppAgentObservers,
  saveWhatsAppAgentObservers,
  type WhatsAppAgentObserver,
  type WhatsAppAgentObserversState,
} from "@/services/whatsappQr";

export function AgentObserversPanel() {
  const [state, setState] = useState<WhatsAppAgentObserversState | null>(null);
  const [groupChatId, setGroupChatId] = useState("");
  const [observers, setObservers] = useState<WhatsAppAgentObserver[]>([]);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    try {
      setState(await getWhatsAppAgentObservers());
    } catch (e: any) {
      setMessage(`No se pudo cargar la configuración: ${e?.message || e}`);
    }
  }

  useEffect(() => { void load(); }, []);

  function selectGroup(chatId: string) {
    setGroupChatId(chatId);
    setMessage("");
    const current = state?.configs.find(row => row.groupChatId === chatId);
    setObservers(current?.observers || []);
    setActive(current ? current.active : true);
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      await saveWhatsAppAgentObservers({ groupChatId, active, observers });
      setMessage("Configuración guardada.");
      await load();
    } catch (e: any) {
      setMessage(`No se pudo guardar: ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <summary className="cursor-pointer text-lg font-semibold text-white">Agentes observadores por grupo</summary>
      <p className="mt-2 max-w-3xl text-sm text-slate-400">
        Registra qué agente observa cada grupo. El número es opcional y solo informativo: cada agente se conectará con su propio QR. Esto solo guarda la configuración; todavía no se leen mensajes.
      </p>

      {!state ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> Cargando...</div>
      ) : (
        <div className="mt-4 space-y-4">
          <select
            value={groupChatId}
            onChange={e => selectGroup(e.target.value)}
            className="w-full max-w-xl rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          >
            <option value="">Selecciona un grupo sincronizado</option>
            {state.groups.map(group => <option key={group.chatId} value={group.chatId}>{group.name || group.chatId}</option>)}
          </select>

          {groupChatId && (
            <div className="space-y-3">
              {observers.map((row, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <select
                    value={row.agentId}
                    onChange={e => setObservers(observers.map((item, i) => i === index ? { ...item, agentId: e.target.value } : item))}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="">Agente</option>
                    {state.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                  <input
                    value={row.phone}
                    onChange={e => setObservers(observers.map((item, i) => i === index ? { ...item, phone: e.target.value } : item))}
                    placeholder="Teléfono del agente (opcional)"
                    className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  />
                  <button type="button" onClick={() => setObservers(observers.filter((_, i) => i !== index))} className="rounded-lg border border-rose-500/40 p-2 text-rose-200" aria-label="Quitar observador">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setObservers([...observers, { agentId: "", phone: "" }])} className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-3 py-2 text-xs font-medium text-emerald-200">
                  <Plus size={14} /> Agregar observador
                </button>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Activo
                </label>
                <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">
                  {saving && <Loader2 size={14} className="animate-spin" />} Guardar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {message && <p className="mt-3 text-sm text-slate-300">{message}</p>}
    </details>
  );
}
