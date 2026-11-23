"use client";

import { useEffect, useState } from "react";
import { listIqDailySyncReviews, type IqPendingReview } from "@/services/iqDailySyncReviews";

const money = (value: number | null, currency: string | null) =>
  value === null ? "—" : `$${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency && currency !== "MXN" ? ` ${currency}` : ""}`;

const dateText = (value: string | null) => {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
};

/** Operations the daily IQ sync did not bring into PAY0, with who, how much, when and why, in plain language. */
export default function IqPendingReviews() {
  const [rows, setRows] = useState<IqPendingReview[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listIqDailySyncReviews()
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows || []);
        setTruncated(result.truncated === true);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudieron cargar los pendientes de IQ.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-[#161d2b]">
      <div className="border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-200">Pendientes de IQ por traer a PAY0</h2>
        <p className="mt-1 text-xs text-slate-400">
          Operaciones que se hicieron directamente en IQ y que el sistema no trajo por sí solo, con el motivo. El número es el que IQ muestra, para buscarla ahí.
        </p>
      </div>

      <div className="p-4">
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {!error && rows === null && <p className="text-sm text-slate-400">Cargando...</p>}
        {!error && rows !== null && rows.length === 0 && <p className="text-sm text-emerald-300">No hay pendientes.</p>}
        {rows !== null && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Socio</th>
                  <th className="px-3 py-2">Fecha en IQ</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2">N.º en IQ</th>
                  <th className="px-3 py-2">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.kind}-${row.iqNumber}-${index}`} className="border-b border-white/5 align-top">
                    <td className="px-3 py-2 text-slate-200">{row.kind}</td>
                    <td className="px-3 py-2 text-slate-200">
                      {row.clientName || <span className="text-slate-500">Sin dato aún</span>}
                      {row.rfc && <div className="text-[10px] text-slate-500">{row.rfc}</div>}
                      {row.beneficiaryName && <div className="text-[10px] text-slate-500">Para: {row.beneficiaryName}{row.bank ? ` · ${row.bank}` : ""}</div>}
                    </td>
                    <td className="px-3 py-2 text-slate-300">{row.partner}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-300">{dateText(row.date)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-slate-200">{money(row.amount, row.currency)}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-300">{row.iqNumber}</td>
                    <td className="px-3 py-2 text-slate-300">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {truncated && <p className="mt-2 text-xs text-amber-300">Se muestran los primeros 500 pendientes.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
