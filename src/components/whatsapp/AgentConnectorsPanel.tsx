"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldOff } from "lucide-react";
import {
  createWhatsAppAgentEnrollment,
  getWhatsAppAgentActivity,
  getWhatsAppAgentObservers,
  saveWhatsAppAgentObservers,
  listWhatsAppAgentChats,
  listWhatsAppAgentConnectors,
  revokeWhatsAppAgentConnector,
  type WhatsAppAgentActivityRow,
  type WhatsAppAgentChats,
  type WhatsAppAgentConnector,
  type WhatsAppAgentObserversState,
} from "@/services/whatsappQr";

const minutes = (ms: number | null) => (ms === null ? "—" : `${(ms / 60000).toFixed(1)} min`);

// Grupos que ve el conector de un agente. Aquí se elige cuáles observa y a qué usuario de PAY0 pertenece cada uno.
// De los chats privados solo se cuenta cuántos hay.
function AgentGroupsList({ bindingId, agentId, meta, onChanged }: { bindingId: string; agentId: string; meta: WhatsAppAgentObserversState; onChanged: () => Promise<void> }) {
  const [chats, setChats] = useState<WhatsAppAgentChats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    listWhatsAppAgentChats(bindingId)
      .then(result => { if (alive) setChats(result); })
      .catch((e: any) => { if (alive) setError(`No se pudieron cargar los grupos: ${e?.message || e}`); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [bindingId]);

  const configFor = (chatId: string) => meta.configs.find(row => row.groupChatId === chatId);
  const observed = (chatId: string) => { const config = configFor(chatId); return !!config && config.active && config.observers.some(o => o.agentId === agentId); };
  const ownerOf = (chatId: string) => picked[chatId] ?? configFor(chatId)?.ownerUserUid ?? "";

  // Un toque guarda: este agente se agrega o se quita de los observadores del grupo sin tocar a los demás.
  async function apply(chatId: string, observe: boolean, owner: string) {
    const config = configFor(chatId);
    const others = (config?.observers || []).filter(o => o.agentId !== agentId);
    const mine = config?.observers.find(o => o.agentId === agentId);
    const observers = observe ? [...others, { agentId, phone: mine?.phone || "" }] : others;
    setSaving(chatId);
    setMessage("");
    try {
      await saveWhatsAppAgentObservers({ groupChatId: chatId, active: observers.length > 0, ownerUserUid: owner, observers });
      await onChanged();
      setMessage(observe ? "Guardado: el agente observa este grupo." : "Guardado: el agente ya no observa este grupo.");
    } catch (e: any) {
      setMessage(`No se pudo guardar: ${e?.message || e}`);
    } finally {
      setSaving("");
    }
  }

  return (
    <details open className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
      <summary className="cursor-pointer text-xs font-medium text-slate-300">
        Grupos de este agente{chats ? ` (${chats.groups.length})` : ""}
      </summary>
      {loading && <div className="mt-2 flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" /> Cargando...</div>}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {chats && (
        <div className="mt-2 space-y-2">
          {chats.groups.length === 0 && <p className="text-xs text-slate-500">Todavía no hay grupos sincronizados.</p>}
          <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {chats.groups.map(group => {
              const on = observed(group.chatId), owner = ownerOf(group.chatId), busy = saving === group.chatId;
              return (
                <li key={group.chatId} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs text-slate-300">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-200">{group.name || "Grupo sin nombre"}{group.archived ? " (archivado)" : ""}</span>
                    <span className={on ? "shrink-0 text-emerald-300" : "shrink-0 text-slate-500"}>{on ? "Observando" : "No observado"}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={owner}
                      disabled={busy}
                      aria-label={`Usuario del grupo ${group.name}`}
                      onChange={e => { setPicked({ ...picked, [group.chatId]: e.target.value }); if (on && e.target.value) void apply(group.chatId, true, e.target.value); }}
                      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                    >
                      <option value="">Usuario del grupo</option>
                      {meta.users.map(user => <option key={user.uid} value={user.uid}>{user.name}</option>)}
                    </select>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      disabled={busy || (!on && !owner)}
                      title={!on && !owner ? "Elige primero el usuario del grupo" : on ? "Dejar de observar" : "Observar este grupo"}
                      onClick={() => void apply(group.chatId, !on, owner)}
                      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${on ? "border-emerald-500/50 bg-emerald-600/20 text-emerald-200" : "border-slate-700 text-slate-300"}`}
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : null}
                      {on ? "Observar: sí" : "Observar: no"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {message && <p className="text-xs text-slate-300">{message}</p>}
          <p className="text-xs text-slate-500">
            Chats privados: {chats.privateChats}. No se muestran ni sus nombres ni sus números.
            {chats.truncated ? " La lista está incompleta." : ""}
          </p>
        </div>
      )}
    </details>
  );
}

export function AgentConnectorsPanel() {
  const [connectors, setConnectors] = useState<WhatsAppAgentConnector[]>([]);
  const [meta, setMeta] = useState<WhatsAppAgentObserversState | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [transfers, setTransfers] = useState<Record<string, string>>({});
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

  async function loadActivity() {
    setBusy("activity");
    try { setActivity((await getWhatsAppAgentActivity(7)).rows); }
    catch (e: any) { setMessage(`No se pudo cargar la actividad: ${e?.message || e}`); }
    finally { setBusy(""); }
  }

  const agentName = (id: string) => meta?.agents.find(a => a.id === id)?.name || id;
  const groupName = (id: string) => meta?.groups.find(g => g.chatId === id)?.name || id;
  const activeByAgent = new Map(connectors.filter(c => c.state === "ACTIVE" && c.agentId !== "pay0").map(c => [c.agentId, c]));

  return (
    <details className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <summary className="cursor-pointer text-lg font-semibold text-white">Conexión de WhatsApp por agente</summary>
      <p className="mt-2 max-w-3xl text-sm text-slate-400">
        Cada agente se conecta con su propio QR y su propio conector local. Solo se leen los grupos que actives aquí para ese agente, y cada uno debe tener su usuario; los mensajes se borran a los 30 días.
      </p>

      {!meta ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> Cargando...</div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {meta.agents.map(agent => {
            const connector = activeByAgent.get(agent.id);
            return (
              <div key={agent.id} className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium text-white">{agent.name}</h3>
                  <span className="text-xs text-slate-400">{connector ? (connector.status || "Sin señal") : "Sin conexión"}</span>
                </div>
                {connector ? (
                  <div className="mt-3 space-y-2">
                    {connector.qrDataUrl && <img src={connector.qrDataUrl} alt={`QR de ${agent.name}`} className="h-40 w-40 rounded bg-white p-1" />}
                    {connector.error && <p className="text-xs text-rose-300">{connector.error}</p>}
                    <p className="text-xs text-slate-500">{connector.lastSeenAtMs ? `Última señal: ${new Date(connector.lastSeenAtMs).toLocaleString("es-MX")}` : "Sin señal todavía"}</p>
                    <AgentGroupsList bindingId={connector.bindingId} agentId={agent.id} meta={meta} onChanged={load} />
                    <button type="button" disabled={busy === connector.bindingId} onClick={() => void revoke(connector.bindingId)} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 px-3 py-2 text-xs text-rose-200 disabled:opacity-40">
                      <ShieldOff size={14} /> Revocar conexión
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <textarea value={keys[agent.id] || ""} onChange={e => setKeys({ ...keys, [agent.id]: e.target.value })} rows={3} placeholder="Llave pública del conector local de este agente" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100" />
                    <button type="button" disabled={busy === agent.id || !(keys[agent.id] || "").trim()} onClick={() => void enroll(agent.id)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">
                      {busy === agent.id ? "Creando..." : "Crear enrolamiento"}
                    </button>
                    {transfers[agent.id] && <textarea readOnly value={transfers[agent.id]} rows={4} className="w-full rounded-lg border border-emerald-500/30 bg-slate-950 px-3 py-2 text-xs text-emerald-100" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
                    <td className="p-2 text-right text-slate-100">{minutes(row.avgResponseMs)}</td>
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
