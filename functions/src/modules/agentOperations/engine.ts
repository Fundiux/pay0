import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { AGENTS, AgentRunStatus, canExecuteTool, TOOLS } from "./contract";
import { canAgentAccessSystem } from "./systems";
import { draftRepeatedCauseProposal } from "./proposals";
import { mexicoDayKey } from "./time";
export { mexicoDayKey } from "./time";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const MAX_RUN_MS = 10 * 60_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const clean = (value: unknown, max = 128) => String(value ?? "").trim().slice(0, max);

export type RunInput = { rootId: string; systemId?: string; agentId: string; toolId: string; entityType: string; entityId: string; revision: string; actorUid: string; evidence: string[]; correlationId: string };
export const runIdFor = (input: RunInput) => hash(JSON.stringify([input.rootId, input.systemId || "pay0", input.agentId, input.toolId, input.entityType, input.entityId, input.revision]));

export async function reserveRun(input: RunInput) {
  const tool = TOOLS.find(row => row.id === input.toolId);
  const agent = AGENTS.find(row => row.id === input.agentId);
  const permission = input.toolId === "quotation-recovery" ? "recoverQuotation" : "propose";
  if (!tool || !agent?.enabled || !canAgentAccessSystem(input.agentId, input.systemId || "pay0", permission) || !input.rootId || !input.actorUid || !input.entityId || !input.revision || !input.correlationId) throw Error("INVALID_AGENT_RUN");
  const id = runIdFor(input);
  const ref = db.collection("agentRuns").doc(id);
  const controlRef = db.collection("agentControls").doc(input.rootId);
  return db.runTransaction(async tx => {
    const [control, current] = await Promise.all([tx.get(controlRef), tx.get(ref)]);
    const row = current.data() || {};
    const attempt = Number(row.attemptCount || 0) + 1;
    const prior = clean(row.status, 40) as AgentRunStatus;
    if (["SUCCEEDED", "BLOCKED", "ESCALATED"].includes(prior)) return { id, claimed: false, status: prior };
    if (prior === "RUNNING" && Number(row.lockUntil?.toMillis?.() || 0) > Date.now()) return { id, claimed: false, status: prior };
    if (prior === "RUNNING") {
      const reason = "La ejecución quedó incierta tras vencer el lock; requiere conciliación.";
      tx.set(ref, { status: "ESCALATED", reason, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(db.collection("agentIncidents").doc(`${id}-lock`), { rootId: input.rootId, reportDay: row.reportDay || mexicoDayKey(), runId: id, correlationId: input.correlationId, entityType: input.entityType, entityId: input.entityId, status: "OPEN", cause: reason, evidence: input.evidence, createdAt: FieldValue.serverTimestamp() }, { merge: true });
      return { id, claimed: false, status: "ESCALATED" as const };
    }
    const circuitOpen = Number(control.get("circuitOpenUntil")?.toMillis?.() || 0) > Date.now();
    if (!canExecuteTool(tool, false, attempt, control.get("killSwitch") === true || circuitOpen)) {
      const reason = control.get("killSwitch") === true ? "Kill switch activo." : circuitOpen ? "Circuito de agentes abierto." : "Límite de reintentos o aprobación requerida.";
      tx.set(ref, { ...input, reportDay: row.reportDay || mexicoDayKey(), status: "BLOCKED", attemptCount: Number(row.attemptCount || 0), reason, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(db.collection("agentIncidents").doc(`${id}-control`), { rootId: input.rootId, reportDay: row.reportDay || mexicoDayKey(), runId: id, correlationId: input.correlationId, entityType: input.entityType, entityId: input.entityId, status: "OPEN", cause: reason, evidence: input.evidence, createdAt: FieldValue.serverTimestamp() }, { merge: true });
      return { id, claimed: false, status: "BLOCKED" as const };
    }
    tx.set(ref, { ...input, reportDay: row.reportDay || mexicoDayKey(), status: "RUNNING", attemptCount: attempt, lockUntil: Timestamp.fromMillis(Date.now() + MAX_RUN_MS), createdAt: row.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { id, claimed: true, status: "RUNNING" as const, attempt };
  });
}

export async function finishRun(id: string, status: Extract<AgentRunStatus, "SUCCEEDED" | "FAILED_RETRYABLE" | "BLOCKED" | "ESCALATED">, result: { reason: string; uploadId?: string; evidence: string[]; resolution?: "GENERATED_NORMAL" | "RECOVERED_EXISTING" | "RECOVERED_MISSING" }) {
  const ref = db.collection("agentRuns").doc(id);
  const rootId = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("status") !== "RUNNING") throw Error("RUN_NOT_RUNNING");
    const row = snap.data() || {};
    const auditRef = db.collection("agentLedger").doc(`${id}-${row.attemptCount}`);
    tx.set(ref, { status, ...result, lockUntil: null, finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(auditRef, { runId: id, rootId: row.rootId, correlationId: row.correlationId, actorUid: row.actorUid, agentId: row.agentId, toolId: row.toolId, entityType: row.entityType, entityId: row.entityId, inputEvidence: row.evidence, action: row.toolId, result: status, resolution: result.resolution || null, outputEvidence: result.evidence, uploadId: result.uploadId || null, reason: result.reason, at: FieldValue.serverTimestamp() });
    if (status === "BLOCKED" || status === "ESCALATED") tx.create(db.collection("agentIncidents").doc(`${id}-${row.attemptCount}`), { rootId: row.rootId, reportDay: mexicoDayKey(), runId: id, correlationId: row.correlationId, entityType: row.entityType, entityId: row.entityId, status: "OPEN", cause: result.reason, evidence: result.evidence, createdAt: FieldValue.serverTimestamp() });
    return String(row.rootId);
  });
  if (status === "BLOCKED" || status === "ESCALATED") {
    await draftRepeatedCauseProposal(rootId, result.reason).catch(error => console.error("AGENT_PROPOSAL_DRAFT_FAILED", error));
  }
}
