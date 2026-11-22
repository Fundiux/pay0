import { confirmProtectedEffect, markProtectedEffectIntent } from "../automationSafety/runtime";
import { fetchIq } from "../iq/iqHttpClient";
import { iqAccountKey, normalizeIqName } from "./iqCatalogDomain";

// IQ's beneficiary write contract, as its own web app calls it (docs/iq-beneficiary-create-contract.md):
//   GET  /partners/{partnerId}/beneficiaries?filter[name]=…          list of { id, name, accounts, created_at }
//   POST /partners/{partnerId}/beneficiaries  { beneficiary: { name } }
//   GET  /beneficiaries/{beneficiaryId}/accounts?filter[clabe]=…     list of { id, owner_name, bank, clabe, card_number, … }
//   GET  /beneficiaries/{beneficiaryId}/accounts/new                  { banks: [{ id, name }] }
//   POST /beneficiaries/{beneficiaryId}/accounts { name, bank_id, clabe? , card_number? }
// Errors come back as { errors: string[] }. A beneficiary belongs to an IQ associate (partner), not to a client.

export type IqSession = { apiOrigin: string; accessToken: string };
export type IqAccountTarget = { partnerId: number; beneficiaryName: string; digits: string; isClabe: boolean; bankCode: string; bankName: string };
export type IqAccountFound = { iqBeneficiaryId: number; iqAccountId: number; iqBeneficiaryName: string; conciliated: boolean };
export type IqFindResult = ({ found: true } & IqAccountFound) | { found: false } | { found: "AMBIGUOUS"; candidates: number[] };
// effect says what may have changed in IQ: NONE (nothing was created), PARTIAL (only an empty beneficiary).
export type IqCreateHttpResult =
  | ({ outcome: "CREATED" } & IqAccountFound)
  | { outcome: "EXISTS" }
  | { outcome: "OUTCOME_UNKNOWN"; step: "BENEFICIARY" | "ACCOUNT" }
  | { outcome: "NOT_SENT"; reason: string }
  | { outcome: "REJECTED"; reason: string; effect: "NONE" | "PARTIAL" };

const text = (value: unknown) => String(value ?? "").trim();
const digitsOf = (value: unknown) => text(value).replace(/\D/g, "");
const PAGE = 100;
const MAX_PAGES = 5;
const MAX_NAME_CANDIDATES = 5;

// IQ answers a duplicate in Spanish or English, depending on the model validation; never parsed for anything else.
const ALREADY_EXISTS = /ya existe|ya est[aá] (en uso|registrad)|ya ha sido (tomad|registrad)|ya se encuentra|duplicad|already (exists|been taken|registered)|has already been taken/i;
export const isAlreadyExists = (errors: unknown) => (Array.isArray(errors) ? errors : [errors]).some(error => ALREADY_EXISTS.test(text(error)));

// Pre-send stops (kill switch, staging transport) are not unknown outcomes: nothing left PAY0.
const PRE_SEND = /^(EXTERNAL_ACTIONS_DISABLED|SAFETY_)/;

type Reply = { status: number; ok: boolean; data: any };

async function call(session: IqSession, method: "GET" | "POST", pathname: string, input: { query?: Record<string, string | number>; body?: unknown; operation: string }): Promise<Reply> {
  const url = new URL(pathname, session.apiOrigin);
  for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, String(value));
  const response = await fetchIq(url, {
    method,
    headers: { Accept: "application/json", Authorization: `Bearer ${session.accessToken}`, ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
  }, { operation: input.operation, timeoutMs: 30_000 });
  const raw = await response.text().catch(() => "");
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  return { status: response.status, ok: response.ok, data };
}

const rowsOf = (data: any): Array<Record<string, any>> => Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
const idOf = (data: any, key: string) => {
  for (const candidate of [data?.id, data?.[key]?.id, data?.data?.id]) { const id = Number(candidate); if (Number.isInteger(id) && id > 0) return id; }
  return 0;
};
const conciliatedOf = (account: Record<string, any>) => /^(conciliad[oa]|conciliated)$/i.test(text(account.conciliation_status ?? account.status));

async function readRows(session: IqSession, pathname: string, query: Record<string, string>, operation: string) {
  const rows: Array<Record<string, any>> = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const reply = await call(session, "GET", pathname, { query: { ...query, limit: PAGE, offset: page * PAGE }, operation });
    if (!reply.ok) throw new Error(`IQ_BENEFICIARY_READ_HTTP_${reply.status}`);
    const batch = rowsOf(reply.data);
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
  // Too many rows to be sure nothing was missed: that is not proof of anything.
  throw new Error("IQ_BENEFICIARY_READ_TOO_MANY_ROWS");
}

