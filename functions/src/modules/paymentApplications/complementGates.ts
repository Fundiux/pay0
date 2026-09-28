import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../sharedCallables/helpers";
import { getUserRole } from "../../utils/authGuard";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { logActivityTx } from "../../utils/logActivity";
import { dayMexico, hash } from "./complementPolicy";

export type IqComplementAction = "LOOKUP" | "REQUEST";
export type GateDecision = { allowed: boolean; reason: string; limit: number };
export const REP_REQUEST_HARD_DISABLED = "REP_REQUEST_HARD_DISABLED";
export const isIqRepRequestHardEnabled = (config: any): boolean => config?.iqRequestEnabled === true;
const effectiveProfileId = (job: any) => String(job?.originIqProfileId || job?.profileId || "").trim();

const clamp = (value: unknown, fallback: number, ceiling: number) => {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(0, Math.min(ceiling, number)) : fallback;
};

function decide(job: any, action: IqComplementAction, config: any, master: any, user: any, access: any, profile: any): GateDecision {
  const limit = action === "LOOKUP" ? clamp(config?.iqLookupDailyLimit, 25, 100) : clamp(config?.iqRequestDailyLimit, 5, 25);
  const deny = (reason: string): GateDecision => ({ allowed: false, reason, limit });
  if (!job || job.provider !== "IQ" || !job.rootId || !effectiveProfileId(job) || !job.actorUid || !job.clientId) return deny("REP_GATE_JOB_INVALID");
  // REP C is fail-closed independently from every other IQ switch. Missing,
  // null and non-boolean values must be indistinguishable from an explicit off.
  if (action === "REQUEST" && !isIqRepRequestHardEnabled(config)) return deny(REP_REQUEST_HARD_DISABLED);
  if (!config || config.rootId !== job.rootId) return deny("REP_GATE_CONFIG_MISSING");
  if (master?.rootId && master.rootId !== job.rootId) return deny("REP_GATE_MASTER_SCOPE");
  if (master?.enabled !== true) return deny("REP_GATE_MASTER_OFF");
  if (config.iqLookupEnabled === false) return deny("REP_GATE_LOOKUP_OFF");
  if (action === "REQUEST" && config.iqEnabled !== true) return deny("REP_GATE_REQUEST_OFF");
  if (action === "REQUEST" && master?.automation?.aplicacionPagos !== true) return deny("REP_GATE_APPLICATION_FLOW_OFF");
  if (limit === 0) return deny("REP_GATE_QUOTA_ZERO");
  // A durable origin was authorized when the application/job was created.
  // Schedulers must not re-authorize that historical action from mutable user
  // or iqUserAccess state. Legacy jobs retain the former live checks.
  if (!job.originIqProfileId) {
    const role = user && getUserRole(user);
    if (!role || user.rootId !== job.rootId || user.active === false || user.disabled === true) return deny("REP_GATE_ACTOR_INVALID");
    if (!access || access.rootId !== job.rootId || access.active !== true || access.iqEnabled !== true ||
        access.iqCredentialProfileId !== job.profileId ||
        (access.allowedModules?.conciliacion !== true && access.allowedModules?.pagos !== true)) return deny("REP_GATE_IQ_ACCESS_CHANGED");
  }
  if (!profile || profile.rootId !== job.rootId || profile.active !== true || profile.hasPassword !== true || !profile.username)
    return deny("REP_GATE_PROFILE_UNAVAILABLE");
  return { allowed: true, reason: "REP_GATE_ALLOWED", limit };
}

async function state(job: any) {
  if (!job?.rootId || !job?.actorUid || !effectiveProfileId(job)) return { config: null, master: null, user: null, access: null, profile: null };
  const [config, master, user, access, profile] = await Promise.all([
    db.doc(`paymentComplementConfigs/${job.rootId}`).get(), db.doc(`iqIntegrationConfigs/${job.rootId}`).get(),
    db.doc(`users/${job.actorUid}`).get(), db.doc(`iqUserAccess/${job.actorUid}`).get(),
    db.doc(`iqCredentialProfiles/${effectiveProfileId(job)}`).get(),
  ]);
  return { config: config.data(), master: master.data(), user: user.data(), access: access.data(), profile: profile.data() };
}

export async function inspectIqComplementGate(job: any, action: IqComplementAction): Promise<GateDecision> {
  const current = await state(job);
  const decision = decide(job, action, current.config, current.master, current.user, current.access, current.profile);
  if (!decision.allowed) return decision;
  try {
    if (!job.originIqProfileId) {
      await requireClientOperationalAccess({ uid: job.actorUid, role: getUserRole(current.user)!, rootId: job.rootId,
        clientId: job.clientId, permission: "operatePagos" });
    }
  } catch {
    return { ...decision, allowed: false, reason: "REP_GATE_CLIENT_PERMISSION" };
  }
  return decision;
}

