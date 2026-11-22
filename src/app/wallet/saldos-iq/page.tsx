"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Scale } from "lucide-react";
import NoAccess from "@/components/NoAccess";
import WalletNavigation from "@/components/WalletNavigation";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { getIqBalanceComparison, type IqBalanceComparison, type IqBalanceRow } from "@/services/iqBalances";

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `$${Number(value).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  MATCH: { label: "Coincide", className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300" },
  DIFFERENT: { label: "Diferencia", className: "border-rose-400/30 bg-rose-500/10 text-rose-300" },
  UNMAPPED: { label: "Sin cliente PAY0", className: "border-amber-400/30 bg-amber-500/10 text-amber-300" },
};

const REASON_LABEL: Record<string, string> = {
  NO_PAY0_CLIENT: "El cliente de IQ no está vinculado a ningún cliente de PAY0.",
  OTHER_PARTNER: "El cliente de PAY0 está vinculado con otro socio en IQ.",
  MULTIPLE_PAY0_CLIENTS: "Varios clientes de PAY0 apuntan al mismo cliente de IQ.",
  IQ_ROW_MISSING: "Tiene saldo en PAY0 pero IQ no reporta saldo para este cliente.",
  IQ_BALANCE_UNREADABLE: "IQ envió un saldo que no se pudo leer.",
};

const EXPLANATION_LABEL: Record<string, string> = {
  SKIPPED_LIMIT: "Detalle no consultado: se revisan primero las diferencias más grandes.",
  FAILED: "No se pudo obtener el detalle de IQ para este cliente.",
  IQ_UNAVAILABLE: "IQ no estuvo disponible para consultar el detalle.",
};

const clientLabel = (row: IqBalanceRow) => `${row.clientNumber ? `C${row.clientNumber} · ` : ""}${row.clientName || "Cliente sin nombre"}`;
const dateTime = (millis: number | null) => (millis ? new Date(millis).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function SaldosIqPage() {
  const { profile } = useUserProfile();
  const { canAccess } = useModuleAccess(profile, "wallet", "saldos");
  const [ownerId, setOwnerId] = useState("");
  const [data, setData] = useState<IqBalanceComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"ALL" | "DIFFERENT" | "UNMAPPED" | "MATCH">("DIFFERENT");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!canAccess) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    getIqBalanceComparison(ownerId || undefined)
      .then(result => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setError("No se pudo cargar la comparación de saldos."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canAccess, ownerId]);

  if (!canAccess) return <NoAccess className="p-6 text-slate-400" message="No tienes acceso a los saldos de Wallet." />;

  const rows = (data?.rows || []).filter(row => filter === "ALL" || row.status === filter);
  const counts = data?.run?.counts;

  return (
    <div className="mx-auto w-full min-w-0 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex items-center gap-2">
          <Scale size={18} className="text-sky-400" aria-hidden="true" />
          <h1 className="text-sm font-semibold uppercase tracking-widest text-white">Saldos IQ vs PAY0</h1>
        </div>
        {data?.isSuperadmin && (
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Socio
            <select value={ownerId} onChange={event => setOwnerId(event.target.value)} className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-sky-400">
              <option value="">Todos</option>
              {data.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.label}</option>)}
            </select>
          </label>
        )}
      </header>

      <section className="mb-4 rounded-2xl border border-white/10 bg-[#161d2b] p-4">
        {data?.run ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
            <span>Última revisión: <strong className="text-white">{dateTime(data.run.ranAt)}</strong></span>
            {!data.run.complete && <span className="text-amber-300">Revisión parcial: un grupo de IQ no se pudo leer.</span>}
            <span>Tolerancia: $0.01</span>
          </div>
        ) : (
          <p className="text-xs text-slate-400">{loading ? "Cargando…" : "Aún no hay una revisión nocturna. Se ejecuta automáticamente de lunes a sábado a las 21:00."}</p>
        )}
        {counts && (
          <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Filtrar por estado">
            {([["DIFFERENT", "Con diferencia", counts.different], ["UNMAPPED", "Sin cliente PAY0", counts.unmapped], ["MATCH", "Coinciden", counts.match], ["ALL", "Todos", counts.different + counts.unmapped + counts.match]] as const).map(([key, label, value]) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${filter === key ? "bg-sky-500 text-slate-950" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>
                {label} <span className="ml-1 opacity-80">{value}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {error && <p className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</p>}

      {data?.run && (
        <section className="overflow-x-auto rounded-2xl border border-white/10 bg-[#161d2b]">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500">
              <tr className="border-b border-white/5">
                <th className="px-4 py-3">Cliente</th>
                {data.isSuperadmin && <th className="px-4 py-3">Socio</th>}
                <th className="px-4 py-3 text-right">Saldo IQ</th>
                <th className="px-4 py-3 text-right">Saldo PAY0</th>
                <th className="px-4 py-3 text-right">Diferencia</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={data.isSuperadmin ? 6 : 5} className="px-4 py-6 text-center text-slate-500">{loading ? "Cargando…" : "Sin registros en este filtro."}</td></tr>
              )}
              {rows.map(row => {
                const expandable = row.status !== "MATCH";
                const expanded = open === row.rowKey;
                const status = STATUS_LABEL[row.status] || STATUS_LABEL.DIFFERENT;
                return (
                  <React.Fragment key={row.rowKey}>
                    <tr className={`border-b border-white/5 ${expandable ? "cursor-pointer hover:bg-white/[0.03]" : ""}`} onClick={() => expandable && setOpen(expanded ? null : row.rowKey)}>
                      <td className="px-4 py-3 text-white">
                        <span className="inline-flex items-center gap-1.5">
                          {expandable ? (expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />) : <span className="w-[14px]" />}
                          {clientLabel(row)}
                        </span>
                      </td>
                      {data.isSuperadmin && <td className="px-4 py-3 text-slate-300">{row.ownerLabel || "—"}</td>}
                      <td className="px-4 py-3 text-right font-mono text-slate-200">{money(row.iqBalance)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-200">{money(row.pay0Balance)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${row.status === "DIFFERENT" ? "text-rose-300" : "text-slate-400"}`}>{money(row.difference)}</td>
                      <td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>{status.label}</span></td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-white/5 bg-black/20">
                        <td colSpan={data.isSuperadmin ? 6 : 5} className="px-6 py-4"><RowDetail row={row} /></td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <WalletNavigation />
    </div>
  );
}

