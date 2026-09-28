import { isPostedCommissionPayment } from "./domain";
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { randomUUID } from "crypto";
import { commissionAccountActor, commissionMillis } from "./userDestinations";
import { stableCommissionId } from "./service";
import { evaluateCommissionLegSubmission } from "./domain";
import { requestUserCommissionDispersionCore } from "./requests";
import { executeUserCommissionRequestCore, USER_COMMISSION_IQ_SECRET, type CommissionExecutor } from "./execution";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore(), timestamp = admin.firestore.FieldValue.serverTimestamp;
export const COMMISSION_TIMEZONE = "America/Mexico_City";
export function validateCommissionAutomation(input: any) {
  if (input.timeZone !== COMMISSION_TIMEZONE || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.cutoff || "")) || !Array.isArray(input.weekdays) || !input.weekdays.length || input.weekdays.some((day: unknown) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6) || new Set(input.weekdays).size !== input.weekdays.length || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate || "")) || new Date(`${input.startDate}T12:00:00Z`).toISOString().slice(0, 10) !== input.startDate) throw new HttpsError("invalid-argument", "Debes definir zona horaria, hora de corte, días y fecha inicial válidos.");
  return { timeZone: COMMISSION_TIMEZONE, cutoff: String(input.cutoff), weekdays: input.weekdays as number[], startDate: String(input.startDate), enabled: input.enabled === true, executionEnabled: input.enabled === true && input.executionEnabled === true, executionGate: input.enabled === true && input.executionEnabled === true ? "CONFIGURED" : "AUTOMATIC_EXECUTION_DISABLED" };
}
export function commissionOperationalClock(now: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: COMMISSION_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now));
  const part = (type: string) => parts.find(row => row.type === type)?.value || "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return { date, time: `${part("hour")}:${part("minute")}`, weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
}
export const getCommissionAutomationConfig = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request, true), config = (await db.doc(`commissionAutomationConfigs/${actor.rootId}`).get()).data();
  return { ok: true, config: config ? { ...config, updatedAt: commissionMillis(config.updatedAt) } : { enabled: false, executionEnabled: false, timeZone: COMMISSION_TIMEZONE, cutoff: null, weekdays: [], startDate: null, version: 0, executionGate: "DAILY_CUTOFF_POLICY_REQUIRED" } };
});
export const saveCommissionAutomationConfig = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request, true), validated = validateCommissionAutomation(request.data);
  const version = await db.runTransaction(async tx => {
    const ref = db.doc(`commissionAutomationConfigs/${actor.rootId}`), previous = await tx.get(ref);
    const previousVersion = Number(previous.data()?.version || 0);
    if (Number(request.data?.expectedVersion || 0) !== previousVersion) throw new HttpsError("aborted", "La configuración cambió; recarga antes de guardar.");
    const nextVersion = previousVersion + 1, payload = { ...validated, rootId: actor.rootId, version: nextVersion, updatedAt: timestamp(), updatedBy: actor.uid };
    tx.set(ref, payload);
    tx.create(db.collection("commissionAuditEvents").doc(), { ...payload, event: "COMMISSION_DAILY_CONFIG_SAVED", actorUid: actor.uid, createdAt: timestamp() });
    return nextVersion;
  });
  return { ok: true, version };
});

/** The scan budget is independent of external execution. A root keeps its unfinished
 * cursor across operational dates, including the remaining owners of a payment.
 * Only a completed sweep can restart; immutable request IDs make every revisit safe.
 */
