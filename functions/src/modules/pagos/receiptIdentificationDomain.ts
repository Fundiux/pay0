export type ReceiptSignals = {
  senderName?: string; beneficiaryName?: string; payerRfc?: string; beneficiaryRfc?: string;
  account?: string; destinationAccount?: string; amount?: number; date?: string;
  reference?: string; concept?: string; currency?: string; paymentForm?: string; time?: string; bankName?: string; identityConflict?: boolean;
  amountVerified?: boolean; executionConfirmed?: boolean; dateVerified?: boolean;
};
export type ReceiptCatalogItem = { id: string; [key: string]: any };
export type IdentityMatch = { status: "EXACT" | "REQUIRES_REVIEW"; id: string | null; reasons: string[]; evidence: string[]; candidateCount: number };
export const normalizeReceiptName = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9&]+/g, " ").trim().replace(/\s+/g, " ");
export const normalizeReceiptReference = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const rfc = (value: unknown) => String(value ?? "").toUpperCase().replace(/[\s.-]/g, "");
const validRfc = (value: string) => /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(value) && !/^XAXX|^XEXX/.test(value);
export function fullReceiptAccount(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^[\d\s-]+$/.test(raw)) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 18 ? digits : "";
}
const names = (item: ReceiptCatalogItem) => [item.name, item.nombre, item.razonSocial, item.businessName, item.legalName, item.commercialName, item.nombreComercial, item.displayName, item.companyName, item.clientName, item.alias, item.depositAlias].map(normalizeReceiptName).filter(Boolean);
const rfcs = (item: ReceiptCatalogItem) => [item.rfc, item.RFC, item.taxId, item.taxID].map(rfc).filter(validRfc);
const accounts = (item: ReceiptCatalogItem) => [item.clabe, item.CLABE, item.bankClabe, item.cuenta, item.account, item.accountNumber, ...(Array.isArray(item.depositClabes) ? item.depositClabes : [])].map(fullReceiptAccount).filter(Boolean);

/** No fuzzy scores or suffix account matches authorize a financial creation. */
export function matchReceiptIdentity(items: ReceiptCatalogItem[], signals: { name?: string; rfc?: string; account?: string }): IdentityMatch {
  const wantedName = normalizeReceiptName(signals.name), wantedRfc = rfc(signals.rfc), wantedAccount = fullReceiptAccount(signals.account);
  const strong = items.filter(item => item.active !== false && item.isActive !== false).map(item => {
    const itemRfcs = rfcs(item), itemAccounts = accounts(item);
    const rfcExact = validRfc(wantedRfc) && itemRfcs.includes(wantedRfc), accountExact = !!wantedAccount && itemAccounts.includes(wantedAccount);
    const nameExact = !!wantedName && names(item).includes(wantedName);
    const conflict = (validRfc(wantedRfc) && itemRfcs.length > 0 && !rfcExact) || (!!wantedAccount && itemAccounts.length > 0 && !accountExact);
    return { id: item.id, rfcExact, accountExact, nameExact, conflict };
  }).filter(item => item.rfcExact || item.accountExact);
  if (strong.some(item => item.conflict)) return { status: "REQUIRES_REVIEW", id: null, reasons: ["CONFLICTING_SIGNALS"], evidence: [], candidateCount: strong.length };
  if (strong.length > 1) return { status: "REQUIRES_REVIEW", id: null, reasons: ["MULTIPLE_CANDIDATES"], evidence: [], candidateCount: strong.length };
  const candidate = strong[0];
  if (!candidate) return { status: "REQUIRES_REVIEW", id: null, reasons: [wantedAccount || validRfc(wantedRfc) ? "NO_CANDIDATE" : "INSUFFICIENT_IDENTITY_SIGNALS"], evidence: [], candidateCount: 0 };
  const evidence = [candidate.rfcExact ? "RFC_EXACT" : "", candidate.accountExact ? "FULL_ACCOUNT_EXACT" : "", candidate.nameExact ? "NORMALIZED_NAME_EXACT" : ""].filter(Boolean);
  if (!candidate.nameExact && !(candidate.rfcExact && candidate.accountExact)) return { status: "REQUIRES_REVIEW", id: null, reasons: ["IDENTITY_NOT_CORROBORATED"], evidence, candidateCount: 1 };
  return { status: "EXACT", id: candidate.id, reasons: [], evidence, candidateCount: 1 };
}

export function receiptRegistrationReasons(receipt: ReceiptSignals, operationTypeKey: string) {
  const reasons: string[] = [];
  if (receipt.identityConflict) reasons.push("CONFLICTING_RFC");
  if (receipt.amountVerified !== true) reasons.push("AMOUNT_REQUIRES_REVIEW");
  if (receipt.executionConfirmed !== true) reasons.push("EXECUTION_REQUIRES_REVIEW");
  if (receipt.dateVerified !== true) reasons.push("DATE_REQUIRES_REVIEW");
  if (!Number.isFinite(receipt.amount) || Number(receipt.amount) <= 0) reasons.push("INVALID_AMOUNT");
  const parsedDate = Date.parse(String(receipt.date || ""));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(receipt.date || "")) || !Number.isFinite(parsedDate) || new Date(parsedDate).toISOString().slice(0, 10) !== receipt.date) reasons.push("MISSING_DATE");
  if (normalizeReceiptReference(receipt.reference).length < 4) reasons.push("MISSING_REFERENCE");
  if (String(receipt.currency || "").toUpperCase() !== "MXN") reasons.push("UNSUPPORTED_CURRENCY");
  if (receipt.paymentForm !== "03") reasons.push("PAYMENT_FORM_REQUIRES_REVIEW");
  if (!operationTypeKey) reasons.push("MISSING_OPERATION_TYPE");
  return reasons;
}
