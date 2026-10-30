import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { Firestore, FieldValue } from "firebase-admin/firestore";

/** Execution metadata only. Financial state and identities remain in domain jobs. */
export const SAFETY_VERSION = "PAY0_AUTOMATION_SAFETY_V1";
export type Circuit = "CLOSED" | "OPEN" | "HALF_OPEN";
export type Origin = "MANUAL" | "AUTOMATIC";
export type TechnicalOrigin = "TRIGGER" | "SCHEDULER" | "TASK" | "CALLABLE" | "HTTP";
export type Result = "SUCCEEDED" | "DEFERRED" | "RETRY_WAIT" | "QUARANTINED" | "OUTCOME_UNKNOWN";
export interface Policy {
  maxAttempts: number; backoffMs: number; maxBackoffMs: number;
  leaseMs: number; spacingMs: number; openMs: number;
  failureThreshold: number; recoverySuccesses: number;
  duplicateThreshold: number; duplicateWindowMs: number;
  maxExternalRequests: number;
}
// Operational containment, NOT contractual provider limits. Single worker and
// 1 operation/s admission and 60–300s retries reuse IQ task policy. Lease exceeds REP's 540s timeout.
export const CONSERVATIVE_POLICY: Policy = {
  maxAttempts: 3, backoffMs: 60_000, maxBackoffMs: 300_000,
  leaseMs: 600_000, spacingMs: 1_000, openMs: 300_000,
  failureThreshold: 3, recoverySuccesses: 3,
  duplicateThreshold: 20, duplicateWindowMs: 600_000,
  maxExternalRequests: 25,
};
export interface ExecutionInput {
  rootId: string; process: string; operationType: string; operationId: string;
  idempotencyKey: string; origin: Origin; technicalOrigin: TechnicalOrigin;
  externalTarget?: string; policy?: Policy;
  partition?: string;
  /** Opt-in only for local, deterministic enqueue; never replay a provider effect. */
  localCompletion?: "DETERMINISTIC_ENQUEUE";
}
export interface Completion { evidence?: { kind: "JOB" | "ADOPTED"; id: string }; reason?: string }
export const safetyHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const scopeId = (rootId: string, process: string) => safetyHash(JSON.stringify([rootId, process]));
export class SafetyStop extends Error {
  constructor(public readonly reason: string) { super(reason); }
}
export interface Ticket {
  input: ExecutionInput; runId: string; scope: string; operation: string;
  attempt: number; policy: Policy;
}
interface ExecutionContext { runtime: SafetyRuntime; ticket: Ticket; failure?: ReturnType<typeof classifyFailure>; parent?: ExecutionContext }
const current = new AsyncLocalStorage<ExecutionContext>();

/** No raw error text, URLs, credentials, or financial payloads are retained. */
export function classifyFailure(error: unknown, effectPending = false) {
  if (effectPending) return { result: "OUTCOME_UNKNOWN" as Result, providerFailure: true, code: "EXTERNAL_OUTCOME_UNKNOWN" };
  const e = error as { message?: string; status?: number; observation?: { httpStatus?: number } };
  const status = Number(e?.status || e?.observation?.httpStatus || e?.message?.match(/HTTP_(\d{3})/)?.[1]);
  const code = /^[A-Z0-9_]{1,100}$/.test(e?.message || "") ? e.message! : "AUTOMATION_EXECUTION_FAILED";
  if (error instanceof SafetyStop) return { result: "DEFERRED" as Result, providerFailure: false, code };
  if (status === 401 || status === 403) return { result: "QUARANTINED" as Result, providerFailure: true, code };
  if (status === 429 || status >= 500 || /TIMEOUT|ECONNRESET|ETIMEDOUT/.test(code))
    return { result: "RETRY_WAIT" as Result, providerFailure: true, code };
  return { result: "QUARANTINED" as Result, providerFailure: false, code };
}

