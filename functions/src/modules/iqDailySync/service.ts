import { randomUUID } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { CONSERVATIVE_POLICY, SafetyRuntime, SafetyStop, type Policy } from "../automationSafety/runtime";
import { readEnabledIqAutomationRoots } from "../iq/automationRuntime";
import { deterministicId, P4EngineError, type P4Manifest } from "../iqHistoricalImport/domain";
import { discoverServerPlan, type DiscoveryBudget } from "../iqHistoricalImport/discovery";
import { actionEligibility, type P4ActionProgress } from "../iqHistoricalImport/phasedExecution";
import { buildServerPlan, P4_PLAN_GROUPS, type Pay0PlanRow } from "../iqHistoricalImport/planner";
import { executeAction, markDailySyncManifest, persistDailySyncManifest, type Context } from "../iqHistoricalImport/service";
import { DAILY_SYNC_MAX_REVIEW_LOOKBACK_DAYS, addDays, applyDailySyncSafety, dailyWindow, executionQueue, mexicoDate, resolvedEntities, reviewItems, widenWindowForOpenReviews, type DailyReview } from "./domain";
import { attachDisplay, displayFromIqRow, type ReviewDisplay } from "./reviewDisplay";
import { applyClientLinks, linkPatchForPlan, planClientLinks } from "./clientLinks";
import { importIqDispersion } from "./dispersionImport";
import { parseIqDispersion, resolveDispersionClient } from "./dispersionPlan";
import { applyClientCreates, clientRowForPlan, planClientCreates, readIqClientCatalog } from "./clientCreate";
import { postRecoveredPagoToWallet } from "./pagoPosting";
import { isIqDailySyncImport } from "../iq/historicalImportGuard";
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
/** A bounded number of dispersions is created per group and run; the rest waits for the next run. */
const MAX_DISPERSIONS_IMPORTED_PER_GROUP = 25;

export type DailySyncBudget = { maxWrites: number; maxDurationMs: number; maxErrors: number; maxLayers: number; maxPlanningPages: number; maxPlanningRecords: number; maxFirestoreReads: number; maxDispersionPages: number; maxDispersionsImported?: number; maxPagosPosted?: number; onlyConcretized?: boolean };
export const DEFAULT_DAILY_SYNC_BUDGET: DailySyncBudget = { maxWrites: 150, maxDurationMs: 420_000, maxErrors: 5, maxLayers: 3, maxPlanningPages: 1800, maxPlanningRecords: 10_000, maxFirestoreReads: 10_000, maxDispersionPages: 20 };

const text = (value: unknown) => String(value ?? "").trim();
const db = () => getFirestore();
const reviewId = (rootId: string, groupId: string, entityType: string, iqEntityId: string) => `iqdr_${deterministicId(rootId, groupId, entityType, iqEntityId).slice(0, 32)}`;

