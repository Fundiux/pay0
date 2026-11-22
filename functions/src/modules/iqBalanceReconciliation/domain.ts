import { createHash } from "crypto";

import { iqCatalogForAlias } from "../beneficiaries/iqCatalogDomain";
import { R3_OPERATIONAL_POLICY } from "../iqHistoricalImport/r3OperationalPolicy";

export const PROCESS = "IQ_BALANCE_RECON";
export const SNAPSHOTS = "iqBalanceSnapshots";
export const STATE = "iqBalanceReconciliationState";
export const CONFIG = "iqBalanceReconciliationConfig";

/** The owner asked that the PAY0 Wallet match IQ to the cent. */
export const BALANCE_TOLERANCE = 0.01;

export type ComparisonStatus = "MATCH" | "DIFFERENT" | "UNMAPPED";

const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const asRecord = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** IQ sends money as strings ("1,234.50", "-12", "$ 3.00"). Anything unreadable is null, never zero. */
export function parseIqMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? round2(value) : null;
  const raw = clean(value).replace(/[$\s,]/g, "");
  if (!raw || !/^[-+]?\d+(\.\d+)?$/.test(raw)) return null;
  return round2(Number(raw));
}

/** Normalised identity of an IQ partner (associate), as used by the R3 identity policy. */
export function normalizePartnerName(value: unknown): string {
  return clean(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/^ASOCIADO\s+/, "");
}

/** `partner` comes from IQ as a name, an id or an object; all three are accepted. */
export function partnerOf(value: unknown): { key: string; name: string; id: string } {
  const record = asRecord(value);
  const name = typeof value === "object" && value !== null
    ? clean(record.name ?? record.nombre ?? record.partner_name ?? record.alias)
    : (typeof value === "number" ? "" : clean(value));
  const id = typeof value === "number" ? String(value) : clean(record.id ?? record.partner_id);
  const key = normalizePartnerName(name) || (id ? `ID:${id}` : "");
  return { key, name, id };
}

export type IqGeneralRow = { iqClientId: string; iqClientName: string; balance: number | null; partner: { key: string; name: string; id: string } };

export function normalizeGeneralRows(raw: unknown): IqGeneralRow[] {
  if (!Array.isArray(raw)) throw new Error("IQ_BALANCE_RESPONSE_INVALID");
  return raw.map(row => {
    const record = asRecord(row);
    return {
      iqClientId: clean(record.client_id ?? record.clientId),
      iqClientName: clean(record.client_name ?? record.clientName),
      balance: parseIqMoney(record.balance),
      partner: partnerOf(record.partner ?? record.partner_name ?? record.partner_id),
    };
  }).filter(row => row.iqClientId);
}

export type ClientLink = { clientId: string; catalog: string; iqClientId: string; partnerKey: string; merged: boolean };

/**
 * Every LINKED profile of every PAY0 client, by IQ data group. RR and BETELL 1 are the same IQ data,
 * so a client linked through both appears once per (catalog, IQ client).
 */
