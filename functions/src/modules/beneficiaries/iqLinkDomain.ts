import { createHash } from "crypto";

import { iqCatalogForAlias, type IqLinkDecision } from "./iqCatalogDomain";

const clean = (value: unknown) => String(value ?? "").trim();
const asRecord = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

export type ClientCatalogProfile = { catalog: string; profileId: string; profileAlias: string; partnerName: string; clientIqId: string };

// A client is linked to IQ per credential profile; the beneficiary catalog is the IQ data group of that
// profile. RR and BETELL 1 collapse to one catalog, so only one profile per catalog is kept (the first by id).
export function catalogsForClient(client: Record<string, unknown> | null | undefined): ClientCatalogProfile[] {
  const byCatalog = new Map<string, ClientCatalogProfile>();
  const links = asRecord(asRecord(client).iqLinksByProfile);
  for (const profileId of Object.keys(links).sort()) {
    const link = asRecord(links[profileId]);
    const catalog = iqCatalogForAlias(link.profileAlias);
    const clientIqId = clean(link.clientId);
    if (!catalog || !clientIqId || link.active === false || clean(link.status).toUpperCase() !== "LINKED" || byCatalog.has(catalog)) continue;
    byCatalog.set(catalog, { catalog, profileId: clean(link.profileId) || profileId, profileAlias: clean(link.profileAlias), partnerName: clean(link.partnerName), clientIqId });
  }
  return [...byCatalog.values()];
}

// One reservation per account in one catalog: a retry, a second trigger or a second client reuses it.
export const createReservationId = (rootId: string, catalog: string, accountKey: string) =>
  `ibc_${createHash("sha256").update(JSON.stringify([rootId, catalog, accountKey])).digest("hex").slice(0, 48)}`;

export const linkActivityId = (methodId: string, catalog: string, accountKey: string, outcome: string) =>
  `ibl_${createHash("sha256").update(JSON.stringify([methodId, catalog, accountKey, outcome])).digest("hex").slice(0, 48)}`;

export const mexicoDay = (nowMs: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));

export const DEFAULT_DAILY_CREATE_LIMIT = 3;
export const MAX_DAILY_CREATE_LIMIT = 200;

export type CreateConfig = { enabled?: unknown; contractVerified?: unknown; dailyLimit?: unknown };
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