// Same-name beneficiaries of the associate. The filter narrows the page; the exact match is checked here.
export async function beneficiariesNamed(session: IqSession, partnerId: number, name: string) {
  const wanted = normalizeIqName(name);
  const rows = await readRows(session, `/partners/${partnerId}/beneficiaries`, { "filter[name]": name }, "beneficiary_by_name");
  return rows.filter(row => normalizeIqName(row.name) === wanted && Number(row.id) > 0).map(row => ({ id: Number(row.id), name: text(row.name) }));
}

async function accountOn(session: IqSession, beneficiaryId: number, target: IqAccountTarget) {
  const filter: Record<string, string> = target.isClabe ? { "filter[clabe]": target.digits } : { "filter[card_number]": target.digits };
  const wanted = iqAccountKey(target.digits);
  const rows = await readRows(session, `/beneficiaries/${beneficiaryId}/accounts`, filter, "beneficiary_accounts");
  // Full digits only: IQ's own filter may be a partial match.
  return rows.filter(row => {
    const value = digitsOf(row.clabe) || digitsOf(row.card_number) || digitsOf(row.number);
    return value && iqAccountKey(value) === wanted && !/^(cancelad|rechazad|canceled|rejected)/i.test(text(row.conciliation_status));
  });
}

// Account-level read under the associate: the beneficiaries with PAY0's name and, on them, the exact account.
export async function findAccountInIq(session: IqSession, target: IqAccountTarget): Promise<IqFindResult> {
  const named = await beneficiariesNamed(session, target.partnerId, target.beneficiaryName);
  if (named.length > MAX_NAME_CANDIDATES) return { found: "AMBIGUOUS", candidates: named.map(row => row.id).slice(0, 20) };
  const hits: IqAccountFound[] = [];
  for (const beneficiary of named) {
    for (const account of await accountOn(session, beneficiary.id, target)) hits.push({ iqBeneficiaryId: beneficiary.id, iqAccountId: Number(account.id), iqBeneficiaryName: beneficiary.name, conciliated: conciliatedOf(account) });
  }
  if (!hits.length) return { found: false };
  if (hits.length > 1) return { found: "AMBIGUOUS", candidates: [...new Set(hits.map(hit => hit.iqBeneficiaryId))] };
  return { found: true, ...hits[0] };
}

const bankText = (value: unknown) => normalizeIqName(value).replace(/[^A-Z0-9 ]/g, " ").replace(/\b(S ?A|DE|C ?V|INSTITUCION|BANCA|MULTIPLE|GRUPO|FINANCIERO|BANCO)\b/g, " ").replace(/\s+/g, " ").trim();

// IQ's bank catalog is keyed by its own id. The ABM code (first 3 CLABE digits) is used when IQ exposes it;
// otherwise the bank name must match exactly one IQ bank. Anything else stops before writing.
export function resolveIqBankId(banks: Array<Record<string, any>>, bankCode: string, bankName: string): number {
  const code = digitsOf(bankCode).padStart(3, "0").slice(-3);
  const byCode = banks.filter(bank => ["code", "key", "abm", "abm_code", "bank_code", "clave", "clabe_code"].some(field => digitsOf(bank[field]) && digitsOf(bank[field]).padStart(3, "0").slice(-3) === code));
  if (code !== "000" && byCode.length === 1) return Number(byCode[0].id) || 0;
  const wanted = bankText(bankName);
  if (!wanted) return 0;
  const exact = banks.filter(bank => bankText(bank.name) === wanted);
  if (exact.length === 1) return Number(exact[0].id) || 0;
  return 0;
}

async function bankCatalog(session: IqSession, partnerId: number, beneficiaryId: number | null) {
  let anyBeneficiary = beneficiaryId;
  if (!anyBeneficiary) {
    const first = await call(session, "GET", `/partners/${partnerId}/beneficiaries`, { query: { limit: 1, offset: 0 }, operation: "beneficiary_any" });
    anyBeneficiary = first.ok ? Number(rowsOf(first.data)[0]?.id) || null : null;
  }
  const sources = [...(anyBeneficiary ? [`/beneficiaries/${anyBeneficiary}/accounts/new`] : []), "/partners/accounts/new"];
  for (const pathname of sources) {
    const reply = await call(session, "GET", pathname, { operation: "beneficiary_account_form" });
    const banks = Array.isArray(reply.data?.banks) ? reply.data.banks as Array<Record<string, any>> : [];
    if (reply.ok && banks.length) return banks;
  }
  return [];
}

