"use client";
import { useEffect, useState } from "react";
import { listPaymentComplementFollowup, refreshPaymentComplementFollowup, configurePaymentComplementAutomation, setComplementPaymentForm, type ComplementFollowup } from "@/services/paymentComplements";

const labels: Record<string, string> = { VOIDED: "Ya no aplica", NEEDS_FISCAL_DATA: "Faltan datos fiscales", WAITING_IQ_APPLICATION: "Esperando confirmación de aplicación IQ", PENDING_PROVIDER_CONTRACT: "Pendiente de solicitud al proveedor", REQUESTED: "Solicitado / esperando archivo", RECEIVED: "Recibido", QUEUED: "En cola", PAUSED: "Pausado por compuerta", PREPARING: "Validando", SENDING: "Enviando", BLOCKED: "Requiere datos o revisión", UNKNOWN: "Resultado incierto · no reenviar", ISSUED_PENDING_FILES: "Emitido · faltan archivos" };
export default function PaymentComplementFollowup() {
  const [rows, setRows] = useState<ComplementFollowup[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [truncated, setTruncated] = useState(false);
  const [automation, setAutomation] = useState({ iqEnabled: false, iqLookupEnabled: false, facturamaEnabled: false });
  async function load() { const result = await listPaymentComplementFollowup(); setRows(result.rows); setTruncated(result.truncated); setAutomation(result.automation); }
  async function configure(key: "iqEnabled" | "facturamaEnabled") {
    const next = { ...automation, [key]: !automation[key] };
    const prompt = key === "iqEnabled"
      ? next[key] ? "¿Activar nuevas solicitudes de REP a IQ? La consulta de REP existentes tiene una compuerta independiente. No se enviará el histórico." : "¿Pausar nuevas solicitudes de REP a IQ? La consulta de REP existentes puede continuar si sus compuertas lo permiten."
      : next[key] ? "¿Activar emisión Facturama para aplicaciones PPD nuevas? Puede emitir CFDI reales. No se enviará el histórico." : "¿Pausar nuevas emisiones Facturama?";
    if (!window.confirm(prompt)) return;
    setBusy(true);
    try { await configurePaymentComplementAutomation({ ...next, confirmation: "AUTORIZO_REP_AUTOMATICO" }); await load(); } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }
  async function setForm(id: string, value: string) {
    if (!value || !window.confirm("Confirma que esta es la forma del pago recibido. Se revalidará el complemento para emitirlo.")) return;
    setBusy(true); try { await setComplementPaymentForm(id, value); await load(); setMessage("Forma guardada. El complemento se revalidará automáticamente."); } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }
  useEffect(() => { void load().catch(e => setMessage(e.message || "No se pudieron consultar los complementos.")); }, []);
  async function refresh() {
    setBusy(true); setMessage("Revisando aplicaciones; no se envían solicitudes a IQ.");
    try { let cursor: string | undefined; let complete = false; let processed = 0;
      while (!complete) { const result = await refreshPaymentComplementFollowup(cursor); processed += result.processed; complete = result.complete; cursor = result.cursor || undefined; setMessage(`${processed} aplicaciones revisadas. No se han emitido complementos.`); }
      await load();
    } catch (e: any) { setMessage(e.message || "No se pudo actualizar el seguimiento."); } finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-white/10 bg-slate-900 p-4 text-slate-200">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Complementos de pago · seguimiento actual</h2><button disabled={busy} onClick={() => void refresh()} className="rounded-lg border border-sky-400/40 px-3 py-2 text-sm text-sky-300 disabled:opacity-50">{busy ? "Revisando…" : "Revisar aplicaciones e histórico"}</button></div>
    <p className="my-3 text-xs text-amber-200">IQ consulta REP existentes: {automation.iqLookupEnabled ? "habilitada por configuración" : "pausada"}; cada consulta también exige Master, perfil y permisos vigentes. La solicitud de REP tiene otra compuerta. Revisión diaria a las 19:00 (Ciudad de México), con aviso tras 7 días. El histórico no se envía automáticamente.</p>
    <div className="mb-3 flex gap-3 text-xs">{(["iqEnabled", "facturamaEnabled"] as const).map(key => <button key={key} disabled={busy} onClick={() => void configure(key)} className="rounded border border-sky-400/40 px-3 py-2">{key === "iqEnabled" ? "IQ · nuevas solicitudes" : "Facturama"}: {automation[key] ? "activo · pausar" : "pausado · activar"}</button>)}</div>
    {message && <p role="status" className="mb-3 text-sm">{message}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Solicitud", "Pago", "Aplicación", "Parcialidad", "Importe", "Proveedor", "Estado"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>
      {!rows.length && <tr><td colSpan={7} className="p-3 text-slate-400">Sin seguimientos registrados. Revisa el histórico para incluir aplicaciones anteriores.</td></tr>}
      {rows.map(row => <tr key={row.id} className="border-t border-white/10"><td className="p-2">{row.solicitudFolio}</td><td className="p-2">{row.pagoFolio}</td><td className="p-2">{row.applicationFolio}</td><td className="p-2">{row.installment}</td><td className="p-2">{Number.isFinite(row.amountMinor) ? (row.amountMinor / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : "Sin importe"}</td><td className="p-2">{row.provider}</td><td className="p-2">{labels[row.automationStatus || row.status] || row.automationStatus || row.status}{row.automationGateReason && <div className="mt-1 text-sky-300">Hugo observó el caso, pero no puede actuar: {row.automationGateReason}</div>}{row.automationError && <div className="mt-1 text-amber-300">{row.automationError === "REP_PAYMENT_FORM_REQUIRED" ? "Falta la forma SAT del pago recibido" : row.automationError}</div>}{row.automationError === "REP_PAYMENT_FORM_REQUIRED" && <select aria-label={`Forma de pago ${row.applicationFolio}`} value="" disabled={busy} onChange={e => void setForm(row.id, e.target.value)} className="mt-2 rounded bg-slate-800 p-2"><option value="">Seleccionar forma real…</option><option value="01">01 Efectivo</option><option value="02">02 Cheque nominativo</option><option value="03">03 Transferencia</option><option value="04">04 Tarjeta de crédito</option><option value="28">28 Tarjeta de débito</option><option value="29">29 Tarjeta de servicios</option></select>}</td></tr>)}
    </tbody></table></div>{truncated && <p className="mt-2 text-xs text-amber-200">Se muestran los 100 seguimientos más recientes; no es el historial completo.</p>}
  </section>;
}
