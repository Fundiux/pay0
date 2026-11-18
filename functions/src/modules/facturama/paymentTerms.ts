// SAT rule (Anexo 20, CFDI 4.0): a PPD invoice (pago en parcialidades o diferido) must carry FormaPago "99" (por definir).
// The real form of payment is declared later in each payment complement. PUE keeps the form it was given.
export function satPaymentForm(paymentMethod: unknown, paymentForm: unknown): string {
  if (String(paymentMethod ?? "").trim().toUpperCase() === "PPD") return "99";
  return String(paymentForm ?? "").trim().slice(0, 2) || "03";
}
