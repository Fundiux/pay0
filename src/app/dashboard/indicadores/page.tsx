"use client";

import { useCallback, useEffect, useState } from "react";
import NoAccess from "@/components/NoAccess";
import { useUserProfile } from "@/lib/useUserProfile";
import { isSuperAdmin, normalizeRole } from "@/lib/roles";
import { getBusinessIndicators, type BusinessIndicators } from "@/services/businessIndicators";

const MX_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });
const money = (value: number, currency = "MXN") => new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(value);
const monthRange = (offset: number) => {
  const today = MX_DAY.format(new Date());
  const [year, month] = today.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1)), last = new Date(Date.UTC(year, month + offset, 0));
  const lastDay = last.toISOString().slice(0, 10);
  return { desde: first.toISOString().slice(0, 10), hasta: offset === 0 && today < lastDay ? today : lastDay };
};

function Tile({ title, value, hint, color = "#38bdf8" }: { title: string; value: string; hint: string; color?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#161d2b] px-5 py-4 shadow-xl" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="text-[12px] uppercase tracking-widest" style={{ color }}>{title}</div>
      <div className="mt-2 text-[24px] tabular-nums text-white">{value}</div>
      <div className="mt-2 text-[11px] leading-4 text-slate-500">{hint}</div>
    </div>
  );
}

export default function IndicadoresPage() {
  const { profile, loading: loadingProfile } = useUserProfile();
  const allowed = isSuperAdmin(normalizeRole((profile as any)?.role));
  const [period, setPeriod] = useState(() => monthRange(0));
  const [data, setData] = useState<BusinessIndicators | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (next: { desde: string; hasta: string }) => {
    setLoading(true); setError("");
    try { setData(await getBusinessIndicators(next)); }
    catch (cause) { setData(null); setError(cause instanceof Error && cause.message ? cause.message : "No se pudieron cargar los indicadores."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (allowed) void load(period); }, [allowed, period, load]);

  if (loadingProfile) return null;
  if (!allowed) return <NoAccess message="Los indicadores de negocio son solo para el superadministrador." />;

  const sums = (record: Record<string, number>) => Object.entries(record).map(([currency, value]) => money(value, currency)).join(" · ") || money(0);
  const pending = data?.pendientes;
  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl text-white">Indicadores de negocio</h1>
          <p className="mt-1 max-w-2xl text-[12px] text-slate-400">Cifras del periodo elegido. No incluyen facturas con CFDI cancelado ni pagos o solicitudes cancelados o rechazados.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-[12px] text-slate-300">
          <label className="grid gap-1">Desde<input type="date" value={period.desde} max={period.hasta} onChange={event => event.target.value && setPeriod({ ...period, desde: event.target.value })} className="rounded border border-white/10 bg-[#161d2b] px-2 py-1" /></label>
          <label className="grid gap-1">Hasta<input type="date" value={period.hasta} min={period.desde} onChange={event => event.target.value && setPeriod({ ...period, hasta: event.target.value })} className="rounded border border-white/10 bg-[#161d2b] px-2 py-1" /></label>
          <button type="button" onClick={() => setPeriod(monthRange(0))} className="rounded border border-white/10 px-3 py-1 hover:bg-white/5">Mes actual</button>
          <button type="button" onClick={() => setPeriod(monthRange(-1))} className="rounded border border-white/10 px-3 py-1 hover:bg-white/5">Mes anterior</button>
        </div>
      </div>

      {error && <div role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-[12px] text-red-200">{error}</div>}
      {loading && <div className="mt-6 text-[12px] text-slate-400">Cargando indicadores...</div>}
      {data && !loading && (
        <>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Tile title="Total de pagos" value={String(data.pagos.total)} hint={`Suma: ${sums(data.pagos.montoPorMoneda)}. Pagos recibidos en el periodo.`} />
            <Tile title="Total de solicitudes" value={String(data.solicitudes.total)} hint={`${data.solicitudes.conFactura} con factura vigente y ${data.solicitudes.sinFactura} sin factura todavía. ${data.solicitudes.facturasCanceladasExcluidas} con CFDI cancelado quedaron fuera.`} />
            <Tile title="Facturas con pago aplicado" value={String(data.relacionadas.conPagoAplicado)} hint={`Facturas que ya tienen algún pago aplicado. Sin pago aplicado: ${data.relacionadas.sinPagoAplicado}.`} color="#34d399" />
            <Tile title="Facturas PPD pendientes" value={String(pending?.PPD.facturas ?? 0)} hint={`Saldo por cobrar: ${money(pending?.PPD.monto ?? 0)}. Se liquidan después de facturar.`} color="#fbbf24" />
            <Tile title="Facturas PUE pendientes" value={String(pending?.PUE.facturas ?? 0)} hint={`Saldo por cobrar: ${money(pending?.PUE.monto ?? 0)}. Deberían estar pagadas al facturar.`} color="#fb923c" />
            {!!pending?.SIN_TIPO.facturas && <Tile title="Pendientes sin tipo PPD/PUE" value={String(pending.SIN_TIPO.facturas)} hint={`Saldo por cobrar: ${money(pending.SIN_TIPO.monto)}. Falta capturar su tipo de factura.`} color="#f87171" />}
            <Tile title="Cliente con más facturas pendientes" value={data.clienteConMasPendientes?.cliente || "Ninguno"}
              hint={data.clienteConMasPendientes ? `${data.clienteConMasPendientes.facturas} facturas pendientes por ${money(data.clienteConMasPendientes.monto)}.` : "No hay facturas pendientes en el periodo."} color="#f87171" />
            <Tile title="Mejor cliente por utilidad" value={data.mejorClientePorUtilidad?.cliente || "Sin datos"}
              hint={data.mejorClientePorUtilidad ? `Utilidad bruta: ${money(data.mejorClientePorUtilidad.utilidad)} en ${data.mejorClientePorUtilidad.operaciones} operaciones. Es utilidad bruta (comisión menos costo del despacho) y solo de pagos conciliados.` : "No hay utilidad registrada en el periodo."} color="#34d399" />
          </div>
          {data.advertencias.map(text => <div key={text} className="mt-3 text-[11px] text-amber-300">{text}</div>)}
          <p className="mt-6 max-w-3xl text-[11px] leading-5 text-slate-500">
            Las facturas pendientes son las emitidas en el periodo que aún tienen saldo. Los montos en pesos no suman facturas en otra moneda. Tiempos de atención y costo por servir se agregarán cuando estén definidos.
          </p>
        </>
      )}
    </div>
  );
}
