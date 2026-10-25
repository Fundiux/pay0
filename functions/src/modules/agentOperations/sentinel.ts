import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { SentinelDecision } from "./contract";
import { canAgentAccessSystem } from "./systems";
import { mexicoDayKey } from "./time";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
export type SentinelEventKind = "NORMAL_ACTIVITY" | "REPEATED_FAILURE" | "AUTH_DENIED" | "DATA_SCOPE_VIOLATION" | "INTEGRITY_MISMATCH";
export type SentinelInput = { rootId: string; systemId: string; eventId: string; kind: SentinelEventKind; actorUid: string; entityType: string; entityId: string; evidence: string[] };
const decisions: Record<SentinelEventKind, SentinelDecision> = {
  NORMAL_ACTIVITY: "NORMAL", REPEATED_FAILURE: "SUSPICIOUS", AUTH_DENIED: "RESTRICTED",
  DATA_SCOPE_VIOLATION: "QUARANTINE", INTEGRITY_MISMATCH: "BLOCKED",
};

/** Observation only. A decision label never changes users, payments, or permissions. */
export async function observeSentinelEvent(input: SentinelInput) {
  if (!canAgentAccessSystem("sentinel", input.systemId, "observe") || !input.rootId || !input.eventId || !input.actorUid || !input.entityId ||
      !Array.isArray(input.evidence) || input.evidence.length > 20 || input.evidence.some(item => typeof item !== "string" || item.length > 250) || !Object.prototype.hasOwnProperty.call(decisions, input.kind)) throw Error("INVALID_SENTINEL_EVENT");
  const id = createHash("sha256").update(JSON.stringify([input.rootId, input.systemId, input.eventId])).digest("hex");
  const ref = db.collection("sentinelEvents").doc(id);
  return db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.exists) return { id, decision: current.get("decision") as SentinelDecision, duplicate: true };
    const decision = decisions[input.kind];
    tx.create(ref, { ...input, decision, containmentApplied: false, createdAt: FieldValue.serverTimestamp() });
    if (decision !== "NORMAL") tx.create(db.collection("agentIncidents").doc(`sentinel-${id}`), {
      rootId: input.rootId, reportDay: mexicoDayKey(), systemId: input.systemId, sentinelEventId: id, entityType: input.entityType, entityId: input.entityId,
      status: "OPEN", cause: `${input.kind}: ${decision}`, evidence: input.evidence, createdAt: FieldValue.serverTimestamp(),
    });
    return { id, decision, duplicate: false };
  });
}