async function post(session: IqSession, pathname: string, body: unknown, operation: string): Promise<Reply | "UNKNOWN"> {
  try { return await call(session, "POST", pathname, { body, operation }); }
  catch (error) {
    const message = text(error instanceof Error ? error.message : error);
    if (PRE_SEND.test(message)) throw error;
    return "UNKNOWN";
  }
}

// Creates the account (and the beneficiary only when the associate has none with PAY0's name). Every read
// that can turn a create into a link happens first, so a retry after a crash finds what an earlier run made.
// Any failure before the account POST leaves is NOT_SENT (an empty beneficiary is reused by name next time);
// any failure after it is an unknown outcome.
export async function createAccountInIq(session: IqSession, target: IqAccountTarget): Promise<IqCreateHttpResult> {
  const progress = { accountSent: false };
  try { return await createSteps(session, target, progress); }
  catch (error) {
    const reason = text(error instanceof Error ? error.message : error).slice(0, 120) || "IQ_CREATE_FAILED";
    return progress.accountSent && !PRE_SEND.test(reason) ? { outcome: "OUTCOME_UNKNOWN", step: "ACCOUNT" } : { outcome: "NOT_SENT", reason };
  }
}

async function createSteps(session: IqSession, target: IqAccountTarget, progress: { accountSent: boolean }): Promise<IqCreateHttpResult> {
  const named = await beneficiariesNamed(session, target.partnerId, target.beneficiaryName);
  if (named.length > 1) return { outcome: "REJECTED", reason: "IQ_BENEFICIARY_NAME_AMBIGUOUS", effect: "NONE" };
  let beneficiary = named[0] ?? null;
  if (beneficiary && (await accountOn(session, beneficiary.id, target)).length) return { outcome: "EXISTS" };

  const bankId = resolveIqBankId(await bankCatalog(session, target.partnerId, beneficiary?.id ?? null), target.bankCode, target.bankName);
  if (!bankId) return { outcome: "REJECTED", reason: "IQ_BANK_UNRESOLVED", effect: "NONE" };

  let effect: "NONE" | "PARTIAL" = "NONE";
  if (!beneficiary) {
    const reply = await post(session, `/partners/${target.partnerId}/beneficiaries`, { beneficiary: { name: target.beneficiaryName } }, "beneficiary_create");
    const createdId = reply !== "UNKNOWN" && reply.ok ? idOf(reply.data, "beneficiary") : 0;
    if (reply !== "UNKNOWN" && !reply.ok && !isAlreadyExists(reply.data?.errors) && reply.status < 500) return { outcome: "REJECTED", reason: `IQ_BENEFICIARY_HTTP_${reply.status}`, effect: "NONE" };
    if (createdId) beneficiary = { id: createdId, name: target.beneficiaryName };
    else {
      // No id in the answer, a "ya existe", a timeout or a 5xx: read by name before deciding anything.
      const again = await beneficiariesNamed(session, target.partnerId, target.beneficiaryName);
      if (again.length > 1) return { outcome: "REJECTED", reason: "IQ_BENEFICIARY_NAME_AMBIGUOUS", effect: "PARTIAL" };
      if (!again.length) return reply !== "UNKNOWN" && reply.ok ? { outcome: "REJECTED", reason: "IQ_BENEFICIARY_ID_MISSING", effect: "PARTIAL" } : { outcome: "OUTCOME_UNKNOWN", step: "BENEFICIARY" };
      beneficiary = again[0];
    }
    effect = "PARTIAL";
  }

  const body = { name: target.beneficiaryName, bank_id: bankId, ...(target.isClabe ? { clabe: target.digits } : { card_number: target.digits }) };
  // One provider effect per operation: the safety runtime refuses a second POST for the same reservation.
  await markProtectedEffectIntent();
  progress.accountSent = true;
  const reply = await post(session, `/beneficiaries/${beneficiary.id}/accounts`, body, "beneficiary_account_create");
  if (reply === "UNKNOWN" || reply.status >= 500) return { outcome: "OUTCOME_UNKNOWN", step: "ACCOUNT" };
  if (!reply.ok) return isAlreadyExists(reply.data?.errors) ? { outcome: "EXISTS" } : { outcome: "REJECTED", reason: `IQ_ACCOUNT_HTTP_${reply.status}`, effect };
  await confirmProtectedEffect();
  const accountId = idOf(reply.data, "account");
  if (!accountId) return { outcome: "EXISTS" }; // created, but the ids come from the read that follows
  return { outcome: "CREATED", iqBeneficiaryId: beneficiary.id, iqAccountId: accountId, iqBeneficiaryName: beneficiary.name, conciliated: conciliatedOf(reply.data?.account ?? reply.data ?? {}) };
}
