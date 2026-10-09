import type { Observation } from "./policy";
import type { SanitizedEvent } from "./schema";

export interface QuotaState { windowStartedAtMs: number; accepted: number }
export interface ObservationReceipt {
  // Optional only when reading legacy evidence; all new creates require both.
  contentBindingVersion?: "PAY0-EVENT-CONTENT@1";
  contentDigest?: string;
  eventDigest: string;
  event: SanitizedEvent;
  incidentKey: string;
  observedAtMs: number;
  expiresAtMs: number;
}
export interface ObservationIncident extends Observation {
  rootId: string;
  actorUid: string;
  origin: SanitizedEvent["origin"];
  eventType: SanitizedEvent["eventType"];
  status: "OPEN_OBSERVATION";
  eventCount: number;
  firstOccurredAtMs: number;
  lastOccurredAtMs: number;
  lastObservedAtMs: number;
  evidence: Pick<SanitizedEvent, "eventDigest" | "intentionDigest" | "attemptDigest" | "effectDigest" | "publisherDigest">;
  expiresAtMs: number;
}

/** Restricted capability surface: no document paths, users, payments or rules. */
export interface ObservationTransaction {
  readQuota(key: string): Promise<QuotaState | null>;
  readReceipt(key: string): Promise<ObservationReceipt | null>;
  readIncident(key: string): Promise<ObservationIncident | null>;
  writeQuota(key: string, state: QuotaState): void;
  createReceipt(key: string, receipt: ObservationReceipt): void;
  writeIncident(key: string, incident: ObservationIncident): void;
}
export interface ObservationStore {
  /** Must retry conflicts, make writes atomic and keep the root namespace. */
  transact<T>(rootDigest: string, operation: (transaction: ObservationTransaction) => Promise<T>): Promise<T>;
}
