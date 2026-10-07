import { createHash } from "node:crypto";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { enqueueIqOnDemandTaskH4D64 } from "./iqOnDemandTaskQueue";
import { readEnabledIqAutomationRoots } from "./automationRuntime";

export const AUTOMATIC_PAGO_TASK = "processIqPagoDepositAutomaticTask";
// Covers the task's 30 minute retry window plus its final 9 minute execution.
export const AUTOMATIC_PAGO_RECOVERY_GRACE_MS = 45 * 60 * 1000;

export function automaticPagoTaskId(pagoId: string, uploadId: string): string {
  return `pago-auto-${createHash("sha256").update(JSON.stringify([pagoId, uploadId])).digest("hex")}`;
}

export function matchesPagoGeneration(row: Record<string, any>, uploadId: string): boolean {
  return Boolean(uploadId) && row.iqDepositCreationQueuedUploadId === uploadId;
}

export function isAutomaticPagoRecoveryDue(row: Record<string, any>, now = Date.now()): boolean {
  const requestedAt = row.iqDepositAutoDispatchRequestedAt?.toMillis?.() || 0;
  const queuedAt = row.iqDepositCreationQueuedAt?.toMillis?.() || 0;
  const sameGeneration = row.iqDepositAutoDispatchUploadId === row.iqDepositCreationQueuedUploadId;
  return requestedAt && sameGeneration && !row.iqDepositAutoDispatchEnqueueFailedAt
    ? now - requestedAt >= AUTOMATIC_PAGO_RECOVERY_GRACE_MS
    : !queuedAt || now - queuedAt >= 60_000;
}

/** Both finalize and the durable Firestore event use the same generation/task ID. */
export async function enqueueAutomaticPagoCreation(pagoId: string, uploadId: string) {
  const ref = admin.firestore().collection("pagos").doc(pagoId);
  const enabled = await readEnabledIqAutomationRoots({ process: "pagoCreate", purpose: "CREATION", respectWindow: false });
  const reserved = await admin.firestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const row = snapshot.data() || {};
    if (!snapshot.exists || !matchesPagoGeneration(row, uploadId) || !enabled.has(String(row.rootId || "")) ||
        row.status !== "CONCILIACION_PENDIENTE" || row.iqDepositCreationStatus !== "QUEUED" ||
        row.iqDepositCreationRetryBlocked === true || row.iqDepositAutomationOmitted === true ||
        row.iqDepositTerminalLocked === true) return false;
    // Reserve before enqueue. Never overwrite PROCESSING after the task starts.
    if (row.iqDepositAutoDispatchUploadId !== uploadId || !row.iqDepositAutoDispatchRequestedAt) {
      tx.set(ref, {
        iqDepositAutoDispatchUploadId: uploadId,
        iqDepositAutoDispatchRequestedAt: FieldValue.serverTimestamp(),
        iqDepositAutoDispatchTaskId: automaticPagoTaskId(pagoId, uploadId),
      }, { merge: true });
    }
    return true;
  });
  if (!reserved) return;
  // Throw on failure: the Firestore event retries. Scheduler remains a last resort.
  try {
    const result = await enqueueIqOnDemandTaskH4D64({
      functionName: AUTOMATIC_PAGO_TASK, taskId: automaticPagoTaskId(pagoId, uploadId),
      data: { pagoId, uploadId }, scheduleDelaySeconds: 0, dispatchDeadlineSeconds: 540,
    });
    await admin.firestore().runTransaction(async (tx) => {
      const row = (await tx.get(ref)).data() || {};
      if (matchesPagoGeneration(row, uploadId) && row.iqDepositAutoDispatchEnqueueFailedAt) {
        tx.set(ref, { iqDepositAutoDispatchEnqueueFailedAt: FieldValue.delete() }, { merge: true });
      }
    });
    return result;
  } catch (error) {
    await admin.firestore().runTransaction(async (tx) => {
      const row = (await tx.get(ref)).data() || {};
      if (matchesPagoGeneration(row, uploadId) && row.iqDepositCreationStatus === "QUEUED") {
        tx.set(ref, { iqDepositAutoDispatchEnqueueFailedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    });
    throw error;
  }
}
