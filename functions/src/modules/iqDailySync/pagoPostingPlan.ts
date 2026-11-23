import { IQ_CANONICAL_TIME_ZONE, parseIqDateTimeMs } from "../iq/iqDateTime";

/**
 * Pure rules to post to the client's wallet a pago that was recovered from an IQ deposit (owner decisions 2026-11-22/23).
 * The amount the client receives is the one IQ itself computes on the deposit: the total minus the commission, where the
 * commission is the sale percentage of the total, or of the subtotal (total / 1.16) when the sale type is Subtotal. It is
 * the same formula PAY0 uses for its own pagos, and it reproduces IQ's net (200,000 at 2% of the subtotal is 196,551.72).
 * Nothing here reads or writes data.
 */

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const plain = (value: unknown) => text(value).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export type PagoPostingPlan = {
  grossAmount: number;
  currency: string;
  baseType: "TOTAL" | "SUBTOTAL";
  salePercentage: number;
  basePercentage: number;
  clientChargeAmount: number;
  clientNetAmount: number;
  operationType: string;
  originalIso: string;
};

export type PagoPostingDecision = { ok: true; plan: PagoPostingPlan } | { ok: false; code: string; detail: string };

function numeric(value: unknown): number | null {
  const raw = text(value).replace(/[$,%\s]/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The base the percentage applies to. Subtotal is the total without the 16% VAT. */
export function baseAmountFromGross(grossAmount: number, baseType: "TOTAL" | "SUBTOTAL"): number {
  return baseType === "SUBTOTAL" ? money(grossAmount / 1.16) : money(grossAmount);
}

/**
 * @param deposit the IQ deposit row (sum, currency, sale_type, sale_percentage, base_percentage, operation_type, conciliation_status, operation_status, created_at)
 * @param pago the PAY0 pago the P4 import created for it
 */
export function planPagoPosting(deposit: Record<string, unknown>, pago: Record<string, unknown>): PagoPostingDecision {
  const posting = plain(pago.financialPostingStatus);
  if (posting === "POSTED") return { ok: false, code: "PAGO_ALREADY_POSTED", detail: "El pago ya está registrado en la cartera." };
  if (!text(pago.clienteId || pago.clientId)) return { ok: false, code: "PAGO_CLIENT_MISSING", detail: "El pago no tiene un cliente de PAY0." };
  // The money has arrived whether the pago is only conciliated or already applied to invoices (partly or fully).
  if (!["CONCILIADO", "APLICADO_PARCIAL", "APLICADO_TOTAL"].includes(plain(pago.status))) return { ok: false, code: "PAGO_NOT_CONCILIATED", detail: "El pago todavía no está conciliado en PAY0." };

  // The deposit must be conciliated and alive in IQ: money is only credited once IQ itself says it arrived.
  if (!plain(deposit.conciliation_status).startsWith("CONCILIADO")) return { ok: false, code: "PAGO_NOT_CONCILIATED_IN_IQ", detail: "El depósito todavía no está conciliado en IQ; se abona cuando se concilie." };
  if (/RECHAZ|CANCEL|ELIMIN/.test(plain(deposit.operation_status))) return { ok: false, code: "PAGO_CANCELLED_IN_IQ", detail: "El depósito está rechazado o cancelado en IQ." };

  const gross = numeric(deposit.sum ?? deposit.amount ?? deposit.total);
  if (gross === null || gross <= 0) return { ok: false, code: "PAGO_AMOUNT_INVALID", detail: "IQ no entregó un monto legible del depósito." };
  const stored = numeric(pago.montoTotal ?? pago.monto);
  if (stored === null || money(stored) !== money(gross)) return { ok: false, code: "PAGO_AMOUNT_MISMATCH", detail: "El monto del pago en PAY0 no coincide con el del depósito en IQ." };

  const currency = plain(deposit.currency) || "MXN";
  if (plain(pago.moneda || pago.currency || "MXN") !== currency) return { ok: false, code: "PAGO_CURRENCY_MISMATCH", detail: "La moneda del pago en PAY0 no coincide con la del depósito en IQ." };

  const sale = numeric(deposit.sale_percentage);
  const base = numeric(deposit.base_percentage);
  if (sale === null || sale < 0 || sale > 100) return { ok: false, code: "PAGO_PERCENTAGE_INVALID", detail: "IQ no entregó un porcentaje de venta legible." };
  const baseType = plain(deposit.sale_type).includes("SUBTOTAL") ? "SUBTOTAL" : "TOTAL";

  const clientChargeAmount = money(baseAmountFromGross(gross, baseType) * (sale / 100));
  const clientNetAmount = money(gross - clientChargeAmount);
  if (clientNetAmount < 0) return { ok: false, code: "PAGO_NET_NEGATIVE", detail: "La comisión resulta mayor que el depósito." };

  const createdMs = parseIqDateTimeMs(text(deposit.created_at ?? deposit.createdAt), IQ_CANONICAL_TIME_ZONE);
  if (createdMs === null) return { ok: false, code: "PAGO_DATE_INVALID", detail: "IQ no entregó una fecha legible del depósito." };

  return {
    ok: true,
    plan: {
      grossAmount: money(gross), currency, baseType, salePercentage: sale, basePercentage: base ?? 0, clientChargeAmount, clientNetAmount,
      operationType: text(deposit.operation_type) || "SIN_TIPO", originalIso: new Date(createdMs).toISOString(),
    },
  };
}
