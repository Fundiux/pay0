import { FieldValue } from "firebase-admin/firestore";
import { mexicoDayKey } from "../agentOperations/time";

/** Never re-run an uncertain PROCESSING job: preserve evidence for reconciliation. */
export async function escalateStaleQuotationJob(db: FirebaseFirestore.Firestore, jobId: string, nowMs: number, staleMs: number): Promise<boolean> {
  const ref = db.collection("solicitudQuotationJobs").doc(jobId);
  return db.runTransaction(async tx => {
    const current = await tx.get(ref);
    const started = current.get("processingStartedAt")?.toMillis?.() || 0;
    if (!current.exists || current.get("status") !== "PROCESSING" || !started || started + staleMs > nowMs) return false;
    const row = current.data() || {};
    const cause = "Trabajo de cotización venció en PROCESSING; resultado incierto, requiere conciliación.";
    tx.set(ref, { status: "ESCALATED", lastError: cause, finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection("agentIncidents").doc(`quotation-${jobId}`), { rootId: row.rootId, reportDay: mexicoDayKey(), runId: null, correlationId: jobId, entityType: "solicitud", entityId: row.solicitudId, status: "OPEN", cause, evidence: [`solicitudQuotationJobs/${jobId}`, `solicitudes/${row.solicitudId}`], createdAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}
