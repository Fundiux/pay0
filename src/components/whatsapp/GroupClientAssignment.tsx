"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { listScopedClients, invalidateClientCatalog, type ClientItem } from "@/services/clients";
import {
  assignWhatsAppGroupToClients,
  getClientWhatsAppGroups,
  type ClientWhatsAppGroupAssignment,
  type ClientWhatsAppGroupOption,
} from "@/services/clientWhatsappGroups";

const MAX_PER_SAVE = 50;

const clean = (value: unknown) => String(value || "").trim();
const norm = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function GroupClientAssignment() {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const uid = (user as any)?.uid as string | undefined;
  const role = clean((profile as any)?.role);
  const rootId = clean((profile as any)?.rootId || uid);
  const isSuper = role.toLowerCase() === "superadmin";

  const [groups, setGroups] = useState<ClientWhatsAppGroupOption[]>([]);
  const [assignments, setAssignments] = useState<ClientWhatsAppGroupAssignment[]>([]);
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupChatId, setGroupChatId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isSuper) return;
    let alive = true;
    setLoading(true);
    getClientWhatsAppGroups()
      .then((result) => {
        if (!alive) return;
        setGroups(result.groups || []);
        setAssignments(result.assignments || []);
      })
      .catch((e: any) => alive && setError(e?.message || "No se pudieron cargar los grupos de WhatsApp."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [isSuper, reloadKey]);

  useEffect(() => {
    if (!isSuper || !uid || !rootId) return;
    return listScopedClients(
      { uid, role, rootId },
      (rows) => setClients(rows.filter((client) => client.active !== false)),
      (e) => setError((e as any)?.message || "No se pudieron cargar los clientes.")
    );
  }, [isSuper, uid, role, rootId]);

  const group = groups.find((item) => item.chatId === groupChatId);

  // Where each client goes today: this group, another group, or still the private contact.
  const rows = useMemo(() => {
    const term = norm(search);
    const byClient = new Map(assignments.map((item) => [item.clientId, item]));
    return clients
      .map((client) => {
        const current = byClient.get(client.id);
        return { client, inThisGroup: !!group && current?.groupChatId === group.chatId, otherGroup: current && current.groupChatId !== group?.chatId ? current.groupName : "" };
      })
      .filter((row) => !term || norm(row.client.name || "").includes(term))
      .sort((a, b) => (a.client.name || "").localeCompare(b.client.name || "", "es"));
  }, [clients, assignments, group, search]);

  function toggle(clientId: string) {
    setSelected((current) => (current.includes(clientId) ? current.filter((id) => id !== clientId) : [...current, clientId]));
  }

  const toAssign = selected.filter((id) => !rows.find((row) => row.client.id === id)?.inThisGroup);
  const toRemove = selected.filter((id) => rows.find((row) => row.client.id === id)?.inThisGroup);

  async function run(action: "ASSIGN" | "UNASSIGN") {
    const ids = action === "ASSIGN" ? toAssign : toRemove;
    if (!group || ids.length === 0) return;
    if (ids.length > MAX_PER_SAVE) {
      setError(`Máximo ${MAX_PER_SAVE} clientes por vez.`);
      return;
    }
    const confirmed = window.confirm(
      action === "ASSIGN"
        ? `Los documentos de ${ids.length} cliente(s) se enviarán al grupo "${group.name}". ¿Continuar?`
        : `${ids.length} cliente(s) dejarán de tener el grupo "${group.name}". ¿Continuar?`
    );
    if (!confirmed) return;

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await assignWhatsAppGroupToClients({ action, groupChatId: group.chatId, clienteIds: ids });
      const names = new Map(clients.map((client) => [client.id, client.name]));
      setMessage(result.message);
      if (result.failed.length) {
        setError(result.failed.map((item) => `${names.get(item.clientId) || "Cliente"}: ${item.message}`).join(" | "));
      }
      setSelected([]);
      invalidateClientCatalog();
      setReloadKey((value) => value + 1);
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar el grupo.");
    } finally {
      setSaving(false);
    }
  }

  if (!isSuper) return null;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#161d2b]">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-200">Grupo de WhatsApp por cliente</h2>
        <p className="mt-1 text-xs text-slate-400">
          Elige un grupo y marca los clientes cuyos documentos deben ir ahí. Varios clientes pueden compartir un grupo; cada cliente tiene uno.
        </p>
      </div>

      <div className="space-y-3 p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay grupos. Aparecen cuando un agente conectado a WhatsApp está dentro del grupo.</p>
        ) : (
          <>
            <select
              value={groupChatId}
              onChange={(e) => {
                setGroupChatId(e.target.value);
                setSelected([]);
                setMessage("");
                setError("");
              }}
              aria-label="Grupo de WhatsApp"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400/40"
            >
              <option value="">Selecciona un grupo</option>
              {groups.map((item) => (
                <option key={item.chatId} value={item.chatId} className="bg-[#161d2b]">
                  {item.name}
                </option>
              ))}
            </select>

            {group && (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar cliente"
                    aria-label="Buscar cliente"
                    className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-sky-400/40"
                  />
                </div>

                <div className="max-h-80 divide-y divide-white/5 overflow-auto rounded-xl border border-white/10">
                  {rows.length === 0 ? (
                    <p className="p-3 text-sm text-slate-500">No hay clientes que mostrar.</p>
                  ) : (
                    rows.map(({ client, inThisGroup, otherGroup }) => (
                      <label key={client.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-white/[0.03]">
                        <input type="checkbox" checked={selected.includes(client.id)} onChange={() => toggle(client.id)} className="h-4 w-4" />
                        <span className="min-w-0 flex-1 truncate text-slate-200">{client.name}</span>
                        <span className={`shrink-0 text-xs ${inThisGroup ? "text-emerald-300" : otherGroup ? "text-amber-300" : "text-slate-500"}`}>
                          {inThisGroup ? "Ya en este grupo" : otherGroup ? `Hoy: ${otherGroup}` : "Sin grupo"}
                        </span>
                      </label>
                    ))
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-slate-400">
                    {toAssign.length} por asignar · {toRemove.length} por retirar
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => run("UNASSIGN")}
                      disabled={saving || toRemove.length === 0}
                      className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 disabled:opacity-40"
                    >
                      Retirar del grupo
                    </button>
                    <button
                      type="button"
                      onClick={() => run("ASSIGN")}
                      disabled={saving || toAssign.length === 0}
                      className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {saving ? "Guardando..." : "Asignar al grupo"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {message && <p className="text-sm text-emerald-300">{message}</p>}
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </div>
    </section>
  );
}
