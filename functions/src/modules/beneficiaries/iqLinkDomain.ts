import { createHash } from "crypto";

import { iqAccountKey, iqCatalogForAlias, iqLinkMatchesMethod, type IqLinkDecision } from "./iqCatalogDomain";

const clean = (value: unknown) => String(value ?? "").trim();
const asRecord = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

export type ClientCatalogProfile = { catalog: string; profileId: string; profileAlias: string; partnerName: string; partnerId: string; clientIqId: string };

// A client is linked to IQ per credential profile; the beneficiary catalog is the IQ data group of that
// profile. RR and BETELL 1 collapse to one catalog, so only one profile per catalog is kept (the first by id).
export function catalogsForClient(client: Record<string, unknown> | null | undefined): ClientCatalogProfile[] {
  const byCatalog = new Map<string, ClientCatalogProfile>();
  const links = asRecord(asRecord(client).iqLinksByProfile);
  // Older links keep the associate only in client.iqLink; it is used when the profile link lacks the id and names the same associate.
  const legacy = asRecord(asRecord(client).iqLink);
  for (const profileId of Object.keys(links).sort()) {
    const link = asRecord(links[profileId]);
    const catalog = iqCatalogForAlias(link.profileAlias);
    const clientIqId = clean(link.clientId);
    if (!catalog || !clientIqId || link.active === false || clean(link.status).toUpperCase() !== "LINKED" || byCatalog.has(catalog)) continue;
    byCatalog.set(catalog, { catalog, profileId: clean(link.profileId) || profileId, profileAlias: clean(link.profileAlias), partnerName: clean(link.partnerName), partnerId: clean(link.partnerId) || (clean(legacy.partnerId) && clean(legacy.partnerName).toUpperCase() === clean(link.partnerName).toUpperCase() ? clean(legacy.partnerId) : ""), clientIqId });
  }
  return [...byCatalog.values()];
}

// One reservation per account in one catalog: a retry, a second trigger or a second client reuses it.
export const createReservationId = (rootId: string, catalog: string, accountKey: string) =>
  `ibc_${createHash("sha256").update(JSON.stringify([rootId, catalog, accountKey])).digest("hex").slice(0, 48)}`;

export const linkActivityId = (methodId: string, catalog: string, accountKey: string, outcome: string) =>
  `ibl_${createHash("sha256").update(JSON.stringify([methodId, catalog, accountKey, outcome])).digest("hex").slice(0, 48)}`;

export const mexicoDay = (nowMs: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));

// Owner decision 2026-11-24: no daily cap unless dailyLimit is set explicitly, like dispersions, solicitudes and pagos.
// Creation itself stays off until enabled and contractVerified are set.
export const DEFAULT_DAILY_CREATE_LIMIT = Number.POSITIVE_INFINITY;
export const MAX_DAILY_CREATE_LIMIT = 200;

export type CreateConfig = { enabled?: unknown; contractVerified?: unknown; dailyLimit?: unknown; catalogMaxAgeHours?: unknown };

// How old a clean pass over an associate may be (counted from the pass start) and still prove that an account is missing.
// A big associate takes several nights to read, so this is five days; the owner can lower it in the create config.
export const DEFAULT_CATALOG_MAX_AGE_HOURS = 120;
export const MAX_CATALOG_MAX_AGE_HOURS = 240;
export function catalogMaxAgeMs(config: CreateConfig | undefined): number {
  const configured = Number(config?.catalogMaxAgeHours);
  const hours = Number.isFinite(configured) && configured > 0 ? Math.min(configured, MAX_CATALOG_MAX_AGE_HOURS) : DEFAULT_CATALOG_MAX_AGE_HOURS;
  return hours * 3_600_000;
}

export type CatalogStateForProof = { partnerSyncedAt?: Record<string, { toMillis?: () => number } | null> | null };
export type AbsenceProof = { proven: true } | { proven: false; reason: "PARTNER_UNKNOWN" | "CATALOG_STALE" | "ACCOUNT_IN_CATALOG" };

