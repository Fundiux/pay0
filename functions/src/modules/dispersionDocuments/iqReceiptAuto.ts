import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logActivity } from "../../utils/logActivity";
import { SafetyRuntime } from "../automationSafety/runtime";
import { loadEnabledIqAutomationRoots } from "../iq/automationRuntime";
import { IQ_CREDENTIALS_KEY, buildDispersionSchedulerAuth } from "../iq/dispersionCreationCallables";
import { importIqDispersionReceiptCore } from "./iqReceiptImport";
import {
  RECEIPT_AUTO_EXPIRE_PER_RUN, RECEIPT_AUTO_MAX_PER_ROOT, RECEIPT_AUTO_PAGE_SIZE, RECEIPT_AUTO_RECHECK_MS, RECEIPT_AUTO_WINDOW_MS,
  decideReceiptAuto, receiptAutoFolio,
} from "./iqReceiptAutoDomain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

const ITEM_SPACING_MS = 1_100;

type ItemResult = "IMPORTED" | "ALREADY_ATTACHED" | "NOT_AVAILABLE" | "EXPIRED" | "REVIEW" | "RETRY" | "STOP" | "SKIPPED";

// Maps the shared import's HttpsErrors onto the safety runtime's failure classes:
// a network problem is retryable, every other refusal needs a person.
function toSafetyError(error: unknown): Error {
  if (error instanceof HttpsError && error.code === "unavailable") return new Error("IQ_RECEIPT_NETWORK_TIMEOUT");
  if (error instanceof HttpsError) return new Error("IQ_RECEIPT_NEEDS_REVIEW");
  return error instanceof Error ? error : new Error("IQ_RECEIPT_FAILED");
}