function RowDetail({ row }: { row: IqBalanceRow }) {
  const notes: string[] = [];
  if (row.reason && REASON_LABEL[row.reason]) notes.push(REASON_LABEL[row.reason]);
  if (row.signInverted) notes.push("Los saldos tienen el mismo monto con signo contrario; puede ser una diferencia de convención de signo.");
  if (row.partnerOwnerMismatch) notes.push("El socio de IQ no coincide con el socio del cliente en PAY0.");
  if (row.explanationStatus && EXPLANATION_LABEL[row.explanationStatus]) notes.push(EXPLANATION_LABEL[row.explanationStatus]);
  const explanation = row.explanation;
  return (
    <div className="space-y-3 text-xs text-slate-300">
      {row.partners.length > 0 && (
        <p className="text-slate-400">Saldo en IQ por socio: {row.partners.map(partner => `${partner.name || "Sin socio"} ${money(partner.balance)}`).join(" · ")}{row.sources.length ? ` (${row.sources.join(", ")})` : ""}</p>
      )}
      {notes.map(note => <p key={note} className="text-amber-200">{note}</p>)}
      {explanation && (
        <div className="space-y-3">
          <p className="text-slate-400">
            Mes {explanation.month}: saldo anterior en IQ {money(explanation.previousBalance)}, abonos {money(explanation.totalCredits)}, cargos {money(explanation.totalCharges)}.
            {" "}{explanation.iqMovements} movimientos en IQ y {explanation.pay0Movements} en PAY0 este mes.
          </p>
          {explanation.unexplainedIqCount === 0 && explanation.unmatchedPay0Count === 0 && (
            <p className="text-slate-400">Los movimientos del mes coinciden; la diferencia viene de meses anteriores.</p>
          )}
          {explanation.unexplainedIq.length > 0 && (
            <MovementList title={`En IQ sin registro en PAY0 (${explanation.unexplainedIqCount})`}
              items={explanation.unexplainedIq.map(item => ({ day: item.day, label: item.concept || "Sin concepto", amount: item.credit ? item.credit : -item.charge }))} />
          )}
          {explanation.unmatchedPay0.length > 0 && (
            <MovementList title={`En PAY0 sin registro en IQ (${explanation.unmatchedPay0Count})`}
              items={explanation.unmatchedPay0.map(item => ({ day: item.day, label: [item.folio, item.concept].filter(Boolean).join(" · ") || "Movimiento", amount: item.direction === "IN" ? item.amount : -item.amount }))} />
          )}
        </div>
      )}
    </div>
  );
}

function MovementList({ title, items }: { title: string; items: Array<{ day: string; label: string; amount: number }> }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
      <ul className="divide-y divide-white/5 rounded-xl border border-white/5">
        {items.map((item, index) => (
          <li key={`${item.day}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="text-slate-400">{item.day || "—"}</span>
            <span className="flex-1 truncate text-slate-200">{item.label}</span>
            <span className={`font-mono ${item.amount >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(item.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
