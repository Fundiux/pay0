"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { getInvoicePaymentControl, type InvoicePaymentControlResult } from "@/services/facturama";

const money = (value: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value || 0));
const count = (value: number) => value.toLocaleString("es-MX");

function Tile({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "neutral" }) {
  const toneClass = tone === "warn" ? "border-amber-500/30 text-amber-200" : tone === "ok" ? "border-emerald-500/30 text-emerald-200" : "border-slate-700 text-slate-100";
  return (
    <div className={`rounded-xl border bg-slate-950/60 p-4 ${toneClass}`}>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export function InvoicePaymentControl() {
  const [result, setResult] = useState<InvoicePaymentControlResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function review() {
    setLoading(true);
    setError("");
    try {
      setResult(await getInvoicePaymentControl());
    } catch (e: any) {
      setError(`No se pudo generar el control: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  const clean = result && result.summary.facturaSinPago === 0 && result.summary.pagoSinFactura === 0 && result.summary.pagoEnSolicitudInactiva === 0;

  return (
    <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Control factura ↔ pago</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Cruza las solicitudes con factura emitida contra los pagos aplicados a esas mismas solicitudes, en ambos sentidos. Es solo lectura.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void review()}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 px-3 py-2 text-xs font-medium text-emerald-200 disabled:opacity-40"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {loading ? "Revisando..." : result ? "Volver a revisar" : "Revisar control"}
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}

      {result && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Factura sin pago" value={count(result.summary.facturaSinPago)} tone={result.summary.facturaSinPago ? "warn" : "ok"} />
            <Tile label="Pago sin factura" value={count(result.summary.pagoSinFactura)} tone={result.summary.pagoSinFactura ? "warn" : "ok"} />
            <Tile label="Monto pagado sin factura" value={money(result.summary.montoPagadoSinFactura)} tone={result.summary.montoPagadoSinFactura ? "warn" : "ok"} />
            <Tile label="Pagos sin aplicar" value={count(result.summary.pagosSinAplicacion)} tone={result.summary.pagosSinAplicacion ? "warn" : "neutral"} />
            <Tile label="Pagos en solicitud inactiva" value={count(result.summary.pagoEnSolicitudInactiva)} tone={result.summary.pagoEnSolicitudInactiva ? "warn" : "ok"} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {count(result.summary.solicitudesActivas)} solicitudes activas · {count(result.summary.solicitudesConFactura)} con factura emitida · {count(result.summary.solicitudesConPagoAplicado)} con pago aplicado
            {result.summary.facturasSandboxIgnoradas ? ` · ${count(result.summary.facturasSandboxIgnoradas)} facturas de sandbox ignoradas` : ""}
            {result.truncated ? " · Revisión truncada: hay más registros que el límite de lectura." : ""}
          </p>

          {clean && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              <CheckCircle2 size={16} /> Sin excepciones: cada factura emitida tiene pago aplicado y cada pago aplicado tiene factura.
            </div>
          )}

          {result.facturaSinPago.length > 0 && (
            <div className="mt-5">
              <h3 className="flex items-center gap-2 font-medium text-white"><AlertTriangle size={16} className="text-amber-400" /> Facturas emitidas sin pago aplicado</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-[640px] w-full text-left text-sm">
                  <thead className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-400">
                    <tr><th className="p-2">Solicitud</th><th className="p-2">Estatus</th><th className="p-2">Origen factura</th><th className="p-2">UUID</th></tr>
                  </thead>
                  <tbody>
                    {result.facturaSinPago.map(row => (
                      <tr key={row.solicitudId} className="border-b border-slate-800/80">
                        <td className="p-2 text-slate-100">{row.solicitudFolio || row.solicitudId}</td>
                        <td className="p-2 text-slate-300">{row.status || "—"}</td>
                        <td className="p-2 text-slate-300">{row.facturaSource === "SOLICITUD" ? "Solicitud (IQ)" : "Facturama"}</td>
                        <td className="p-2 break-all text-xs text-slate-400">{row.facturaUuid || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.pagoSinFactura.length > 0 && (
            <div className="mt-5">
              <h3 className="flex items-center gap-2 font-medium text-white"><AlertTriangle size={16} className="text-amber-400" /> Pagos aplicados a solicitudes sin factura</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-[640px] w-full text-left text-sm">
                  <thead className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-400">
                    <tr><th className="p-2">Pago</th><th className="p-2">Solicitud</th><th className="p-2 text-right">Monto aplicado</th></tr>
                  </thead>
                  <tbody>
                    {result.pagoSinFactura.map(row => (
                      <tr key={row.applicationId} className="border-b border-slate-800/80">
                        <td className="p-2 text-slate-100">{row.pagoFolio || row.pagoId}</td>
                        <td className="p-2 text-slate-300">{row.solicitudFolio || row.solicitudId}</td>
                        <td className="p-2 text-right text-slate-100">{money(row.montoAplicado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.pagoEnSolicitudInactiva.length > 0 && (
            <div className="mt-5">
              <h3 className="flex items-center gap-2 font-medium text-white"><AlertTriangle size={16} className="text-amber-400" /> Pagos aplicados a solicitudes canceladas, rechazadas o inexistentes</h3>
              <p className="mt-1 text-xs text-slate-400">El dinero sigue aplicado a una solicitud que ya no está activa; revisar si debe revertirse.</p>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-[640px] w-full text-left text-sm">
                  <thead className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-400">
                    <tr><th className="p-2">Pago</th><th className="p-2">Solicitud</th><th className="p-2">Estatus solicitud</th><th className="p-2 text-right">Monto aplicado</th></tr>
                  </thead>
                  <tbody>
                    {result.pagoEnSolicitudInactiva.map(row => (
                      <tr key={row.applicationId} className="border-b border-slate-800/80">
                        <td className="p-2 text-slate-100">{row.pagoFolio || row.pagoId}</td>
                        <td className="p-2 text-slate-300">{row.solicitudFolio || row.solicitudId}</td>
                        <td className="p-2 text-slate-300">{row.solicitudStatus || "—"}</td>
                        <td className="p-2 text-right text-slate-100">{money(row.montoAplicado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.pagosSinAplicacion.length > 0 && (
            <div className="mt-5">
              <h3 className="font-medium text-white">Pagos activos sin aplicar a ninguna solicitud</h3>
              <p className="mt-1 text-xs text-slate-400">Estos pagos no tienen factura porque aún no están ligados a una solicitud.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {result.pagosSinAplicacion.map(row => (
                  <span key={row.pagoId} className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">{row.pagoFolio || row.pagoId}{row.status ? ` · ${row.status}` : ""}</span>
                ))}
              </div>
            </div>
          )}

          {(result.summary.facturaSinPago > result.facturaSinPago.length || result.summary.pagoSinFactura > result.pagoSinFactura.length || result.summary.pagosSinAplicacion > result.pagosSinAplicacion.length || result.summary.pagoEnSolicitudInactiva > result.pagoEnSolicitudInactiva.length) && (
            <p className="mt-4 text-xs text-slate-500">Se muestran las primeras {count(result.listedLimit)} filas de cada lista; los totales son completos.</p>
          )}
        </>
      )}
    </section>
  );
}