export async function processDispersionReceipt(rootId: string, dispersionId: string, principal: Record<string, unknown>, nowMs: number): Promise<ItemResult> {
  const ref = db.doc(`clientDispersions/${dispersionId}`);
  const folio = receiptAutoFolio(principal);
  const auth = await buildDispersionSchedulerAuth(principal, rootId).catch(() => null);
  if (!auth) {
    await ref.set({ iqReceiptAutoStatus: "REVIEW", iqReceiptAutoError: "NO_AUTHORIZED_ACTOR", iqReceiptAutoCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
    return "REVIEW";
  }
  const slot = Math.floor(nowMs / RECEIPT_AUTO_RECHECK_MS);
  const run = await new SafetyRuntime(db).run({
    rootId, process: "DISPERSION_RECEIPT", partition: "IQ", operationType: "DISPERSION_RECEIPT_IMPORT",
    operationId: dispersionId, idempotencyKey: `${dispersionId}:${folio}:${slot}`,
    origin: "AUTOMATIC", technicalOrigin: "SCHEDULER", externalTarget: "IQ",
  }, async () => {
    try {
      return await importIqDispersionReceiptCore({ auth, dispersionId, source: "AUTOMATIC" });
    } catch (error) {
      throw toSafetyError(error);
    }
  });
  if (!run.admitted) return run.reason === "KILL_SWITCH" ? "STOP" : run.reason === "QUARANTINED" || run.reason === "OUTCOME_UNKNOWN" ? "REVIEW" : "RETRY";
  const outcome = (run as { value?: { status: string } }).value;
  if (!outcome) {
    if (run.reason === "RETRY_WAIT") return "RETRY";
    await ref.set({ iqReceiptAutoStatus: "REVIEW", iqReceiptAutoError: "IMPORT_FAILED", iqReceiptAutoCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
    return "REVIEW";
  }
  if (outcome.status === "NOT_AVAILABLE") {
    await ref.set({
      iqReceiptAutoStatus: "WAITING", iqReceiptAutoError: null, iqReceiptAutoCheckedAt: FieldValue.serverTimestamp(),
      iqReceiptAutoNextCheckAt: new Date(nowMs + RECEIPT_AUTO_RECHECK_MS), iqReceiptAutoAttempts: FieldValue.increment(1),
    }, { merge: true });
    return "NOT_AVAILABLE";
  }
  // IMPORTED sets the READY fields itself; a receipt that already existed only needs the marker.
  if (outcome.status === "ALREADY_ATTACHED") await ref.set({ iqReceiptAutoStatus: "HAS_RECEIPT" }, { merge: true });
  return outcome.status === "IMPORTED" ? "IMPORTED" : "ALREADY_ATTACHED";
}

async function giveUp(rootId: string, dispersionId: string, principal: Record<string, unknown>) {
  await db.doc(`clientDispersions/${dispersionId}`).set({
    iqReceiptAutoStatus: "EXPIRED", iqReceiptStatus: "PENDING_NOT_FOUND",
    iqReceiptAutoGaveUpAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await logActivity({
    event: "IQ_COMPROBANTE_DISPERSION_PENDIENTE", rootId, actorUid: "SYSTEM", actorRole: "system",
    referenceId: dispersionId, referenceFolio: clean(principal.folio || principal.sequenceDisplay) || null, referenceType: "dispersion",
    description: `IQ no entrego el comprobante de la dispersion en la ventana de busqueda; queda pendiente. FOLIO IQ: ${receiptAutoFolio(principal)}.`,
  }).catch(() => undefined);
}

export async function runIqDispersionReceiptScan(rootId: string, nowMs = Date.now()) {
  const configRef = db.collection("iqIntegrationConfigs").doc(rootId);
  const configSnap = await configRef.get();
  const runtime = (configSnap.data()?.automationRuntime?.dispersionReceipt || {}) as Record<string, unknown>;
  const storedCursorId = clean(runtime.scanCursorId);
  const cursorSnap = storedCursorId ? await db.doc(`clientDispersions/${storedCursorId}`).get() : null;
  // Only dispersions generated inside the search window are ever read, oldest first.
  const cutoff = admin.firestore.Timestamp.fromMillis(nowMs - RECEIPT_AUTO_WINDOW_MS);
  const base = db.collection("clientDispersions").where("rootId", "==", rootId).where("iqGenerationStatus", "==", "IQ_GENERADA")
    .where("iqGenerationUpdatedAt", ">=", cutoff).orderBy("iqGenerationUpdatedAt").limit(RECEIPT_AUTO_PAGE_SIZE);
  let snap = cursorSnap?.exists && clean(cursorSnap.data()?.rootId) === rootId ? await base.startAfter(cursorSnap).get() : await base.get();
  // Cursor stale or end reached: restart from the first page in the same run.
  if (snap.empty && storedCursorId) snap = await base.get();

  const counts: Record<string, number> = {};
  // Report as pending only what this job tried and IQ never delivered; untouched history is never read here.
  const stale = await db.collection("clientDispersions").where("rootId", "==", rootId).where("iqReceiptAutoStatus", "==", "WAITING")
    .where("iqGenerationUpdatedAt", "<", cutoff).limit(RECEIPT_AUTO_EXPIRE_PER_RUN).get();
  for (const doc of stale.docs) {
    if (decideReceiptAuto(doc.data(), rootId, nowMs).action !== "EXPIRED") continue;
    await giveUp(rootId, doc.id, doc.data());
    counts.EXPIRED = (counts.EXPIRED || 0) + 1;
  }
  let handled = 0, holdCursor = false, stopped = false;
  for (const doc of snap.docs) {
    const principal = doc.data();
    if (decideReceiptAuto(principal, rootId, nowMs).action !== "CHECK") continue;
    if (handled >= RECEIPT_AUTO_MAX_PER_ROOT) { holdCursor = true; break; }
    // The safety runtime admits one IQ operation per second; wait instead of deferring the rest of the page.
    if (handled > 0) await new Promise((resolve) => setTimeout(resolve, ITEM_SPACING_MS));
    handled += 1;
    let result: ItemResult;
    try {
      result = await processDispersionReceipt(rootId, doc.id, principal, nowMs);
    } catch (error) {
      console.error("IQ_DISPERSION_RECEIPT_ITEM_ERROR", { rootId, dispersionId: doc.id, message: error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN" });
      result = "RETRY";
    }
    counts[result] = (counts[result] || 0) + 1;
    if (result === "STOP") { stopped = true; holdCursor = true; break; }
    // A network failure keeps the cursor so the same page is read again next run.
    if (result === "RETRY") holdCursor = true;
  }

  const lastDoc = snap.docs[snap.docs.length - 1];
  const reachedEnd = snap.docs.length < RECEIPT_AUTO_PAGE_SIZE && !holdCursor;
  if (!holdCursor) {
    await configRef.set({
      automationRuntime: { dispersionReceipt: {
        scanCursorId: reachedEnd ? null : lastDoc?.id ?? null, scanPageSize: RECEIPT_AUTO_PAGE_SIZE,
        lastScanCount: snap.docs.length, lastHandledCount: handled, scanCursorUpdatedAt: FieldValue.serverTimestamp(),
      } },
    }, { merge: true });
  }
  return { scanned: snap.docs.length, handled, counts, stopped, cursorHeld: holdCursor };
}

export const processIqDispersionReceipts = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "us-central1",
    timeZone: "America/Mexico_City",
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 1,
    concurrency: 1,
    secrets: [IQ_CREDENTIALS_KEY],
  },
  async () => {
    // IQ master switch + "dispersiones" flow + operating window + interval claim.
    const enabledRoots = await loadEnabledIqAutomationRoots({ process: "dispersionReceipt", purpose: "RECONCILIATION" });
    for (const rootId of enabledRoots.keys()) {
      const result = await runIqDispersionReceiptScan(rootId);
      await db.collection("iqQueueRuns").doc(`dispersion-receipt-${rootId}-${Date.now()}`).set({
        type: "DISPERSION_RECEIPT_IMPORT", rootId, ...result, createdAt: FieldValue.serverTimestamp(),
      }).catch(() => undefined);
    }
  },
);
