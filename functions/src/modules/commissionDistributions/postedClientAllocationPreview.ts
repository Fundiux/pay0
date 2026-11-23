/**
 * Derive a preview-only contractual basis from an immutable posted financial snapshot.
 * Never infer an amount from user input, a current client price, or a new ledger credit.
 * Where the snapshot does not record a comparable base, points mode fails closed.
 */
export function postedClientOperationBaseMinor(snapshot: any, calculationBaseType: string | null): number | null {
  const mode = String(calculationBaseType || "").toUpperCase();
  let amount: unknown;
  if (mode === "TOTAL") {
    amount = snapshot?.grossAmount;
  } else if (mode === "SUBTOTAL") {
    // baseAmount is recorded for the despacho's basis, not always the user's basis.
    if (String(snapshot?.assignmentSnapshot?.despachoCost?.calculationBaseType || "TOTAL").toUpperCase() !== "SUBTOTAL") return null;
    amount = snapshot?.baseAmount;
  } else {
    return null;
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}
