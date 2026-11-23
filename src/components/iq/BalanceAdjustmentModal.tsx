"use client";

import { useRef, useState } from "react";
import { adjustClientBalanceFromComparison, type IqBalanceRow } from "@/services/iqBalances";

const MIN_REASON = 15;
const MAX_REASON = 500;

const money = (value: number) => `$${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Exceptional adjustment that brings a client's PAY0 balance to its IQ balance. Superadmin only, for the migration:
 * the typed reason is mandatory and goes to the internal log together with the superadmin's name.
 */
export default function BalanceAdjustmentModal({ row, onClose, onDone }: { row: IqBalanceRow; onClose: () => void; onDone: () => void }) {
  const iq = row.iqBalance ?? 0;
  const pay0 = row.pay0Balance ?? 0;
  const difference = Math.round((iq - pay0) * 100) / 100;
  const [amount, setAmount] = useState(Math.abs(difference).toFixed(2));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // One key per opened window: a repeated click or a retry applies the adjustment once.
  const idempotencyKey = useRef(`adj-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())}`);

  const numeric = Number(amount);
  const amountOk = Number.isFinite(numeric) && numeric > 0 && numeric <= Math.abs(difference) + 0.005 && Math.abs(numeric * 100 - Math.round(numeric * 100)) < 1e-6;
  const reasonOk = reason.trim().length >= MIN_REASON;
  const direction = difference > 0 ? "abono" : "cargo";

  async function apply() {
    if (!amountOk || !reasonOk || saving) return;
    const confirmed = window.confirm(
      `Se registrará un ${direction} de ${money(numeric)} a ${row.clientName}, que cambia su saldo en PAY0 de ${money(pay0)} a ${money(difference > 0 ? pay0 + numeric : pay0 - numeric)}. Queda en el registro con tu nombre y el motivo escrito. ¿Aplicar el ajuste?`
    );
    if (!confirmed) return;
    setSaving(true);
    setError("");
    try {
      await adjustClientBalanceFromComparison({ rowKey: row.rowKey, amount: numeric, reason: reason.trim(), idempotencyKey: idempotencyKey.current });
      onDone();
    } catch (e: any) {
      setError(e?.message || "No se pudo aplicar el ajuste.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-label="Ajuste excepcional de saldo">
      <div className="w-full max-w-lg space-y-4 rounded-2xl border border-white/10 bg-[#161d2b] p-5">
        <div>
          <h2 className="text-sm font-semibold text-white">Ajuste excepcional de saldo</h2>
          <p className="mt-1 text-xs text-slate-400">{row.clientName}</p>
        </div>

        <dl className="grid grid-cols-3 gap-3 text-xs">
          <div><dt className="text-slate-500">Saldo IQ</dt><dd className="font-mono text-slate-200">{money(iq)}</dd></div>
          <div><dt className="text-slate-500">Saldo PAY0</dt><dd className="font-mono text-slate-200">{money(pay0)}</dd></div>
          <div><dt className="text-slate-500">Falta ({direction})</dt><dd className="font-mono text-amber-200">{money(Math.abs(difference))}</dd></div>
        </dl>

        <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          Úsalo solo cuando el sistema todavía no pudo registrar la operación que explica la diferencia. Es un ajuste manual de migración: queda en el registro con tu nombre y el motivo que escribas.
        </p>

        <label className="block text-xs text-slate-300">
          Monto a {direction === "abono" ? "abonar" : "cargar"}
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none focus:border-sky-400/40"
          />
          {!amountOk && amount !== "" && <span className="mt-1 block text-[11px] text-rose-300">Debe ser mayor que cero, con dos decimales y no mayor que {money(Math.abs(difference))}.</span>}
        </label>

        <label className="block text-xs text-slate-300">
          Motivo (obligatorio)
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, MAX_REASON))}
            rows={4}
            placeholder="Por qué se ajusta, por ejemplo: depósito registrado en IQ antes de que PAY0 pudiera recibirlo."
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/40"
          />
          <span className={`mt-1 block text-[11px] ${reasonOk ? "text-slate-500" : "text-amber-300"}`}>
            {reasonOk ? `${reason.trim().length} caracteres` : `Escribe al menos ${MIN_REASON} caracteres.`}
          </span>
        </label>

        {error && <p className="text-xs text-rose-300">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 disabled:opacity-40">Cancelar</button>
          <button type="button" onClick={apply} disabled={!amountOk || !reasonOk || saving} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {saving ? "Aplicando..." : "Aplicar ajuste"}
          </button>
        </div>
      </div>
    </div>
  );
}