export function clientLinks(clientId: string, client: Record<string, unknown>): ClientLink[] {
  const links = asRecord(client.iqLinksByProfile);
  const seen = new Set<string>();
  const result: ClientLink[] = [];
  for (const profileId of Object.keys(links).sort()) {
    const link = asRecord(links[profileId]);
    const catalog = iqCatalogForAlias(link.profileAlias);
    const iqClientId = clean(link.clientId);
    if (!catalog || !iqClientId || link.active === false || clean(link.status).toUpperCase() !== "LINKED") continue;
    const key = `${catalog}:${iqClientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const partner = normalizePartnerName(link.partnerName) || (clean(link.partnerId) ? `ID:${clean(link.partnerId)}` : "");
    result.push({ clientId, catalog, iqClientId, partnerKey: partner, merged: !!clean(client.mergedInto) });
  }
  return result;
}

export type RowResolution = { clientId: string } | { clientId: null; reason: "NO_PAY0_CLIENT" | "OTHER_PARTNER" | "MULTIPLE_PAY0_CLIENTS" };

/**
 * The PAY0 client of one IQ balance row. A link that names its partner only takes that partner's
 * row; a merged (forward-only) client yields to its canonical client; anything else ambiguous stays
 * unmapped so a person never sees one client's balance attributed to another.
 */
export function resolveRowClient(catalog: string, row: IqGeneralRow, index: Map<string, ClientLink[]>): RowResolution {
  const candidates = index.get(`${catalog}:${row.iqClientId}`) || [];
  if (!candidates.length) return { clientId: null, reason: "NO_PAY0_CLIENT" };
  const partnerMatches = candidates.filter(link => !link.partnerKey || !row.partner.key || link.partnerKey === row.partner.key);
  if (!partnerMatches.length) return { clientId: null, reason: "OTHER_PARTNER" };
  const active = partnerMatches.filter(link => !link.merged);
  const pool = active.length ? active : partnerMatches;
  const ids = [...new Set(pool.map(link => link.clientId))];
  return ids.length === 1 ? { clientId: ids[0] } : { clientId: null, reason: "MULTIPLE_PAY0_CLIENTS" };
}

export function indexLinks(links: ClientLink[]): Map<string, ClientLink[]> {
  const index = new Map<string, ClientLink[]>();
  for (const link of links) {
    const key = `${link.catalog}:${link.iqClientId}`;
    index.set(key, [...(index.get(key) || []), link]);
  }
  return index;
}

/** Same sign convention on both sides: a positive balance is money the client has in favour. */
export function compareBalances(iqBalance: number, pay0Balance: number) {
  const difference = round2(pay0Balance - iqBalance);
  const status: ComparisonStatus = Math.abs(difference) <= BALANCE_TOLERANCE ? "MATCH" : "DIFFERENT";
  // A hint only: equal magnitudes with opposite signs usually mean a sign-convention mismatch.
  const signInverted = status === "DIFFERENT" && Math.abs(iqBalance) > BALANCE_TOLERANCE && Math.abs(round2(pay0Balance + iqBalance)) <= BALANCE_TOLERANCE;
  return { status, difference, signInverted };
}

/** IQ partner → PAY0 user (socio). Starts from the R3 identity policy; per-root config may add more. */
export function partnerOwnerMap(rootId: string, overrides: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (rootId === R3_OPERATIONAL_POLICY.rootId) {
    for (const mapping of Object.values(R3_OPERATIONAL_POLICY.mappings)) map.set(normalizePartnerName(mapping.associatedName), mapping.adminId);
  }
  for (const [name, uid] of Object.entries(asRecord(overrides))) {
    const key = normalizePartnerName(name), value = clean(uid);
    if (key && /^[A-Za-z0-9]{10,64}$/.test(value)) map.set(key, value);
  }
  return map;
}

export const snapshotKey = (parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
export const snapshotId = (rootId: string, day: string, key: string) => `${rootId}_${day}_${key}`;

/** Accepts ISO dates and DD/MM/YYYY; returns YYYY-MM-DD or "" when unreadable. */
export function dayOf(value: unknown): string {
  const raw = clean(value);
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return "";
}

const dayDistance = (a: string, b: string) => !a || !b ? Infinity : Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

export type IqMovement = { iqIds: string[]; day: string; concept: string; credit: number; charge: number };
export type Pay0Movement = { iqIds: string[]; day: string; folio: string; concept: string; direction: "IN" | "OUT"; amount: number };

export function normalizeIqMovements(raw: unknown): IqMovement[] {
  return (Array.isArray(raw) ? raw : []).map(row => {
    const record = asRecord(row);
    return {
      iqIds: [record.individual_id, record.client_movement_id].map(clean).filter(Boolean),
      day: dayOf(record.fecha ?? record.date),
      concept: clean(record.concepto ?? record.concept).slice(0, 80),
      credit: parseIqMoney(record.credit) ?? 0,
      charge: parseIqMoney(record.charge) ?? 0,
    };
  }).filter(row => row.credit !== 0 || row.charge !== 0);
}

export const EXPLANATION_LIMIT = 15;

/**
 * Best effort: an IQ movement is explained by a PAY0 movement that carries its IQ id, or else by an
 * unused PAY0 movement of the same direction and amount within a day. What is left on either side
 * is what a person should look at. Bounded so a snapshot stays small.
 */
export function explainMovements(iq: IqMovement[], pay0: Pay0Movement[], limit = EXPLANATION_LIMIT) {
  const used = new Set<number>();
  const unexplainedIq: IqMovement[] = [];
  for (const movement of iq) {
    const direction = movement.credit !== 0 ? "IN" : "OUT";
    const amount = round2(Math.abs(movement.credit !== 0 ? movement.credit : movement.charge));
    let found = pay0.findIndex((row, i) => !used.has(i) && movement.iqIds.some(id => row.iqIds.includes(id)));
    if (found < 0) found = pay0.findIndex((row, i) => !used.has(i) && row.direction === direction && Math.abs(row.amount - amount) <= BALANCE_TOLERANCE && dayDistance(row.day, movement.day) <= 1);
    if (found >= 0) used.add(found); else unexplainedIq.push(movement);
  }
  const unmatchedPay0 = pay0.filter((_, i) => !used.has(i));
  return {
    iqMovements: iq.length,
    pay0Movements: pay0.length,
    unexplainedIqCount: unexplainedIq.length,
    unmatchedPay0Count: unmatchedPay0.length,
    unexplainedIq: unexplainedIq.slice(0, limit).map(row => ({ day: row.day, concept: row.concept, credit: row.credit, charge: row.charge })),
    unmatchedPay0: unmatchedPay0.slice(0, limit).map(row => ({ day: row.day, folio: row.folio, concept: row.concept, direction: row.direction, amount: row.amount })),
  };
}

export type Explanation = ReturnType<typeof explainMovements> & { previousBalance: number | null; totalCredits: number | null; totalCharges: number | null; month: string };
