"use client";

import { useCallback, useEffect, useState } from "react";
import { listDuplicateClientGroupsQuery, mergeDuplicateClientMutation, type DuplicateClientGroup } from "@/services/clientMutations";

const errorText = (error: unknown) => String((error as any)?.message || "No se pudo completar la fusión.").replace(/^.*?:\s*/, "");

// Superadmin only. Lists the groups of active clients that share a unique RFC and lets the owner merge each group
// into one client. Only new operations move to the canonical client; existing pagos and solicitudes stay where they are.
export default function DuplicateRfcPanel({ onMerged }: { onMerged?: (message: string) => void }) {
  const [groups, setGroups] = useState<DuplicateClientGroup[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await listDuplicateClientGroupsQuery();
      setGroups(next);
      setChosen((current) => Object.fromEntries(next.map((group) => [group.rfc, group.clients.some((c) => c.id === current[group.rfc]) ? current[group.rfc] : group.proposedCanonicalId])));
    } catch (error) {
      console.warn("[clients] duplicate groups:", (error as any)?.code || (error as any)?.message || error);
      setGroups([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function merge(group: DuplicateClientGroup) {
    const canonicalId = chosen[group.rfc] || group.proposedCanonicalId;
    setBusy(group.rfc);
    setMessage("");
    try {
      for (const duplicate of group.clients.filter((client) => client.id !== canonicalId)) {
        await mergeDuplicateClientMutation({ canonicalId, duplicateId: duplicate.id, reason: "RFC duplicado" });
      }
      setConfirming("");
      onMerged?.(`Grupo ${group.rfc} fusionado.`);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy("");
      await load();
    }
  }

  if (!groups.length && !message) return null;

  return (
    <section className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-500/5 p-4" aria-label="RFC duplicados">
      <h2 className="text-sm font-semibold text-amber-200">RFC duplicados</h2>
      <p className="mt-1 text-xs text-slate-400">
        Las operaciones nuevas pasan al cliente vigente. Los pagos y solicitudes que ya existen no se mueven y se pueden terminar en el cliente original.
      </p>
      {message && <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">{message}</div>}
      {groups.map((group) => {
        const canonicalId = chosen[group.rfc] || group.proposedCanonicalId;
        const canonical = group.clients.find((client) => client.id === canonicalId);
        return (
          <div key={group.rfc} className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-xs font-semibold text-slate-200">{group.rfc}</div>
            <div className="mt-2 space-y-1">
              {group.clients.map((client) => (
                <label key={client.id} className="flex cursor-pointer flex-wrap items-center gap-2 text-xs text-slate-300">
                  <input
                    type="radio"
                    name={`vigente-${group.rfc}`}
                    checked={canonicalId === client.id}
                    disabled={!!busy}
                    onChange={() => { setChosen((current) => ({ ...current, [group.rfc]: client.id })); setConfirming(""); }}
                  />
                  <span className="font-medium text-white">{client.numero ? `C${client.numero}` : client.id}</span>
                  <span>{client.name}</span>
                  <span className="text-slate-500">
                    {client.solicitudes} solicitudes · {client.pagos} pagos · {client.iqLinked ? `IQ ${client.iqClientId}` : "sin vínculo IQ"}
                  </span>
                  {client.id === group.proposedCanonicalId && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">propuesto</span>}
                </label>
              ))}
            </div>
            {confirming === group.rfc ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span>
                  Fusionar en {canonical?.numero ? `C${canonical.numero}` : canonicalId}: los demás clientes del grupo dejan de recibir operaciones nuevas.
                </span>
                <button type="button" disabled={!!busy} onClick={() => void merge(group)} className="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-black disabled:opacity-50">
                  {busy === group.rfc ? "Fusionando..." : "Confirmar fusión"}
                </button>
                <button type="button" disabled={!!busy} onClick={() => setConfirming("")} className="rounded-lg border border-white/10 px-3 py-1.5 text-slate-300 disabled:opacity-50">
                  Cancelar
                </button>
              </div>
            ) : (
              <button type="button" disabled={!!busy} onClick={() => setConfirming(group.rfc)} className="mt-3 rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs font-semibold text-amber-200 disabled:opacity-50">
                Fusionar
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
