export type ReceiptSignals = {
  senderName?: string; beneficiaryName?: string; payerRfc?: string; beneficiaryRfc?: string;
  account?: string; destinationAccount?: string; amount?: number; date?: string;
  reference?: string; concept?: string; currency?: string; paymentForm?: string; time?: string; bankName?: string; identityConflict?: boolean;
  amountVerified?: boolean; executionConfirmed?: boolean; dateVerified?: boolean;
};
export type ReceiptCatalogItem = { id: string; [key: string]: any };
export type IdentityMatch = { status: "EXACT" | "REQUIRES_REVIEW"; id: string | null; reasons: string[]; evidence: string[]; candidateCount: number };
/** Only punctuation/spacing variants of complete legal suffixes are equivalent. */
export const normalizeReceiptName = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9&]+/g, " ").trim().replace(/\s+/g, " ")
  .replace(/\bS\s+DE\s+R\s*L\s+DE\s+C\s*V$/, "S DE RL DE CV")
  .replace(/\bS\s*A\s+DE\s+C\s*V$/, "SA DE CV");
export const normalizeReceiptReference = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const rfc = (value: unknown) => String(value ?? "").toUpperCase().replace(/[\s.-]/g, "");
const validRfc = (value: string) => /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(value) && !/^XAXX|^XEXX/.test(value);
export function fullReceiptAccount(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^[\d\s-]+$/.test(raw)) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 18 ? digits : "";
}
const names = (item: ReceiptCatalogItem) => [item.name, item.nombre, item.razonSocial, item.businessName, item.legalName, item.commercialName, item.nombreComercial, item.displayName, item.companyName, item.clientName, item.clienteNombre, item.alias, item.depositAlias].map(normalizeReceiptName).filter(Boolean);
const rfcs = (item: ReceiptCatalogItem) => [item.rfc, item.RFC, item.taxId, item.taxID].map(rfc).filter(validRfc);
const accounts = (item: ReceiptCatalogItem) => [item.clabe, item.CLABE, item.bankClabe, item.cuenta, item.account, item.accountNumber, ...(Array.isArray(item.depositClabes) ? item.depositClabes : [])].map(fullReceiptAccount).filter(Boolean);

type IdentitySignals = { name?: string; rfc?: string; account?: string };
type IdentityOptions = { party?: "CLIENT" | "COMPANY" };
function assessIdentity(items: ReceiptCatalogItem[], signals: IdentitySignals, options: IdentityOptions) {
  const wantedName = normalizeReceiptName(signals.name), wantedRfc = rfc(signals.rfc), wantedAccount = fullReceiptAccount(signals.account);
  return items.filter(item => item.active !== false && item.isActive !== false).map(item => {
    const itemRfcs = rfcs(item), itemAccounts = accounts(item);
    const rfcExact = validRfc(wantedRfc) && itemRfcs.includes(wantedRfc);
    const accountExact = !!wantedAccount && itemAccounts.includes(wantedAccount);
    const nameExact = !!wantedName && names(item).includes(wantedName);
    // The ordering party may pay on behalf of a different client.
    const conflict = (validRfc(wantedRfc) && itemRfcs.length > 0 && !rfcExact) ||
      (options.party !== "CLIENT" && !!wantedAccount && itemAccounts.length > 0 && !accountExact);
    const evidence = [rfcExact ? "RFC_EXACT" : "", accountExact ? "FULL_ACCOUNT_EXACT" : "", nameExact ? "NORMALIZED_NAME_EXACT" : ""].filter(Boolean);
    return { item, rfcExact, accountExact, nameExact, conflict, evidence };
  });
}

/** Exact names can identify; missing metadata is not contradictory evidence. */
export function matchReceiptIdentity(items: ReceiptCatalogItem[], signals: IdentitySignals, options: IdentityOptions = {}): IdentityMatch {
  const assessed = assessIdentity(items, signals, options);
  const named = assessed.filter(row => row.nameExact);
  const strong = assessed.filter(row => row.rfcExact || row.accountExact);
  const candidates = named.length ? named : strong;
  const review = (reason: string, evidence: string[] = []): IdentityMatch => ({ status: "REQUIRES_REVIEW", id: null, reasons: [reason], evidence, candidateCount: candidates.length });
  if (candidates.some(row => row.conflict)) return review("CONFLICTING_SIGNALS");
  if (candidates.length > 1) return review("MULTIPLE_CANDIDATES");
  const candidate = candidates[0];
  if (!candidate) return review("INSUFFICIENT_IDENTITY_SIGNALS");
  if (candidate.conflict || (named.length && strong.some(row => row.item.id !== candidate.item.id && (options.party !== "CLIENT" || row.rfcExact)))) return review("CONFLICTING_SIGNALS", candidate.evidence);
  if (!candidate.nameExact && !(candidate.rfcExact && candidate.accountExact)) return review("IDENTITY_NOT_CORROBORATED", candidate.evidence);
  return { status: "EXACT", id: candidate.item.id, reasons: [], evidence: candidate.evidence, candidateCount: 1 };
}

/** Caller supplies only the active, authorized catalog. A human choice is not OCR proof. */
export function selectReceiptIdentity(items: ReceiptCatalogItem[], signals: IdentitySignals, selectedId?: string, options: IdentityOptions = {}) {
  const assessed = assessIdentity(items, signals, options);
  const automatic = matchReceiptIdentity(items, signals, options);
  const candidates = [...assessed].sort((a, b) => Number(b.nameExact) - Number(a.nameExact) || Number(b.rfcExact) - Number(a.rfcExact) || a.item.id.localeCompare(b.item.id)).map(row => row.item);
  if (!selectedId) return { match: automatic, candidates };
  const selected = assessed.find(row => row.item.id === selectedId);
  if (!selected) return { match: { ...automatic, status: "REQUIRES_REVIEW" as const, id: null, reasons: ["INVALID_SELECTION"] }, candidates };
  return { match: { status: "EXACT" as const, id: selected.item.id, reasons: [], evidence: [...selected.evidence, "USER_SELECTED_AUTHORIZED_CATALOG_ENTRY"], candidateCount: 1 }, candidates };
}

export function receiptRegistrationReasons(receipt: ReceiptSignals, operationTypeKey: string) {
  const reasons: string[] = [];
  if (receipt.identityConflict) reasons.push("CONFLICTING_RFC");
  // Registration precedes reconciliation. OCR confidence and a bank's execution
  // wording are evidence, not prerequisites for recording a pending payment.
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
