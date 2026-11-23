"use client";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";
import { listUsers } from "@/services/users";
import { useUserProfile } from "@/lib/useUserProfile";
import ClientCommissionAllocationEditor, { type ClientAllocationRow, type CommissionAccountOption } from "./ClientCommissionAllocationEditor";

type Draft = { version: number; instructions: ClientAllocationRow[] };
export default function ClientPersonalCommissionDrafts({ clientId }: { clientId: string }) {
  const { profile } = useUserProfile();
  const [users, setUsers] = useState<Array<{ uid: string; label: string }>>([]);
  const [ownerUid, setOwnerUid] = useState("");
  const [accounts, setAccounts] = useState<CommissionAccountOption[]>([]);
  const [draft, setDraft] = useState<Draft>({ version: 0, instructions: [] });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const superadmin = String(profile?.role || "").toLowerCase() === "superadmin";
  useEffect(() => {
    if (!superadmin) return;
    let live = true;
    (async () => {
      const result: Array<{ uid: string; label: string }> = [];
      let cursor: string | undefined;
      do {
        const page = await listUsers({ limit: 200, ...(cursor ? { cursor } : {}) });
        result.push(...(page.users || []).filter((user: any) => !user.isDeleted && user.isActive !== false)
          .map((user: any) => ({ uid: user.uid, label: user.displayName || user.username || "Usuario" })));
        cursor = page.hasMore ? page.nextCursor : undefined;
      } while (cursor);
      if (live) setUsers(result);
    })().catch(error => { if (live) setMessage(error.message || "No se pudieron consultar los usuarios."); });
    return () => { live = false; };
  }, [superadmin]);
  useEffect(() => {
    setAccounts([]); setDraft({ version: 0, instructions: [] }); setLoaded(false); setMessage("");
    if (!ownerUid || !superadmin) return;
    let live = true;
    Promise.all([
      httpsCallable<{ ownerUid: string; purpose: string }, { accounts: Array<{ id: string; bankName: string; beneficiaryName: string; instrumentNumber: string; active: boolean; iqLinkStatus: string }> }>(functions, "listPersonalCommissionAccounts")({ ownerUid, purpose: "CLIENT_COSTS" }),
      httpsCallable<{ clientId: string; ownerUid: string }, { draft: Draft | null }>(functions, "getClientCommissionAllocationDraft")({ clientId, ownerUid }),
    ]).then(([accountResponse, draftResponse]) => {
      if (!live) return;
      setAccounts(accountResponse.data.accounts.filter(a => a.active).map(a => ({
        id: a.id, bankName: a.bankName, beneficiaryName: a.beneficiaryName,
        instrumentNumber: a.instrumentNumber, selectable: a.iqLinkStatus === "VERIFIED",
        reason: a.iqLinkStatus === "VERIFIED" ? null : "Pendiente IQ",
      })));
      setDraft(draftResponse.data.draft || { version: 0, instructions: [] });
      setLoaded(true);
    }).catch(error => { if (live) setMessage(error.message || "No se pudo cargar la distribución."); });
    return () => { live = false; };
  }, [clientId, ownerUid, superadmin]);
  if (!superadmin) return null;
  async function save() {
    if (!ownerUid || busy || !loaded) return;
    setBusy(true); setMessage("");
    try {
      const result = await httpsCallable<{ clientId: string; ownerUid: string; instructions: ClientAllocationRow[]; expectedVersion: number }, { version: number }>(functions, "saveClientCommissionAllocationDraft")({
        clientId, ownerUid, instructions: draft.instructions, expectedVersion: draft.version,
      });
      setDraft(current => ({ ...current, version: result.data.version }));
      setMessage("Borrador guardado. No habilita dispersiones.");
    } catch (error: any) { setMessage(error.message || "No se pudo guardar el borrador."); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 space-y-3 border-t border-white/10 pt-5">
    <h4 className="font-semibold">Cuentas personales · distribución por cliente</h4>
    <p className="text-xs text-slate-400">Selecciona un usuario y configura sus cuentas. Solo se guardan borradores hasta aprobar la validación financiera e IQ.</p>
    <select aria-label="Usuario titular" className="w-full rounded-lg bg-slate-950 p-2 text-sm" value={ownerUid} onChange={event => setOwnerUid(event.target.value)}>
      <option value="">Seleccionar usuario</option>{users.map(user => <option key={user.uid} value={user.uid}>{user.label}</option>)}
    </select>
    {ownerUid && loaded && <ClientCommissionAllocationEditor key={clientId + ":" + ownerUid + ":" + draft.version} accounts={accounts} initialRows={draft.instructions} onDraftChange={instructions => setDraft(current => ({ ...current, instructions }))} />}
    {ownerUid && <button type="button" disabled={busy || !loaded} className="rounded-lg bg-sky-600 px-4 py-2 text-sm disabled:opacity-40" onClick={() => void save()}>{busy ? "Guardando…" : "Guardar borrador"}</button>}
    {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
  </section>;
}
