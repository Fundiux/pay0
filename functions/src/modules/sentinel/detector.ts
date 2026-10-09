import { digest, InvalidSecurityEvent, sanitizeSecurityEvent } from "./schema";
import type { VerifiedIngress } from "./schema";
import { observeSecurityEvent, SENTINEL_POLICY } from "./policy";
import type { ObservationIncident, ObservationStore, QuotaState } from "./store";

// Resource ceilings for observation ingestion, not calibrated attack thresholds.
export const OBSERVATION_LIMITS = Object.freeze({
  windowMs: 60_000, serverPerRoot: 180, clientPerRoot: 30, clientPerActor: 6,
  receiptRetentionMs: 48 * 60 * 60 * 1000, incidentRetentionMs: 7 * 24 * 60 * 60 * 1000,
  failureThreshold: 3, breakerOpenMs: 30_000,
});
export type IngestResult = {
  decision: "OBSERVE_ONLY";
  restricted: false;
  outcome: "RECORDED" | "DUPLICATE" | "QUOTA" | "INVALID_EVENT" | "INVALID_SCOPE" | "INVALID_ORIGIN" | "STALE_EVENT" | "LOOP_REJECTED" | "STORE_UNAVAILABLE" | "CIRCUIT_OPEN";
  incidentKey?: string;
};
const result = (outcome: IngestResult["outcome"], incidentKey?: string): IngestResult => ({
  decision: "OBSERVE_ONLY", restricted: false, outcome, ...(incidentKey ? { incidentKey } : {}),
});

function nextQuota(previous: QuotaState | null, now: number, limit: number): QuotaState | null {
  if (previous && (!Number.isSafeInteger(previous.accepted) || previous.accepted < 0 ||
      !Number.isSafeInteger(previous.windowStartedAtMs) || previous.windowStartedAtMs < 0 || previous.windowStartedAtMs > now)) {
    throw new Error("INVALID_OBSERVATION_STORE_STATE");
  }
  const current = previous && now - previous.windowStartedAtMs < OBSERVATION_LIMITS.windowMs ? previous : { windowStartedAtMs: now, accepted: 0 };
  return current.accepted >= limit ? null : { ...current, accepted: current.accepted + 1 };
}

export class ObservationDetector {
  private failures = 0;
  private openUntil = 0;
  private probing = false;
  constructor(private readonly store: ObservationStore, private readonly now = () => Date.now()) {}

  async ingest(raw: unknown, ingress: VerifiedIngress): Promise<IngestResult> {
    const now = this.now();
    let event;
    try { event = sanitizeSecurityEvent(raw, ingress, now); }
    catch (error) { return result(error instanceof InvalidSecurityEvent ? error.code : "INVALID_EVENT"); }
    if (this.probing || (this.openUntil > 0 && now < this.openUntil)) return result("CIRCUIT_OPEN");
    const isProbe = this.openUntil > 0;
    if (isProbe) this.probing = true;
    const rootDigest = digest(event.rootId);
    const receiptKey = digest([SENTINEL_POLICY, event.origin, event.eventDigest]);
    const incidentKey = digest([SENTINEL_POLICY, event.origin, event.actorUid, event.eventType, event.intentionDigest || event.eventDigest]);
    const rootQuotaKey = digest(["root", ingress.source]);
    const actorQuotaKey = digest(["actor", ingress.source, event.actorUid]);
    try {
      const response = await this.store.transact(rootDigest, async tx => {
        const receipt = await tx.readReceipt(receiptKey);
        if (receipt) {
          if (!/^[a-f0-9]{64}$/.test(receipt.incidentKey) || receipt.eventDigest !== event.eventDigest) throw new Error("INVALID_OBSERVATION_STORE_STATE");
          return result("DUPLICATE", receipt.incidentKey);
        }
        const [rootQuota, actorQuota, previous] = await Promise.all([
          tx.readQuota(rootQuotaKey), tx.readQuota(actorQuotaKey), tx.readIncident(incidentKey),
        ]);
        const limit = ingress.source === "SERVER" ? OBSERVATION_LIMITS.serverPerRoot : OBSERVATION_LIMITS.clientPerRoot;
        const nextRoot = nextQuota(rootQuota, now, limit);
        const nextActor = nextQuota(actorQuota, now, ingress.source === "SERVER" ? limit : OBSERVATION_LIMITS.clientPerActor);
        if (!nextRoot || !nextActor) return result("QUOTA");
        if (previous && (previous.rootId !== event.rootId || previous.actorUid !== event.actorUid ||
            previous.origin !== event.origin || previous.eventType !== event.eventType || previous.policyVersion !== SENTINEL_POLICY ||
            previous.status !== "OPEN_OBSERVATION" || previous.authority !== "NONE" || previous.decision !== "OBSERVE_ONLY" ||
            !Number.isSafeInteger(previous.eventCount) || previous.eventCount < 1 || previous.eventCount >= Number.MAX_SAFE_INTEGER ||
            !Number.isSafeInteger(previous.firstOccurredAtMs) || !Number.isSafeInteger(previous.lastOccurredAtMs))) {
          throw new Error("INVALID_OBSERVATION_STORE_STATE");
        }
        const incident: ObservationIncident = {
          ...observeSecurityEvent(event), rootId: event.rootId, actorUid: event.actorUid,
          origin: event.origin, eventType: event.eventType, status: "OPEN_OBSERVATION",
          eventCount: (previous?.eventCount || 0) + 1,
          firstOccurredAtMs: Math.min(previous?.firstOccurredAtMs ?? event.occurredAtMs, event.occurredAtMs),
          lastOccurredAtMs: Math.max(previous?.lastOccurredAtMs ?? event.occurredAtMs, event.occurredAtMs),
          lastObservedAtMs: now,
          evidence: previous && previous.lastOccurredAtMs > event.occurredAtMs ? previous.evidence : { eventDigest: event.eventDigest, publisherDigest: event.publisherDigest,
            intentionDigest: event.intentionDigest, attemptDigest: event.attemptDigest, effectDigest: event.effectDigest },
          expiresAtMs: now + OBSERVATION_LIMITS.incidentRetentionMs,
        };
        tx.writeQuota(rootQuotaKey, nextRoot);
        tx.writeQuota(actorQuotaKey, nextActor);
        tx.createReceipt(receiptKey, { eventDigest: event.eventDigest, event, incidentKey, observedAtMs: now, expiresAtMs: now + OBSERVATION_LIMITS.receiptRetentionMs });
        tx.writeIncident(incidentKey, incident);
        return result("RECORDED", incidentKey);
      });
      this.failures = 0;
      this.openUntil = 0;
      return response;
    } catch {
      this.failures++;
      if (this.failures >= OBSERVATION_LIMITS.failureThreshold) this.openUntil = now + OBSERVATION_LIMITS.breakerOpenMs;
      // Never surface provider messages, and never turn telemetry failure into a
      // financial/auth decision. Callers may observe this outcome independently.
      return result("STORE_UNAVAILABLE");
    } finally { if (isProbe) this.probing = false; }
  }
}
