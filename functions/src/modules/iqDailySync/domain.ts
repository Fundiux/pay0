import { buildManifest, type P4Action, type P4EntityType, type P4Manifest, type P4ManifestContent } from "../iqHistoricalImport/domain";
import type { Pay0PlanRow } from "../iqHistoricalImport/planner";

/**
 * Pure rules of the automatic daily IQ → PAY0 reverse sync (owner decision 2026-11-22).
 *
 * The P4 planner decides what exists in IQ but not in PAY0 using strong IQ ids. The daily sync is stricter,
 * because it runs without a human approval step:
 *  - it only CREATES missing records (CREATE_HISTORICAL / DEPENDENCY_IMPORT); any RECONCILE becomes REVIEW,
 *    so a live PAY0 record is never rewritten as an IQ import;
 *  - before creating, a conservative secondary match looks for PAY0 records that LACK an IQ id but look like
 *    the same operation (see findPay0Lookalikes). Any lookalike turns the action into REVIEW, never CREATE;
 *  - an application whose invoice or deposit already existed in PAY0 goes to REVIEW (the P4 engine can only
 *    write parent balances for parents it creates in the same manifest);
 *  - review spreads to every action of the same financial component and to every dependent, so balances are
 *    never written for a partial component.
 */

export const DAILY_SYNC_TIMEZONE = "America/Mexico_City" as const;
export const DAILY_SYNC_MAX_CATCH_UP_DAYS = 7;
const DAY_MS = 86_400_000;

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const upper = (value: unknown) => text(value).toLocaleUpperCase("es-MX");
const minor = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? Math.round(n * 100) : null; };

export function mexicoDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DAILY_SYNC_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
function dayDistance(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY_MS);
}

/**
 * Window = from the first day not yet completed (at most 7 days back, at least yesterday) through today.
 * Yesterday is always included, so an operation registered in IQ late in the day is seen by the next run.
 */
export function dailyWindow(now: Date, lastCompletedDate?: string | null): { start: string; end: string; timezone: typeof DAILY_SYNC_TIMEZONE } {
  const today = mexicoDate(now), yesterday = addDays(today, -1), floor = addDays(today, -(DAILY_SYNC_MAX_CATCH_UP_DAYS - 1));
  let start = yesterday;
  if (lastCompletedDate && /^\d{4}-\d{2}-\d{2}$/.test(lastCompletedDate)) {
    const next = addDays(lastCompletedDate, 1);
    if (next < start) start = next < floor ? floor : next;
  } else start = yesterday;
  return { start, end: today, timezone: DAILY_SYNC_TIMEZONE };
}

/** How far back an open review is re-read. Beyond this, a review waits for the person (or the historical import). */
export const DAILY_SYNC_MAX_REVIEW_LOOKBACK_DAYS = 10;

/**
 * Reviews are only re-evaluated while their day is inside the window, so a review of an operation from three days ago
 * would stay open for ever even after the cause is fixed. The window reaches back to the oldest open review, at most
 * DAILY_SYNC_MAX_REVIEW_LOOKBACK_DAYS before today. It never moves forward and never changes which day counts as completed.
 */
export function widenWindowForOpenReviews(window: { start: string; end: string; timezone: typeof DAILY_SYNC_TIMEZONE }, oldestOpenReviewDate: string | null | undefined, now: Date) {
  if (!oldestOpenReviewDate || !/^\d{4}-\d{2}-\d{2}$/.test(oldestOpenReviewDate)) return window;
  const floor = addDays(mexicoDate(now), -DAILY_SYNC_MAX_REVIEW_LOOKBACK_DAYS);
  const wanted = oldestOpenReviewDate < floor ? floor : oldestOpenReviewDate;
  return wanted < window.start ? { ...window, start: wanted } : window;
}

