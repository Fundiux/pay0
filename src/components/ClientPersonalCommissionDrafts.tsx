"use client";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";
import { listUsers } from "@/services/users";
import { useUserProfile } from "@/lib/useUserProfile";
import ClientCommissionAllocationEditor, { type ClientAllocationRow, type CommissionAccountOption } from "./ClientCommissionAllocationEditor";

type ListedAccount = { id: string; bankName: string; beneficiaryName: string; instrumentNumber: string; active: boolean; iqLinkStatus: string };
async function clientAccountOptions(ownerUid: string, clientId: string, data: { accounts: ListedAccount[] }) {
  const active = data.accounts.filter(account => account.active);
  if (!active.length) return { options: [] as CommissionAccountOption[], error: "" };
  let numbers = new Map<string, string>();
  let error = "";
  try {
    const response = await httpsCallable<
      { accountIds: string[]; ownerUid: string; clientId: string; purpose: "CLIENT_COSTS" },
      { accounts: Array<{ accountId: string; instrumentNumber: string }> }
    >(functions, "revealPersonalCommissionAccountNumber")({
      accountIds: active.map(account => account.id), ownerUid, clientId, purpose: "CLIENT_COSTS",
    });
    numbers = new Map(response.data.accounts.map(account => [account.accountId, account.instrumentNumber]));
  } catch {
    error = "No fue posible mostrar las CLABE o tarjetas completas. Revisa la clave de cifrado del servidor.";
  }
  return {
    options: active.map(account => ({
      id: account.id, bankName: account.bankName, beneficiaryName: account.beneficiaryName,
      instrumentNumber: numbers.get(account.id) || account.instrumentNumber,
      selectable: account.iqLinkStatus === "VERIFIED",
      reason: account.iqLinkStatus === "VERIFIED" ? null : "Pendiente IQ",
    })),
    error,
  };
}
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
  const [accountsReferencePaymentId, setAccountsReferencePaymentId] = useState("");
  const [draft, setDraft] = useState<Draft>({ version: 0, instructions: [] });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState("");
  const [message, setMessage] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [preview, setPreview] = useState<PostedPreview | null>(null);
  const [dirty, setDirty] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState(0);
  const [publishedStatus, setPublishedStatus] = useState("");
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
    setAccounts([]); setAccountsReferencePaymentId(""); setDraft({ version: 0, instructions: [] }); setLoaded(false); setMessage("");
    setPreview(null); setDirty(false); setPublishedVersion(0); setPublishedStatus("");
    if (!ownerUid || !superadmin) return;
    let live = true;
    Promise.all([
      httpsCallable<{ ownerUid: string; purpose: string; clientId: string; paymentId: string }, { accounts: Array<{ id: string; bankName: string; beneficiaryName: string; instrumentNumber: string; active: boolean; iqLinkStatus: string }> }>(functions, "listPersonalCommissionAccounts")({ ownerUid, purpose: "CLIENT_COSTS", clientId, paymentId: referencePaymentId.trim() }),
      httpsCallable<{ clientId: string; ownerUid: string }, { draft: Draft | null }>(functions, "getClientCommissionAllocationDraft")({ clientId, ownerUid }),
      httpsCallable<{ clientId: string; ownerUid: string }, { rule: { version: number; status: string; executionEnabled: false } | null }>(functions, "getPublishedClientCommissionAllocation")({ clientId, ownerUid }),
    ]).then(async ([accountResponse, draftResponse, ruleResponse]) => {
      const details = await clientAccountOptions(ownerUid, clientId, accountResponse.data);
      if (!live) return;
      setAccounts(details.options);
      if (details.error) setMessage(details.error);
      setAccountsReferencePaymentId(referencePaymentId.trim());
      setDraft(draftResponse.data.draft || { version: 0, instructions: [] });
      setPublishedVersion(ruleResponse.data.rule?.version || 0);
      setPublishedStatus(ruleResponse.data.rule?.status || "");
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
        const refreshed = await httpsCallable<{ ownerUid: string; purpose: string; clientId: string; paymentId: string },
          { accounts: Array<{ id: string; bankName: string; beneficiaryName: string; instrumentNumber: string; active: boolean; iqLinkStatus: string }> }>(functions, "listPersonalCommissionAccounts")({
          ownerUid, purpose: "CLIENT_COSTS", clientId, paymentId: referencePaymentId.trim(),
        });
        const details = await clientAccountOptions(ownerUid, clientId, refreshed.data);
        setAccounts(details.options);
        if (details.error) setMessage(details.error);
        setAccountsReferencePaymentId(referencePaymentId.trim());
        setMessage("Cuenta verificada en IQ para este cliente y origen de pago. No se ha enviado ninguna dispersión.");
      }
    } catch (error: any) { setMessage(error.message || "No se pudo verificar la cuenta en IQ."); }
    finally { setVerifying(""); }
  }
  const accountsForReference = accounts.map(account => accountsReferencePaymentId === referencePaymentId.trim()
    ? account : { ...account, selectable: false, reason: "Cambió el pago de referencia; comprueba IQ nuevamente" });
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
  async function publishConfiguration() {
    if (!ownerUid || !paymentId.trim() || !preview || preview.blockedIqAccountIds.length ||
        busy || dirty || preview.draftVersion !== draft.version) return;
    setBusy(true); setMessage("");
    try {
      const result = await httpsCallable<{
        clientId: string; ownerUid: string; paymentId: string;
        expectedDraftVersion: number; expectedVersion: number;
      }, { version: number; executionEnabled: false }>(functions, "publishClientCommissionAllocation")({
        clientId, ownerUid, paymentId: paymentId.trim(),
        expectedDraftVersion: draft.version, expectedVersion: publishedVersion,
      });
      setPublishedVersion(result.data.version);
      setPublishedStatus("CONFIGURED");
      setMessage("Regla v" + result.data.version + " registrada y auditada. No activa dispersiones.");
    } catch (error: any) {
      setMessage(error.message || "No se pudo registrar la regla; comprueba la versión y las cuentas IQ.");
    } finally { setBusy(false); }
  }
  async function activateConfiguration() {
    if (!ownerUid || !publishedVersion || publishedStatus !== "CONFIGURED" || busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await httpsCallable<{ clientId: string; ownerUid: string; expectedVersion: number },
        { version: number; status: string; executionEnabled: boolean }>(
        functions, "activateClientCommissionAllocation",
      )({ clientId, ownerUid, expectedVersion: publishedVersion });
      setPublishedVersion(result.data.version);
      setPublishedStatus(result.data.status);
      setMessage("Regla v" + result.data.version + " activa para movimientos futuros. Los envíos automáticos siguen deshabilitados.");
    } catch (error: any) { setMessage(error.message || "No se pudo activar la regla; revisa las cuentas IQ."); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 space-y-3 border-t border-white/10 pt-5">
    <h4 className="font-semibold">Cuentas personales · distribución por cliente</h4>
    <p className="text-xs text-slate-400">Selecciona un usuario y configura sus cuentas. Solo se guardan borradores hasta aprobar la validación financiera e IQ.</p>
    <select aria-label="Usuario titular" className="w-full rounded-lg bg-slate-950 p-2 text-sm" value={ownerUid} onChange={event => setOwnerUid(event.target.value)}>
      <option value="">Seleccionar usuario</option>{users.map(user => <option key={user.uid} value={user.uid}>{user.label}</option>)}
    </select>
    {ownerUid && loaded && accountsForReference.some(a => !a.selectable) && <div className="space-y-2 text-xs">
      <p className="text-amber-200">La verificación IQ utiliza el pago contabilizado de referencia del cliente indicado arriba.</p>
      {accountsForReference.filter(a => !a.selectable).map(a => <div key={a.id} className="flex flex-wrap items-center gap-2">
        <span>{a.bankName} · {a.instrumentNumber}</span>
        <button type="button" disabled={!!verifying || !referencePaymentId.trim()}
          className="rounded-lg border border-sky-400/40 px-2 py-1 text-sky-200 disabled:opacity-40"
          onClick={() => void verifyAccount(a.id)}>{verifying === a.id ? "Verificando…" : "Verificar en IQ"}</button>
      </div>)}
    </div>}
    {ownerUid && loaded && <ClientCommissionAllocationEditor key={clientId + ":" + ownerUid + ":" + draft.version} accounts={accountsForReference} initialRows={draft.instructions} onDraftChange={instructions => { setDraft(current => ({ ...current, instructions })); setDirty(true); setPreview(null); }} />}
    {ownerUid && <button type="button" disabled={busy || !loaded} className="rounded-lg bg-sky-600 px-4 py-2 text-sm disabled:opacity-40" onClick={() => void save()}>{busy ? "Guardando…" : "Guardar borrador"}</button>}
    {ownerUid && loaded && <div className="space-y-2 rounded-lg border border-white/10 p-3">
      <label className="block text-sm text-slate-300">Pago contabilizado de referencia para validar reglas
        <input aria-label="ID interno del pago contabilizado" value={paymentId} onChange={event => { setPaymentId(event.target.value); setPreview(null); }} placeholder="ID interno del pago" className="mt-1 w-full rounded-lg bg-slate-950 p-2 text-sm" />
      </label>
      <button type="button" disabled={busy || !paymentId.trim() || dirty} onClick={() => void calculatePostedPreview()} className="rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40">Validar configuración</button>
      {dirty && <p className="text-xs text-amber-200">Guarda primero los cambios del borrador para comprobar los importes.</p>}
      {preview && <div role="status" className="space-y-2 text-sm">
        <p className="font-medium">Comprobación del pago contabilizado · borrador v{preview.draftVersion}</p>
        <p>{preview.rows.length} instrucciones calculadas desde el pago real. La porción no distribuida permanece en el saldo del usuario.</p>
        <p className="text-xs text-amber-200">Validación sin movimiento de dinero ni envío a IQ.{preview.blockedIqAccountIds.length ? ` ${preview.blockedIqAccountIds.length} cuenta(s) sin verificación IQ exacta y vigente.` : ""}</p>
        <button type="button" disabled={busy || preview.blockedIqAccountIds.length > 0 || dirty} onClick={() => void publishConfiguration()} className="rounded-lg border border-sky-400/30 px-3 py-2 text-sky-200 disabled:opacity-40">Registrar regla prospectiva sin ejecución</button>
      </div>}
    </div>}
    {publishedVersion > 0 && <div className="space-y-2 text-xs text-slate-300">
      <p>Regla versión {publishedVersion} · {publishedStatus === "ACTIVE" ? "Activa prospectivamente" : "Configurada, no activa"} · envío automático deshabilitado</p>
      {publishedStatus === "CONFIGURED" && <button type="button" disabled={busy || !loaded}
        className="rounded-lg border border-emerald-400/30 px-3 py-2 text-emerald-200 disabled:opacity-40"
        onClick={() => void activateConfiguration()}>Activar para movimientos futuros</button>}
    </div>}
    {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
  </section>;
}
