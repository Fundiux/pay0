import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onTaskDispatched } from "firebase-functions/tasks";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { assertAuthorized } from "../../utils/authGuard";
import { logActivity } from "../../utils/logActivity";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import { enqueueIqOnDemandTaskH4D64 } from "../iq/iqOnDemandTaskQueue";
import { generateCotizacionForSolicitudCore } from "./callables";
import { authorizeDeferredIntent } from "../../utils/authorizeDeferredIntent";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const RETRY_DELAY_MS = 10 * 60 * 1000;
const TASK_NAME = "processSolicitudQuotationOnDemandTask";
const TERMINAL = new Set(["SUCCEEDED", "BLOCKED"]);

const clean = (value: unknown, max = 500) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const upper = (value: unknown) => clean(value).toUpperCase();
const jobIdFor = (solicitudId: string, iqFolio: string, ocUploadId: string) =>
  createHash("sha256").update([solicitudId, iqFolio, ocUploadId].join("|")).digest("hex");

type QueueInput = { solicitudId: string; iqFolio: string; requestedBy: string; source?: string };

/** A transaction-backed reservation shared by both IQ success paths. */
export async function enqueueQuotationForConfirmedIq(input: QueueInput) {
  const solicitudRef = db.collection("solicitudes").doc(input.solicitudId);
  const reserved = await db.runTransaction(async (tx) => {
    const solicitudSnap = await tx.get(solicitudRef);
    if (!solicitudSnap.exists) throw new HttpsError("not-found", "Solicitud no existe.");
    const solicitud: any = solicitudSnap.data() || {};
    const rootId = clean(solicitud.rootId, 128);
    const currentIqFolio = clean(solicitud.iqFolio || solicitud.iqId, 128);
    if (!rootId || currentIqFolio !== clean(input.iqFolio, 128)) {
      throw new HttpsError("failed-precondition", "La cotizacion requiere un folio IQ confirmado y vigente.");
    }
    const activeOcUploadId = clean(solicitud.ocFiscalMetadataUploadId, 128);
    if (!activeOcUploadId) throw new HttpsError("failed-precondition", "La solicitud no tiene OC activa procesada.");
    const id = jobIdFor(input.solicitudId, currentIqFolio, activeOcUploadId);
    const ref = db.collection("solicitudQuotationJobs").doc(id);
    const current = await tx.get(ref);
    const row: any = current.exists ? current.data() || {} : {};
    const status = upper(row.status);
    const reused = current.exists && !TERMINAL.has(status);
    if (!current.exists || ["FAILED_RETRYABLE", "QUEUED"].includes(status)) {
      tx.set(ref, {
        rootId, solicitudId: input.solicitudId, solicitudFolio: clean(solicitud.folio || input.solicitudId, 128),
        iqFolio: currentIqFolio, ocUploadId: activeOcUploadId, ocFingerprint: clean(solicitud.orderUploadId || activeOcUploadId, 128),
        requestedBy: input.requestedBy, source: input.source || "IQ_CONFIRMED", status: "QUEUED",
        attemptCount: Number(row.attemptCount || 0), lastError: FieldValue.delete(), nextRunAt: null,
        createdAt: current.exists ? row.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    tx.set(solicitudRef, {
      cotizacionAutoGenerateStatus: status === "SUCCEEDED" ? "READY" : "QUEUED",
      cotizacionAutoGenerateStage: status === "SUCCEEDED" ? "COMPLETED" : "WAITING_FOR_AUTOMATIC_JOB",
      cotizacionAutoGenerateJobId: id, cotizacionAutoGenerateIqFolio: currentIqFolio,
      cotizacionAutoGenerateOcUploadId: activeOcUploadId, cotizacionAutoGenerateUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { id, rootId, solicitudFolio: clean(solicitud.folio || input.solicitudId, 128), reused, status };
  });

  await logActivity({ event: reserved.reused ? "COTIZACION_ENCOLADA" : "COTIZACION_ENCOLADA", rootId: reserved.rootId,
    adminId: reserved.rootId, actorUid: input.requestedBy, actorRole: "system", referenceId: input.solicitudId,
    referenceFolio: reserved.solicitudFolio, referenceType: "solicitud", entityId: input.solicitudId, entityType: "solicitudes",
    description: `Cotizacion encolada para ejecucion automatica tras confirmar IQ.`,
    extra: { quotationJobId: reserved.id, iqFolio: input.iqFolio, source: input.source || "IQ_CONFIRMED", automaticExecution: true },
  }).catch(() => undefined);

  if (!TERMINAL.has(reserved.status)) {
    let taskId: string | null = null; let taskError: string | null = null;
    try { taskId = (await enqueueIqOnDemandTaskH4D64({ functionName: TASK_NAME, taskId: `solicitud-quotation-${reserved.id}`, data: { jobId: reserved.id }, dispatchDeadlineSeconds: 540 })).taskId; }
    catch (error) { taskError = clean((error as any)?.message || error, 1500); }
    await db.collection("solicitudQuotationJobs").doc(reserved.id).set({ onDemandTaskId: taskId, onDemandTaskRequestedAt: FieldValue.serverTimestamp(), onDemandTaskEnqueueError: taskError, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return { queued: !TERMINAL.has(reserved.status), jobId: reserved.id, reused: reserved.reused };
}

async function processJob(jobId: string) {
  const ref = db.collection("solicitudQuotationJobs").doc(jobId);
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref); if (!snap.exists) return null;
    const job: any = snap.data() || {}; if (!["QUEUED", "FAILED_RETRYABLE"].includes(upper(job.status))) return null;
    const solicitudSnap = await tx.get(db.collection("solicitudes").doc(clean(job.solicitudId, 128)));
    const solicitud: any = solicitudSnap.exists ? solicitudSnap.data() || {} : {};
    const valid = solicitudSnap.exists && !solicitud.isDeleted && clean(solicitud.iqFolio || solicitud.iqId, 128) === clean(job.iqFolio, 128) && clean(solicitud.ocFiscalMetadataUploadId, 128) === clean(job.ocUploadId, 128);
    if (!valid) { tx.set(ref, { status: "BLOCKED", lastError: "La OC activa o el folio IQ ya no corresponden al trabajo.", finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }); return null; }
    const attemptCount = Number(job.attemptCount || 0) + 1;
    tx.set(ref, { status: "PROCESSING", attemptCount, processingStartedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(solicitudSnap.ref, { cotizacionAutoGenerateStatus: "PROCESSING", cotizacionAutoGenerateAttemptCount: attemptCount, cotizacionAutoGenerateUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ...job, attemptCount, solicitudId: clean(job.solicitudId, 128), rootId: clean(job.rootId, 128), requestedBy: clean(job.requestedBy, 128), clientId: clean(solicitud.clienteId || solicitud.clientId, 128) };
  });
  if (!claimed) return;
  try {
    // Cloud Tasks has no end-user Firebase auth. Revalidate the persisted
    // origin at execution time before granting the server-only capability.
    await authorizeDeferredIntent({ uid: claimed.requestedBy, rootId: claimed.rootId, module: "solicitudes", action: "uploadDocs", clientId: claimed.clientId, permission: "operateSolicitudes" });
    // A confirmed replacement IQ folio is a new commercial attempt. The
    // document lifecycle keeps only one active version if a worker is retried.
    const result: any = await generateCotizacionForSolicitudCore({ data: { solicitudId: claimed.solicitudId, replaceExisting: true }, internalAutomation: { rootId: claimed.rootId, originUid: claimed.requestedBy, quotationJobId: jobId } });
    if (!result?.active) throw new Error("La cotizacion no quedo activa.");
    await ref.set({ status: "SUCCEEDED", uploadId: result.uploadId || null, finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), lastError: FieldValue.delete(), nextRunAt: null }, { merge: true });
    await logActivity({ event: "COTIZACION_GENERADA", rootId: claimed.rootId, adminId: claimed.rootId, actorUid: claimed.requestedBy, actorRole: "system", referenceId: claimed.solicitudId, referenceType: "solicitud", entityId: claimed.solicitudId, entityType: "solicitudes", description: "Cotizacion generada por ejecucion automatica.", extra: { quotationJobId: jobId, iqFolio: claimed.iqFolio, uploadId: result.uploadId || null, automaticExecution: true } }).catch(() => undefined);
  } catch (error) {
    const message = clean((error as any)?.message || error, 1500);
    const blocked = String((error as any)?.code || "").toLowerCase() === "permission-denied";
    const status = blocked ? "BLOCKED" : "FAILED_RETRYABLE";
    await ref.set({ status, lastError: message, nextRunAt: blocked ? null : Timestamp.fromMillis(Date.now() + RETRY_DELAY_MS), finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection("solicitudes").doc(claimed.solicitudId).set({ cotizacionAutoGenerateStatus: status, cotizacionAutoGenerateLastError: message, cotizacionAutoGenerateUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await logActivity({ event: "COTIZACION_FALLIDA_REINTENTO", rootId: claimed.rootId, adminId: claimed.rootId, actorUid: claimed.requestedBy, actorRole: "system", referenceId: claimed.solicitudId, referenceType: "solicitud", entityId: claimed.solicitudId, entityType: "solicitudes", description: blocked ? "Cotizacion bloqueada porque la autorizacion origen ya no es valida." : "Cotizacion fallida; pendiente de reintento automatico.", extra: { quotationJobId: jobId, automaticExecution: true, status, error: message } }).catch((auditError) => console.error("COTIZACION_AUDIT_WRITE_FAILED", auditError));
  }
}

export const processSolicitudQuotationOnDemandTask = onTaskDispatched({ region: "us-central1", timeoutSeconds: 540, memory: "1GiB", maxInstances: 2, concurrency: 1, retryConfig: { maxAttempts: 1, minBackoffSeconds: 60 } }, async (request) => { const jobId = clean((request.data as any)?.jobId, 128); if (jobId) await processJob(jobId); });

export const processSolicitudQuotationQueue = onSchedule({ schedule: "every 5 minutes", timeZone: "America/Mexico_City", timeoutSeconds: 540, memory: "1GiB" }, async () => {
  const now = Timestamp.now();
  // Two single-field reads avoid requiring a production composite index for
  // recovery; Cloud Tasks remains the primary execution path.
  const [queued, retryable] = await Promise.all([
    db.collection("solicitudQuotationJobs").where("status", "==", "QUEUED").limit(50).get(),
    db.collection("solicitudQuotationJobs").where("status", "==", "FAILED_RETRYABLE").limit(50).get(),
  ]);
  const jobs = [...queued.docs, ...retryable.docs];
  for (const snap of jobs) { const row: any = snap.data() || {}; const next = row.nextRunAt?.toMillis?.() || 0; if (!next || next <= now.toMillis()) await processJob(snap.id); }
});

/** Read-only operational preview; it deliberately never enqueues or repairs. */
export const previewSolicitudesWithoutQuotation = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
  const uid = requireAuth(request); const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: "solicitudes", requiredAction: "view" });
  const rootId = clean(user?.rootId || uid, 128); const [snap, uploads] = await Promise.all([db.collection("solicitudes").where("rootId", "==", rootId).limit(500).get(), db.collection("uploads").where("rootId", "==", rootId).limit(2000).get()]);
  const activeQuoteSolicitudIds = new Set(uploads.docs.filter(doc => { const row: any = doc.data() || {}; return row.documentType === "COTIZACION" && row.active === true; }).map(doc => clean((doc.data() || {}).solicitudId, 128)));
  const candidates: any[] = [];
  for (const doc of snap.docs) { const row: any = doc.data() || {}; const iqFolio = clean(row.iqFolio || row.iqId, 128); const ocUploadId = clean(row.ocFiscalMetadataUploadId, 128); if (!iqFolio || !ocUploadId || activeQuoteSolicitudIds.has(doc.id)) continue; candidates.push({ solicitudId: doc.id, folio: clean(row.folio || doc.id, 128), iqFolio, ocUploadId, quotationStatus: clean(row.cotizacionAutoGenerateStatus || "MISSING", 64) }); }
  return { ok: true, readOnly: true, candidates };
});
