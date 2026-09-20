"use client";
import { useEffect, useState } from "react";
import { listPaymentComplementFollowup, refreshPaymentComplementFollowup, type ComplementFollowup } from "@/services/paymentComplements";

const labels: Record<string, string> = { VOIDED: "Ya no aplica", NEEDS_FISCAL_DATA: "Faltan datos fiscales", WAITING_IQ_APPLICATION: "Esperando confirmación de aplicación IQ", PENDING_PROVIDER_CONTRACT: "Pendiente de solicitud al proveedor", REQUESTED: "Solicitado", RECEIVED: "Recibido" };
export default function PaymentComplementFollowup() {
  const [rows, setRows] = useState<ComplementFollowup[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [truncated, setTruncated] = useState(false);
  async function load() { const result = await listPaymentComplementFollowup(); setRows(result.rows); setTruncated(result.truncated); }
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
    <p className="my-3 text-xs text-amber-200">La solicitud y descarga automática en IQ todavía no están conectadas. Esta tabla registra lo pendiente, no confirma emisión ni recepción. Es seguimiento actual de todo tu ámbito, sin filtro de fechas.</p>
    {message && <p role="status" className="mb-3 text-sm">{message}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Solicitud", "Pago", "Aplicación", "Parcialidad", "Importe", "Proveedor", "Estado"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>
      {!rows.length && <tr><td colSpan={7} className="p-3 text-slate-400">Sin seguimientos registrados. Revisa el histórico para incluir aplicaciones anteriores.</td></tr>}
      {rows.map(row => <tr key={row.id} className="border-t border-white/10"><td className="p-2">{row.solicitudFolio}</td><td className="p-2">{row.pagoFolio}</td><td className="p-2">{row.applicationFolio}</td><td className="p-2">{row.installment}</td><td className="p-2">{Number.isFinite(row.amountMinor) ? (row.amountMinor / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : "Sin importe"}</td><td className="p-2">{row.provider}</td><td className="p-2">{labels[row.status] || row.status}</td></tr>)}
    </tbody></table></div>{truncated && <p className="mt-2 text-xs text-amber-200">Se muestran los 100 seguimientos más recientes; no es el historial completo.</p>}
  </section>;
}
