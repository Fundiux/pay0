import type { SanitizedEvent } from "./schema";

export const SENTINEL_POLICY = "PAY0-SENTINEL-SHADOW@1" as const;
export type Observation = {
  policyVersion: typeof SENTINEL_POLICY;
  decision: "OBSERVE_ONLY";
  authority: "NONE";
  reason: "CLIENT_REPORT_UNVERIFIED" | "SERVER_AUTHORIZATION_SIGNAL" | "SERVER_EXECUTION_SIGNAL";
  recovery: "HUMAN_REVIEW_ONLY";
};

/** No calibration, inferred maliciousness, restriction, or financial decision. */
export function observeSecurityEvent(event: SanitizedEvent): Observation {
  return {
    policyVersion: SENTINEL_POLICY,
    decision: "OBSERVE_ONLY",
    authority: "NONE",
    reason: event.origin === "CLIENT_REPORTED" ? "CLIENT_REPORT_UNVERIFIED" :
      event.origin === "SERVER_AUTH_DECISION" ? "SERVER_AUTHORIZATION_SIGNAL" : "SERVER_EXECUTION_SIGNAL",
    recovery: "HUMAN_REVIEW_ONLY",
  };
}
