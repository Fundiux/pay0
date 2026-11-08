"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decidePagoSinSolicitud, listPagosSinSolicitud,
  type PagoSinSolicitudDecisionOption, type PagoSinSolicitudRow,
} from "@/services/pagosSinSolicitud";

const OPTIONS: { value: PagoSinSolicitudDecisionOption; label: string; hint: string }[] = [
  { value: "FACTURAR_PUE", label: "Facturar como PUE", hint: "Solo registra la decisión; no se factura automáticamente." },
  { value: "ESPERAR_FACTURA", label: "Esperar factura (pago anticipado)", hint: "El pago queda como saldo libre hasta que llegue su factura." },
  { value: "APLICAR_A_FACTURA_EXISTENTE", label: "Aplicar a factura existente", hint: "Solo registra la decisión; la aplicación se hace por el flujo normal de aplicación de pagos." },
  { value: "DEVOLVER", label: "Devolver al cliente", hint: "Solo registra la decisión; no mueve dinero." },
];
const optionLabel = (value: string) => OPTIONS.find(option => option.value === value)?.label || value;
const money = (value: number, currency: string) => {
  try { return new Intl.NumberFormat("es-MX", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "MXN" }).format(value); }
  catch { return `$${value.toFixed(2)}`; }
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" }) : "");

function PagoRow({ row, onSaved }: { row: PagoSinSolicitudRow; onSaved: () => void }) {
  const [option, setOption] = useState<PagoSinSolicitudDecisionOption>("ESPERAR_FACTURA");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The same request id is reused when the same decision is retried, so a retry never records twice.
  const requestIds = useRef(new Map<string, string>());
  const save = async () => {
    const key = `${option}|${note.trim()}`;
    if (!requestIds.current.has(key)) requestIds.current.set(key, crypto.randomUUID().replace(/-/g, ""));
    setSaving(true); setError("");
    try {
      await decidePagoSinSolicitud({ pagoId: row.pagoId, option, note: note.trim(), requestId: requestIds.current.get(key)! });
      setNote(""); onSaved();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "No se pudo registrar la decisión.");
    } finally { setSaving(false); }
  };
  const hint = OPTIONS.find(item => item.value === option)?.hint;
  return (
    <li className="rounded-xl border border-white/10 bg-black/20 p-3 text-[12px] text-slate-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-mono text-sky-400">{row.folio}</span>
          <span className="ml-2 text-white">{row.clienteNombre}</span>
        </div>
        <div className="font-mono text-emerald-300">{money(row.monto, row.moneda)} · {row.fecha}</div>
      </div>
      {row.case === "B" && <div className="mt-1 text-[11px] text-slate-400">
        {row.pendingCount > 0 ? `El cliente tiene ${row.pendingCount} factura(s) pendiente(s); ninguna coincide con este pago.` : "El cliente tiene demasiadas solicitudes para comprobar sus facturas pendientes."}
      </div>}
      {row.latestDecision && <div className="mt-2 inline-block rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
        Decisión: {optionLabel(row.latestDecision.option)} · {row.latestDecision.decidedByName} · {when(row.latestDecision.decidedAt)}
        {row.latestDecision.note ? ` · ${row.latestDecision.note}` : ""}
      </div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select aria-label="Decisión para el pago" value={option} onChange={event => setOption(event.target.value as PagoSinSolicitudDecisionOption)} disabled={saving}
          className="rounded border border-white/10 bg-[#161d2b] px-2 py-1 text-[12px]">
          {OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <input aria-label="Nota de la decisión" value={note} maxLength={500} onChange={event => setNote(event.target.value)} disabled={saving} placeholder="Nota (opcional)"
          className="min-w-[12rem] flex-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-[12px] text-slate-100 outline-none" />
        <button type="button" onClick={save} disabled={saving}
          className="rounded-lg border border-[#0063C4]/60 bg-[#0063C4]/20 px-3 py-1 text-[12px] text-white disabled:opacity-50">
          {saving ? "Guardando..." : row.latestDecision ? "Cambiar decisión" : "Registrar decisión"}
        </button>
      </div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
      {error && <div role="alert" className="mt-1 text-[11px] text-red-300">{error}</div>}
    </li>
  );
}

function Section({ title, empty, rows, onSaved }: { title: string; empty: string; rows: PagoSinSolicitudRow[]; onSaved: () => void }) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] text-white">{title} <span className="text-slate-400">({rows.length})</span></h3>
      {rows.length ? <ul className="space-y-2">{rows.map(row => <PagoRow key={row.pagoId} row={row} onSaved={onSaved} />)}</ul>
        : <div className="rounded-xl border border-white/10 bg-black/10 p-3 text-[12px] text-slate-500">{empty}</div>}
    </section>
  );
}

export default function PagosSinSolicitudPanel() {
  const [rows, setRows] = useState<PagoSinSolicitudRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try { const result = await listPagosSinSolicitud(); setRows(result.rows); setTruncated(result.truncated); setError(""); }
    catch { setError("No se pudo cargar la lista de pagos sin solicitud."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // A panel with nothing to review stays out of the way.
  if (!loading && !error && rows.length === 0) return null;
  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-[#0b1220] p-4">
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex w-full items-center justify-between text-left text-[13px] text-white">
        <span>Pagos sin solicitud {loading ? "" : `(${rows.length})`}</span>
        <span className="text-[11px] text-slate-400">{open ? "Ocultar" : "Mostrar"}</span>
      </button>
      {open && <div className="mt-3 space-y-4">
        <p className="text-[11px] text-slate-400">Estos pagos no cuentan con solicitud aún. Decidir aquí solo deja constancia: no aplica el pago, no factura y no mueve dinero.</p>
        {error && <div role="alert" className="text-[12px] text-red-300">{error}</div>}
        <Section title="Pagos sin solicitud" empty="No hay pagos sin solicitud." rows={rows.filter(row => row.case === "A")} onSaved={load} />
        <Section title="Pagos que no coinciden con sus facturas pendientes" empty="No hay pagos de este tipo." rows={rows.filter(row => row.case === "B")} onSaved={load} />
        {truncated && <div className="text-[11px] text-amber-300">Se muestran los primeros 200 pagos.</div>}
      </div>}
    </div>
  );
}
