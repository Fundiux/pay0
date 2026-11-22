import { randomUUID } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { CONSERVATIVE_POLICY, SafetyRuntime, SafetyStop, type Policy } from "../automationSafety/runtime";
import { readEnabledIqAutomationRoots } from "../iq/automationRuntime";
import { deterministicId, P4EngineError, type P4Manifest } from "../iqHistoricalImport/domain";
import { discoverServerPlan, type DiscoveryBudget } from "../iqHistoricalImport/discovery";
import { actionEligibility, type P4ActionProgress } from "../iqHistoricalImport/phasedExecution";
import { buildServerPlan, P4_PLAN_GROUPS } from "../iqHistoricalImport/planner";
import { executeAction, markDailySyncManifest, persistDailySyncManifest, type Context } from "../iqHistoricalImport/service";
import { addDays, applyDailySyncSafety, dailyWindow, executionQueue, mexicoDate, resolvedEntities, reviewItems, type DailyReview } from "./domain";
import { detectIqDispersions } from "./dispersions";

/**
 * Automatic daily IQ → PAY0 reverse sync (owner decisions 2026-11-22): every day, operations registered
 * directly in IQ are recovered into PAY0 without a button or approval step.
 *
 * - Runs as a SERVICE (no request.auth); the system actor "system:iq-daily-sync" is recorded on every audit row.
 * - Per root and IQ group it plans with the P4 planner, applies the daily safety rules (iqDailySync/domain.ts),
 *   persists the manifest (auto-approved by policy) and executes only CREATE actions with the P4 executor.
 *   Created rows carry source IQ_IMPORT + importMode DAILY_SYNC (see iq/historicalImportGuard.ts).
 * - Bounded per run (writes, duration, errors, layers) and resumable: the next run replans the same window and
 *   rows already created are NO_OP by strong IQ id; the window only advances when a run completes.
 * - All IQ reads run inside SafetyRuntime (process IQ_DAILY_SYNC), so they have a kill switch, a circuit breaker,
 *   backoff and an external-request budget.
 * - Everything not written becomes a review item (iqDailySyncReviews) surfaced as a Control Center incident.
 */

const IQ_CREDENTIALS_KEY = defineSecret("IQ_CREDENTIALS_KEY");
export const IQ_DAILY_SYNC_ACTOR_UID = "system:iq-daily-sync";
export const IQ_DAILY_SYNC_PROCESS = "IQ_DAILY_SYNC";
export const IQ_DAILY_SYNC_GROUPS = ["iq-group-pay0", "iq-group-rr"] as const;
export const IQ_DAILY_SYNC_POLICY: Policy = { ...CONSERVATIVE_POLICY, maxExternalRequests: 2500, leaseMs: 600_000 };
const LEASE_MS = 570_000;

export type DailySyncBudget = { maxWrites: number; maxDurationMs: number; maxErrors: number; maxLayers: number; maxPlanningPages: number; maxPlanningRecords: number; maxFirestoreReads: number; maxDispersionPages: number };
export const DEFAULT_DAILY_SYNC_BUDGET: DailySyncBudget = { maxWrites: 150, maxDurationMs: 420_000, maxErrors: 5, maxLayers: 3, maxPlanningPages: 1800, maxPlanningRecords: 10_000, maxFirestoreReads: 10_000, maxDispersionPages: 20 };

const text = (value: unknown) => String(value ?? "").trim();
const db = () => getFirestore();
const reviewId = (rootId: string, groupId: string, entityType: string, iqEntityId: string) => `iqdr_${deterministicId(rootId, groupId, entityType, iqEntityId).slice(0, 32)}`;

type Counts = Record<string, number>;
type GroupResult = {
  groupId: string; status: "COMPLETE" | "PARTIAL" | "FAILED"; stopReason: string | null; layers: number;
  created: Counts; noop: number; failed: number; reviewsOpen: number; reviewsNew: number; reviewsResolved: number;
  dispersionsObserved: number; dispersionsMissing: number;
};
export type RootResult = { rootId: string; status: string; window: { start: string; end: string } | null; groups: GroupResult[]; safety: string };
type Tracker = { started: number; writes: number; errors: number; budget: DailySyncBudget };

const exhausted = (t: Tracker) => t.writes >= t.budget.maxWrites || t.errors >= t.budget.maxErrors || Date.now() - t.started >= t.budget.maxDurationMs;
const remainingMs = (t: Tracker) => Math.max(10_000, t.budget.maxDurationMs - (Date.now() - t.started));

