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
    Boolean(link.iqPartnerId) && Boolean(link.iqBeneficiaryId) &&
    Boolean(link.iqAccountId) && Boolean(link.iqCredentialProfileId);
}
