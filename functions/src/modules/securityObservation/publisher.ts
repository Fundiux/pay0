import { randomUUID } from "node:crypto";

/** Server-only port. Never expose its context as a callable/request payload.
 * A future authGuard adapter must derive root from the reread profile and actor
 * from verified auth, after deciding denial. Observation cannot change that decision. */
export type ObservationResource = {
  projectId: string; serviceName: string; revisionName: string; configurationName: string;
};
export type ObservationResult = "DISABLED" | "INVALID_CONTEXT" | "RATE_LIMITED" | "ACCEPTED" | "WRITE_FAILED";
export type LogEntry = {
  logName: string; resource: { type: "cloud_run_revision"; labels: Record<string, string> };
  timestamp: string; insertId: string; severity: "NOTICE";
  jsonPayload: { schemaVersion: "PAY0-SECURITY-ENVELOPE@1"; context: { rootId: string; actorUid: string };
    event: { schemaVersion: "PAY0-SECURITY-EVENT@1"; rootId: string; actorUid: string; eventId: string;
      origin: "SERVER_AUTH_DECISION"; eventType: "AUTHORIZATION_DENIED"; occurredAtMs: number } };
};
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function contextValues(context: unknown): { rootId: string; actorUid: string } | null {
  if (!context || typeof context !== "object" || Object.getPrototypeOf(context) !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(context);
  if (Object.keys(descriptors).sort().join(",") !== "actorUid,rootId" ||
      !Object.values(descriptors).every(d => Object.prototype.hasOwnProperty.call(d, "value"))) return null;
  const rootId = descriptors.rootId.value, actorUid = descriptors.actorUid.value;
  return identifier(rootId) && identifier(actorUid) ? { rootId, actorUid } : null;
}
export function createAuthorizationObservationPublisher(input: {
  enabled: boolean; resource: ObservationResource; write: (entry: LogEntry) => Promise<void>;
  now?: () => number; eventId?: () => string;
}) {
  const resource = { ...input.resource }, now = input.now || Date.now, eventId = input.eventId || randomUUID;
  if (resource.projectId !== "pay-0-system" || ![resource.serviceName, resource.revisionName, resource.configurationName].every(identifier)) throw Error("INVALID_OBSERVATION_RESOURCE");
  let window = -1, attempts = 0, lifetimeAttempts = 0, busy = false;
  return {
    async authorizationDenied(trustedContext: unknown): Promise<ObservationResult> {
      if (!input.enabled) return "DISABLED";
      try {
        const context = contextValues(trustedContext), timestamp = now();
        if (!context || !Number.isSafeInteger(timestamp) || timestamp < 0) return "INVALID_CONTEXT";
        const minute = Math.floor(timestamp / 60_000);
        if (window !== minute) { window = minute; attempts = 0; }
        // Canary budgets are per process, not claimed as global durable quotas.
        if (busy || attempts >= 6 || lifetimeAttempts >= 20) return "RATE_LIMITED";
        const id = eventId(); if (!identifier(id)) return "INVALID_CONTEXT";
        const entry: LogEntry = {
          logName: "projects/pay-0-system/logs/pay0_security_observation",
          resource: { type: "cloud_run_revision", labels: { project_id: resource.projectId, service_name: resource.serviceName,
            revision_name: resource.revisionName, configuration_name: resource.configurationName, location: "us-central1" } },
          timestamp: new Date(timestamp).toISOString(), insertId: id, severity: "NOTICE",
          jsonPayload: { schemaVersion: "PAY0-SECURITY-ENVELOPE@1", context,
            event: { schemaVersion: "PAY0-SECURITY-EVENT@1", ...context, eventId: id,
              origin: "SERVER_AUTH_DECISION", eventType: "AUTHORIZATION_DENIED", occurredAtMs: timestamp } },
        };
        attempts++; lifetimeAttempts++; busy = true;
        try { await input.write(entry); return "ACCEPTED"; }
        catch { return "WRITE_FAILED"; }
        finally { busy = false; }
      } catch { return "INVALID_CONTEXT"; }
    },
  };
}
