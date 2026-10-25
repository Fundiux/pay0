import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { AGENTS, AgentRunStatus, canExecuteTool, TOOLS } from "./contract";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const MAX_RUN_MS = 10 * 60_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const clean = (value: unknown, max = 128) => String(value ?? "").trim().slice(0, max);

export type RunInput = { rootId: string; agentId: string; toolId: string; entityType: string; entityId: string; revision: string; actorUid: string; evidence: string[]; correlationId: string };
export const runIdFor = (input: RunInput) => hash([input.rootId, input.agentId, input.toolId, input.entityType, input.entityId, input.revision].join("|"));

export async function reserveRun(input: RunInput) {
  const tool = TOOLS.find(row => row.id === input.toolId);
  const agent = AGENTS.find(row => row.id === input.agentId);
  if (!tool || !agent?.enabled || !agent.permissions.includes(input.toolId === "quotation-recovery" ? "recoverQuotation" : "propose") || !input.rootId || !input.actorUid || !input.entityId || !input.revision || !input.correlationId) throw Error("INVALID_AGENT_RUN");
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
      tx.set(ref, { status: "ESCALATED", reason: "La ejecución quedó incierta tras vencer el lock; requiere conciliación.", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { id, claimed: false, status: "ESCALATED" as const };
    }
    const circuitOpen = Number(control.get("circuitOpenUntil")?.toMillis?.() || 0) > Date.now();
    if (!canExecuteTool(tool, false, attempt, control.get("killSwitch") === true || circuitOpen)) {
      tx.set(ref, { ...input, status: "BLOCKED", attemptCount: Number(row.attemptCount || 0), reason: "Kill switch, aprobación o límite de reintentos.", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { id, claimed: false, status: "BLOCKED" as const };
    }
    tx.set(ref, { ...input, status: "RUNNING", attemptCount: attempt, lockUntil: Timestamp.fromMillis(Date.now() + MAX_RUN_MS), createdAt: row.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { id, claimed: true, status: "RUNNING" as const, attempt };
  });
}

export async function finishRun(id: string, status: Extract<AgentRunStatus, "SUCCEEDED" | "FAILED_RETRYABLE" | "BLOCKED" | "ESCALATED">, result: { reason: string; uploadId?: string; evidence: string[] }) {
  const ref = db.collection("agentRuns").doc(id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("status") !== "RUNNING") throw Error("RUN_NOT_RUNNING");
    const row = snap.data() || {};
    const auditRef = db.collection("agentLedger").doc(`${id}-${row.attemptCount}`);
    tx.set(ref, { status, ...result, lockUntil: null, finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(auditRef, { runId: id, rootId: row.rootId, correlationId: row.correlationId, actorUid: row.actorUid, agentId: row.agentId, toolId: row.toolId, entityType: row.entityType, entityId: row.entityId, inputEvidence: row.evidence, action: row.toolId, result: status, outputEvidence: result.evidence, uploadId: result.uploadId || null, reason: result.reason, at: FieldValue.serverTimestamp() });
    if (status === "BLOCKED" || status === "ESCALATED") tx.create(db.collection("agentIncidents").doc(`${id}-${row.attemptCount}`), { rootId: row.rootId, runId: id, correlationId: row.correlationId, entityType: row.entityType, entityId: row.entityId, status: "OPEN", cause: result.reason, evidence: result.evidence, createdAt: FieldValue.serverTimestamp() });
  });
}