// The account is missing in IQ when the associate's slice of the catalog was read whole, in one run, recently
// and has no row at all for it, whatever its status. A full pass spans several nights, so its completion date
// says nothing about one associate. Rows of other associates do not count: the same CLABE under another
// associate is another IQ record.
export function catalogAbsenceProof(input: { partnerId: unknown; partnerRows: unknown[]; state: CatalogStateForProof | undefined; nowMs: number; maxAgeMs: number }): AbsenceProof {
  const partnerId = Number(input.partnerId);
  if (!Number.isInteger(partnerId) || partnerId <= 0) return { proven: false, reason: "PARTNER_UNKNOWN" };
  if (input.partnerRows.length) return { proven: false, reason: "ACCOUNT_IN_CATALOG" };
  const syncedMs = input.state?.partnerSyncedAt?.[String(partnerId)]?.toMillis?.() ?? 0;
  if (!syncedMs || input.nowMs - syncedMs > input.maxAgeMs) return { proven: false, reason: "CATALOG_STALE" };
  return { proven: true };
}
export type CreateGate = { allowed: true; limit: number } | { allowed: false; reason: "IQ_MASTER_OFF" | "CREATE_DISABLED" | "CREATE_CONTRACT_UNVERIFIED" | "DAILY_LIMIT_REACHED"; limit: number };

// Creating in IQ needs the master switch, the per-root create switch, a verified write contract and
// room in today's counter. The limit is read from Firestore, so changing it never needs a deploy.
export function evaluateCreateGate(input: { masterEnabled: boolean; config: CreateConfig | undefined; createdToday: number }): CreateGate {
  const configured = Number(input.config?.dailyLimit);
  const limit = Number.isFinite(configured) && configured >= 0 ? Math.min(Math.floor(configured), MAX_DAILY_CREATE_LIMIT) : DEFAULT_DAILY_CREATE_LIMIT;
  if (!input.masterEnabled) return { allowed: false, reason: "IQ_MASTER_OFF", limit };
  if (input.config?.enabled !== true) return { allowed: false, reason: "CREATE_DISABLED", limit };
  if (input.config?.contractVerified !== true) return { allowed: false, reason: "CREATE_CONTRACT_UNVERIFIED", limit };
  if (input.createdToday >= limit) return { allowed: false, reason: "DAILY_LIMIT_REACHED", limit };
  return { allowed: true, limit };
}

export type LinkEntryInput = { decision: IqLinkDecision; key: string; last4: string; source: "CATALOG" | "LIVE_LOOKUP" | "CREATED_IN_IQ"; createState?: string | null };

// The entry replaces the whole iqLinksByCatalog[catalog] value, so stale ids never survive a new state.
export function buildLinkEntry(input: LinkEntryInput, checkedAt: unknown) {
  const { iqBeneficiaryName: _name, ...decision } = input.decision as Record<string, unknown>;
  return { ...decision, key: input.key, last4: input.last4, source: input.source, ...(input.createState ? { createState: input.createState } : {}), checkedAt };
}

// The link a dispersion may use: same IQ data group as the profile that sends it, still LINKED and made
// for the method's current CLABE or card. Anything else returns nothing and the dispersion resolves by name.
export function storedIqLink(method: Record<string, unknown>, profileAlias: unknown, destinationDigits?: unknown): { storedLink?: { beneficiaryId: string; accountId: string } } {
  const catalog = iqCatalogForAlias(profileAlias);
  const link = catalog ? asRecord(asRecord(method.iqLinksByCatalog)[catalog]) : null;
  const beneficiaryId = clean(link?.iqBeneficiaryId), accountId = clean(link?.iqAccountId);
  const destination = clean(destinationDigits).replace(/[^0-9]/g, "");
  // Conservative: a link whose IQ name differs from PAY0's is not used, and the account fingerprint must
  // match the digits this dispersion pays (a method can hold both a CLABE and a card).
  if (!link || link.nameDiffers === true || !iqLinkMatchesMethod(link, method) || !/^\d+$/.test(beneficiaryId) || !/^\d+$/.test(accountId)) return {};
  if (destination && iqAccountKey(destination) !== link.key) return {};
  return { storedLink: { beneficiaryId, accountId } };
}

