"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  assignWhatsAppGroupToClients,
  getClientWhatsAppGroups,
  type ClientWhatsAppGroupOption,
} from "@/services/clientWhatsappGroups";

// Destino WhatsApp del cliente: el grupo, entre los que ve Hugo, que recibe sus documentos automaticamente.
export default function ClientWhatsAppGroupPicker({ clientId }: { clientId: string }) {
  const [groups, setGroups] = useState<ClientWhatsAppGroupOption[]>([]);
  const [current, setCurrent] = useState<{ chatId: string; name: string } | null>(null);
  const [selected, setSelected] = useState("");
  const [senderConnected, setSenderConnected] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessage("");
    getClientWhatsAppGroups({ agentId: "hugo" })
      .then(result => {
        if (!alive) return;
        setGroups(result.groups || []);
        setSenderConnected(result.senderConnected !== false);
        const assignment = (result.assignments || []).find(row => row.clientId === clientId);
        setCurrent(assignment ? { chatId: assignment.groupChatId, name: assignment.groupName } : null);
        setSelected(assignment?.groupChatId || "");
      })
      .catch((e: any) => { if (alive) setMessage(e?.message || "No se pudieron cargar los grupos de WhatsApp."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [clientId]);

  const currentVisible = useMemo(() => !current || groups.some(group => group.chatId === current.chatId), [current, groups]);

  async function save(action: "ASSIGN" | "UNASSIGN") {
    if (action === "ASSIGN" && !selected) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await assignWhatsAppGroupToClients({ action, groupChatId: action === "ASSIGN" ? selected : "", clienteIds: [clientId] });
      if (!result.ok) throw new Error(result.failed?.[0]?.message || result.message);
      if (action === "ASSIGN") {
        const group = groups.find(item => item.chatId === selected);
        setCurrent({ chatId: selected, name: group?.name || "" });
      } else {
        setCurrent(null);
        setSelected("");
      }
      setMessage(action === "ASSIGN" ? "Grupo guardado. Hugo enviará aquí los documentos del cliente." : "Grupo retirado del cliente.");
    } catch (e: any) {
      setMessage(e?.message || "No se pudo guardar el grupo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.05] p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-emerald-100">Destino WhatsApp</h3>
        <p className="text-xs text-slate-400">
          Grupo de WhatsApp donde Hugo envía automáticamente facturas, complementos, comprobantes, cotizaciones y constancias de este cliente.
        </p>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando grupos de Hugo...</div>
      ) : !senderConnected ? (
        <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
          Hugo aún no tiene su WhatsApp conectado. Conéctalo en WhatsApp para elegir el grupo.
        </div>
      ) : groups.length === 0 ? (
        <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
          Hugo no tiene grupos sincronizados todavía.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {current && (
            <p className="text-sm text-slate-300">
              Grupo actual: <span className="font-semibold text-slate-100">{current.name || "Sin nombre"}</span>
              {!currentVisible && <span className="ml-2 text-amber-200">(Hugo ya no ve este grupo)</span>}
            </p>
          )}
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            aria-label="Grupo de WhatsApp del cliente"
            className="w-full max-w-md rounded-xl border border-white/10 bg-[#0f1522] px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400/40"
          >
            <option value="">Selecciona un grupo</option>
            {groups.map(group => (
              <option key={group.chatId} value={group.chatId}>{group.name || "Grupo sin nombre"}</option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save("ASSIGN")}
              disabled={saving || !selected || selected === current?.chatId}
              className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar grupo"}
            </button>
            {current && (
              <button
                type="button"
                onClick={() => void save("UNASSIGN")}
                disabled={saving}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.06] disabled:opacity-50"
              >
                Quitar grupo
              </button>
            )}
          </div>
        </div>
      )}

      {message && <div className="mt-3 text-xs text-slate-300">{message}</div>}
    </div>
  );
}