// The quota and the live switches are checked in one transaction immediately
// before the provider action. A denied claim cannot invoke IQ.
export async function claimIqComplementGate(jobId: string, action: IqComplementAction, now = new Date()): Promise<GateDecision> {
  const ref = db.doc(`paymentComplementJobs/${jobId}`), day = dayMexico(now);
  return db.runTransaction(async tx => {
    const job = (await tx.get(ref)).data();
    const profileId = effectiveProfileId(job);
    if (!job?.rootId || !profileId || !job?.actorUid) return { allowed: false, reason: "REP_GATE_JOB_INVALID", limit: 0 };
    const quotaRef = db.doc(`paymentComplementQuotas/${hash(`${job.rootId}:${profileId}:${action}:${day}`)}`);
    const [config, master, user, access, profile, quota] = await Promise.all([
      tx.get(db.doc(`paymentComplementConfigs/${job.rootId}`)), tx.get(db.doc(`iqIntegrationConfigs/${job.rootId}`)),
      tx.get(db.doc(`users/${job.actorUid}`)), tx.get(db.doc(`iqUserAccess/${job.actorUid}`)),
      tx.get(db.doc(`iqCredentialProfiles/${profileId}`)), tx.get(quotaRef),
    ]);
    let decision = decide(job, action, config.data(), master.data(), user.data(), access.data(), profile.data());
    if (decision.allowed && action === "REQUEST" && job.status !== "PREPARING") decision = { ...decision, allowed: false, reason: "REP_GATE_JOB_STATE" };
    const eligibilityLookup = job.status === "BLOCKED" && job.error === "IQ_REP_REQUEST_ELIGIBILITY_UNVERIFIED";
    if (decision.allowed && action === "LOOKUP" && !eligibilityLookup && !["PREPARING", "REQUESTED", "UNKNOWN", "ISSUED_PENDING_FILES"].includes(job.status))
      decision = { ...decision, allowed: false, reason: "REP_GATE_JOB_STATE" };
    if (decision.allowed && Number(quota.data()?.count || 0) >= decision.limit) decision = { ...decision, allowed: false, reason: "REP_GATE_QUOTA_EXHAUSTED" };
    if (decision.allowed) tx.set(quotaRef, { rootId: job.rootId, profileId, action, day,
      count: Number(quota.data()?.count || 0) + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(ref, { lastGateAction: action, lastGateAllowed: decision.allowed, lastGateReason: decision.reason,
      lastGateAt: Timestamp.fromDate(now), updatedAt: FieldValue.serverTimestamp() });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: job.rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: jobId, referenceType: "complementoPago", description: `Compuerta IQ ${action}: ${decision.reason}.` });
    return decision;
  });
}

// Historical recovery has no prospective automation job. Reserve only the B
// quota, with the same live root/profile/actor switches, before IQ login.
export async function claimIqComplementCanaryLookup(job: any, canaryId: string, now = new Date()): Promise<GateDecision> {
  const day = dayMexico(now);
  return db.runTransaction(async tx => {
    const profileId = effectiveProfileId(job);
    const [config, master, user, access, profile] = await Promise.all([
      tx.get(db.doc(`paymentComplementConfigs/${job.rootId}`)), tx.get(db.doc(`iqIntegrationConfigs/${job.rootId}`)),
      tx.get(db.doc(`users/${job.actorUid}`)), tx.get(db.doc(`iqUserAccess/${job.actorUid}`)),
      tx.get(db.doc(`iqCredentialProfiles/${profileId}`)),
    ]);
    let decision = decide(job, "LOOKUP", config.data(), master.data(), user.data(), access.data(), profile.data());
    const quotaRef = db.doc(`paymentComplementQuotas/${hash(`${job.rootId}:${profileId}:LOOKUP:${day}`)}`);
    const quota = await tx.get(quotaRef);
    if (decision.allowed && Number(quota.data()?.count || 0) >= decision.limit) decision = { ...decision, allowed: false, reason: "REP_GATE_QUOTA_EXHAUSTED" };
    if (decision.allowed) tx.set(quotaRef, { rootId: job.rootId, profileId, action: "LOOKUP", day,
      count: Number(quota.data()?.count || 0) + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: job.rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: canaryId, referenceType: "complementoPago", description: `Canario IQ LOOKUP: ${decision.reason}.` });
    return decision;
  });
}

export async function recordBlockedIqGate(jobId: string, action: IqComplementAction, reason: string, now = new Date()) {
  await db.runTransaction(async tx => {
    const ref = db.doc(`paymentComplementJobs/${jobId}`), snap = await tx.get(ref), job = snap.data();
    if (!job?.rootId) return;
    const day = dayMexico(now);
    if (job.lastGateReason === reason && job.lastGateDay === day) return;
    tx.update(ref, { lastGateAction: action, lastGateAllowed: false, lastGateReason: reason, lastGateDay: day,
      lastGateAt: Timestamp.fromDate(now), updatedAt: FieldValue.serverTimestamp() });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: job.rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: jobId, referenceType: "complementoPago", description: `Compuerta IQ ${action} bloqueó acción externa: ${reason}.` });
  });
}