/** IQ transport failures keep their HTTP status so SafetyRuntime counts them toward the circuit breaker. */
function providerError(error: unknown): Error | null {
  if (error instanceof SafetyStop) return null;
  const message = text((error as Error)?.message), explicit = Number((error as { status?: unknown })?.status);
  const status = Number.isFinite(explicit) && explicit >= 400 ? explicit : Number(message.match(/IQ [a-z -]*failed (?:HTTP_)?(\d{3})/i)?.[1]);
  if (Number.isFinite(status) && status >= 400) return Object.assign(new Error(`IQ_DAILY_SYNC_HTTP_${status}`), { status });
  if (/IQ_HTTP_TIMEOUT/.test(message)) return new Error("IQ_DAILY_SYNC_TIMEOUT");
  return null;
}

async function loadProgress(runId: string): Promise<P4ActionProgress> {
  const snap = await db().collection("p4ImportRuns").doc(runId).collection("actions").get();
  return Object.fromEntries(snap.docs.map(doc => [doc.id, text(doc.get("status")) || "PENDING"])) as P4ActionProgress;
}

async function executeManifest(ctx: Context, manifest: P4Manifest, tracker: Tracker, dailyRunId: string) {
  const runRef = db().collection("p4ImportRuns").doc(dailyRunId);
  await runRef.set({ runId: dailyRunId, manifestId: manifest.manifestId, manifestHash: manifest.manifestHash, rootId: ctx.rootId, importMode: "DAILY_SYNC", owner: ctx.uid, actorType: "SYSTEM", status: "RUNNING", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const progress = await loadProgress(dailyRunId), created: Counts = {}, failures: DailyReview[] = [], createdPayments: Array<{ iqEntityId: string; path: string }> = [];
  let noop = 0, failed = 0, budgetStop = false, clientsCreated = 0;
  for (const action of executionQueue(manifest)) {
    if (exhausted(tracker)) { budgetStop = true; break; }
    if (!actionEligibility(manifest, action, progress).eligible) continue;
    try {
      const result = await executeAction(ctx, dailyRunId, manifest, action, true, undefined, undefined, { importMode: "DAILY_SYNC" });
      progress[action.actionId] = result.progressStatus;
      if (result.outcome === "COMPLETED") {
        tracker.writes++; created[action.entityType] = (created[action.entityType] || 0) + 1;
        if (action.entityType === "CLIENT") clientsCreated++;
        if (action.entityType === "PAYMENT") createdPayments.push({ iqEntityId: action.iqEntityId, path: action.targetPath });
      } else noop++;
    } catch (error) {
      tracker.errors++; failed++; progress[action.actionId] = "FAILED";
      const code = error instanceof P4EngineError ? error.code : "P4_INTERNAL";
      await runRef.collection("actions").doc(action.actionId).set({ status: "FAILED", manifestId: manifest.manifestId, actionId: action.actionId, entityType: action.entityType, iqEntityId: action.iqEntityId, operation: action.operation, errorCode: code, failedAt: FieldValue.serverTimestamp() }, { merge: true });
      failures.push({ entityType: action.entityType, iqEntityId: action.iqEntityId, canonicalGroupId: action.canonicalGroupId, code, detail: text((error as Error)?.message).slice(0, 200), evidence: { operation: action.operation, executionFailure: true } });
    }
  }
  const pending = executionQueue(manifest).filter(action => actionEligibility(manifest, action, progress).eligible).length;
  const done = !budgetStop && failed === 0 && pending === 0;
  await runRef.set({ status: done ? "COMPLETED" : budgetStop ? "PAUSED_BUDGET" : "PAUSED_ERROR", created, noop, failed, pending, updatedAt: FieldValue.serverTimestamp(), ...(done ? { finishedAt: FieldValue.serverTimestamp() } : {}) }, { merge: true });
  await markDailySyncManifest(manifest.manifestId, done ? "COMPLETED" : "APPROVED");
  return { created, noop, failed, failures, createdPayments, budgetStop, clientsCreated, done, progress };
}

async function upsertReviews(rootId: string, groupId: string, window: { start: string; end: string }, reviews: DailyReview[], resolved: Array<{ entityType: string; iqEntityId: string }>) {
  const firestore = db(), collection = firestore.collection("iqDailySyncReviews");
  let reviewsNew = 0, reviewsResolved = 0;
  const unique = new Map(reviews.map(review => [reviewId(rootId, groupId, review.entityType, review.iqEntityId), review]));
  const resolvedIds = [...new Set(resolved.map(row => reviewId(rootId, groupId, row.entityType, row.iqEntityId)))].filter(id => !unique.has(id));
  const writes: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  const ids = [...unique.keys()];
  for (let i = 0; i < ids.length; i += 300) {
    const snaps = await firestore.getAll(...ids.slice(i, i + 300).map(id => collection.doc(id)));
    for (const snap of snaps) {
      const review = unique.get(snap.id)!, isNew = !snap.exists || snap.get("status") !== "OPEN";
      if (isNew) reviewsNew++;
      writes.push(batch => batch.set(snap.ref, {
        rootId, canonicalGroupId: groupId, entityType: review.entityType, iqEntityId: review.iqEntityId, code: review.code, detail: review.detail, evidence: review.evidence,
        status: "OPEN", source: "IQ_DAILY_SYNC", lastSeenAt: FieldValue.serverTimestamp(), lastSeenWindow: window, seenCount: FieldValue.increment(1),
        ...(isNew ? { openedAt: FieldValue.serverTimestamp(), resolvedAt: null, resolution: null } : {}),
      }, { merge: true }));
    }
  }
  for (let i = 0; i < resolvedIds.length; i += 300) {
    const snaps = await firestore.getAll(...resolvedIds.slice(i, i + 300).map(id => collection.doc(id)));
    for (const snap of snaps) if (snap.exists && snap.get("status") === "OPEN") {
      reviewsResolved++;
      writes.push(batch => batch.set(snap.ref, { status: "RESOLVED", resolution: "IQ_ID_LINKED_IN_PAY0", resolvedAt: FieldValue.serverTimestamp(), resolvedBy: IQ_DAILY_SYNC_ACTOR_UID }, { merge: true }));
    }
  }
  for (let i = 0; i < writes.length; i += 400) { const batch = firestore.batch(); writes.slice(i, i + 400).forEach(write => write(batch)); await batch.commit(); }
  return { reviewsNew, reviewsResolved };
}

/** Recovered pagos need PAY0's operation type to build the wallet posting snapshot; once posted, close the review. */
async function resolvePostedPaymentReviews(rootId: string) {
  const firestore = db(), open = await firestore.collection("iqDailySyncReviews").where("rootId", "==", rootId).where("status", "==", "OPEN").where("code", "==", "WALLET_POSTING_REQUIRES_OPERATION_TYPE").limit(200).get();
  let resolved = 0;
  for (const doc of open.docs) {
    const path = text(doc.get("evidence.pagoPath"));
    if (!/^pagos\/[A-Za-z0-9_-]+$/.test(path)) continue;
    const pago = await firestore.doc(path).get();
    if (text(pago.get("financialPostingStatus")).toUpperCase() !== "POSTED") continue;
    await doc.ref.set({ status: "RESOLVED", resolution: "WALLET_POSTED", resolvedAt: FieldValue.serverTimestamp(), resolvedBy: IQ_DAILY_SYNC_ACTOR_UID }, { merge: true });
    resolved++;
  }
  return resolved;
}

async function syncGroup(ctx: Context, groupId: string, window: { start: string; end: string; timezone: "America/Mexico_City" }, tracker: Tracker, secret: string): Promise<GroupResult> {
  const result: GroupResult = { groupId, status: "COMPLETE", stopReason: null, layers: 0, created: {}, noop: 0, failed: 0, reviewsOpen: 0, reviewsNew: 0, reviewsResolved: 0, dispersionsObserved: 0, dispersionsMissing: 0 };
  let finalManifest: P4Manifest | null = null;
  const failures: DailyReview[] = [], extraReviews: DailyReview[] = [], extraResolved: Array<{ entityType: string; iqEntityId: string }> = [];
  for (let layer = 0; layer < tracker.budget.maxLayers; layer++) {
    if (exhausted(tracker)) { result.status = "PARTIAL"; result.stopReason = "RUN_BUDGET"; break; }
    result.layers++;
    const planningBudget: DiscoveryBudget = { maxPages: tracker.budget.maxPlanningPages, maxRecords: tracker.budget.maxPlanningRecords, maxFirestoreReads: tracker.budget.maxFirestoreReads, maxDurationMs: remainingMs(tracker) };
    const discovered = await discoverServerPlan({ rootId: ctx.rootId, groupIds: [groupId], range: window, secret, budget: planningBudget });
    if (discovered.partial) { result.status = "PARTIAL"; result.stopReason = "PLAN_BUDGET"; finalManifest = null; break; }
    const { manifest, summary } = buildServerPlan({ rootId: ctx.rootId, range: window, groupIds: [groupId], iqRows: discovered.iqRows, pay0Rows: discovered.pay0Rows, tombstones: discovered.tombstones });
    const safe = applyDailySyncSafety(manifest, discovered.pay0Rows);
    finalManifest = safe.manifest;
    if (!executionQueue(safe.manifest).length) break;
    const dailyRunId = `p4d_${safe.manifest.manifestHash.slice(0, 24)}`;
    await persistDailySyncManifest({ ctx, manifest: safe.manifest, summary: { ...summary, dailySyncConverted: safe.converted }, metrics: discovered.metrics, dailyRunId });
    const executed = await executeManifest(ctx, safe.manifest, tracker, dailyRunId);
    for (const [type, count] of Object.entries(executed.created)) result.created[type] = (result.created[type] || 0) + count;
    result.noop += executed.noop; result.failed += executed.failed; failures.push(...executed.failures);
    for (const payment of executed.createdPayments) extraReviews.push({ entityType: "PAYMENT_POSTING", iqEntityId: payment.iqEntityId, canonicalGroupId: groupId, code: "WALLET_POSTING_REQUIRES_OPERATION_TYPE", detail: "Pago recuperado de IQ: el posteo a wallet requiere el tipo de operación de PAY0.", evidence: { pagoPath: payment.path } });
    for (const action of safe.manifest.actions) if (executed.progress[action.actionId] === "COMPLETED") extraResolved.push({ entityType: action.entityType, iqEntityId: action.iqEntityId });
    if (executed.budgetStop) { result.status = "PARTIAL"; result.stopReason = "RUN_BUDGET"; break; }
    if (executed.failed) { result.status = "PARTIAL"; result.stopReason = "EXECUTION_ERRORS"; break; }
    // A new client unlocks its invoices/deposits only on the next plan (the planner needs the PAY0 client root).
    if (!executed.clientsCreated) break;
  }
  if (finalManifest && result.status === "COMPLETE") {
    const reviews = [...reviewItems(finalManifest).filter(review => !extraResolved.some(row => row.entityType === review.entityType && row.iqEntityId === review.iqEntityId)), ...failures, ...extraReviews];
    const resolved = [...resolvedEntities(finalManifest), ...extraResolved];
    const written = await upsertReviews(ctx.rootId, groupId, window, reviews, resolved);
    result.reviewsNew += written.reviewsNew; result.reviewsResolved += written.reviewsResolved; result.reviewsOpen += reviews.length;
  } else if (failures.length || extraReviews.length) {
    // A partial run still records its failures and the wallet follow-ups of what it created.
    const written = await upsertReviews(ctx.rootId, groupId, window, [...failures, ...extraReviews], extraResolved);
    result.reviewsNew += written.reviewsNew; result.reviewsResolved += written.reviewsResolved; result.reviewsOpen += failures.length + extraReviews.length;
  }
  if (!exhausted(tracker)) {
    const detection = await detectIqDispersions({ rootId: ctx.rootId, groupId, range: window, secret, maxPages: tracker.budget.maxDispersionPages });
    const missing = detection.observed.filter(row => !row.inPay0);
    result.dispersionsObserved = detection.observed.length; result.dispersionsMissing = missing.length;
    const written = await upsertReviews(ctx.rootId, groupId, window,
      missing.map(row => ({ entityType: "DISPERSION", iqEntityId: row.iqDispersionId, canonicalGroupId: groupId, code: "IQ_DISPERSION_NOT_IN_PAY0", detail: "Dispersión registrada directamente en IQ sin dispersión equivalente en PAY0.", evidence: { date: row.date, amount: row.amount, operationStatus: row.operationStatus, observedThroughProfileId: row.profileId } })),
      detection.observed.filter(row => row.inPay0).map(row => ({ entityType: "DISPERSION", iqEntityId: row.iqDispersionId })));
    result.reviewsNew += written.reviewsNew; result.reviewsResolved += written.reviewsResolved; result.reviewsOpen += missing.length;
    if (detection.truncated && result.status === "COMPLETE") { result.status = "PARTIAL"; result.stopReason = "DISPERSION_PAGE_BUDGET"; }
  } else if (result.status === "COMPLETE") { result.status = "PARTIAL"; result.stopReason = "RUN_BUDGET"; }
  return result;
}

async function publishIncident(rootId: string) {
  const firestore = db(), open = await firestore.collection("iqDailySyncReviews").where("rootId", "==", rootId).where("status", "==", "OPEN").select("code").limit(2000).get();
  const countsByCode: Counts = {};
  for (const doc of open.docs) { const code = text(doc.get("code")) || "UNKNOWN"; countsByCode[code] = (countsByCode[code] || 0) + 1; }
  const ref = firestore.collection("analyticsRoots").doc(rootId).collection("incidents").doc("iq-daily-sync-review");
  if (!open.size) { await ref.delete(); return { openCount: 0, countsByCode }; }
  const topCode = Object.entries(countsByCode).sort((a, b) => b[1] - a[1])[0][0];
  await ref.set({ source: "iqDailySyncReviews", entityId: "IQ_DAILY_SYNC", solicitudId: "", kind: "IQ_DAILY_SYNC_REVIEW", status: "NEEDS_REVIEW", lastErrorCode: topCode,
    openCount: open.size, openCountTruncated: open.size >= 2000, countsByCode, title: "Sincronización diaria IQ: operaciones por revisar", updatedAt: FieldValue.serverTimestamp() });
  return { openCount: open.size, countsByCode };
}

async function acquireLease(rootId: string, now: number) {
  const ref = db().collection("iqDailySyncState").doc(rootId), token = randomUUID();
  const state = await db().runTransaction(async tx => {
    const snap = await tx.get(ref), data = snap.data() || {};
    if (Number(data.leaseUntil || 0) > now) return null;
    tx.set(ref, { rootId, leaseToken: token, leaseUntil: now + LEASE_MS, leaseAcquiredAt: FieldValue.serverTimestamp() }, { merge: true });
    return data;
  });
  return state ? { ref, token, state } : null;
}

async function releaseLease(ref: FirebaseFirestore.DocumentReference, token: string, patch: Record<string, unknown>) {
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.get("leaseToken") !== token) return;
    tx.set(ref, { ...patch, leaseToken: null, leaseUntil: 0, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

export async function runIqDailySyncForRoot(input: { rootId: string; secret: string; now?: Date; runKey?: string; budget?: Partial<DailySyncBudget>; groups?: readonly string[] }): Promise<RootResult> {
  const now = input.now ?? new Date(), rootId = text(input.rootId);
  const runKey = text(input.runKey) || `${mexicoDate(now)}-${Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hourCycle: "h23" }).format(now)) < 12 ? "AM" : "PM"}`;
  const lease = await acquireLease(rootId, Date.now());
  if (!lease) return { rootId, status: "BUSY", window: null, groups: [], safety: "LEASE_HELD" };
  const window = dailyWindow(now, text(lease.state.lastCompletedDate) || null);
  const tracker: Tracker = { started: Date.now(), writes: 0, errors: 0, budget: { ...DEFAULT_DAILY_SYNC_BUDGET, ...(input.budget || {}) } };
  const ctx: Context = { uid: IQ_DAILY_SYNC_ACTOR_UID, rootId };
  const groups: GroupResult[] = [], runDoc = db().collection("iqDailySyncRuns").doc(`iqds_${deterministicId(rootId, runKey).slice(0, 24)}`);
  let safety = "NOT_RUN", status = "FAILED";
  try {
    const guarded = await new SafetyRuntime(db()).run({
      rootId, process: IQ_DAILY_SYNC_PROCESS, operationType: "IQ_DAILY_REVERSE_SYNC", operationId: `${rootId}:${runKey}`, idempotencyKey: `${runKey}:${window.start}:${window.end}`,
      origin: "AUTOMATIC", technicalOrigin: "SCHEDULER", externalTarget: "IQ", policy: IQ_DAILY_SYNC_POLICY,
    }, async () => {
      const ordered = [...(input.groups || IQ_DAILY_SYNC_GROUPS)];
      for (const groupId of ordered) {
        if (!P4_PLAN_GROUPS[groupId]) continue;
        try { groups.push(await syncGroup(ctx, groupId, window, tracker, input.secret)); }
        catch (error) {
          groups.push({ groupId, status: "FAILED", stopReason: error instanceof SafetyStop ? error.reason : text((error as { code?: unknown })?.code) || "GROUP_FAILED", layers: 0, created: {}, noop: 0, failed: 0, reviewsOpen: 0, reviewsNew: 0, reviewsResolved: 0, dispersionsObserved: 0, dispersionsMissing: 0 });
          if (error instanceof SafetyStop) break;
          const provider = providerError(error);
          if (provider) throw provider;
        }
      }
      return groups;
    });
    safety = guarded.reason;
    status = !guarded.admitted ? "NOT_ADMITTED" : groups.length && groups.every(group => group.status === "COMPLETE") ? "COMPLETE" : "PARTIAL";
  } finally {
    const complete = status === "COMPLETE", lastCompletedDate = addDays(window.end, -1);
    const priorCompleted = text(lease.state.lastCompletedDate);
    await releaseLease(lease.ref, lease.token, { lastRunKey: runKey, lastRunStatus: status, lastSafetyResult: safety, lastWindow: window, lastRunAt: FieldValue.serverTimestamp(),
      ...(complete && (!priorCompleted || lastCompletedDate > priorCompleted) ? { lastCompletedDate } : {}) });
  }
  const postedResolved = status === "NOT_ADMITTED" ? 0 : await resolvePostedPaymentReviews(rootId);
  const incident = await publishIncident(rootId);
  const totals = groups.reduce((out, group) => {
    for (const [type, count] of Object.entries(group.created)) out.created[type] = (out.created[type] || 0) + count;
    out.failed += group.failed; out.reviewsNew += group.reviewsNew; out.reviewsResolved += group.reviewsResolved; out.dispersionsMissing += group.dispersionsMissing; return out;
  }, { created: {} as Counts, failed: 0, reviewsNew: 0, reviewsResolved: postedResolved, dispersionsMissing: 0 });
  await runDoc.set({ rootId, runKey, window, status, safety, actorUid: IQ_DAILY_SYNC_ACTOR_UID, actorType: "SYSTEM", groups, totals, openReviews: incident.openCount, openReviewsByCode: incident.countsByCode,
    finishedAt: FieldValue.serverTimestamp(), runs: FieldValue.increment(1) }, { merge: true });
  // One line, counts only: no folios, ids, names or amounts.
  console.log("IQ_DAILY_SYNC_SUMMARY", JSON.stringify({ status, safety, days: Math.round((Date.parse(window.end) - Date.parse(window.start)) / 86_400_000) + 1, created: totals.created, failed: totals.failed, reviewsNew: totals.reviewsNew, reviewsResolved: totals.reviewsResolved, reviewsOpen: incident.openCount, dispersionsMissing: totals.dispersionsMissing }));
  return { rootId, status, window, groups, safety };
}

/** Roots with IQ automation enabled (iqIntegrationConfigs) and an operational identity policy (RR → BETELL, ELIUT → EBASOR). */
export async function dailySyncRoots(): Promise<string[]> {
  const enabled = await readEnabledIqAutomationRoots({ process: "discovery", respectWindow: false });
  const roots: string[] = [];
  for (const rootId of enabled.keys()) {
    const policy = await db().doc(`iqOperationalAssignmentPolicies/${rootId}`).get();
    if (policy.exists && text(policy.get("activeVersion"))) roots.push(rootId);
  }
  return roots.sort();
}

export async function runIqDailySync(input: { secret: string; now?: Date; runKey?: string; rootIds?: string[]; budget?: Partial<DailySyncBudget> }) {
  const roots = input.rootIds ?? await dailySyncRoots(), results: RootResult[] = [];
  for (const rootId of roots) results.push(await runIqDailySyncForRoot({ ...input, rootId }));
  return results;
}

// 20:30 after IQ hours (window yesterday + today) and 06:30 catch-up of the previous day.
export const runIqDailyReverseSync = onSchedule(
  { schedule: "30 6,20 * * *", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 540, memory: "1GiB", retryCount: 0, maxInstances: 1, concurrency: 1, secrets: [IQ_CREDENTIALS_KEY] },
  async () => { await runIqDailySync({ secret: IQ_CREDENTIALS_KEY.value() }); },
);
