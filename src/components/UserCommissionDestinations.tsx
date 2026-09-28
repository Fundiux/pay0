"use client";
import { useEffect, useState } from "react";
import { cancelUserCommissionDispersion, executeUserCommissionDispersion, getMyCommissionSettings, previewMyCommissionDestinations, previewUserCommissionWithdrawal, requestUserCommissionDispersion, saveMyCommissionDestinations, type UserCommissionDestination, type UserCommissionMode, type UserCommissionSettings } from "@/services/commissions";

const inputClass = "rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm";
const money = (minor: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(minor / 100);
const statusLabel = (status?: string) => ({
  PREPARED: "Preparada", CALCULATED: "Calculada", RESERVED_AWAITING_EXECUTION: "Reservada para envío",
  PROCESSING: "En proceso", COMPLETED: "Enviada", CANCELLED: "Cancelada", CANCELLING: "Cancelación en proceso",
  UNCERTAIN: "Requiere conciliación", BLOCKED: "Requiere revisión", READY: "Lista", PENDING: "Pendiente",
  FAILED_SAFE: "Envío bloqueado", NOT_EXECUTED: "Sin enviar", RESERVED: "Reservada",
}[status || ""] || "Requiere revisión");
export default function UserCommissionDestinations() {
  const [settings, setSettings] = useState<UserCommissionSettings | null>(null), [clientId, setClientId] = useState("");
  const [mode, setMode] = useState<UserCommissionMode>("USER_EARNINGS_PERCENTAGE"), [destinations, setDestinations] = useState<UserCommissionDestination[]>([]);
  const [example, setExample] = useState("10000.00"), [preview, setPreview] = useState<Awaited<ReturnType<typeof previewMyCommissionDestinations>> | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [paymentId, setPaymentId] = useState("");
  const [withdrawalPreview, setWithdrawalPreview] = useState<Awaited<ReturnType<typeof previewUserCommissionWithdrawal>> | null>(null);
  const configuration = settings?.configurations.find(row => row.clientId === clientId);
  async function reload() { const result = await getMyCommissionSettings(); setSettings(result); setClientId(current => current || result.configurations[0]?.clientId || ""); }
  useEffect(() => { let live = true; getMyCommissionSettings().then(result => { if (live) { setSettings(result); setClientId(result.configurations[0]?.clientId || ""); } }).catch(error => { if (live) setMessage(error.message || "No se pudieron cargar tus destinos."); }); return () => { live = false; }; }, []);
  useEffect(() => { setMode(configuration?.rule?.distributionMode || "USER_EARNINGS_PERCENTAGE"); setDestinations(configuration?.rule?.destinations || []); setPreview(null); setPaymentId(""); setWithdrawalPreview(null); }, [configuration]);
  function update(rows: UserCommissionDestination[]) { setDestinations(rows); setPreview(null); }
  async function act(action: "preview" | "save" | "request" | "withdrawalPreview") {
    if (busy || !configuration) return;
    setBusy(true); setMessage("");
    try {
      if (action === "preview") setPreview(await previewMyCommissionDestinations({ clientId, distributionMode: mode, destinations, earnedMinor: Math.round(Number(example) * 100) }));
      else if (action === "save") { const result = await saveMyCommissionDestinations({ clientId, distributionMode: mode, destinations, expectedVersion: configuration.rule?.version || 0 }); await reload(); setMessage(`Destinos v${result.version} guardados. Aplican a nuevas utilidades; las calculadas conservan sus cuentas.`); }
      else if (action === "withdrawalPreview") setWithdrawalPreview(await previewUserCommissionWithdrawal(paymentId.trim(), clientId));
      else { if (!withdrawalPreview) return; const result = await requestUserCommissionDispersion({ paymentId: withdrawalPreview.paymentId, acceptTotalDebitMinor: withdrawalPreview.totalDebitMinor }); setMessage(result.status === "RESERVED_AWAITING_EXECUTION" ? "Utilidad reservada. Puedes enviarla o cancelar la reserva en Comisiones calculadas." : result.requestId ? `Solicitud: ${statusLabel(result.status)}.` : "El pago no tiene una configuración vigente al momento de generar la utilidad."); await reload(); }
    } catch (error: any) { setPreview(null); setWithdrawalPreview(null); setMessage(error.message || "No se pudo completar la operación."); }
    finally { setBusy(false); }
  }
  async function execute(requestId: string, cancel: boolean) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { const result = await (cancel ? cancelUserCommissionDispersion(requestId) : executeUserCommissionDispersion(requestId)); setMessage(result.status === "COMPLETED" ? "Envío registrado en IQ." : result.status === "CANCELLED" ? "Reserva cancelada y utilidad reintegrada." : "La operación requiere conciliación. El reintento permanece bloqueado para evitar duplicados."); await reload(); }
    catch (error: any) { setMessage(error.message || "La operación requiere revisión."); } finally { setBusy(false); }
  }
  const expected = mode === "CONTRACT_COMMISSION_POINTS" ? configuration?.contractRateBps || 0 : 10000;
  const assigned = destinations.reduce((sum, row) => sum + row.shareBps, 0);
  return <section className="space-y-4 rounded-2xl border border-white/10 bg-[#161d2b] p-5">
    <h2 className="text-lg font-semibold">Tus destinos de comisión</h2>
    <p className="text-sm text-slate-400">Cada cliente tiene su propia distribución. Tu comisión procede de la utilidad contabilizada; elegir cuentas no modifica cuánto ganas.</p>
    {!settings ? <p>Cargando…</p> : !settings.configurations.length ? <p className="text-sm text-amber-200">Aún no tienes clientes e instrumentos asignados para distribuir tu comisión. Solicita la asignación a Superadmin.</p> : <>
      <label className="block text-sm">Cliente que genera la comisión<select disabled={busy} className={`${inputClass} mt-1 w-full`} value={clientId} onChange={event => setClientId(event.target.value)}>{settings.configurations.map(row => <option key={row.clientId} value={row.clientId}>{row.clientName}</option>)}</select></label>
      {configuration && <fieldset disabled={busy || !configuration.active} className="space-y-4 disabled:opacity-60">
        <p className="text-sm">{configuration.contractRateBps ? `Comisión contractual de referencia: ${(configuration.contractRateBps / 100).toFixed(2)} puntos.` : "Este contrato no tiene puntos comparables; distribuye el dinero que ganaste."} {!configuration.active && "Asignación inactiva."}</p>
        <label className="block text-sm">Modalidad<select className={`${inputClass} mt-1 w-full`} value={mode} onChange={event => { setMode(event.target.value as UserCommissionMode); setPreview(null); }}><option value="USER_EARNINGS_PERCENTAGE">Distribuir el 100% de lo que gané</option><option disabled={!configuration.contractRateBps} value="CONTRACT_COMMISSION_POINTS">Distribuir mis puntos contractuales</option></select></label>
        {destinations.map((row, index) => <div key={index} className="flex flex-wrap items-center gap-2">
          <select aria-label={`Cuenta ${index + 1}`} className={`${inputClass} min-w-0 flex-1`} value={row.methodId} onChange={event => { const instrument = configuration.instruments.find(item => item.methodId === event.target.value); update(destinations.map((item, i) => i === index ? { ...item, methodId: instrument?.methodId || "", beneficiaryId: instrument?.beneficiaryId || "" } : item)); }}><option value="">Selecciona una cuenta</option>{configuration.instruments.map(instrument => <option key={instrument.methodId} value={instrument.methodId} disabled={!!instrument.blockedReason}>{instrument.beneficiaryName} · {instrument.bankName} {instrument.instrumentMasked}{instrument.blockedReason ? ` · ${instrument.iqLinkStatus}: requiere revisión` : ""}</option>)}</select>
          <input aria-label={`Participación de cuenta ${index + 1}`} type="number" min="0.01" step="0.01" className={`${inputClass} w-24`} value={row.shareBps / 100 || ""} onChange={event => update(destinations.map((item, i) => i === index ? { ...item, shareBps: Math.round(Number(event.target.value) * 100) } : item))} /><span className="text-xs">{mode === "CONTRACT_COMMISSION_POINTS" ? "puntos" : "%"}</span>
          <button type="button" className="text-sm text-rose-300" onClick={() => update(destinations.filter((_, i) => i !== index))}>Quitar</button>
        </div>)}
        <button type="button" disabled={destinations.length >= 50} className="rounded-lg border border-white/10 px-3 py-2 text-sm" onClick={() => update([...destinations, { methodId: "", beneficiaryId: "", shareBps: destinations.length ? 0 : expected }])}>Agregar cuenta</button>
        <p className={assigned === expected && destinations.length ? "text-sm text-emerald-300" : "text-sm text-amber-300"}>Asignado {(assigned / 100).toFixed(2)} de {(expected / 100).toFixed(2)} {mode === "CONTRACT_COMMISSION_POINTS" ? "puntos" : "%"}.</p>
        <label className="block text-sm">Comisión ganada de ejemplo (MXN)<input className={`${inputClass} ml-2 w-36`} type="number" min="0.01" step="0.01" value={example} onChange={event => { setExample(event.target.value); setPreview(null); }} /></label>
        <button type="button" className="rounded-lg border border-sky-400/40 px-3 py-2 text-sm text-sky-200" onClick={() => void act("preview")}>Previsualizar y validar cuentas</button>
        {preview && <div className="space-y-2 rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-3"><p className="text-xs text-slate-400">Ejemplo sobre {money(preview.earnedMinor)} de utilidad. Los centavos residuales se asignan por resto mayor y, en empate, por el orden de las cuentas.</p>{preview.destinations.map(row => <p key={row.methodId} className="text-sm">{row.beneficiaryName} · {row.instrumentMasked}: <strong>{money(row.amountMinor)}</strong></p>)}<button type="button" className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950" onClick={() => void act("save")}>Guardar esta distribución</button></div>}
        <div className="space-y-2 border-t border-white/10 pt-4"><h3 className="text-sm font-semibold">Solicitar mi comisión manualmente</h3><p className="text-xs text-slate-400">Para un pago posterior a tu configuración. Se utilizan los costos y la validación de Dispersiones, con cargo a tu utilidad del cliente.</p><input className={`${inputClass} w-full`} value={paymentId} onChange={event => { setPaymentId(event.target.value); setWithdrawalPreview(null); }} placeholder="Folio del pago que generó tu comisión" /><button type="button" disabled={!configuration.rule || !paymentId.trim()} className="rounded-lg border border-white/10 px-3 py-2 text-sm disabled:opacity-40" onClick={() => void act("withdrawalPreview")}>Revisar retiro y costos</button>{withdrawalPreview && <div className="rounded-lg border border-amber-300/20 p-3 text-sm"><p>Comisión a recibir: {money(withdrawalPreview.totalAmountMinor)}</p><p>Costos de dispersión: {money(withdrawalPreview.feeMinor)}</p><p>Total a descontar de tu utilidad: <strong>{money(withdrawalPreview.totalDebitMinor)}</strong></p><button type="button" onClick={() => void act("request")} className="mt-2 rounded-lg bg-sky-400 px-3 py-2 font-semibold text-slate-950">Aceptar costos y reservar</button></div>}</div>
      </fieldset>}
    </>}
    {!!settings?.history.length && <section className="space-y-2 border-t border-white/10 pt-4"><h3 className="font-medium">Comisiones calculadas</h3>{settings.history.filter(row => !clientId || row.clientId === clientId).map(row => <details key={row.distributionId} className="rounded-lg border border-white/10 p-3"><summary className="text-sm">{row.operationalDate} · {row.pay0Folio} · {money(row.totalAmountMinor)} · {statusLabel(row.requestStatus || row.status)}</summary><p className="mt-2 text-xs text-slate-400">Configuración v{row.ruleVersion}. {row.distributionMode === "CONTRACT_COMMISSION_POINTS" ? "Puntos contractuales" : "Porcentaje de lo ganado"}.</p>{row.legs.map((leg, index) => <p key={index} className="text-xs">{leg.beneficiaryName} {leg.instrumentMasked} · {money(leg.amountMinor)} · {leg.status}{leg.errorCode ? ` · ${leg.errorCode}` : ""}</p>)}{row.requestId && ["RESERVED_AWAITING_EXECUTION", "CANCELLING"].includes(row.requestStatus || "") && <div className="mt-3 flex flex-wrap gap-2"><p className="w-full text-sm">Total reservado con costos: {money(row.totalDebitMinor || row.totalAmountMinor)}</p>{row.requestStatus === "RESERVED_AWAITING_EXECUTION" && <button type="button" disabled={busy} className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950" onClick={() => void execute(row.requestId!, false)}>Enviar mi comisión</button>}<button type="button" disabled={busy} className="rounded-lg border border-white/10 px-3 py-2 text-sm" onClick={() => void execute(row.requestId!, true)}>Cancelar reserva</button></div>}</details>)}</section>}
    {message && <p role="status" className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm">{message}</p>}
  </section>;
}
