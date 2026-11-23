/** Resolve IQ origin strictly from the immutable posted-payment snapshot.
 * A mutable payment-level despacho cannot override the recorded financial origin.
 * Return null for missing, cross-client or contradictory evidence.
 */
export function postedClientIqOrigin(input: {
  rootId: string; clientId: string; paymentId: string; payment: any; snapshot: any;
}): string | null {
  const { rootId, clientId, paymentId, payment, snapshot } = input;
  if (!rootId || !clientId || !paymentId || !payment || !snapshot ||
      payment.rootId !== rootId || snapshot.rootId !== rootId ||
      String(payment.clienteId || payment.clientId || "") !== clientId ||
      snapshot.clienteId !== clientId || snapshot.pagoId !== paymentId ||
      String(snapshot.currency || payment.moneda || "MXN").toUpperCase() !== "MXN") return null;
  const despachoId = String(snapshot.despachoId || "").trim();
  const paymentDespachoId = String(payment.despachoId || "").trim();
  return despachoId && (!paymentDespachoId || paymentDespachoId === despachoId) ? despachoId : null;
}

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

/**
 * Structural IQ account proof shared by client-cost preview, publication and activation.
 * The caller must ALSO check the verifiedAt freshness with evaluateIqLink.
 * A match by only the last 4 digits is never evidence of an exact IQ account.
 */
export function hasExactPersonalCommissionIqLink(input: {
  rootId: string; clientId: string; ownerUid: string; accountId: string;
  clientIqId: string; despachoId: string; account: any; link: any;
}): boolean {
  const { rootId, clientId, ownerUid, accountId, clientIqId, despachoId, account, link } = input;
  if (!rootId || !clientId || !ownerUid || !accountId || !clientIqId || !despachoId ||
      !account || !link || account.active !== true || account.rootId !== rootId ||
      account.ownerUid !== ownerUid || !account.instrumentFingerprint ||
      !/^\d{4}$/.test(String(account.last4 || ""))) return false;
  return link.iqLinkStatus === "VERIFIED" && link.iqFullDigitsMatched === true &&
    link.rootId === rootId && link.clientId === clientId &&
    link.ownerUid === ownerUid && link.accountId === accountId &&
    link.accountFingerprint === account.instrumentFingerprint && link.last4 === account.last4 &&
    String(link.iqClientId || "") === clientIqId && String(link.despachoId || "") === despachoId &&
    [link.iqPartnerId, link.iqBeneficiaryId, link.iqAccountId].every(value =>
      /^[1-9]\d*$/.test(String(value ?? "")) && Number.isSafeInteger(Number(value))) &&
    Boolean(link.iqCredentialProfileId);
}

/** Require the full published account and IQ identity for historical snapshots.
 * Callers must additionally enforce 24h IQ verification freshness.
 */
export function hasExactPublishedPersonalCommissionDestination(input: {
  rootId: string; clientId: string; ownerUid: string; accountId: string;
  clientIqId: string; despachoId: string; account: any; link: any; published: any;
}): boolean {
  const { accountId, account, link, published, clientIqId, despachoId } = input;
  if (!hasExactPersonalCommissionIqLink(input) || !published) return false;
  return published.accountId === accountId &&
    published.fingerprint === account.instrumentFingerprint &&
    published.last4 === account.last4 &&
    String(published.iqClientId || "") === clientIqId &&
    String(published.despachoId || "") === despachoId &&
    String(published.iqPartnerId || "") === String(link.iqPartnerId) &&
    String(published.iqBeneficiaryId || "") === String(link.iqBeneficiaryId) &&
    String(published.iqAccountId || "") === String(link.iqAccountId) &&
    String(published.iqCredentialProfileId || "") === String(link.iqCredentialProfileId) &&
    Boolean(published.methodId && published.beneficiaryId);
}
