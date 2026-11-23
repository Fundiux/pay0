"use client";
import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

type Account = { id: string; bankName: string; beneficiaryName: string; instrumentType: "CLABE" | "CARD"; instrumentNumber: string; active: boolean; iqLinkStatus: string };
const inputStyle = "w-full rounded-lg border border-white/10 bg-slate-950 p-2 text-sm";
export default function PersonalCommissionAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bankName, setBankName] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [instrumentType, setInstrumentType] = useState<"CLABE" | "CARD">("CLABE");
  const [instrumentNumber, setInstrumentNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const result = await httpsCallable<{}, { accounts: Account[] }>(functions, "listPersonalCommissionAccounts")({});
    const listed = result.data.accounts || [];
    if (!listed.length) { setAccounts([]); return; }
    try {
      const response = await httpsCallable<{ accountIds: string[] },
        { accounts: Array<{ accountId: string; instrumentNumber: string }> }>(
        functions, "revealPersonalCommissionAccountNumber",
      )({ accountIds: listed.map(account => account.id) });
      const full = new Map(response.data.accounts.map(account => [account.accountId, account.instrumentNumber]));
      setAccounts(listed.map(account => ({ ...account, instrumentNumber: full.get(account.id) || account.instrumentNumber })));
    } catch {
      setAccounts(listed);
      setMessage("No se pueden mostrar los números completos. Verifica la clave de cifrado configurada en el servidor.");
    }
  }
  useEffect(() => { void refresh().catch(() => setMessage("No fue posible consultar tus cuentas.")); }, []);
  async function addAccount() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      await httpsCallable(functions, "createPersonalCommissionAccount")({ bankName, bankCode, beneficiaryName, instrumentType, instrumentNumber });
      setInstrumentNumber(""); setBankCode("");
      await refresh();
      setMessage("Cuenta registrada. Queda pendiente de validación IQ antes de poder dispersar.");
    } catch (error: any) { setMessage(error?.message || "No se pudo registrar la cuenta."); }
    finally { setBusy(false); }
  }
  async function deactivate(accountId: string) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      await httpsCallable(functions, "deactivatePersonalCommissionAccount")({ accountId });
      await refresh();
      setMessage("Cuenta desactivada. El historial se conserva.");
    } catch (error: any) { setMessage(error?.message || "No se pudo desactivar la cuenta."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-white/10 p-4">
    <h3 className="font-semibold">Mis cuentas para comisiones</h3>
    <p className="text-xs text-slate-400">Registra tus cuentas para que puedan seleccionarse desde los costos de tus clientes. Las nuevas cuentas requieren verificación IQ.</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[550px] text-sm"><thead><tr className="text-left"><th className="p-2">Banco</th><th className="p-2">Beneficiario</th><th className="p-2">CLABE o tarjeta</th><th className="p-2">Estado IQ</th><th className="p-2">Acción</th></tr></thead><tbody>{accounts.map(a => <tr key={a.id} className="border-t border-white/10"><td className="p-2">{a.bankName}</td><td className="p-2">{a.beneficiaryName}</td><td className="p-2 font-mono"><span>{a.instrumentNumber}</span></td><td className="p-2">{a.iqLinkStatus === "VERIFIED" ? "Verificada" : "Pendiente de validación"}</td><td className="p-2">{a.active ? <button type="button" disabled={busy} className="text-rose-300 disabled:opacity-40" onClick={() => void deactivate(a.id)}>Desactivar</button> : "Inactiva"}</td></tr>)}</tbody></table></div>
    <div className="grid gap-2 md:grid-cols-2"><label className="text-xs">Banco<input className={inputStyle} value={bankName} onChange={e => setBankName(e.target.value)} /></label><label className="text-xs">Código de banco (3 dígitos){instrumentType === "CARD" ? " · requerido para tarjeta" : " · se obtiene de la CLABE"}<input className={inputStyle} inputMode="numeric" maxLength={3} value={bankCode} onChange={e => setBankCode(e.target.value.replace(/\D/g, ""))} placeholder="Ej. 012"/></label><label className="text-xs">Beneficiario<input className={inputStyle} value={beneficiaryName} onChange={e => setBeneficiaryName(e.target.value)} /></label><label className="text-xs">Tipo<select className={inputStyle} value={instrumentType} onChange={e => { setInstrumentType(e.target.value as "CLABE" | "CARD"); setInstrumentNumber(""); }}><option value="CLABE">CLABE</option><option value="CARD">Tarjeta</option></select></label><label className="text-xs">Número completo<input className={inputStyle} inputMode="numeric" autoComplete="off" value={instrumentNumber} onChange={e => setInstrumentNumber(e.target.value)} /></label></div>
    <button type="button" disabled={busy || !bankName.trim() || !beneficiaryName.trim() || !instrumentNumber.trim() || (instrumentType === "CARD" && !/^\d{3}$/.test(bankCode))} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold disabled:opacity-40" onClick={() => void addAccount()}>{busy ? "Guardando…" : "Agregar cuenta"}</button>
    {message && <p role="status" className="text-sm text-amber-200">{message}</p>}
  </section>;
}
