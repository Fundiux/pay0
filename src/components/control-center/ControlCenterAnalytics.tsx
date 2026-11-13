"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getControlCenterAnalytics, getControlCenterEvidence, initializeControlCenterAnalytics, recognizeControlCenterExpense, reverseControlCenterExpense, ControlAnalytics, ControlEvidence } from "@/services/controlCenter";

const currency = (n: number) => (n / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const panel = "rounded-xl border border-white/10 bg-[#111827] p-4";
const input = "rounded-lg border border-white/15 bg-[#070d1d] px-3 py-2 text-sm";
const labels: Record<string, string> = { companyId: "Empresa", clientId: "Cliente", userId: "Usuario", despachoId: "Despacho", bankId: "Banco", status: "Estado", operationTypeKey: "Tipo de operación", destinationAccountId: "Cuenta destino" };
const metrics = [
  ["paymentsRegisteredMinor", "Pagos registrados", "/pagos", true],
  ["appliedMinor", "Pagos aplicados", "/pagos", true],
  ["commissionRootMinor", "Comisiones de la raíz", "/wallet", true],
  ["expensesMinor", "Gastos reconocidos", "/materialidad", true],
  ["invoicedMinor", "CFDI vigentes (importe)", "/facturacion", true],
  ["requestsOpen", "Solicitudes del periodo abiertas", "/solicitudes", false],
  ["invoicesIssued", "CFDI emitidos vigentes", "/facturacion", false],
  ["filesComplete", "Expedientes completos", "/materialidad", false],
  ["hugoProposals", "Propuestas de Hugo", "/hugo", false],
  ["hugoRules", "Reglas confirmadas vigentes", "/hugo", false],
] as const;

export default function ControlCenterAnalytics({ from, to, refreshVersion = 0 }: { from: Date; to: Date; refreshVersion?: number }) {
  const start = dayKey(from), end = dayKey(to);
  const [data, setData] = useState<ControlAnalytics | null>(null);
  const [evidence, setEvidence] = useState<ControlEvidence | null>(null);
  const [dimension, setDimension] = useState(""); const [value, setValue] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState("");
  const generation = useRef(0), alive = useRef(true);
  const [uploadId, setUploadId] = useState(""); const [expense, setExpense] = useState(""); const [note, setNote] = useState("");
  const [expenseId, setExpenseId] = useState(""); const [expenseMessage, setExpenseMessage] = useState("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const load = useCallback(async () => {
    const current = ++generation.current; setError(""); setData(null);
    if (dimension && !value) return;
    try {
      const [result, events] = await Promise.all([getControlCenterAnalytics({ from: start, to: end, dimension, value }), getControlCenterEvidence()]);
      if (alive.current && current === generation.current) { setData(result); setEvidence(events); }
    } catch (e: any) { if (alive.current && current === generation.current) setError(e.message || "No se pudieron cargar las métricas."); }
  }, [start, end, dimension, value, refreshVersion]);
  useEffect(() => { void load(); }, [load]);
  async function initialize() {
    setBusy(true); setError("");
    try {
      let complete = false;
      while (!complete && alive.current) {
        const result = await initializeControlCenterAnalytics(); complete = result.complete;
        setProgress(`${result.processed || 0} registros procesados · ${result.source || "Finalizado"}`);
      }
      if (alive.current) await load();
    } catch (e: any) { setError(e.message || "La consolidación no terminó; puedes reanudarla."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function saveExpense(reverse = false) {
    setBusy(true); setExpenseMessage("");
    try {
      if (reverse) { await reverseControlCenterExpense({ id: expenseId, reason: note }); setExpenseMessage("Reconocimiento revertido. La evidencia se conserva."); }
      else { const saved = await recognizeControlCenterExpense({ uploadId, amountMinor: Math.round(Number(expense) * 100), note, confirmed: true }); setExpenseId(saved.id); setExpenseMessage(`Gasto reconocido: ${saved.id}. Las métricas se actualizan por evento.`); }
      await load();
    } catch (e: any) { setExpenseMessage(e.message); } finally { setBusy(false); }
  }
  const series = data?.daily || [], max = Math.max(1, ...series.flatMap(d => [d.metrics.paymentsRegisteredMinor || 0, d.metrics.expensesMinor || 0]));
  const points = (key: string) => series.map((d, i) => `${series.length <= 1 ? 300 : i * 600 / (series.length - 1)},${150 - (d.metrics[key] || 0) * 140 / max}`).join(" ");
  return <div className="space-y-4">
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Control financiero conectado</h2><p className="text-xs text-slate-400">{start} al {end} · Fechas operativas de México · Los filtros superiores controlan este panel.</p></div><button className={input} onClick={() => void load()} disabled={busy}>Actualizar</button></div>
      <div className="mt-3 flex flex-wrap gap-2"><select aria-label="Dimensión analítica" className={input} value={dimension} onChange={e => { setDimension(e.target.value); setValue(""); }}><option value="">Todo mi ámbito</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{dimension && <select aria-label="Valor del filtro" className={input} value={value} onChange={e => setValue(e.target.value)}><option value="">Selecciona {labels[dimension]}</option>{evidence?.facets.filter(f => f.dimension === dimension).map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select>}</div>
      {evidence?.facetsTruncated && <p className="mt-2 text-xs text-amber-300">Catálogo de filtros parcial: se muestran los primeros 500 valores.</p>}
      {error && <p role="alert" className="mt-3 text-rose-300">{error}</p>}
      {data && !data.coverage.complete && <div className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200"><p>Histórico todavía incompleto. No interpretes estos valores como totales definitivos.</p><button className={`${input} mt-2`} disabled={busy} onClick={() => void initialize()}>{busy ? "Consolidando…" : "Consolidar / reanudar histórico"}</button><p>{progress}</p></div>}
      {!data && !error && <p className="mt-3 text-sm text-slate-400">{dimension && !value ? "Selecciona un valor para consultar." : "Cargando indicadores…"}</p>}
    </section>
    {data && <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{metrics.map(([key, label, href, monetary]) => { const n = data.totals[key] || 0, previous = data.previous[key] || 0; return <Link className={panel} href={href} key={key}><p className="text-xs text-slate-400">{label}</p><p className="my-2 text-xl font-bold text-sky-300">{key === "invoicedMinor" && data.totals.invoicesMissingTotal ? "Importe incompleto" : monetary ? currency(n) : n}</p><p className="text-xs text-slate-500">Anterior: {monetary ? currency(previous) : previous} · {previous ? `${(((n - previous) / Math.abs(previous)) * 100).toFixed(1)}%` : "sin base comparativa"}</p></Link>; })}</section>
      <p className="text-xs text-amber-200">Pagos ≠ ingresos propios. Comisiones ≠ utilidad. La utilidad y los impuestos no se calculan mientras no exista cobertura contable validada de ingresos y gastos.</p>
      <section className={panel}><h3 className="font-bold">Pagos registrados y gastos reconocidos</h3><p className="text-xs text-slate-400">Comparación de movimientos; no representa flujo de caja neto ni utilidad.</p><svg viewBox="-10 -5 620 175" className="mt-3 h-44 w-full" role="img" aria-label="Serie diaria de pagos registrados en azul y gastos reconocidos en naranja"><line x1="0" x2="600" y1="150" y2="150" stroke="#475569" /><polyline points={points("paymentsRegisteredMinor")} fill="none" stroke="#38bdf8" strokeWidth="2" /><polyline points={points("expensesMinor")} fill="none" stroke="#fbbf24" strokeWidth="2" />{series.length === 1 && <circle cx="300" cy={150 - (series[0].metrics.paymentsRegisteredMinor || 0) * 140 / max} r="3" fill="#38bdf8" />}</svg><div className="flex justify-between text-xs text-slate-400"><span>{start}</span><span className="text-sky-300">Pagos</span><span className="text-amber-300">Gastos</span><span>{end}</span></div></section>
      <section className={panel}><h3 className="font-bold">Estado actual · independiente del periodo</h3><p className="my-2 text-sm">Wallet de clientes: {currency(data.current.clientWalletMinor)} · Adelantos pendientes: {currency(data.current.advancePendingMinor)}</p><p className="text-sm">Recuperaciones en cola: {data.current.recoveryPending} · Requieren revisión: {data.current.recoveryBlocked}</p><p className="mt-2 text-xs text-slate-400">Respeta la dimensión seleccionada. Sin cuenta de empresa en la fuente, no se atribuye artificialmente el saldo a una empresa.</p></section>
      <section className={panel}><h3 className="font-bold">Integraciones · estado actual de trabajos registrados</h3><div className="mt-3 grid gap-3 md:grid-cols-3">{["iq", "whatsapp", "telegram"].map(name => <div key={name} className="rounded-lg border border-white/10 p-3"><p className="font-bold uppercase">{name}</p><p className="mt-1 text-xs text-slate-400">{data.current[`${name}Jobs`] ? `${data.current[`${name}Pending`] || 0} pendientes · ${data.current[`${name}Failed`] || 0} fallidos · ${data.current[`${name}Succeeded`] || 0} terminados` : "Sin telemetría indexada para este ámbito."}</p></div>)}</div><p className="mt-2 text-xs text-slate-500">Estos estados no son una prueba de disponibilidad del proveedor. No se realizan envíos ni sincronizaciones desde este panel.</p></section>
    </>}
    <section className={panel}><h3 className="font-bold">Incidencias actuales de mi ámbito · sin filtro de fechas</h3><p className="mt-1 text-xs text-slate-400">Borradores y expedientes se reconcilian con permisos vigentes. Los documentos que requieren regeneración permanecen para revisión; no se timbra ni se cancela automáticamente.</p>{evidence?.incidents.map(item => <div key={item.id} className="mt-2 border-t border-white/10 py-2 text-sm"><Link className="text-sky-300" href="/solicitudes">{item.solicitudId}</Link> · {item.kind} · {item.status}<p className="text-xs text-amber-200">{item.lastErrorCode}</p></div>)}{evidence && !evidence.incidents.length && <p className="mt-2 text-sm text-slate-400">Sin incidencias indexadas. Verifica primero la cobertura del histórico.</p>}{evidence?.incidentsTruncated && <p>Se muestran las 50 incidencias más recientes.</p>}</section>
    <details className={panel}><summary className="cursor-pointer font-bold">Reconocer gasto documentado · Superadmin</summary><p className="my-3 text-xs text-slate-400">Usa el ID de un documento de gasto activo. Un reconocimiento por operación evita duplicar PDF/XML. No realiza pagos ni determina deducibilidad fiscal.</p><div className="flex flex-wrap gap-2"><input className={input} placeholder="ID de documento de gasto" value={uploadId} onChange={e => setUploadId(e.target.value)} /><input className={input} type="number" min="0.01" step="0.01" placeholder="Importe MXN" value={expense} onChange={e => setExpense(e.target.value)} /><input className={input} placeholder="Motivo / referencia" value={note} onChange={e => setNote(e.target.value)} /><button className={input} disabled={busy || !uploadId || !expense || note.length < 5} onClick={() => void saveExpense()}>Confirmar reconocimiento</button></div><div className="mt-3 flex flex-wrap gap-2"><input className={input} placeholder="ID del reconocimiento a revertir" value={expenseId} onChange={e => setExpenseId(e.target.value)} /><button className={input} disabled={busy || !expenseId || note.length < 5} onClick={() => void saveExpense(true)}>Revertir con el motivo indicado</button></div><p role="status" className="mt-2 text-sm text-amber-200">{expenseMessage}</p></details>
    <details className={panel}><summary className="cursor-pointer font-bold">Trazabilidad analítica reciente · todo mi ámbito</summary><p className="my-2 text-xs text-slate-400">Últimas 30 revisiones procesadas. La fecha mostrada es la fecha de negocio, no la hora de indexación. No sustituye la auditoría operativa.</p>{evidence?.rows.map(row => <div key={row.id} className="border-t border-white/10 py-2 text-xs">{row.businessDate} · {row.source} · {row.entityId} · revisión {row.revision}</div>)}</details>
  </div>;
}