// "READY" (white) only when IQ has the account reconciled: a stored link for this profile's catalog that still
// matches the account, or the older VERIFIED link. Anything else is pending (orange) and is not dispersed.
export function iqLinkReadiness(method: Record<string, unknown>, profileAlias: unknown, destinationDigits?: unknown): "READY" | "PENDING" {
  if (storedIqLink(method, profileAlias, destinationDigits).storedLink) return "READY";
  const legacyVerified = clean(method.iqLinkStatus).toUpperCase() === "VERIFIED" && /^\d+$/.test(clean(method.iqBeneficiaryId)) && /^\d+$/.test(clean(method.iqAccountId));
  return legacyVerified ? "READY" : "PENDING";
}

// Stops that only mean "not yet": they are stored as PENDING_RETRY and picked up again by the scheduled
// re-drive, instead of becoming a NOT_FOUND that nothing revisits. The delay is a floor, not a schedule.
export const MAX_RETRY_ATTEMPTS = 20;
const HOUR = 3_600_000;
export const GATE_REASONS = new Set(["IQ_MASTER_OFF", "CREATE_DISABLED", "CREATE_CONTRACT_UNVERIFIED", "DAILY_LIMIT_REACHED", "ABSENCE_NOT_PROVEN"]);
// Waiting for the nightly catalog to read the associate again is not a failure either: it never spends attempts.
export const WAITING_REASONS = new Set([...GATE_REASONS, "CATALOG_STALE"]);
// A create whose answer was lost is only re-read, never re-sent: a few reads over a day, then a person.
export const UNKNOWN_OUTCOME_REASON = "CREATE_OUTCOME_UNKNOWN";
export const MAX_UNKNOWN_OUTCOME_READS = 4;

export function retryDelayMs(reason: string): number | null {
  if (reason === "IQ_MASTER_OFF") return HOUR;
  if (reason === "DAILY_LIMIT_REACHED" || reason === "CREATE_DISABLED" || reason === "CREATE_CONTRACT_UNVERIFIED" || reason === "ABSENCE_NOT_PROVEN" || reason === "CATALOG_STALE" || reason === UNKNOWN_OUTCOME_REASON) return 6 * HOUR;
  if (reason === "LOOKUP_FAILED" || reason === "CREATE_NOT_SENT" || reason.startsWith("SAFETY_")) return HOUR / 2;
  return null;
}

// What the daily summary counts. No identifiers: only how many methods are in each state per catalog.
export type LinkSummaryCounts = { linked: number; created: number; awaitingConciliation: number; pending: number; stuck: number; review: number; notFound: number };
const DAY = 24 * HOUR;
export function summarizeEntries(entries: Array<Record<string, any>>, nowMs: number): LinkSummaryCounts {
  const counts: LinkSummaryCounts = { linked: 0, created: 0, awaitingConciliation: 0, pending: 0, stuck: 0, review: 0, notFound: 0 };
  for (const entry of entries) {
    const status = clean(entry?.status);
    if (status === "LINKED") { counts.linked++; if (entry.source === "CREATED_IN_IQ") counts.created++; }
    else if (status === "NOT_CONCILIATED" && entry.source === "CREATED_IN_IQ") counts.awaitingConciliation++;
    else if (status === "PENDING_RETRY") {
      counts.pending++;
      const since = entry.pendingSince?.toMillis?.() ?? entry.checkedAt?.toMillis?.() ?? nowMs;
      if (nowMs - since > DAY) counts.stuck++;
    } else if (status === "REVIEW_REQUIRED") counts.review++;
    else if (status === "NOT_FOUND") counts.notFound++;
  }
  return counts;
}