export async function runDailyUserCommissionPreflightCore(rootId: string, actorUid: string, now = Date.now(), executor?: CommissionExecutor) {
  const config = (await db.doc(`commissionAutomationConfigs/${rootId}`).get()).data();
  if (!config?.enabled) return { ok: true, skipped: true, reason: "DAILY_PREPARATION_DISABLED" };
  const policy = validateCommissionAutomation(config), clock = commissionOperationalClock(now);
  if (clock.date < policy.startDate || !policy.weekdays.includes(clock.weekday) || clock.time < policy.cutoff) return { ok: true, skipped: true, reason: "OUTSIDE_CONFIGURED_CUTOFF" };
  // Date-keyed cursors starve the tail when a sweep takes more than one day.
  const runId = stableCommissionId(`${rootId}|CONTINUOUS_SCAN_V2`), runRef = db.doc(`commissionDailyRuns/${runId}`), token = randomUUID();
  const claim = await db.runTransaction(async tx => {
    const [run, latestConfig] = await Promise.all([tx.get(runRef), tx.get(db.doc(`commissionAutomationConfigs/${rootId}`))]);
    const data = run.data();
    if (!latestConfig.data()?.enabled || latestConfig.data()?.version !== config.version || Number(data?.leaseUntil || 0) > now) return null;
    if (data?.complete && data.operationalDate === clock.date && data.configVersion === config.version) return null;
    const restart = !data || data.complete;
    const state = {
      cursor: restart ? "" : String(data.cursor || ""),
      pendingPaymentId: restart ? "" : String(data.pendingPaymentId || ""),
      pendingOwnerUids: restart ? [] as string[] : (Array.isArray(data.pendingOwnerUids) ? data.pendingOwnerUids.filter((uid: unknown): uid is string => typeof uid === "string" && !!uid) : []),
      processed: restart ? 0 : Number(data.processed || 0),
      operationalDate: restart ? clock.date : String(data.operationalDate || clock.date),
    };
    tx.set(runRef, { ...state, rootId, schemaVersion: 2, complete: false, configVersion: config.version, policySnapshot: policy, leaseToken: token, leaseUntil: now + 900000, updatedAt: timestamp() }, { merge: true });
    return state;
  });
  if (!claim) return { ok: true, skipped: true, reason: "RUN_COMPLETED_OR_IN_PROGRESS" };
  const scanLimit = 250, executionLimit = 1;
  let query = db.collection("pagos").where("rootId", "==", rootId).orderBy(admin.firestore.FieldPath.documentId()).limit(scanLimit);
  if (claim.cursor) query = query.startAfter(claim.cursor);
  try {
    const payments = await query.get(), results: Array<{ paymentId: string; ownerUid?: string; distributionId?: string; status: string }> = [];
    let cursor = claim.cursor, pendingPaymentId = claim.pendingPaymentId, pendingOwnerUids = claim.pendingOwnerUids;
    let scanned = 0, finishedPayments = 0, executions = 0;
    for (const payment of payments.docs) {
      scanned++;
      const data = payment.data();
      let owners: string[] = [];
      if (isPostedCommissionPayment(data) && data.financialSnapshotId) {
        const snapshot = (await db.doc(`paymentFinancialSnapshots/${data.financialSnapshotId}`).get()).data();
        const postedAt = commissionMillis(snapshot?.createdAt);
        if (snapshot && postedAt && snapshot.rootId === rootId) {
          const postedClock = commissionOperationalClock(postedAt);
          // Freeze the cutoff date for this sweep; a following sweep catches newer postings.
          if (postedClock.date >= policy.startDate && postedClock.date <= claim.operationalDate && (postedClock.date !== claim.operationalDate || postedClock.time <= policy.cutoff)) {
            owners = payment.id === claim.pendingPaymentId ? claim.pendingOwnerUids : [...new Set([snapshot.rootId, snapshot.adminId, snapshot.operadorId].filter(value => typeof value === "string" && value))] as string[];
          }
        }
      }
      let ownerIndex = 0;
      for (; ownerIndex < owners.length; ownerIndex++) {
        const ownerUid = owners[ownerIndex];
        try {
          const created: any = await requestUserCommissionDispersionCore({ paymentId: payment.id, ownerUid, actorUid, rootId, source: "DAILY", now, reserve: policy.executionEnabled });
          if (!created.distributionId) { results.push({ paymentId: payment.id, ownerUid, status: created.reason || "SKIPPED" }); continue; }
          let status = created.status;
          if (policy.executionEnabled && created.requestId && created.status === "RESERVED_AWAITING_EXECUTION") {
            executions++;
            status = (await executeUserCommissionRequestCore({ requestId: created.requestId, rootId, ownerUid, actorUid }, executor)).status;
          }
          results.push({ paymentId: payment.id, ownerUid, distributionId: created.distributionId, status });
        } catch { results.push({ paymentId: payment.id, ownerUid, status: "BLOCKED_REVIEW_REQUIRED" }); }
        // Checkpoint after this owner, before reserving or submitting any later owner.
        if (executions >= executionLimit) { ownerIndex++; break; }
      }
      if (ownerIndex < owners.length) {
        pendingPaymentId = payment.id;
        pendingOwnerUids = owners.slice(ownerIndex);
      } else {
        cursor = payment.id;
        pendingPaymentId = "";
        pendingOwnerUids = [];
        finishedPayments++;
      }
      if (executions >= executionLimit) break;
    }
    const complete = scanned === payments.size && payments.size < scanLimit && !pendingPaymentId;
    await db.runTransaction(async tx => {
      const run = await tx.get(runRef);
      if (run.data()?.leaseToken !== token) throw new Error("La corrida perdio su reserva; el siguiente intento conciliara la pagina.");
      tx.create(db.doc(`commissionDailyRunPages/${stableCommissionId(`${runId}|${token}`)}`), { rootId, runId, operationalDate: claim.operationalDate, invocationDate: clock.date, cursor: claim.cursor, pendingPaymentId: claim.pendingPaymentId, results, scanned, executions, executionEnabled: policy.executionEnabled, createdAt: timestamp() });
      tx.update(runRef, { cursor, pendingPaymentId, pendingOwnerUids, processed: claim.processed + finishedPayments, complete, leaseToken: null, leaseUntil: 0, executionEnabled: policy.executionEnabled, updatedAt: timestamp() });
    });
    return { ok: true, runId, scanned, executions, complete, results, executionEnabled: policy.executionEnabled };
  } catch (error) {
    await db.runTransaction(async tx => { const run = await tx.get(runRef); if (run.data()?.leaseToken === token) tx.update(runRef, { leaseToken: null, leaseUntil: 0, lastError: "PAGE_REVIEW_REQUIRED", updatedAt: timestamp() }); });
    throw error;
  }
}
export const runDailyUserCommissionPreflight = onCall({ cors: true, timeoutSeconds: 540, memory: "2GiB", secrets: [USER_COMMISSION_IQ_SECRET] }, async request => {
  const actor = await commissionAccountActor(request, true);
  return runDailyUserCommissionPreflightCore(actor.rootId, actor.uid);
});
export const prepareDailyUserCommissions = onSchedule({ schedule: "every 15 minutes", timeZone: COMMISSION_TIMEZONE, timeoutSeconds: 540, memory: "2GiB", maxInstances: 1, secrets: [USER_COMMISSION_IQ_SECRET] }, async () => {
  const configs = await db.collection("commissionAutomationConfigs").where("enabled", "==", true).limit(100).get();
  for (const config of configs.docs) {
    if (config.data().rootId !== config.id) continue;
    try { await runDailyUserCommissionPreflightCore(config.id, "SYSTEM_COMMISSION_DAILY"); }
    catch { console.warn("[commissionDaily] A configured root requires review; inspect its persisted run state before retrying."); }
  }
});

/** Test-only in-memory adapter. No production caller, Firestore mutation, credentials or IQ import. */
export async function simulateCommissionSubmission(legs: any[], executor: (leg: any) => Promise<{ iqFolio?: string; uncertain?: boolean }>) {
  const result = [];
  for (const leg of legs) {
    if (!evaluateCommissionLegSubmission(leg).allowed) { result.push({ ...leg }); continue; }
    try {
      const response = await executor({ ...leg });
      result.push(response.iqFolio ? { ...leg, status: "COMPLETED", iqFolio: response.iqFolio, retryBlocked: true } : { ...leg, status: "UNCERTAIN", retryBlocked: true });
    } catch { result.push({ ...leg, status: "UNCERTAIN", retryBlocked: true }); }
  }
  return result;
}
