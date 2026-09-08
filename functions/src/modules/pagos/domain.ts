export const PAGO_STATUSES = [
  "REGISTRADO", "CONCILIACION_PENDIENTE", "CONCILIADO", "APLICADO_PARCIAL",
  "APLICADO_TOTAL", "RECHAZADO", "CANCELADO",
] as const;
export type PagoStatus = typeof PAGO_STATUSES[number];
const STATUS_SET = new Set<string>(PAGO_STATUSES);
const STATUS_ALIASES: Record<string, PagoStatus> = {
  REGISTRO: "REGISTRADO", PENDIENTE: "CONCILIACION_PENDIENTE", CONCILIACION: "CONCILIACION_PENDIENTE",
  "CONCILIACION PENDIENTE": "CONCILIACION_PENDIENTE", CONCILIADA: "CONCILIADO",
  "APLICADO PARCIAL": "APLICADO_PARCIAL", "APLICADO TOTAL": "APLICADO_TOTAL",
  RECHAZADA: "RECHAZADO", CANCELADA: "CANCELADO",
};
const TRANSITIONS: Record<PagoStatus, readonly PagoStatus[]> = {
  REGISTRADO: ["CONCILIACION_PENDIENTE", "CANCELADO"],
  CONCILIACION_PENDIENTE: ["CONCILIADO", "RECHAZADO", "CANCELADO"],
  CONCILIADO: [], APLICADO_PARCIAL: [], APLICADO_TOTAL: [], RECHAZADO: [], CANCELADO: [],
};
export function normalizePagoStatus(value: unknown): PagoStatus {
  const raw=String(value??"").trim().toUpperCase();
  const normalized=STATUS_ALIASES[raw]||raw;
  return STATUS_SET.has(normalized)?normalized as PagoStatus:"REGISTRADO";
}
export function canTransitionPagoStatus(current: unknown,next: unknown): boolean {
  const from=normalizePagoStatus(current),to=normalizePagoStatus(next);
  return from===to||TRANSITIONS[from].includes(to);
}
export function isPagoTerminalStatus(value: unknown): boolean {
  return ["RECHAZADO","CANCELADO","APLICADO_TOTAL"].includes(normalizePagoStatus(value));
}
