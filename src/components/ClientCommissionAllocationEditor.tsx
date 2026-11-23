"use client";
import { useState } from "react";

export type CommissionAccountOption = { id: string; bankName: string; masked: string; selectable: boolean; reason: string | null };
export type ClientAllocationRow = { accountId: string; pointsBps?: number | null; earningsPercentBps?: number | null };
type Props = {
  accounts: CommissionAccountOption[];
  initialRows?: ClientAllocationRow[];
  onDraftChange?: (rows: ClientAllocationRow[]) => void;
};
/** UI-only editor. Persistence and financial execution must be supplied by validated server callables. */
export default function ClientCommissionAllocationEditor({ accounts, initialRows = [], onDraftChange }: Props) {
  const [rows, setRows] = useState<ClientAllocationRow[]>(initialRows);
  function update(next: ClientAllocationRow[]) { setRows(next); onDraftChange?.(next); }
  return <section className="space-y-3 rounded-xl border border-white/10 p-4">
    <h4 className="text-sm font-semibold">Cuentas para distribuir comisiones</h4>
    <p className="text-xs text-slate-400">Las cuentas se registran en el perfil del usuario. Sólo las verificadas en IQ pueden utilizarse. Una columna por fila; no se muestran estimaciones en pesos.</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
      <thead><tr className="text-left text-slate-300"><th className="p-2">Cuenta del usuario</th><th className="p-2">Puntos</th><th className="p-2">% de comisión</th><th className="p-2">Acción</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index} className="border-t border-white/10">
        <td className="p-2"><select aria-label={`Cuenta destino ${index + 1}`} className="w-full rounded-lg bg-slate-950 p-2" value={row.accountId} onChange={event => update(rows.map((r, i) => i === index ? { ...r, accountId: event.target.value } : r))}><option value="">Seleccionar cuenta</option>{accounts.map(a => <option key={a.id} value={a.id} disabled={!a.selectable}>{a.bankName} {a.masked}{a.selectable ? "" : " · Pendiente IQ"}</option>)}</select></td>
        <td className="p-2"><input aria-label={`Puntos ${index + 1}`} className="w-24 rounded-lg bg-slate-950 p-2" type="number" min="0" step="0.01" value={row.pointsBps == null ? "" : row.pointsBps / 100} onChange={event => update(rows.map((r, i) => i === index ? { ...r, pointsBps: event.target.value === "" ? null : Math.round(Number(event.target.value) * 100), earningsPercentBps: null } : r))}/></td>
        <td className="p-2"><input aria-label={`Porcentaje de comisión ${index + 1}`} className="w-24 rounded-lg bg-slate-950 p-2" type="number" min="0" max="100" step="0.01" value={row.earningsPercentBps == null ? "" : row.earningsPercentBps / 100} onChange={event => update(rows.map((r, i) => i === index ? { ...r, earningsPercentBps: event.target.value === "" ? null : Math.round(Number(event.target.value) * 100), pointsBps: null } : r))}/></td>
        <td className="p-2"><button type="button" className="text-rose-300" onClick={() => update(rows.filter((_, i) => i !== index))}>Quitar</button></td>
      </tr>)}</tbody>
    </table></div>
    <button type="button" disabled={rows.length >= 50} className="rounded-lg border border-white/10 px-3 py-2 text-sm disabled:opacity-40" onClick={() => update([...rows, { accountId: "", pointsBps: null, earningsPercentBps: null }])}>Agregar fila</button>
    <p className="text-xs text-amber-200">Editor en preparación: guardar o activar requiere validación del servidor. No ejecuta dispersiones.</p>
  </section>;
}