export class SafetyRuntime {
  constructor(readonly db: Firestore, readonly now = () => Date.now()) {}
  private refs(ticket: Pick<Ticket, "scope" | "operation">) {
    const scope = this.db.doc(`automationSafetyScopes/${ticket.scope}`);
    return { scope, operation: scope.collection("operations").doc(ticket.operation) };
  }
  private event(tx: FirebaseFirestore.Transaction, scope: string, sequence: number, type: string,
    before: unknown, after: unknown, reason: string, actor: string, metrics: Record<string, unknown> = {}) {
    tx.create(this.db.doc(`automationSafetyEvents/${scope}-${sequence}`), {
      scope, sequence, type, before, after, reason, actor,
      trigger: actor === "SYSTEM" ? "AUTOMATIC" : "MANUAL", metrics,
      occurredAt: this.now(), version: SAFETY_VERSION,
    });
  }
  async claim(input: ExecutionInput): Promise<{ ticket?: Ticket; reason: string }> {
    if (!input.rootId || !input.process || !input.operationId || !input.idempotencyKey ||
        !["MANUAL", "AUTOMATIC"].includes(input.origin)) throw Error("SAFETY_IDENTITY_REQUIRED");
    const policy = input.policy || CONSERVATIVE_POLICY;
    if (input.localCompletion && (policy.maxExternalRequests !== 0 || input.externalTarget))
      throw Error("SAFETY_LOCAL_COMPLETION_REQUIRES_NO_TRANSPORT");
    const ticket: Ticket = { input, runId: randomUUID(), scope: scopeId(input.rootId, input.process + (input.partition ? `:${input.partition}` : "")),
      operation: safetyHash(JSON.stringify([input.operationType, input.idempotencyKey])), attempt: 0, policy };
    const refs = this.refs(ticket), now = this.now();
    return this.db.runTransaction(async tx => {
      const [ss, os, master, control, rootMaster] = await Promise.all([tx.get(refs.scope), tx.get(refs.operation),
        tx.get(this.db.doc("automationSafetyControls/master")), tx.get(this.db.doc(`automationSafetyControls/${scopeId(input.rootId, input.process)}`)),
        tx.get(this.db.doc(`automationSafetyControls/master-${safetyHash(input.rootId)}`))]);
      const s = ss.data() || {}, o = os.data() || {};
      if (master.data()?.paused === true || rootMaster.data()?.paused === true || control.data()?.paused === true) return { reason: "KILL_SWITCH" };
      if (s.circuitState === "OPEN" && (s.manualRecovery === true || now < Number(s.openUntil))) return { reason: "CIRCUIT_OPEN" };
      if (["OUTCOME_UNKNOWN", "QUARANTINED"].includes(o.status)) return { reason: o.status };
      if (o.status === "RUNNING" && now >= Number(o.leaseUntil)) {
        if (input.localCompletion === "DETERMINISTIC_ENQUEUE" && o.localCompletion === input.localCompletion &&
            !o.effectPending && !Number(o.externalAttempted || 0) && !Number(o.externalRequests || 0)) {
          // A local enqueue may have committed before its response was lost.
          // Its existing deterministic job must be reconciled on the next admission.
          const sequence = Number(s.sequence || 0) + 1;
          tx.update(refs.operation, { status: "DEFERRED", finishedAt: now, leaseUntil: 0,
            nextRetryAt: now, attempt: Math.max(0, Number(o.attempt || 1) - 1), lastError: "LOCAL_ENQUEUE_INTERRUPTED" });
          tx.set(refs.scope, { sequence, ...(s.runId === o.runId ? { leaseUntil: 0 } : {}) }, { merge: true });
          this.event(tx, ticket.scope, sequence, "LOCAL_INTENT_DEFERRED", "RUNNING", "DEFERRED", "LOCAL_ENQUEUE_INTERRUPTED", "SYSTEM");
          return { reason: "DEFERRED" };
        }
        // A crashed process is never silently replayed. Domain reconciliation
        // decides whether a new read/repair operation is safe.
        const status = o.effectPending ? "OUTCOME_UNKNOWN" : "QUARANTINED";
        tx.update(refs.operation, { status, finishedAt: now, lastError: "LEASE_EXPIRED", leaseUntil: 0 });
        const sequence = Number(s.sequence || 0) + 1;
        tx.set(refs.scope, { sequence, quarantined: FieldValue.increment(1) }, { merge: true });
        this.event(tx, ticket.scope, sequence, "QUARANTINE_CREATED", "RUNNING", status, "LEASE_EXPIRED", "SYSTEM");
        return { reason: status };
      }
      if (["RUNNING", "SUCCEEDED"].includes(o.status)) {
        const count = now - Number(o.duplicateWindowAt || 0) < policy.duplicateWindowMs ? Number(o.duplicates || 0) + 1 : 1;
        tx.set(refs.operation, { duplicates: count, duplicateWindowAt: count === 1 ? now : o.duplicateWindowAt }, { merge: true });
        tx.set(refs.scope, { deduplicated: FieldValue.increment(1) }, { merge: true });
        if (count >= policy.duplicateThreshold) {
          const sequence = Number(s.sequence || 0) + 1;
          tx.set(refs.scope, { circuitState: "OPEN", manualRecovery: true, openUntil: now + policy.openMs,
            sequence, lastReason: "NO_PROGRESS_LOOP" }, { merge: true });
          this.event(tx, ticket.scope, sequence, "CIRCUIT_OPENED", s.circuitState || "CLOSED", "OPEN", "NO_PROGRESS_LOOP", "SYSTEM", { duplicates: count });
        }
        return { reason: "DEDUPLICATED" };
      }
      if (now < Number(o.nextRetryAt || 0)) return { reason: "BACKOFF" };
      if (now < Number(s.leaseUntil || 0) || now < Number(s.nextAdmissionAt || 0)) return { reason: "CAPACITY" };
      const admissions = now - Number(s.windowAt || 0) < policy.duplicateWindowMs ? Number(s.windowAdmissions || 0) : 0;
      if (admissions >= policy.duplicateThreshold) {
        const sequence = Number(s.sequence || 0) + 1;
        tx.set(refs.scope, { circuitState: "OPEN", manualRecovery: true, openUntil: now + policy.openMs,
          sequence, lastReason: "ABNORMAL_VOLUME" }, { merge: true });
        this.event(tx, ticket.scope, sequence, "CIRCUIT_OPENED", s.circuitState || "CLOSED", "OPEN", "ABNORMAL_VOLUME", "SYSTEM", { admissions });
        return { reason: "CIRCUIT_OPEN" };
      }
      const attempt = Number(o.attempt || 0) + 1;
      if (attempt > policy.maxAttempts) {
        const sequence = Number(s.sequence || 0) + 1;
        tx.set(refs.operation, { status: "QUARANTINED", lastError: "ATTEMPTS_EXHAUSTED", finishedAt: now }, { merge: true });
        tx.set(refs.scope, { sequence, quarantined: FieldValue.increment(1) }, { merge: true });
        this.event(tx, ticket.scope, sequence, "QUARANTINE_CREATED", o.status || null, "QUARANTINED", "ATTEMPTS_EXHAUSTED", "SYSTEM");
        return { reason: "QUARANTINED" };
      }
      const circuitState: Circuit = s.circuitState === "OPEN" ? "HALF_OPEN" : s.circuitState || "CLOSED";
      let sequence = Number(s.sequence || 0);
      if (s.circuitState === "OPEN") {
        sequence++;
        this.event(tx, ticket.scope, sequence, "CIRCUIT_HALF_OPEN", "OPEN", "HALF_OPEN", "COOLDOWN_ELAPSED", "SYSTEM");
      }
      tx.set(refs.scope, { rootId: input.rootId, process: input.process, circuitState, sequence,
        partition: input.partition || null, externalTarget: input.externalTarget || null,
        runId: ticket.runId, leaseUntil: now + policy.leaseMs, nextAdmissionAt: now + policy.spacingMs,
        windowAt: admissions === 0 ? now : s.windowAt, windowAdmissions: admissions + 1,
        admitted: FieldValue.increment(1), version: SAFETY_VERSION }, { merge: true });
      tx.set(refs.operation, { operationType: input.operationType, operationId: input.operationId,
        idempotencyKey: input.idempotencyKey, origin: input.origin, technicalOrigin: input.technicalOrigin,
        runId: ticket.runId, attempt, startedAt: now, finishedAt: null, status: "RUNNING",
        externalTarget: input.externalTarget || null, externalAttempted: Number(o.externalAttempted || 0),
        externalSucceeded: Number(o.externalSucceeded || 0), externalRequests: 0, externalResponses: 0, effectPending: false,
        lastError: null, nextRetryAt: null, circuitState, leaseUntil: now + policy.leaseMs,
        budgetStop: null,
        localCompletion: input.localCompletion || null,
        completionEvidence: null,
        version: SAFETY_VERSION }, { merge: true });
      return { reason: "ADMITTED", ticket: { ...ticket, attempt } };
    });
  }
  async reserveExternal(ticket: Ticket, sideEffect = false, countRequest = true) {
    const refs = this.refs(ticket), now = this.now();
    const stopped = await this.db.runTransaction(async tx => {
      const [ss, os, ms, control, rootMaster] = await Promise.all([tx.get(refs.scope), tx.get(refs.operation), tx.get(this.db.doc("automationSafetyControls/master")),
        tx.get(this.db.doc(`automationSafetyControls/${scopeId(ticket.input.rootId, ticket.input.process)}`)),
        tx.get(this.db.doc(`automationSafetyControls/master-${safetyHash(ticket.input.rootId)}`))]);
      const s = ss.data() || {}, o = os.data() || {};
      if (ms.data()?.paused || rootMaster.data()?.paused || control.data()?.paused || s.circuitState === "OPEN") throw new SafetyStop("SAFETY_PAUSED");
      if (s.runId !== ticket.runId || o.runId !== ticket.runId || o.status !== "RUNNING" || now >= Number(o.leaseUntil)) throw new SafetyStop("SAFETY_FENCE_LOST");
      const budgetStop = Number(o.externalRequests || 0) >= ticket.policy.maxExternalRequests ? "SAFETY_EXTERNAL_BUDGET"
        : now - Number(o.startedAt) >= 480_000 ? "SAFETY_DURATION_BUDGET" : null;
      if (budgetStop) {
        if (!o.budgetStop) {
          const sequence = Number(s.sequence || 0) + 1;
          tx.update(refs.operation, { budgetStop });
          tx.set(refs.scope, { sequence, lastReason: budgetStop }, { merge: true });
          this.event(tx, ticket.scope, sequence, "EXECUTION_BUDGET_REACHED", "RUNNING", "DEFERRED", budgetStop, "SYSTEM", { requests: Number(o.externalRequests || 0) });
        }
        return budgetStop;
      }
      if (sideEffect && (o.effectPending || o.externalAttempted > 0)) throw new SafetyStop("SAFETY_EFFECT_ALREADY_ATTEMPTED");
      tx.update(refs.operation, { externalRequests: FieldValue.increment(countRequest ? 1 : 0), ...(sideEffect ? {
        externalAttempted: FieldValue.increment(1), effectPending: true,
      } : {}) });
      tx.set(refs.scope, { externalRequests: FieldValue.increment(countRequest ? 1 : 0), ...(sideEffect ? { externalAttempted: FieldValue.increment(1) } : {}) }, { merge: true });
      return null;
    });
    if (stopped) throw new SafetyStop(stopped);
  }
  async confirmEffect(ticket: Ticket) {
    const refs = this.refs(ticket);
    await this.db.runTransaction(async tx => {
      const o = (await tx.get(refs.operation)).data();
      if (o?.runId !== ticket.runId || !o.effectPending || o.status !== "RUNNING") throw new SafetyStop("SAFETY_FENCE_LOST");
      tx.update(refs.operation, { effectPending: false, externalSucceeded: FieldValue.increment(1) });
      tx.set(refs.scope, { externalSucceeded: FieldValue.increment(1) }, { merge: true });
    });
  }
  async observeResponse(ticket: Ticket, status: number) {
    const refs = this.refs(ticket);
    await this.db.runTransaction(async tx => {
      const o = (await tx.get(refs.operation)).data();
      if (o?.runId !== ticket.runId) throw new SafetyStop("SAFETY_FENCE_LOST");
      tx.update(refs.operation, { externalResponses: FieldValue.increment(1), lastHttpStatus: status });
      tx.set(refs.scope, { externalResponses: FieldValue.increment(1) }, { merge: true });
    });
  }
  async finish(ticket: Ticket, desired: Result, errorCode: string | null = null, providerFailure = false, completion?: Completion) {
    const refs = this.refs(ticket), now = this.now(), p = ticket.policy;
    return this.db.runTransaction(async tx => {
      const [ss, os] = await Promise.all([tx.get(refs.scope), tx.get(refs.operation)]);
      const s = ss.data() || {}, o = os.data() || {};
      if (o.runId !== ticket.runId || o.status !== "RUNNING") return "STALE";
      let result = o.effectPending ? "OUTCOME_UNKNOWN" : o.budgetStop ? "DEFERRED" : desired;
      if (result === "SUCCEEDED" && ticket.input.localCompletion && !completion?.evidence?.id) {
        result = "QUARANTINED"; errorCode = "LOCAL_COMPLETION_EVIDENCE_MISSING";
      }
      if (result === "RETRY_WAIT" && ticket.attempt >= p.maxAttempts) result = "QUARANTINED";
      providerFailure = providerFailure || !!o.effectPending;
      const failureCount = providerFailure ? Number(s.consecutiveFailures || 0) + 1 : result === "SUCCEEDED" ? 0 : Number(s.consecutiveFailures || 0);
      let circuit: Circuit = s.circuitState || "CLOSED", sequence = Number(s.sequence || 0);
      const successes = result === "SUCCEEDED" ? Number(s.recoverySuccesses || 0) + 1 : 0;
      if (providerFailure && (failureCount >= p.failureThreshold || circuit === "HALF_OPEN") && circuit !== "OPEN") {
        sequence++;
        this.event(tx, ticket.scope, sequence, "CIRCUIT_OPENED", circuit, "OPEN", errorCode || "PROVIDER_FAILURE", "SYSTEM", { consecutiveFailures: failureCount });
        circuit = "OPEN";
      } else if (circuit === "HALF_OPEN" && successes >= p.recoverySuccesses) {
        sequence++;
        this.event(tx, ticket.scope, sequence, "CIRCUIT_RECOVERED", circuit, "CLOSED", "BOUNDED_PROBES_SUCCEEDED", "SYSTEM");
        circuit = "CLOSED";
      }
      if (["QUARANTINED", "OUTCOME_UNKNOWN"].includes(result)) {
        sequence++;
        this.event(tx, ticket.scope, sequence, "QUARANTINE_CREATED", "RUNNING", result, errorCode || result, "SYSTEM", { attempt: ticket.attempt });
      }
      tx.update(refs.operation, { status: result, finishedAt: now, lastError: errorCode || completion?.reason || null, leaseUntil: 0,
        // Administrative deferral is not a failed execution attempt. It remains
        // discoverable after arbitrarily many paused scheduler runs.
        attempt: result === "DEFERRED" ? Math.max(0, ticket.attempt - 1) : ticket.attempt,
        deferredCount: FieldValue.increment(result === "DEFERRED" ? 1 : 0),
        completionEvidence: result === "SUCCEEDED" ? completion?.evidence || null : null,
        nextRetryAt: ["RETRY_WAIT", "DEFERRED"].includes(result) ? now + Math.min(p.maxBackoffMs, p.backoffMs * 2 ** (ticket.attempt - 1)) : null,
        circuitState: circuit });
      // A late worker cannot release another worker's capacity.
      if (s.runId === ticket.runId) tx.set(refs.scope, { leaseUntil: 0,
        nextAdmissionAt: now + (s.circuitState === "HALF_OPEN" ? Math.max(60_000, p.spacingMs) : p.spacingMs), circuitState: circuit, sequence,
        openUntil: circuit === "OPEN" ? now + p.openMs : null,
        consecutiveFailures: failureCount, recoverySuccesses: circuit === "HALF_OPEN" ? successes : 0,
        lastError: errorCode, lastSuccessAt: result === "SUCCEEDED" ? now : s.lastSuccessAt || null,
        quarantined: FieldValue.increment(["QUARANTINED", "OUTCOME_UNKNOWN"].includes(result) ? 1 : 0),
      }, { merge: true });
      return result;
    });
  }
  /** Trusted backend/admin entrypoint. Never expose actor/scope directly to clients. */
  async setControl(input: { rootId?: string; process?: string; master?: boolean; paused: boolean; actor: string; reason: string }) {
    if (!input.actor || !input.reason || (!input.master && (!input.rootId || !input.process))) throw Error("SAFETY_CONTROL_INVALID");
    const id = input.master ? input.rootId ? `master-${safetyHash(input.rootId)}` : "master" : scopeId(input.rootId!, input.process!);
    const ref = this.db.doc(`automationSafetyControls/${id}`);
    await this.db.runTransaction(async tx => {
      const before = (await tx.get(ref)).data() || {};
      if (before.paused === input.paused) return;
      const sequence = Number(before.sequence || 0) + 1;
      tx.set(ref, { paused: input.paused, sequence, reason: input.reason, actor: input.actor,
        rootId: input.rootId || null, process: input.master ? "MASTER" : input.process,
        updatedAt: this.now(), version: SAFETY_VERSION }, { merge: true });
      this.event(tx, `control-${id}`, sequence, "KILL_SWITCH_CHANGED", !!before.paused, input.paused, input.reason, input.actor);
    });
  }
  /** Explicit recovery of a loop circuit does not release any unknown/quarantined operation. */
  async recoverCircuit(scope: string, actor: string, reason: string) {
    if (!/^[a-f0-9]{64}$/.test(scope) || !actor || !reason) throw Error("SAFETY_RECOVERY_INVALID");
    const ref = this.db.doc(`automationSafetyScopes/${scope}`);
    await this.db.runTransaction(async tx => {
      const s = (await tx.get(ref)).data();
      if (!s || s.circuitState !== "OPEN" || Number(s.leaseUntil || 0) > this.now()) throw Error("SAFETY_RECOVERY_NOT_READY");
      const sequence = Number(s.sequence || 0) + 1;
      tx.update(ref, { circuitState: "HALF_OPEN", manualRecovery: false, recoverySuccesses: 0,
        consecutiveFailures: 0, nextAdmissionAt: this.now(), sequence });
      this.event(tx, scope, sequence, "CIRCUIT_HALF_OPEN", "OPEN", "HALF_OPEN", reason, actor);
    });
  }
  /** Join the domain's authorized repair transaction; never release an attempted effect. */
  async releaseUnsentRepair(tx: FirebaseFirestore.Transaction, input: ExecutionInput, actor: string, reason: string) {
    const scope = scopeId(input.rootId, input.process + (input.partition ? `:${input.partition}` : ""));
    const refs = this.refs({ scope, operation: safetyHash(JSON.stringify([input.operationType, input.idempotencyKey])) });
    const [ss, os] = await Promise.all([tx.get(refs.scope), tx.get(refs.operation)]);
    const s = ss.data() || {}, o = os.data();
    if (!o) return;
    if (o.externalAttempted > 0 || o.status === "OUTCOME_UNKNOWN" || o.status === "RUNNING") throw new SafetyStop("SAFETY_RECONCILIATION_REQUIRED");
    if (o.status !== "QUARANTINED") return;
    const sequence = Number(s.sequence || 0) + 1;
    tx.update(refs.operation, { status: "DEFERRED", attempt: 0, nextRetryAt: 0, lastError: null,
      repairedAt: this.now(), repairedBy: actor });
    tx.set(refs.scope, { sequence, quarantined: FieldValue.increment(-1) }, { merge: true });
    this.event(tx, scope, sequence, "QUARANTINE_RELEASED", "QUARANTINED", "DEFERRED", reason, actor, { priorAttempts: o.attempt });
  }
  async run<T>(input: ExecutionInput, execute: () => Promise<T>, result: (value: T) => Result = () => "SUCCEEDED",
    completion?: (value: T) => Completion) {
    const claim = await this.claim(input);
    if (!claim.ticket) return { admitted: false, reason: claim.reason };
    const ticket = claim.ticket;
    try {
      const context: ExecutionContext = { runtime: this, ticket, parent: current.getStore() };
      const value = await current.run(context, execute);
      const domainResult = result(value);
      const status = await this.finish(ticket, domainResult === "OUTCOME_UNKNOWN" ? domainResult : context.failure?.result || domainResult,
        context.failure?.code, context.failure?.providerFailure, completion?.(value));
      return { admitted: true, reason: status, value };
    } catch (error) {
      const failure = classifyFailure(error);
      const status = await this.finish(ticket, failure.result, failure.code, failure.providerFailure);
      return { admitted: true, reason: status };
    }
  }
}

/** Called at the existing transport boundary; absent context preserves other flows. */
export async function reserveProtectedRequest(sideEffect = false) {
  const contexts: ExecutionContext[] = [];
  for (let context = current.getStore(); context; context = context.parent) contexts.unshift(context);
  for (const context of contexts) await context.runtime.reserveExternal(context.ticket, sideEffect);
}
export async function confirmProtectedEffect() {
  const context = current.getStore();
  if (context) await context.runtime.confirmEffect(context.ticket);
}
export async function markProtectedEffectIntent() {
  const context = current.getStore();
  if (context) await context.runtime.reserveExternal(context.ticket, true, false);
}
export async function observeProtectedResponse(status: number) {
  for (let context = current.getStore(); context; context = context.parent) await context.runtime.observeResponse(context.ticket, status);
}
export function reportProtectedFailure(error: unknown) {
  const context = current.getStore();
  if (context) context.failure = classifyFailure(error);
}
