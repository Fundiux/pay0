import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { logActivityBatch } from "../../utils/logActivity";
import { isConfirmedFacturamaCancellation } from "./cancellationStatus";
import { PENDING_WINDOW_MS } from "./cancellationGuard";

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
};

// Statuses of a job whose CFDI exists. PAUSED/QUEUED/BLOCKED jobs never issued one, so there is nothing to cancel.
const ISSUED_JOB_STATUSES = new Set(["RECEIVED", "ISSUED_PENDING_FILES"]);

export function isRepCancelled(rep: Pick<FacturamaRep, "cancellationStatus">): boolean {
  return isConfirmedFacturamaCancellation(rep.cancellationStatus);
}

export function repsToCancel(reps: FacturamaRep[]): FacturamaRep[] {
  return reps.filter(rep => !isRepCancelled(rep));
}

// A request already sent and not answered stays open for a week; sending the DELETE again could duplicate it.
export function repCancellationBlock(rep: FacturamaRep, now = Date.now()): string | null {
  const status = upper(rep.cancellationStatus);
  if (status === "REQUESTING" || status === "REQUEST_UNCERTAIN" || status === "REQUESTED") {
    if (rep.cancellationRequestedAtMs && now - rep.cancellationRequestedAtMs < PENDING_WINDOW_MS) return "Ya hay una cancelación del complemento en curso.";
  }
  return null;
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
    });
  }
  return reps.sort((a, b) => a.installment - b.installment || a.requestId.localeCompare(b.requestId));
}

// What the screen may show: the parcialidad and the amount, never ids.
export const publicRep = (rep: FacturamaRep) => ({ installment: rep.installment, amountMinor: rep.amountMinor, cancelled: isRepCancelled(rep) });

export type RepCancelOutcome = {
  allConfirmed: boolean;
  results: Array<{ installment: number; status: string; skipped?: boolean; error?: string }>;
};

/**
 * Cancels the live complements of a solicitud, one at a time, before its invoice. `cancelCfdi` is the single call to
 * Facturama (injected so tests never reach it). Retry-safe: a complement already cancelled is skipped, one with a request
 * still open is not sent again, and a failure stops the sequence so the invoice is never cancelled over a live complement.
 */
export async function cancelRepsBeforeInvoice(input: {
  db: Firestore; rootId: string; solicitudId: string; solicitudFolio: string | null; actorUid: string; actorRole: string;
  cancelCfdi: (cfdiId: string, motive: string) => Promise<{ Status?: string; status?: string }>;
  now?: () => number;
}): Promise<RepCancelOutcome> {
  const { db } = input;
  const results: RepCancelOutcome["results"] = [];
  for (const rep of await listFacturamaReps(db, input.rootId, input.solicitudId)) {
    if (isRepCancelled(rep)) { results.push({ installment: rep.installment, status: "CANCELED", skipped: true }); continue; }
    const blocked = repCancellationBlock(rep, input.now?.());
    if (blocked) { results.push({ installment: rep.installment, status: rep.cancellationStatus, error: blocked }); return { allConfirmed: false, results }; }
    const jobRef = db.doc(`paymentComplementJobs/${rep.jobId}`);
    await jobRef.set({ repCancellationStatus: "REQUESTING", repCancellationRequestedAt: FieldValue.serverTimestamp(), repCancellationRequestedBy: input.actorUid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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
        description: `La cancelación del complemento de pago (parcialidad ${rep.installment}) ${rejected ? "fue rechazada" : "quedó sin respuesta"}; la factura no se cancela hasta resolverlo.` });
      await batch.commit();
      results.push({ installment: rep.installment, status: rejected ? "REQUEST_FAILED" : "REQUEST_UNCERTAIN", error: clean(error?.message || error, 200) });
      return { allConfirmed: false, results };
    }
    const confirmed = isConfirmedFacturamaCancellation(status);
    const batch = db.batch();
    batch.set(jobRef, { repCancellationStatus: status, repCancellationMotive: REP_CANCEL_MOTIVE, repCancellationError: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logActivityBatch(batch, db, { event: confirmed ? "FACTURAMA_CANCELACION_CONFIRMADA" : "FACTURAMA_CANCELACION_SOLICITADA", rootId: input.rootId, actorUid: input.actorUid, actorRole: input.actorRole,
      referenceId: input.solicitudId, referenceFolio: input.solicitudFolio, referenceType: "SOLICITUD",
      description: `Complemento de pago (parcialidad ${rep.installment}) ${confirmed ? "cancelado" : "con cancelación solicitada"} antes de cancelar la factura original.` });
    await batch.commit();
    results.push({ installment: rep.installment, status });
    if (!confirmed) return { allConfirmed: false, results };
  }
  return { allConfirmed: true, results };
}