export const DAILY_EXECUTABLE_OPERATIONS = new Set(["CREATE_HISTORICAL", "DEPENDENCY_IMPORT"]);
const REVIEW_OPERATIONS = new Set(["CANONICAL_DEPENDENCY_PENDING", "REVIEW_REQUIRED", "CLIENT_REVIEW_REQUIRED", "FINANCIAL_RECONCILIATION_REVIEW", "HISTORICAL_DATE_REVIEW_REQUIRED"]);
const STRONG_IQ_FIELDS: Record<Exclude<P4EntityType, "CLIENT">, string[]> = {
  SOLICITUD: ["iqId", "iqFolio", "iqInvoiceId", "externalIqId", "originalIqEntityId"],
  PAYMENT: ["iqDepositId", "iqDepositFolio", "iqPagoDepositId", "iqPagoDepositFolio", "iqId", "iqFolio", "externalIqId", "originalIqEntityId"],
  APPLICATION: ["iqApplicationId", "externalIqId", "originalIqEntityId"],
};
const COLLECTION: Record<P4EntityType, Pay0PlanRow["collection"]> = { CLIENT: "clients", SOLICITUD: "solicitudes", PAYMENT: "pagos", APPLICATION: "pagoAplicaciones" };
const GENERIC_RFCS = new Set(["XAXX010101000", "XEXX010101000"]);

function rowDate(value: unknown): string | null {
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const at = (value as { toDate: () => Date }).toDate(); return Number.isFinite(at.getTime()) ? mexicoDate(at) : null;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? mexicoDate(value) : null;
  const raw = text(value); if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Date.parse(raw); return Number.isFinite(ms) ? mexicoDate(new Date(ms)) : null;
}
const isDeleted = (row: Record<string, unknown>) => row.isDeleted === true || Boolean(row.deletedAt) || ["ELIMINADA", "ELIMINADO"].includes(upper(row.status));
const hasStrongIqId = (type: Exclude<P4EntityType, "CLIENT">, row: Record<string, unknown>) => STRONG_IQ_FIELDS[type].some(field => text(row[field]));
const clientOf = (row: Record<string, unknown>) => text(row.clientId) || text(row.clienteId);

export type Lookalike = { path: string; folioMatch: boolean };

/**
 * Secondary duplicate rule (for PAY0 records whose IQ id was never written back, e.g. an IQ push with an
 * unknown outcome or still in flight). A PAY0 record is a lookalike of the IQ operation when ALL hold:
 *  - same collection and same root, not deleted, and it has NO strong IQ id (a record with a different IQ id
 *    is a different IQ operation);
 *  - same PAY0 client (the client the IQ client resolves to);
 *  - same amount to the cent;
 *  - its date is within ±1 day of the IQ date (Mexico City civil date);
 *  - applications: same PAY0 invoice and deposit instead of client/date.
 * Folio/reference agreement is recorded as evidence but is not required: any lookalike blocks creation.
 */
export function findPay0Lookalikes(action: P4Action, pay0Rows: Pay0PlanRow[]): Lookalike[] {
  if (action.entityType === "CLIENT") {
    const rfc = upper(action.after.rfc), name = upper(action.after.name);
    return pay0Rows.filter(row => row.collection === "clients" && !isDeleted(row.data)).filter(row => {
      const rowRfc = upper(row.data.rfc), rowName = upper(row.data.name ?? row.data.razonSocial ?? row.data.nombre);
      return (rfc && !GENERIC_RFCS.has(rfc) && rowRfc === rfc) || (name && rowName === name);
    }).map(row => ({ path: `clients/${row.id}`, folioMatch: false }));
  }
  const type = action.entityType, amount = minor(type === "APPLICATION" ? action.after.montoAplicado : action.after.monto);
  if (amount === null) return [];
  const iqFolio = text(action.after.iqFolio) || text(action.after.folio);
  return pay0Rows.filter(row => row.collection === COLLECTION[type] && !isDeleted(row.data) && !hasStrongIqId(type, row.data)).filter(row => {
    if (type === "APPLICATION") return text(row.data.solicitudId) === text(action.after.solicitudId) && text(row.data.pagoId) === text(action.after.pagoId) && minor(row.data.montoAplicado ?? row.data.monto) === amount;
    if (!clientOf(row.data) || clientOf(row.data) !== text(action.after.clientId)) return false;
    if (minor(row.data.monto ?? row.data.montoTotal ?? row.data.total) !== amount) return false;
    const iqDate = action.historicalTime?.normalizedDate, pay0Date = rowDate(type === "PAYMENT" ? (row.data.fechaPago ?? row.data.reportDateAt ?? row.data.createdAt) : row.data.createdAt);
    return !!iqDate && !!pay0Date && dayDistance(iqDate, pay0Date) <= 1;
  }).map(row => ({ path: `${row.collection}/${row.id}`, folioMatch: !!iqFolio && [row.data.folio, row.data.reference, row.data.referencia, row.data.externalReference].map(text).includes(iqFolio) }));
}

