"use client";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";
import { listUsers } from "@/services/users";
import { useUserProfile } from "@/lib/useUserProfile";
import ClientCommissionAllocationEditor, { type ClientAllocationRow, type CommissionAccountOption } from "./ClientCommissionAllocationEditor";

type Draft = { version: number; instructions: ClientAllocationRow[] };
type PostedPreview = {
  simulationOnly: true; canSubmitToIq: false; currency: string; draftVersion: number;
  earnedMinor: number; distributedMinor: number; remainingMinor: number;
  rows: Array<{ accountId: string; amountMinor: number }>;
  blockedIqAccountIds: string[];
};
export default function ClientPersonalCommissionDrafts({ clientId, referencePaymentId }: { clientId: string; referencePaymentId: string }) {
  const { profile } = useUserProfile();
  const [users, setUsers] = useState<Array<{ uid: string; label: string }>>([]);
  const [ownerUid, setOwnerUid] = useState("");
  const [accounts, setAccounts] = useState<CommissionAccountOption[]>([]);
  const [draft, setDraft] = useState<Draft>({ version: 0, instructions: [] });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState("");
  const [message, setMessage] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [preview, setPreview] = useState<PostedPreview | null>(null);
  const [dirty, setDirty] = useState(false);
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
    setPreview(null); setDirty(false);
    if (!ownerUid || !superadmin) return;
    let live = true;
    Promise.all([
      httpsCallable<{ ownerUid: string; purpose: string; clientId: string }, { accounts: Array<{ id: string; bankName: string; beneficiaryName: string; instrumentNumber: string; active: boolean; iqLinkStatus: string }> }>(functions, "listPersonalCommissionAccounts")({ ownerUid, purpose: "CLIENT_COSTS", clientId }),
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
  async function verifyAccount(accountId: string) {
    if (!referencePaymentId.trim() || !ownerUid || verifying) return;
    setVerifying(accountId); setMessage("");
    try {
      const result = await httpsCallable<{ clientId: string; ownerUid: string; accountId: string; paymentId: string },
        { ok: boolean; status: string; reason?: string }>(functions, "resolvePersonalCommissionAccountIq")({
        clientId, ownerUid, accountId, paymentId: referencePaymentId.trim(),
      });
      if (!result.data.ok) {
        setMessage("IQ requiere revisión: " + (result.data.reason || result.data.status));
      } else {
        const refreshed = await httpsCallable<{ ownerUid: string; purpose: string; clientId: string },
          { accounts: Array<{ id: string; bankName: string; beneficiaryName: string; instrumentNumber: string; active: boolean; iqLinkStatus: string }> }>(functions, "listPersonalCommissionAccounts")({
          ownerUid, purpose: "CLIENT_COSTS", clientId,
        });
        setAccounts(refreshed.data.accounts.filter(a => a.active).map(a => ({
          id: a.id, bankName: a.bankName, beneficiaryName: a.beneficiaryName,
          instrumentNumber: a.instrumentNumber, selectable: a.iqLinkStatus === "VERIFIED",
          reason: a.iqLinkStatus === "VERIFIED" ? null : "Pendiente IQ",
        })));
        setMessage("Cuenta verificada en IQ para este cliente. No se ha enviado ninguna dispersión.");
      }
    } catch (error: any) { setMessage(error.message || "No se pudo verificar la cuenta en IQ."); }
    finally { setVerifying(""); }
  }
  if (!superadmin) return null;
  async function save() {
    if (!ownerUid || busy || !loaded) return;
    setBusy(true); setMessage("");
    try {
      const result = await httpsCallable<{ clientId: string; ownerUid: string; instructions: ClientAllocationRow[]; expectedVersion: number }, { version: number }>(functions, "saveClientCommissionAllocationDraft")({
        clientId, ownerUid, instructions: draft.instructions, expectedVersion: draft.version,
      });
      setDraft(current => ({ ...current, version: result.data.version }));
      setDirty(false); setPreview(null);
      setMessage("Borrador guardado. No habilita dispersiones.");
    } catch (error: any) { setMessage(error.message || "No se pudo guardar el borrador."); }
    finally { setBusy(false); }
  }
  async function calculatePostedPreview() {
    if (!ownerUid || !clientId || !paymentId.trim() || busy || !loaded || dirty) return;
    setBusy(true); setMessage(""); setPreview(null);
    try {
      const response = await httpsCallable<{ clientId: string; ownerUid: string; paymentId: string }, PostedPreview>(functions, "previewPostedClientCommissionAllocation")({
        clientId, ownerUid, paymentId: paymentId.trim(),
      });
      setPreview(response.data);
    } catch (error: any) { setMessage(error.message || "No fue posible comprobar el pago contabilizado."); }
    finally { setBusy(false); }
  }
  const money = (minor: number, currency: string) => new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(minor / 100);
  return <section className="mt-6 space-y-3 border-t border-white/10 pt-5">
    <h4 className="font-semibold">Cuentas personales · distribución por cliente</h4>
    <p className="text-xs text-slate-400">Selecciona un usuario y configura sus cuentas. Solo se guardan borradores hasta aprobar la validación financiera e IQ.</p>
    <select aria-label="Usuario titular" className="w-full rounded-lg bg-slate-950 p-2 text-sm" value={ownerUid} onChange={event => setOwnerUid(event.target.value)}>
      <option value="">Seleccionar usuario</option>{users.map(user => <option key={user.uid} value={user.uid}>{user.label}</option>)}
    </select>
    {ownerUid && loaded && accounts.some(a => !a.selectable) && <div className="space-y-2 text-xs">
      <p className="text-amber-200">La verificación IQ utiliza el pago contabilizado de referencia del cliente indicado arriba.</p>
      {accounts.filter(a => !a.selectable).map(a => <div key={a.id} className="flex flex-wrap items-center gap-2">
        <span>{a.bankName} · {a.instrumentNumber}</span>
        <button type="button" disabled={!!verifying || !referencePaymentId.trim()}
          className="rounded-lg border border-sky-400/40 px-2 py-1 text-sky-200 disabled:opacity-40"
          onClick={() => void verifyAccount(a.id)}>{verifying === a.id ? "Verificando…" : "Verificar en IQ"}</button>
      </div>)}
    </div>}
    {ownerUid && loaded && <ClientCommissionAllocationEditor key={clientId + ":" + ownerUid + ":" + draft.version} accounts={accounts} initialRows={draft.instructions} onDraftChange={instructions => { setDraft(current => ({ ...current, instructions })); setDirty(true); setPreview(null); }} />}
    {ownerUid && <button type="button" disabled={busy || !loaded} className="rounded-lg bg-sky-600 px-4 py-2 text-sm disabled:opacity-40" onClick={() => void save()}>{busy ? "Guardando…" : "Guardar borrador"}</button>}
    {ownerUid && loaded && <div className="space-y-2 rounded-lg border border-white/10 p-3">
      <label className="block text-sm text-slate-300">Pago contabilizado para comprobar importes
        <input aria-label="ID interno del pago contabilizado" value={paymentId} onChange={event => { setPaymentId(event.target.value); setPreview(null); }} placeholder="ID interno del pago" className="mt-1 w-full rounded-lg bg-slate-950 p-2 text-sm" />
      </label>
      <button type="button" disabled={busy || !paymentId.trim() || dirty} onClick={() => void calculatePostedPreview()} className="rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40">Comprobar reparto</button>
      {dirty && <p className="text-xs text-amber-200">Guarda primero los cambios del borrador para comprobar los importes.</p>}
      {preview && <div role="status" className="space-y-2 text-sm">
        <p className="font-medium">Comprobación del pago contabilizado · borrador v{preview.draftVersion}</p>
        <p>Utilidad: {money(preview.earnedMinor, preview.currency)} · Distribuido: {money(preview.distributedMinor, preview.currency)} · Saldo restante: {money(preview.remainingMinor, preview.currency)}</p>
        <ul className="space-y-1">{preview.rows.map((row, index) => <li key={index}>{accounts.find(a => a.id === row.accountId)?.instrumentNumber || "Cuenta"} · {money(row.amountMinor, preview.currency)}</li>)}</ul>
        <p className="text-xs text-amber-200">Solo cálculo de consulta. No reserva saldo ni envía instrucciones a IQ.{preview.blockedIqAccountIds.length ? ` ${preview.blockedIqAccountIds.length} cuenta(s) sin verificación IQ exacta y vigente.` : ""}</p>
      </div>}
    </div>}
    {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
  </section>;
}
