import { BALANCE_TOLERANCE, round2 } from "./domain";

/**
 * Exceptional balance adjustment to match PAY0 to IQ (owner decision 2026-11-23): temporary, only for the migration
 * period in which the system was not ready to register some operations, only by the superadmin, always with a
 * written reason. These are the pure rules; the callable adds authentication, the on/off switch and the writes.
 */
export const MIN_REASON_LENGTH = 15;
export const MAX_REASON_LENGTH = 500;

export class AdjustmentRuleError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export type AdjustmentPlan = { direction: "IN" | "OUT"; amount: number; difference: number };

/**
 * `difference` is IQ minus PAY0: positive means IQ has more, so PAY0 receives an IN; negative means PAY0 has more, so
 * PAY0 gets an OUT. The adjustment may bring PAY0 to IQ but never beyond it.
 */
export function planBalanceAdjustment(input: { iqBalance: unknown; pay0Balance: unknown; amount: unknown }): AdjustmentPlan {
  const iq = typeof input.iqBalance === "number" && Number.isFinite(input.iqBalance) ? round2(input.iqBalance) : null;
  const pay0 = typeof input.pay0Balance === "number" && Number.isFinite(input.pay0Balance) ? round2(input.pay0Balance) : null;
  if (iq === null || pay0 === null) throw new AdjustmentRuleError("BALANCE_UNREADABLE", "No hay un saldo legible de IQ y de PAY0 para este cliente.");
  const difference = round2(iq - pay0);
  if (Math.abs(difference) <= BALANCE_TOLERANCE) throw new AdjustmentRuleError("NO_DIFFERENCE", "El saldo de este cliente ya coincide con IQ.");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    throw new AdjustmentRuleError("INVALID_AMOUNT", "El monto del ajuste debe ser mayor que cero y con dos decimales como máximo.");
  }
  if (amount > Math.abs(difference) + 0.005) throw new AdjustmentRuleError("AMOUNT_EXCEEDS_DIFFERENCE", "El ajuste no puede ser mayor que la diferencia con IQ.");
  return { direction: difference > 0 ? "IN" : "OUT", amount: round2(amount), difference };
}

export function cleanReason(value: unknown): string {
  const reason = String(value ?? "").replace(/\s+/g, " ").trim();
  if (reason.length < MIN_REASON_LENGTH) throw new AdjustmentRuleError("REASON_TOO_SHORT", `Escribe el motivo del ajuste (mínimo ${MIN_REASON_LENGTH} caracteres).`);
  if (reason.length > MAX_REASON_LENGTH) throw new AdjustmentRuleError("REASON_TOO_LONG", `El motivo no puede pasar de ${MAX_REASON_LENGTH} caracteres.`);
  return reason;
}

/** The internal comment kept in the log: what was done, why the superadmin allowed it, and the typed reason. */
export function adjustmentLogComment(input: { actorName: string; clientName: string; direction: "IN" | "OUT"; amount: number; before: number; after: number; iqBalance: number; reason: string }): string {
  const money = (value: number) => `$${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `Ajuste excepcional de saldo (${input.direction === "IN" ? "abono" : "cargo"} de ${money(input.amount)}) a ${input.clientName || "un cliente"}: de ${money(input.before)} a ${money(input.after)}, para igualar el saldo de IQ (${money(input.iqBalance)}). `
    + `Autorizado por el superadmin ${input.actorName}: el sistema todavía no estaba listo para registrar esta operación, por lo que se permite este ajuste manual por única vez durante la migración. Motivo: ${input.reason}`;
}
