import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { dailySyncRoots, runIqDailySyncForRoot, type DailySyncBudget } from "./service";

/**
 * Historical backfill of IQ operations (owner decision 2026-11-24): BETELL (IQ group RR) and EBASOR (ELIUT) from 2025-01 up to
 * 2026-11-23, oldest month first, only what IQ concluded. It reuses the daily sync engine on one calendar month at a time, so
 * every effect (original dates, wallet, beneficiaries, documents, no client messages for old dates) is the same one the daily
 * sync already has. It goes as fast as the safety budgets allow: a month closes when a run finds nothing left to create, and
 * the next month starts right away. Off until a superadmin turns it on.
 */

const IQ_CREDENTIALS_KEY = defineSecret("IQ_CREDENTIALS_KEY");
export const BACKFILL_PROCESS = "IQ_BACKFILL";
export const BACKFILL_DEFAULT_START_MONTH = "2025-01";
export const BACKFILL_DEFAULT_END_DATE = "2026-11-23";
/** One invocation works on at most this many months and stops starting new ones after this time. */
export const BACKFILL_MAX_MONTHS_PER_INVOCATION = 6;
export const BACKFILL_NO_NEW_MONTH_AFTER_MS = 270_000;
export const BACKFILL_BUDGET: Partial<DailySyncBudget> = { maxWrites: 1500, maxDurationMs: 240_000, maxErrors: 8, maxLayers: 3, maxDispersionsImported: 150, maxPagosPosted: 300, onlyConcretized: true };

const text = (value: unknown) => String(value ?? "").trim();
const db = () => getFirestore();

export const monthOf = (date: string) => date.slice(0, 7);
export function nextMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
}
export function monthWindow(month: string, endDate: string): { start: string; end: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const start = `${month}-01`;
  if (start > endDate) return null;
  const [year, mon] = month.split("-").map(Number);
  const last = `${month}-${String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, "0")}`;
  return { start, end: last < endDate ? last : endDate };
}

export type BackfillMonthStatus = "EN_CURSO" | "CUADRADO" | "CON_PENDIENTES";
/** A month is closed when a complete run found nothing left to create, link, import or credit. Pure. */
export function monthRunIsQuiet(groups: Array<{ status: string; created: Record<string, number>; clientsLinked?: number; clientsCreated?: number; dispersionsImported?: number; pagosPosted?: number }>): boolean {
  return groups.length > 0 && groups.every((group) => group.status === "COMPLETE" && !Object.values(group.created).some((count) => count > 0) && !group.clientsLinked && !group.clientsCreated && !group.dispersionsImported && !group.pagosPosted);
}

export const configRef = (rootId: string) => db().doc(`iqBackfillConfig/${rootId}`);
export const monthRef = (rootId: string, month: string) => db().doc(`iqBackfillMonths/${rootId}_${month}`);

async function openReviewsInWindow(rootId: string, window: { start: string; end: string }): Promise<number> {
  const open = await db().collection("iqDailySyncReviews").where("rootId", "==", rootId).where("status", "==", "OPEN").limit(5000).get();
  let count = 0;
  for (const doc of open.docs) {
    const date = [text(doc.get("evidence.display.date")), text(doc.get("evidence.date"))].find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
    if (date && date >= window.start && date <= window.end) count++;
  }
  return count;
}

export type BackfillInvocation = { rootId: string; status: "DISABLED" | "DONE" | "BUSY" | "PROGRESS" | "PAUSED"; monthsClosed: number; cursorMonth: string | null };

export async function runIqBackfillForRoot(input: { rootId: string; secret: string; now?: Date }): Promise<BackfillInvocation> {
  const rootId = text(input.rootId), started = Date.now();
  const cfgSnap = await configRef(rootId).get(), cfg = cfgSnap.data() || {};
  if (cfg.enabled !== true) return { rootId, status: "DISABLED", monthsClosed: 0, cursorMonth: text(cfg.cursorMonth) || null };
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(text(cfg.endDate)) ? text(cfg.endDate) : BACKFILL_DEFAULT_END_DATE;
  let cursor = text(cfg.cursorMonth) || text(cfg.startMonth) || BACKFILL_DEFAULT_START_MONTH, monthsClosed = 0;
  for (let i = 0; i < BACKFILL_MAX_MONTHS_PER_INVOCATION; i++) {
    const window = monthWindow(cursor, endDate);
    if (!window) {
      await configRef(rootId).set({ status: "DONE", cursorMonth: cursor, finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { rootId, status: "DONE", monthsClosed, cursorMonth: cursor };
    }
    if (i > 0 && Date.now() - started > BACKFILL_NO_NEW_MONTH_AFTER_MS) break;
    await configRef(rootId).set({ status: "RUNNING", cursorMonth: cursor, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const result = await runIqDailySyncForRoot({
      rootId, secret: input.secret, now: input.now, runKey: `bf-${cursor}-${new Date().toISOString()}`, budget: BACKFILL_BUDGET,
      backfill: { window, stateDocId: `${rootId}__backfill`, process: BACKFILL_PROCESS },
    });
    if (result.status === "BUSY") return { rootId, status: "BUSY", monthsClosed, cursorMonth: cursor };
    const quiet = result.status === "COMPLETE" && monthRunIsQuiet(result.groups);
    const pending = quiet ? await openReviewsInWindow(rootId, window) : null;
    const created = result.groups.reduce((out, group) => { for (const [type, count] of Object.entries(group.created)) out[type] = (out[type] || 0) + count; return out; }, {} as Record<string, number>);
    await monthRef(rootId, cursor).set({
      rootId, month: cursor, window, status: quiet ? (pending ? "CON_PENDIENTES" : "CUADRADO") : "EN_CURSO", openReviews: pending, lastRunStatus: result.status, lastSafety: result.safety,
      lastStopReason: result.groups.map((group) => group.stopReason).find(Boolean) || null, lastRunCreated: created, runs: FieldValue.increment(1), lastRunAt: FieldValue.serverTimestamp(),
      ...(quiet ? { closedAt: FieldValue.serverTimestamp() } : {}),
    }, { merge: true });
    if (result.status === "NOT_ADMITTED" || result.safety !== "SUCCEEDED" && !quiet) {
      await configRef(rootId).set({ status: "PAUSED", lastSafety: result.safety, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { rootId, status: "PAUSED", monthsClosed, cursorMonth: cursor };
    }
    if (!quiet) return { rootId, status: "PROGRESS", monthsClosed, cursorMonth: cursor };
    monthsClosed++;
    cursor = nextMonth(cursor);
    await configRef(rootId).set({ cursorMonth: cursor, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return { rootId, status: "PROGRESS", monthsClosed, cursorMonth: cursor };
}

// Every 30 minutes; a lease keeps two runs from overlapping and the safety breaker pauses it on repeated errors.
export const runIqHistoricalBackfill = onSchedule(
  { schedule: "*/30 * * * *", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 540, memory: "1GiB", retryCount: 0, maxInstances: 1, concurrency: 1, secrets: [IQ_CREDENTIALS_KEY] },
  async () => {
    for (const rootId of await dailySyncRoots()) {
      const outcome = await runIqBackfillForRoot({ rootId, secret: IQ_CREDENTIALS_KEY.value() });
      if (outcome.status !== "DISABLED") console.log("IQ_BACKFILL_SUMMARY", JSON.stringify({ status: outcome.status, monthsClosed: outcome.monthsClosed, cursorMonth: outcome.cursorMonth }));
    }
  },
);