export type DailyReviewCode =
  | "DAILY_RECONCILE_REQUIRES_REVIEW" | "POSSIBLE_PAY0_DUPLICATE" | "POSSIBLE_PAY0_CLIENT_DUPLICATE"
  | "APPLICATION_ON_EXISTING_PARENT" | "CANONICAL_FIELDS_REVIEW" | "COMPONENT_IN_REVIEW" | "DEPENDENCY_IN_REVIEW";

function toReview(action: P4Action, code: DailyReviewCode, evidence: Record<string, unknown>): P4Action {
  const operation = action.entityType === "CLIENT" ? "CLIENT_REVIEW_REQUIRED" : "REVIEW_REQUIRED";
  const priorReasons = action.canonicalEvidence?.reviewReasons || [];
  return {
    ...action, operation, after: {}, reason: code,
    matchingEvidence: { ...action.matchingEvidence, method: "UNRESOLVED_STRONG_ID", dailySync: { code, plannedOperation: action.operation, ...evidence } },
    ...(action.canonicalEvidence ? { canonicalEvidence: { ...action.canonicalEvidence, readiness: "CANONICAL_REVIEW_REQUIRED" as const, reviewReasons: [...new Set([...priorReasons, code])].sort() } } : {}),
    expectedDelta: { operation, fields: [], relationships: action.dependencies || [], expectedExternalEffects: 0 },
  };
}

export type DailyReview = { entityType: string; iqEntityId: string; canonicalGroupId: string; code: string; detail: string; evidence: Record<string, unknown> };

