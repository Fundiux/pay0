const REJECTION_MIN_AGE_MS = 60 * 60 * 1000;

const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

export type IqCancellationReconcileAction = "CONFIRM" | "KEEP" | "PROMOTE" | "REJECT" | "NOT_APPLIED";

// A row out of "Pendiente Cancelacion" that is not cancelled means IQ declined the
// request. An unknown attempt that never reached that state can be requested again.
export function iqCancellationReconcileAction(input: {
  cancellationStatus: unknown;
  operationStatus: unknown;
  requestedAtMs: number;
  now?: number;
}): IqCancellationReconcileAction {
  const operation = normalize(input.operationStatus);
  const requested = normalize(input.cancellationStatus) === "REQUESTED";
  if (/CANCELAD[AO]/.test(operation)) return "CONFIRM";
  if (/PENDIENTE.*CANCELACION/.test(operation)) return requested ? "KEEP" : "PROMOTE";
  if (!operation) return "KEEP";
  if (!requested) return "NOT_APPLIED";
  return (input.now ?? Date.now()) - input.requestedAtMs >= REJECTION_MIN_AGE_MS ? "REJECT" : "KEEP";
}