type Counts = Record<string, number>;
type GroupResult = {
  groupId: string; status: "COMPLETE" | "PARTIAL" | "FAILED"; stopReason: string | null; layers: number;
  created: Counts; noop: number; failed: number; reviewsOpen: number; reviewsNew: number; reviewsResolved: number;
  dispersionsObserved: number; dispersionsMissing: number; clientsLinked?: number; clientsCreated?: number; dispersionsImported?: number; pagosPosted?: number;
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
  const firestore = db(), open = await firestore.collection("iqDailySyncReviews").where("rootId", "==", rootId).where("status", "==", "OPEN").where("entityType", "==", "PAYMENT_POSTING").limit(400).get();
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

const MAX_PAGOS_POSTED_PER_GROUP = 40;

const DISCARDED_IQ_STATUS = /CANCEL|RECHAZ|ELIMIN|FALL|FAIL|ERROR|ANULAD/;
/** An IQ operation that did not conclude (cancelled, rejected, deleted or failed). */
export function isDiscardedIqStatus(raw: Record<string, unknown>): boolean {
  return [raw.operation_status, raw.status, raw.state].some(value => DISCARDED_IQ_STATUS.test(text(value).toUpperCase()));
}

/** Credits to the wallet the daily-sync pagos of this group that IQ already shows as conciliated; the rest stays in review with its reason. */
async function postRecoveredPagos(rootId: string, groupId: string, deposits: Map<string, Record<string, unknown>>, tracker: Tracker) {
  const maxPosted = tracker.budget.maxPagosPosted ?? MAX_PAGOS_POSTED_PER_GROUP;
  const group = P4_PLAN_GROUPS[groupId];
  const out = { posted: 0, reviews: [] as DailyReview[] };
  if (!group) return out;
  const snap = await db().collection("pagos").where("rootId", "==", rootId).where("source", "==", "IQ_IMPORT").limit(2000).get();
  for (const doc of snap.docs) {
    if (out.posted >= maxPosted || exhausted(tracker)) break;
    const data = doc.data();
    if (!isIqDailySyncImport(data) || text(data.canonicalIqProfileId) !== group.canonicalIqProfileId || text(data.financialPostingStatus).toUpperCase() === "POSTED") continue;
    const iqId = text(data.originalIqEntityId || data.iqDepositId);
    const deposit = deposits.get(iqId);
    if (!deposit) continue; // outside the window read in this run
    try {
      const result = await postRecoveredPagoToWallet(db(), rootId, doc.id, deposit);
      if (result.status === "POSTED") { out.posted++; tracker.writes += 3; continue; }
      if (result.code === "PAGO_ALREADY_POSTED") continue;
      out.reviews.push({ entityType: "PAYMENT_POSTING", iqEntityId: iqId, canonicalGroupId: groupId, code: result.code, detail: result.detail, evidence: { pagoPath: `pagos/${doc.id}` } });
    } catch (error) {
      console.error("IQ_DAILY_SYNC_PAGO_POSTING_FAILED", JSON.stringify({ groupId, iqDepositId: iqId, message: (error instanceof Error ? error.message : String(error)).slice(0, 160) }));
      out.reviews.push({ entityType: "PAYMENT_POSTING", iqEntityId: iqId, canonicalGroupId: groupId, code: "PAGO_POSTING_FAILED", detail: "No se pudo abonar el pago a la cartera; se reintenta en la siguiente corrida.", evidence: { pagoPath: `pagos/${doc.id}` } });
    }
  }
  return out;
}

async function syncGroup(ctx: Context, groupId: string, window: { start: string; end: string; timezone: "America/Mexico_City" }, tracker: Tracker, secret: string): Promise<GroupResult> {
  const result: GroupResult = { groupId, status: "COMPLETE", stopReason: null, layers: 0, created: {}, noop: 0, failed: 0, reviewsOpen: 0, reviewsNew: 0, reviewsResolved: 0, dispersionsObserved: 0, dispersionsMissing: 0 };
  let finalManifest: P4Manifest | null = null;
  const displayIndex = new Map<string, ReviewDisplay>();
  let lastPay0Rows: Pay0PlanRow[] = [];
  const iqDeposits = new Map<string, Record<string, unknown>>();
  const failures: DailyReview[] = [], extraReviews: DailyReview[] = [], extraResolved: Array<{ entityType: string; iqEntityId: string }> = [];
  for (let layer = 0; layer < tracker.budget.maxLayers; layer++) {
    if (exhausted(tracker)) { result.status = "PARTIAL"; result.stopReason = "RUN_BUDGET"; break; }
    result.layers++;
    const planningBudget: DiscoveryBudget = { maxPages: tracker.budget.maxPlanningPages, maxRecords: tracker.budget.maxPlanningRecords, maxFirestoreReads: tracker.budget.maxFirestoreReads, maxDurationMs: remainingMs(tracker) };
    const discovered = await discoverServerPlan({ rootId: ctx.rootId, groupIds: [groupId], range: window, secret, budget: planningBudget });
    if (discovered.partial) { result.status = "PARTIAL"; result.stopReason = "PLAN_BUDGET"; finalManifest = null; break; }
    // The historical backfill brings only what IQ concluded: cancelled, rejected or failed operations are left out.
    if (tracker.budget.onlyConcretized) discovered.iqRows = discovered.iqRows.filter(row => row.kind === "CLIENT" || !isDiscardedIqStatus(row.raw));
    // A PAY0 client with the same RFC and owner as an IQ client is the same company: link it so the plan finds it
    // (instead of a review that nobody can close) and its operations can follow.
    lastPay0Rows = discovered.pay0Rows;
    const links = planClientLinks({ groupId, iqRows: discovered.iqRows, pay0Rows: discovered.pay0Rows });
    if (links.length) {
      const linked = await applyClientLinks(db(), ctx.rootId, links);
      tracker.writes += linked.length; result.clientsLinked = (result.clientsLinked || 0) + linked.length;
      for (const link of linked) {
        const row = discovered.pay0Rows.find(candidate => candidate.collection === "clients" && candidate.id === link.pay0ClientId);
        if (row) row.data = { ...row.data, ...linkPatchForPlan(link) };
      }
      if (linked.length) console.log("IQ_DAILY_SYNC_CLIENTS_LINKED", JSON.stringify({ groupId, linked: linked.length }));
    }
    for (const row of discovered.iqRows) if (row.kind === "PAYMENT" && !iqDeposits.has(row.id)) iqDeposits.set(row.id, row.raw);
    for (const row of discovered.iqRows) displayIndex.set(`${row.kind}:${row.id}`, displayFromIqRow(row.kind, row.raw));
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
  // The pagos recovered from IQ are credited to the client's wallet on the day of the deposit, instead of waiting for a person.
  if (iqDeposits.size) {
    const posted = await postRecoveredPagos(ctx.rootId, groupId, iqDeposits, tracker);
    result.pagosPosted = posted.posted;
    extraReviews.push(...posted.reviews);
  }
  if (finalManifest && result.status === "COMPLETE") {
    const reviews = attachDisplay([...reviewItems(finalManifest).filter(review => !extraResolved.some(row => row.entityType === review.entityType && row.iqEntityId === review.iqEntityId)), ...failures, ...extraReviews], displayIndex);
    const resolved = [...resolvedEntities(finalManifest), ...extraResolved];
    const written = await upsertReviews(ctx.rootId, groupId, window, reviews, resolved);
    result.reviewsNew += written.reviewsNew; result.reviewsResolved += written.reviewsResolved; result.reviewsOpen += reviews.length;
  } else if (failures.length || extraReviews.length) {
    // A partial run still records its failures and the wallet follow-ups of what it created.
    const written = await upsertReviews(ctx.rootId, groupId, window, attachDisplay([...failures, ...extraReviews], displayIndex), extraResolved);
    result.reviewsNew += written.reviewsNew; result.reviewsResolved += written.reviewsResolved; result.reviewsOpen += failures.length + extraReviews.length;
  }
  if (!exhausted(tracker)) {
    const detection = await detectIqDispersions({ rootId: ctx.rootId, groupId, range: window, secret, maxPages: tracker.budget.maxDispersionPages });
    const missing = detection.observed.filter(row => !row.inPay0);
    result.dispersionsObserved = detection.observed.length;
    // A finished dispersion whose client, owner and account are clear is created in PAY0 with its original date; the rest stays in review with its reason.
    const brought = new Set<string>(), reasons = new Map<string, { code: string; detail: string }>();
    const importEnabled = lastPay0Rows.length > 0 && (await db().doc(`iqDailySyncState/${ctx.rootId}`).get()).get("dispersionImportEnabled") !== false;
    let imported = 0;
    // A client IQ names that PAY0 does not have is created from IQ's own client record when its RFC is real and unique.
    if (importEnabled && !exhausted(tracker) && (await db().doc(`iqDailySyncState/${ctx.rootId}`).get()).get("clientAutoCreateEnabled") !== false) {
      const unknown = new Set<string>();
      for (const row of missing) {
        const parsed = parseIqDispersion(row.raw, groupId);
        if (parsed.ok && resolveDispersionClient({ groupId, clientName: parsed.value.clientName, pay0Rows: lastPay0Rows }).ok === false) unknown.add(parsed.value.clientName);
      }
      if (unknown.size) {
        try {
          const catalog = await readIqClientCatalog({ rootId: ctx.rootId, groupId, secret });
          const creates = planClientCreates({ rootId: ctx.rootId, groupId, names: [...unknown], catalog, pay0Rows: lastPay0Rows });
          const made = await applyClientCreates(db(), ctx.rootId, creates);
          tracker.writes += made.length; result.clientsCreated = made.length;
          for (const create of made) lastPay0Rows.push(clientRowForPlan(ctx.rootId, create));
          if (made.length) console.log("IQ_DAILY_SYNC_CLIENTS_CREATED", JSON.stringify({ groupId, created: made.length }));
        } catch (error) {
          console.error("IQ_DAILY_SYNC_CLIENT_CREATE_FAILED", JSON.stringify({ groupId, message: (error instanceof Error ? error.message : String(error)).slice(0, 160) }));
        }
      }
    }
    for (const row of missing) {
      if (!importEnabled) break;
      if (imported >= (tracker.budget.maxDispersionsImported ?? MAX_DISPERSIONS_IMPORTED_PER_GROUP) || exhausted(tracker)) break;
      const parsed = parseIqDispersion(row.raw, groupId);
      if (!parsed.ok) { reasons.set(row.iqDispersionId, { code: parsed.code, detail: parsed.detail }); continue; }
      try {
        const outcome = await importIqDispersion(db(), ctx.rootId, parsed.value, lastPay0Rows);
        if (outcome.status === "REVIEW") reasons.set(row.iqDispersionId, { code: outcome.code, detail: outcome.detail });
        else { brought.add(row.iqDispersionId); if (outcome.status === "CREATED") { imported++; tracker.writes += 3; } }
      } catch (error) {
        console.error("IQ_DAILY_SYNC_DISPERSION_IMPORT_FAILED", JSON.stringify({ groupId, iqDispersionId: row.iqDispersionId, message: (error instanceof Error ? error.message : String(error)).slice(0, 160) }));
        reasons.set(row.iqDispersionId, { code: "DISPERSION_IMPORT_FAILED", detail: "No se pudo crear la dispersión; se reintenta en la siguiente corrida." });
      }
    }
    result.dispersionsImported = imported;
    const stillMissing = missing.filter(row => !brought.has(row.iqDispersionId));
    result.dispersionsMissing = stillMissing.length;
    const written = await upsertReviews(ctx.rootId, groupId, window,
      stillMissing.map(row => { const reason = reasons.get(row.iqDispersionId); return { entityType: "DISPERSION", iqEntityId: row.iqDispersionId, canonicalGroupId: groupId, code: reason?.code || "IQ_DISPERSION_NOT_IN_PAY0", detail: reason?.detail || "Dispersión registrada directamente en IQ sin dispersión equivalente en PAY0.", evidence: { date: row.date, amount: row.amount, operationStatus: row.operationStatus, observedThroughProfileId: row.profileId, display: row.display } }; }),
      [...detection.observed.filter(row => row.inPay0), ...missing.filter(row => brought.has(row.iqDispersionId))].map(row => ({ entityType: "DISPERSION", iqEntityId: row.iqDispersionId })));
    result.reviewsNew += written.reviewsNew; result.reviewsResolved += written.reviewsResolved; result.reviewsOpen += stillMissing.length;
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

/** Oldest day an open review refers to (its operation date, else the first window that saw it). */
async function oldestOpenReviewDate(rootId: string, now: Date = new Date()): Promise<string | null> {
  // A review older than the look-back belongs to the historical backfill or to a person; it must not widen every daily window.
  const recentFloor = addDays(mexicoDate(now), -DAILY_SYNC_MAX_REVIEW_LOOKBACK_DAYS);
  const open = await db().collection("iqDailySyncReviews").where("rootId", "==", rootId).where("status", "==", "OPEN").limit(2000).get();
  let oldest: string | null = null;
  for (const doc of open.docs) {
    const candidates = [text(doc.get("evidence.display.date")), text(doc.get("evidence.date")), text(doc.get("lastSeenWindow.start"))].filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value));
    const date = candidates.sort()[0];
    if (date && date >= recentFloor && (!oldest || date < oldest)) oldest = date;
  }
  return oldest;
}

async function acquireLease(stateDocId: string, now: number, rootId: string = stateDocId) {
  const ref = db().collection("iqDailySyncState").doc(stateDocId), token = randomUUID();
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

export type BackfillRun = { window: { start: string; end: string }; stateDocId: string; process: string };

export async function runIqDailySyncForRoot(input: { rootId: string; secret: string; now?: Date; runKey?: string; budget?: Partial<DailySyncBudget>; groups?: readonly string[]; backfill?: BackfillRun }): Promise<RootResult> {
  const now = input.now ?? new Date(), rootId = text(input.rootId);
  const runKey = text(input.runKey) || `${mexicoDate(now)}-${Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hourCycle: "h23" }).format(now)) < 12 ? "AM" : "PM"}`;
  const lease = await acquireLease(input.backfill?.stateDocId || rootId, Date.now(), rootId);
  if (!lease) return { rootId, status: "BUSY", window: null, groups: [], safety: "LEASE_HELD" };
  const window = input.backfill ? { ...input.backfill.window, timezone: "America/Mexico_City" as const } : widenWindowForOpenReviews(dailyWindow(now, text(lease.state.lastCompletedDate) || null), await oldestOpenReviewDate(rootId, now).catch(() => null), now);
  const tracker: Tracker = { started: Date.now(), writes: 0, errors: 0, budget: { ...DEFAULT_DAILY_SYNC_BUDGET, ...(input.budget || {}) } };
  const ctx: Context = { uid: IQ_DAILY_SYNC_ACTOR_UID, rootId };
  const groups: GroupResult[] = [], runDoc = db().collection("iqDailySyncRuns").doc(`iqds_${deterministicId(rootId, runKey).slice(0, 24)}`);
  let safety = "NOT_RUN", status = "FAILED";
  try {
    const guarded = await new SafetyRuntime(db()).run({
      rootId, process: input.backfill?.process || IQ_DAILY_SYNC_PROCESS, operationType: input.backfill ? "IQ_HISTORICAL_BACKFILL" : "IQ_DAILY_REVERSE_SYNC", operationId: `${rootId}:${runKey}`, idempotencyKey: `${runKey}:${window.start}:${window.end}`,
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
      ...(!input.backfill && complete && (!priorCompleted || lastCompletedDate > priorCompleted) ? { lastCompletedDate } : {}) });
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