/** Applies the daily-sync safety rules to a server-built manifest and returns the rebuilt (re-hashed) manifest. */
export function applyDailySyncSafety(manifest: P4Manifest, pay0Rows: Pay0PlanRow[]): { manifest: P4Manifest; converted: Record<string, number> } {
  const byId = new Map(manifest.actions.map(action => [action.actionId, action]));
  const converted: Record<string, number> = {};
  const convert = (action: P4Action, code: DailyReviewCode, evidence: Record<string, unknown> = {}) => {
    byId.set(action.actionId, toReview(action, code, evidence)); converted[code] = (converted[code] || 0) + 1;
  };
  for (const action of manifest.actions) {
    if (action.operation === "RECONCILE") { convert(action, "DAILY_RECONCILE_REQUIRES_REVIEW", { reconcileMethod: action.matchingEvidence?.method || null }); continue; }
    if (!DAILY_EXECUTABLE_OPERATIONS.has(action.operation)) continue;
    if (action.canonicalEvidence && action.canonicalEvidence.readiness !== "CANONICAL_READY") { convert(action, "CANONICAL_FIELDS_REVIEW", { reasons: action.canonicalEvidence.reviewReasons }); continue; }
    const lookalikes = findPay0Lookalikes(action, pay0Rows);
    if (lookalikes.length) { convert(action, action.entityType === "CLIENT" ? "POSSIBLE_PAY0_CLIENT_DUPLICATE" : "POSSIBLE_PAY0_DUPLICATE", { candidateCount: lookalikes.length, candidates: lookalikes.map(row => row.path).sort().slice(0, 10), folioMatch: lookalikes.some(row => row.folioMatch) }); continue; }
    if (action.entityType === "APPLICATION") {
      const parents = (action.dependencies || []).map(id => byId.get(id)).filter(parent => parent && parent.entityType !== "CLIENT") as P4Action[];
      // A parent created by PAY0 itself has its balance managed by PAY0's own application flow: review.
      // A parent imported from IQ on an earlier day is moved forward by the executor only on an exact-cent match.
      const pay0Native = parents.filter(parent => ["NO_OP", "EXISTING"].includes(parent.operation)).filter(parent => {
        const [collection, id] = parent.targetPath.split("/"), row = pay0Rows.find(candidate => candidate.collection === collection && candidate.id === id);
        return !row || row.data.source !== "IQ_IMPORT";
      });
      if (pay0Native.length) convert(action, "APPLICATION_ON_EXISTING_PARENT", { parents: pay0Native.map(parent => `${parent.entityType}:${parent.operation}`).sort() });
    }
  }
  // Fixed point: a component with any review member is reviewed whole; a dependent of a review action is reviewed.
  for (let changed = true; changed;) {
    changed = false;
    const reviewComponents = new Set([...byId.values()].filter(action => action.componentId && REVIEW_OPERATIONS.has(action.operation)).map(action => action.componentId as string));
    for (const action of [...byId.values()]) {
      if (!DAILY_EXECUTABLE_OPERATIONS.has(action.operation)) continue;
      if (action.componentId && reviewComponents.has(action.componentId)) { convert(action, "COMPONENT_IN_REVIEW", { componentId: action.componentId }); changed = true; continue; }
      const blocked = (action.dependencies || []).map(id => byId.get(id)).find(dependency => dependency && REVIEW_OPERATIONS.has(dependency.operation));
      if (blocked) { convert(action, "DEPENDENCY_IN_REVIEW", { dependencyEntityType: blocked.entityType, dependencyIqEntityId: blocked.iqEntityId }); changed = true; }
    }
  }
  if (!Object.keys(converted).length) return { manifest, converted };
  const { manifestId: _id, manifestHash: _hash, status: _status, ...content } = manifest;
  const rebuilt = buildManifest({ ...(content as P4ManifestContent), actions: manifest.actions.map(action => byId.get(action.actionId)!) });
  return { manifest: rebuilt, converted };
}

/** Review items of a final manifest: every action the daily sync will not write and that is not already in PAY0. */
export function reviewItems(manifest: P4Manifest): DailyReview[] {
  return manifest.actions.filter(action => REVIEW_OPERATIONS.has(action.operation) || action.operation === "RECONCILE").map(action => {
    const daily = (action.matchingEvidence?.dailySync || {}) as Record<string, unknown>;
    const code = text(daily.code) || text(action.reason).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80) || action.operation;
    return { entityType: action.entityType, iqEntityId: action.iqEntityId, canonicalGroupId: action.canonicalGroupId, code, detail: text(action.reason).slice(0, 200),
      evidence: { operation: action.operation, ...(Object.keys(daily).length ? { dailySync: daily } : {}), reviewReasons: action.canonicalEvidence?.reviewReasons || [] } };
  });
}

/** Entities that are already in PAY0 (strong IQ link) after the final plan: their open reviews can be closed. */
export function resolvedEntities(manifest: P4Manifest): Array<{ entityType: string; iqEntityId: string; canonicalGroupId: string }> {
  return manifest.actions.filter(action => ["NO_OP", "EXISTING"].includes(action.operation)).map(action => ({ entityType: action.entityType, iqEntityId: action.iqEntityId, canonicalGroupId: action.canonicalGroupId }));
}

const PHASE_ORDER: Record<P4EntityType, number> = { CLIENT: 0, SOLICITUD: 1, PAYMENT: 2, APPLICATION: 3 };
export function executionQueue(manifest: P4Manifest): P4Action[] {
  return manifest.actions.filter(action => DAILY_EXECUTABLE_OPERATIONS.has(action.operation))
    .sort((a, b) => PHASE_ORDER[a.entityType] - PHASE_ORDER[b.entityType] || a.actionId.localeCompare(b.actionId));
}
