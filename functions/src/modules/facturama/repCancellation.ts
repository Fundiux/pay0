import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { logActivityBatch } from "../../utils/logActivity";
import { isConfirmedFacturamaCancellation } from "./cancellationStatus";

const clean = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);
const upper = (value: unknown) => clean(value, 40).toUpperCase();

// A CFDI de ingreso with a live complemento de pago is "no cancelable" for the SAT, so the complements go first.
// SAT motive 02: the complement is cancelled because the operation it reported no longer stands.
export const REP_CANCEL_MOTIVE = "02";
export const REP_CANCELLATION_CONFIRM_REQUIRED = "REP_CANCELLATION_CONFIRM_REQUIRED";

export type FacturamaRep = {
  requestId: string;
  jobId: string;
  cfdiId: string;
  applicationFolio: string;
  installment: number;
  amountMinor: number | null;
  cancellationStatus: string;
  cancellationRequestedAtMs: number;
  cancellationAttempts: number;
  /** UUID of the complement, from its request; needed to ask the SAT for its status. */
  uuid: string;
  receiptUploadId: string;
};

// Statuses of a job whose CFDI exists. PAUSED/QUEUED/BLOCKED jobs never issued one, so there is nothing to cancel.
const ISSUED_JOB_STATUSES = new Set(["RECEIVED", "ISSUED_PENDING_FILES"]);

export function isRepCancelled(rep: Pick<FacturamaRep, "cancellationStatus">): boolean {
  return isConfirmedFacturamaCancellation(rep.cancellationStatus);
}

export function repsToCancel(reps: FacturamaRep[]): FacturamaRep[] {
  return reps.filter(rep => !isRepCancelled(rep));
}

export async function listFacturamaReps(db: Firestore, rootId: string, solicitudId: string): Promise<FacturamaRep[]> {
  const requests = await db.collection("paymentComplementRequests").where("rootId", "==", rootId).where("solicitudId", "==", solicitudId).get();
  const reps: FacturamaRep[] = [];
  for (const request of requests.docs) {
    const data = request.data();
    const jobId = clean(data.automationJobId, 128);
    if (data.provider !== "FACTURAMA" || !jobId) continue;
    const job = (await db.doc(`paymentComplementJobs/${jobId}`).get()).data();
    if (!job || job.rootId !== rootId || !clean(job.cfdiId) || !ISSUED_JOB_STATUSES.has(upper(job.status))) continue;
    reps.push({
      requestId: request.id, jobId, cfdiId: clean(job.cfdiId, 256), applicationFolio: clean(data.applicationFolio),
      installment: Number(data.installment || 0), amountMinor: Number.isSafeInteger(data.amountMinor) ? data.amountMinor : null,
      cancellationStatus: upper(job.repCancellationStatus), cancellationRequestedAtMs: job.repCancellationRequestedAt?.toMillis?.() ?? 0,
      cancellationAttempts: Number(job.repCancellationAttempts || 0), uuid: clean(data.uuid, 64).toUpperCase(), receiptUploadId: clean(job.repCancellationReceiptUploadId),
    });
  }
  return reps.sort((a, b) => a.installment - b.installment || a.requestId.localeCompare(b.requestId));
}

// What the screen may show: the parcialidad and the amount, never ids.
export const publicRep = (rep: FacturamaRep) => ({ installment: rep.installment, amountMinor: rep.amountMinor, cancelled: isRepCancelled(rep) });

/**
 * Sends the cancellation of ONE complement to Facturama (`cancelCfdi` is injected so tests never reach it) and records the answer.
 * It never throws: a rejection or a timeout leaves the complement pending, and the process asks again after 72 hours.
 */
export async function requestOneRepCancellation(input: {
  db: Firestore; rootId: string; solicitudId: string; solicitudFolio: string | null; actorUid: string; actorRole: string; rep: FacturamaRep;
  cancelCfdi: (cfdiId: string, motive: string) => Promise<{ Status?: string; status?: string }>;
}): Promise<string> {
  const { db, rep } = input;
  const jobRef = db.doc(`paymentComplementJobs/${rep.jobId}`);
  await jobRef.set({ repCancellationStatus: "REQUESTING", repCancellationRequestedAt: FieldValue.serverTimestamp(), repCancellationRequestedBy: input.actorUid,
    repCancellationAttempts: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  let status = "";
  try {
    const answer = await input.cancelCfdi(rep.cfdiId, REP_CANCEL_MOTIVE);
    status = upper(answer?.Status || answer?.status) || "REQUESTED";
  } catch (error: any) {
    // Only a 4xx proves the complement was not cancelled; after a timeout or a 5xx the DELETE may have landed.
    const rejected = Number(error?.providerStatus) >= 400 && Number(error?.providerStatus) < 500;
    const batch = db.batch();
    batch.set(jobRef, { repCancellationStatus: rejected ? "REQUEST_FAILED" : "REQUEST_UNCERTAIN", repCancellationError: clean(error?.message || error, 500), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logActivityBatch(batch, db, { event: rejected ? "FACTURAMA_CANCELACION_FALLIDA" : "FACTURAMA_CANCELACION_INCIERTA", rootId: input.rootId, actorUid: input.actorUid, actorRole: input.actorRole,
      referenceId: input.solicitudId, referenceFolio: input.solicitudFolio, referenceType: "SOLICITUD",
      description: `La cancelación del complemento de pago (parcialidad ${rep.installment}) ${rejected ? "fue rechazada" : "quedó sin respuesta"}; se vuelve a intentar en 72 horas y la factura no se cancela mientras tanto.` });
    await batch.commit();
    return rejected ? "REQUEST_FAILED" : "REQUEST_UNCERTAIN";
  }
  const confirmed = isConfirmedFacturamaCancellation(status);
  const batch = db.batch();
  batch.set(jobRef, { repCancellationStatus: status, repCancellationMotive: REP_CANCEL_MOTIVE, repCancellationError: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  logActivityBatch(batch, db, { event: confirmed ? "FACTURAMA_CANCELACION_CONFIRMADA" : "FACTURAMA_CANCELACION_SOLICITADA", rootId: input.rootId, actorUid: input.actorUid, actorRole: input.actorRole,
    referenceId: input.solicitudId, referenceFolio: input.solicitudFolio, referenceType: "SOLICITUD",
    description: `Complemento de pago (parcialidad ${rep.installment}) ${confirmed ? "cancelado" : "con cancelación solicitada"} antes de cancelar la factura original.` });
  await batch.commit();
  return status;
}

/** The complement is effectively cancelled (the SAT said so). */
export async function markRepCancelled(db: Firestore, rep: FacturamaRep): Promise<void> {
  await db.doc(`paymentComplementJobs/${rep.jobId}`).set({ repCancellationStatus: "CANCELED", repCancellationConfirmedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
