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
import { finishRun, reserveRun } from "../agentOperations/engine";
import { mexicoDayKey } from "../agentOperations/time";
import { verifyQuotationEvidence } from "../agentOperations/quotationEvidence";
import { isTerminalSolicitud } from "./quotationPolicy";
import { observeSentinelEvent } from "../agentOperations/sentinel";
import { escalateStaleQuotationJob } from "./staleJob";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const RETRY_DELAY_MS = 10 * 60 * 1000;
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const EXPECTED_QUOTE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 2;
const TASK_NAME = "processSolicitudQuotationOnDemandTask";
const TERMINAL = new Set(["SUCCEEDED", "BLOCKED", "ESCALATED"]);

const clean = (value: unknown, max = 500) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const upper = (value: unknown) => clean(value).toUpperCase();
const jobIdFor = (solicitudId: string, iqFolio: string, ocUploadId: string) =>
  createHash("sha256").update([solicitudId, iqFolio, ocUploadId].join("|")).digest("hex");

type QueueInput = { solicitudId: string; iqFolio: string; requestedBy: string; source?: string; batchId?: string };

/** A transaction-backed reservation shared by both IQ success paths. */
export async function enqueueQuotationForConfirmedIq(input: QueueInput) {
  const solicitudRef = db.collection("solicitudes").doc(input.solicitudId);
  const reserved = await db.runTransaction(async (tx) => {
    const solicitudSnap = await tx.get(solicitudRef);
    if (!solicitudSnap.exists) throw new HttpsError("not-found", "Solicitud no existe.");
    const solicitud: any = solicitudSnap.data() || {};
    if (isTerminalSolicitud(solicitud)) throw new HttpsError("failed-precondition", "Solicitud terminal; no se encola cotizacion.");
    const rootId = clean(solicitud.rootId, 128);
    const currentIqFolio = clean(solicitud.iqFolio || solicitud.iqId, 128);
    if (!rootId || !currentIqFolio || currentIqFolio !== clean(input.iqFolio, 128)) {
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
    const exhausted = Number(row.attemptCount || 0) >= MAX_ATTEMPTS;
    const effectiveStatus = exhausted && ["FAILED_RETRYABLE", "QUEUED"].includes(status) ? "ESCALATED" : status;
    if (effectiveStatus === "ESCALATED" && status !== "ESCALATED") tx.set(ref, { status: "ESCALATED", lastError: "Límite de intentos agotado.", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (!current.exists || ["FAILED_RETRYABLE", "QUEUED"].includes(status) && !exhausted) {
      tx.set(ref, {
        rootId, solicitudId: input.solicitudId, solicitudFolio: clean(solicitud.folio || input.solicitudId, 128),
        iqFolio: currentIqFolio, ocUploadId: activeOcUploadId, ocFingerprint: clean(solicitud.orderUploadId || activeOcUploadId, 128),
        requestedBy: input.requestedBy, source: input.source || "IQ_CONFIRMED", batchId: clean(input.batchId, 128) || null, status: "QUEUED",
        attemptCount: Number(row.attemptCount || 0), lastError: FieldValue.delete(), nextRunAt: null,
        createdAt: current.exists ? row.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    tx.set(solicitudRef, {
      cotizacionAutoGenerateStatus: effectiveStatus === "SUCCEEDED" ? "READY" : effectiveStatus === "ESCALATED" || effectiveStatus === "BLOCKED" ? effectiveStatus : "QUEUED",
      cotizacionAutoGenerateStage: effectiveStatus === "SUCCEEDED" ? "COMPLETED" : TERMINAL.has(effectiveStatus) ? "STOPPED" : "WAITING_FOR_AUTOMATIC_JOB",
      cotizacionAutoGenerateJobId: id, cotizacionAutoGenerateIqFolio: currentIqFolio,
      cotizacionAutoGenerateOcUploadId: activeOcUploadId, cotizacionAutoGenerateUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { id, rootId, solicitudFolio: clean(solicitud.folio || input.solicitudId, 128), reused, status: effectiveStatus };
  });

  await logActivity({ event: reserved.reused ? "COTIZACION_ENCOLADA" : "COTIZACION_ENCOLADA", rootId: reserved.rootId,
    adminId: reserved.rootId, actorUid: input.requestedBy, actorRole: "system", referenceId: input.solicitudId,
    referenceFolio: reserved.solicitudFolio, referenceType: "solicitud", entityId: input.solicitudId, entityType: "solicitudes",
    description: `Cotizacion encolada para ejecucion automatica tras confirmar IQ.`,
    extra: { quotationJobId: reserved.id, iqFolio: input.iqFolio, batchId: clean(input.batchId, 128) || null, source: input.source || "IQ_CONFIRMED", automaticExecution: true },
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
    const control = await tx.get(db.collection("agentControls").doc(clean(job.rootId, 128)));
    const incident = (cause: string) => tx.set(db.collection("agentIncidents").doc(`quotation-${jobId}`), { rootId: job.rootId, reportDay: mexicoDayKey(), runId: null, correlationId: jobId, entityType: "solicitud", entityId: job.solicitudId, status: "OPEN", cause, evidence: [`solicitudQuotationJobs/${jobId}`, `solicitudes/${job.solicitudId}`], createdAt: FieldValue.serverTimestamp() }, { merge: true });
    if (control.get("killSwitch") === true) { const cause = "Kill switch de agentes activo."; tx.set(ref, { status: "BLOCKED", lastError: cause, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); incident(cause); return null; }
    if (Number(job.attemptCount || 0) >= MAX_ATTEMPTS) { const cause = "Límite de intentos agotado."; tx.set(ref, { status: "ESCALATED", lastError: cause, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); incident(cause); return null; }
    const solicitudSnap = await tx.get(db.collection("solicitudes").doc(clean(job.solicitudId, 128)));
    const solicitud: any = solicitudSnap.exists ? solicitudSnap.data() || {} : {};
    const valid = solicitudSnap.exists && !isTerminalSolicitud(solicitud) && clean(solicitud.iqFolio || solicitud.iqId, 128) === clean(job.iqFolio, 128) && clean(solicitud.ocFiscalMetadataUploadId, 128) === clean(job.ocUploadId, 128);
    if (!valid) { const cause = "Solicitud terminal o la OC activa o el folio IQ ya no corresponden al trabajo."; tx.set(ref, { status: "BLOCKED", lastError: cause, finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }); incident(cause); return null; }
    const attemptCount = Number(job.attemptCount || 0) + 1;
    tx.set(ref, { status: "PROCESSING", attemptCount, processingStartedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(solicitudSnap.ref, { cotizacionAutoGenerateStatus: "PROCESSING", cotizacionAutoGenerateAttemptCount: attemptCount, cotizacionAutoGenerateUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ...job, attemptCount, solicitudId: clean(job.solicitudId, 128), rootId: clean(job.rootId, 128), requestedBy: clean(job.requestedBy, 128), clientId: clean(solicitud.clienteId || solicitud.clientId, 128), iqFingerprint: clean(solicitud.iqCreationFingerprint, 128) };
  });
  if (!claimed) return;
  let agentRunId: string | null = null;
  let runFinished = false;
  try {
    const iqAttempt = claimed.iqFingerprint ? await db.collection("solicitudes").doc(claimed.solicitudId).collection("iqAttempts").doc(claimed.iqFingerprint).get() : null;
    const iqEvidence = iqAttempt?.exists ? `solicitudes/${claimed.solicitudId}/iqAttempts/${claimed.iqFingerprint}` : "IQ_ATTEMPT_NOT_FOUND";
    const run = await reserveRun({
      rootId: claimed.rootId, agentId: "expediente", toolId: "quotation-recovery",
      entityType: "solicitud", entityId: claimed.solicitudId, revision: jobId,
      actorUid: claimed.requestedBy, correlationId: jobId,
      evidence: [`solicitudes/${claimed.solicitudId}`, `solicitudQuotationJobs/${jobId}`, iqEvidence, `IQ:${claimed.iqFolio}`, `OC:${claimed.ocUploadId}`],
    });
    if (!run.claimed) throw new HttpsError("failed-precondition", `Ejecucion de agente no disponible: ${run.status}.`);
    agentRunId = run.id;
    // Cloud Tasks has no end-user Firebase auth. Revalidate the persisted
    // origin at execution time before granting the server-only capability.
    await authorizeDeferredIntent({ uid: claimed.requestedBy, rootId: claimed.rootId, module: "solicitudes", action: "uploadDocs", clientId: claimed.clientId, permission: "operateSolicitudes" });
    // A confirmed replacement IQ folio is a new commercial attempt. The
    // document lifecycle keeps only one active version if a worker is retried.
    const result: any = await generateCotizacionForSolicitudCore({ data: { solicitudId: claimed.solicitudId, replaceExisting: true }, internalAutomation: { rootId: claimed.rootId, originUid: claimed.requestedBy, quotationJobId: jobId } });
    if (!result?.active) throw new Error("La cotizacion no quedo activa.");
    const verified = await verifyQuotationEvidence({ rootId: claimed.rootId, solicitudId: claimed.solicitudId, jobId, uploadId: clean(result.uploadId, 128), iqFolio: claimed.iqFolio, ocUploadId: claimed.ocUploadId });
    const delayed = claimed.attemptCount > 1 || (claimed.createdAt?.toMillis?.() || Date.now()) + EXPECTED_QUOTE_MS < Date.now();
    const resolution = result.alreadyExists ? "RECOVERED_EXISTING" : delayed ? "RECOVERED_MISSING" : "GENERATED_NORMAL";
    await finishRun(agentRunId, "SUCCEEDED", { reason: result.alreadyExists ? "Cotización existente recuperada, ligada al expediente y verificada en Storage." : "Cotización generada, ligada al expediente y verificada en Storage.", resolution, uploadId: verified.uploadId, evidence: [...verified.evidence, iqEvidence] });
    runFinished = true;
    await db.runTransaction(async tx => {
      const solicitudRef = db.collection("solicitudes").doc(claimed.solicitudId);
      const [jobSnap, solicitudSnap] = await Promise.all([tx.get(ref), tx.get(solicitudRef)]);
      const solicitud = solicitudSnap.data() || {};
      if (jobSnap.get("status") !== "PROCESSING" || !solicitudSnap.exists || isTerminalSolicitud(solicitud) || clean(solicitud.iqFolio || solicitud.iqId, 128) !== claimed.iqFolio || clean(solicitud.ocFiscalMetadataUploadId, 128) !== claimed.ocUploadId) throw new HttpsError("failed-precondition", "IQ, OC o estado cambiaron antes de cerrar la cotización.");
      tx.set(ref, { status: "SUCCEEDED", uploadId: verified.uploadId, finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), lastError: FieldValue.delete(), nextRunAt: null }, { merge: true });
      tx.set(solicitudRef, { cotizacionAutoGenerateStatus: "READY", cotizacionAutoGenerateStage: "COMPLETED", cotizacionAutoGenerateJobId: jobId, cotizacionAutoGenerateUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    await logActivity({ event: "COTIZACION_GENERADA", rootId: claimed.rootId, adminId: claimed.rootId, actorUid: claimed.requestedBy, actorRole: "system", referenceId: claimed.solicitudId, referenceType: "solicitud", entityId: claimed.solicitudId, entityType: "solicitudes", description: "Cotizacion generada por ejecucion automatica.", extra: { quotationJobId: jobId, iqFolio: claimed.iqFolio, uploadId: result.uploadId || null, automaticExecution: true } }).catch(() => undefined);
  } catch (error) {
    const message = clean((error as any)?.message || error, 1500);
    const code = String((error as any)?.code || "").toLowerCase();
    const blocked = code === "permission-denied";
    const uncertain = code === "failed-precondition" || message.startsWith("COTIZACION_") || message.startsWith("OC_");
    let status: "BLOCKED" | "ESCALATED" | "FAILED_RETRYABLE" = blocked ? "BLOCKED" : runFinished || uncertain || claimed.attemptCount >= MAX_ATTEMPTS ? "ESCALATED" : "FAILED_RETRYABLE";
    if (agentRunId && !runFinished) {
      try { await finishRun(agentRunId, status, { reason: message, evidence: [`solicitudes/${claimed.solicitudId}`, `solicitudQuotationJobs/${jobId}`] }); }
      catch (auditError) { status = "ESCALATED"; console.error("AGENT_RUN_AUDIT_FAILED", auditError); }
    }
    await ref.set({ status, lastError: message, nextRunAt: status === "FAILED_RETRYABLE" ? Timestamp.fromMillis(Date.now() + RETRY_DELAY_MS) : null, finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (!agentRunId && status !== "FAILED_RETRYABLE") await db.collection("agentIncidents").doc(`quotation-${jobId}`).set({ rootId: claimed.rootId, reportDay: mexicoDayKey(), runId: null, correlationId: jobId, entityType: "solicitud", entityId: claimed.solicitudId, status: "OPEN", cause: message, evidence: [`solicitudQuotationJobs/${jobId}`, `solicitudes/${claimed.solicitudId}`], createdAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection("solicitudes").doc(claimed.solicitudId).set({ cotizacionAutoGenerateStatus: status, cotizacionAutoGenerateLastError: message, cotizacionAutoGenerateUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await observeSentinelEvent({ rootId: claimed.rootId, systemId: "pay0", eventId: `quotation-${jobId}-${claimed.attemptCount}`, kind: blocked ? "AUTH_DENIED" : uncertain ? "INTEGRITY_MISMATCH" : "REPEATED_FAILURE", actorUid: claimed.requestedBy, entityType: "solicitud", entityId: claimed.solicitudId, evidence: [`solicitudQuotationJobs/${jobId}`, `solicitudes/${claimed.solicitudId}`] }).catch(error => console.error("SENTINEL_OBSERVATION_FAILED", error));
    await logActivity({ event: "COTIZACION_FALLIDA_REINTENTO", rootId: claimed.rootId, adminId: claimed.rootId, actorUid: claimed.requestedBy, actorRole: "system", referenceId: claimed.solicitudId, referenceType: "solicitud", entityId: claimed.solicitudId, entityType: "solicitudes", description: blocked ? "Cotización bloqueada porque la autorización origen ya no es válida." : status === "ESCALATED" ? "Cotización escalada para conciliación humana." : "Cotización fallida; pendiente de un reintento automático.", extra: { quotationJobId: jobId, automaticExecution: true, status, error: message } }).catch((auditError) => console.error("COTIZACION_AUDIT_WRITE_FAILED", auditError));
  }
}

export const processSolicitudQuotationOnDemandTask = onTaskDispatched({ region: "us-central1", timeoutSeconds: 540, memory: "1GiB", maxInstances: 2, concurrency: 1, retryConfig: { maxAttempts: 1, minBackoffSeconds: 60 } }, async (request) => { const jobId = clean((request.data as any)?.jobId, 128); if (jobId) await processJob(jobId); });

export const processSolicitudQuotationQueue = onSchedule({ schedule: "every 5 minutes", timeZone: "America/Mexico_City", timeoutSeconds: 540, memory: "1GiB" }, async () => {
  const now = Timestamp.now();
  // Two single-field reads avoid requiring a production composite index for
  // recovery; Cloud Tasks remains the primary execution path.
  const [queued, retryable, processing] = await Promise.all([
    db.collection("solicitudQuotationJobs").where("status", "==", "QUEUED").limit(50).get(),
    db.collection("solicitudQuotationJobs").where("status", "==", "FAILED_RETRYABLE").limit(50).get(),
    db.collection("solicitudQuotationJobs").where("status", "==", "PROCESSING").limit(50).get(),
  ]);
  const jobs = [...queued.docs, ...retryable.docs];
  for (const snap of jobs) { const row: any = snap.data() || {}; const next = row.nextRunAt?.toMillis?.() || 0; if (!next || next <= now.toMillis()) await processJob(snap.id); }
  for (const snap of processing.docs) {
    const started = snap.get("processingStartedAt")?.toMillis?.() || 0;
    if (!started || started + STALE_PROCESSING_MS > now.toMillis()) continue;
    await escalateStaleQuotationJob(db, snap.id, now.toMillis(), STALE_PROCESSING_MS);
  }
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
