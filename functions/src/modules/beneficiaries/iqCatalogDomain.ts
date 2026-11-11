import { createHash } from "crypto";

// RR and BETELL 1 are two logins over the same IQ data, and PAY0 is ELIUT's list:
// a link belongs to the IQ catalog, not to the login that found it.
const CATALOG_BY_ALIAS: Record<string, string> = { "RR": "iq-group-rr", "BETELL 1": "iq-group-rr", "PAY0": "iq-group-pay0" };

const clean = (value: unknown) => String(value ?? "").trim();
const digits = (value: unknown) => clean(value).replace(/\D/g, "");
export const normalizeIqName = (value: unknown) => clean(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ");

export function iqCatalogForAlias(alias: unknown): string | null {
  return CATALOG_BY_ALIAS[clean(alias).toUpperCase()] ?? null;
}

export const iqAccountKey = (accountDigits: string) => createHash("sha256").update(accountDigits).digest("hex").slice(0, 32);

export function iqAccountIdentity(account: Record<string, unknown>): { key: string; last4: string } | null {
  const value = digits(account.clabe) || digits(account.card_number) || digits(account.number);
  return value ? { key: iqAccountKey(value), last4: value.slice(-4) } : null;
}

export function methodAccountRef(method: Record<string, unknown>): { key: string; last4: string } | null {
  const value = digits(method.clabe) || digits(method.cardNumber);
  return value.length >= 15 ? { key: iqAccountKey(value), last4: value.slice(-4) } : null;
}

// A link is only valid for the account it was made with: any consumer must check
// this before using iqAccountId, because a method can change its CLABE or card.
export function iqLinkMatchesMethod(link: Record<string, unknown> | null | undefined, method: Record<string, unknown>): boolean {
  const account = methodAccountRef(method);
  return !!account && link?.status === "LINKED" && link.key === account.key;
}

export type IqCatalogRow = { beneficiaryId: number; accountId: number; beneficiaryName: string; conciliationStatus: string; partnerId?: number };

// The same CLABE under another IQ associate is another record: it is neither a link nor a reason to review.
export function rowsOfPartner<T extends { partnerId?: unknown }>(rows: T[], partnerId: unknown): T[] {
  const wanted = Number(partnerId);
  return Number.isFinite(wanted) && wanted > 0 ? rows.filter(row => Number(row.partnerId) === wanted) : [];
}
export type IqLinkDecision =
  | { status: "LINKED"; iqBeneficiaryId: number; iqAccountId: number; iqBeneficiaryName: string; nameDiffers: boolean }
  | { status: "REVIEW_REQUIRED"; candidates: number[] }
  | { status: "NOT_CONCILIATED" | "NOT_FOUND" };

// PAY0 never picks one of several beneficiaries on its own: same account under
// different numbers goes to a person unless the name settles it.
export function resolveIqLink(beneficiaryName: unknown, rows: IqCatalogRow[]): IqLinkDecision {
  const active = rows.filter(row => normalizeIqName(row.conciliationStatus) === "CONCILIADO");
  if (!active.length) return { status: rows.some(row => normalizeIqName(row.conciliationStatus) !== "CANCELADO" && normalizeIqName(row.conciliationStatus) !== "RECHAZADO") ? "NOT_CONCILIATED" : "NOT_FOUND" };
  const wanted = normalizeIqName(beneficiaryName);
  const sameName = active.filter(row => normalizeIqName(row.beneficiaryName) === wanted);
  const pool = sameName.length ? sameName : active;
  const beneficiaries = [...new Set(pool.map(row => row.beneficiaryId))].sort((a, b) => a - b);
  if (beneficiaries.length > 1) return { status: "REVIEW_REQUIRED", candidates: beneficiaries };
  const row = [...pool].sort((a, b) => a.accountId - b.accountId)[0];
  return { status: "LINKED", iqBeneficiaryId: row.beneficiaryId, iqAccountId: row.accountId, iqBeneficiaryName: row.beneficiaryName, nameDiffers: !sameName.length };
}
