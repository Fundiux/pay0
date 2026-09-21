import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "../sharedCallables/helpers";
import { logActivityTx } from "../../utils/logActivity";
import { complementRequestId } from "./complementFollowup";
import { assessLocalIqRecovery } from "./complementRecoveryPlan";
import { claimIqComplementGate, inspectIqComplementGate } from "./complementGates";
import { iqRepRequestId, matchingIqRepJobs } from "./complementRequestIdentity";
import { markIqSending, updateJob } from "./complementAutomation";
import { assertSource, text } from "./complementPolicy";
import { IQ_REP_CANARY_ID } from "./complementCanary";
import { IQ_REP_ATTACHMENT_EXPERIMENT_ID } from "./repAttachmentExperiment";
import { IQ_REP_DEPOSIT_FIELD_PROBE_ID } from "./repDepositFieldProbe";
import * as providers from "./complementProviders";

export const IQ_REP_REQUEST_CANARY_ID = "iq-rep-request-ap1c4u1e6-220483-v1";
const FOLIO = "AP1C4U1E6", DEPOSIT_ID = "220483";
const errorCode = (error: any) => /^[A-Z0-9_]+$/.test(error?.message || "") ? error.message : "IQ_REP_REQUEST_CANARY_FAILED";
const nextReview = () => Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);

export async function runIqRepRequestCanary(id: string, adapter = providers) {
  if (id !== IQ_REP_REQUEST_CANARY_ID) throw Error("IQ_REP_REQUEST_CANARY_ID_INVALID");
  const ref = db.doc(`hugoRepRequestCanaries/${id}`);
  const input = await db.runTransaction(async tx => {
    const snap = await tx.get(ref), row = snap.data();
    if (!row || row.status !== "QUEUED" || row.capability !== "REQUEST" || row.applicationFolio !== FOLIO ||
        !row.rootId || !row.applicationId || row.rootId.includes("/")) return null;
    tx.update(ref, { status: "RUNNING", startedAt: FieldValue.serverTimestamp() }); return row;
  });
  if (!input) return;
  let jobId = "", jobReserved = false, sending = false;
  try {
    const [prior, attachment, fieldProbe] = await Promise.all([
      db.doc(`hugoComplementCanaries/${IQ_REP_CANARY_ID}`).get(),
      db.doc(`hugoRepAttachmentExperiments/${IQ_REP_ATTACHMENT_EXPERIMENT_ID}`).get(),
      db.doc(`hugoRepDepositFieldProbes/${IQ_REP_DEPOSIT_FIELD_PROBE_ID}`).get(),
    ]);
    if (prior.data()?.rootId !== input.rootId || prior.data()?.applicationId !== input.applicationId ||
        attachment.data()?.rootId !== input.rootId || attachment.data()?.applicationId !== input.applicationId ||
        attachment.data()?.repAttachmentStatus !== "REP_ATTACHMENT_NOT_AVAILABLE" ||
        fieldProbe.data()?.rootId !== input.rootId || fieldProbe.data()?.applicationId !== input.applicationId ||
        fieldProbe.data()?.status !== "OBSERVED" || fieldProbe.data()?.observation?.depositId !== DEPOSIT_ID ||
        fieldProbe.data()?.observation?.canRequestRep?.value !== true)
      throw Error("IQ_REP_REQUEST_PRIOR_EVIDENCE_INVALID");
    const preview = await assessLocalIqRecovery(input.rootId, input.applicationId);
    if (preview.state !== "READY_FOR_IQ_LOOKUP" || preview.planFingerprint !== input.expectedFingerprint)
      throw Error("IQ_REP_REQUEST_LOCAL_EVIDENCE_CHANGED");
    const app = (await db.doc(`pagoAplicaciones/${input.applicationId}`).get()).data();
    if (!app || app.rootId !== input.rootId || app.folio !== FOLIO || app.iqApplicationStatus !== "IQ_APPLIED" || app.iqActionExecuted !== true)
      throw Error("IQ_REP_REQUEST_APPLICATION_CHANGED");
    const [solicitud, pago, plan, attempt, sourceSnap] = await Promise.all([
      db.doc(`solicitudes/${app.solicitudId}`).get(), db.doc(`pagos/${app.pagoId}`).get(),
      db.doc(`pagoApplicationIqPlans/${app.iqPlanId}`).get(), db.doc(`pagoApplicationIqAttempts/${app.iqExecutionAttemptId}`).get(),
      db.doc(`paymentComplementRequests/${complementRequestId(input.rootId, input.applicationId)}`).get(),
    ]);
    assertSource(input.rootId, app, solicitud.data(), pago.data());
    const source = sourceSnap.data();
    if (!source || source.rootId !== input.rootId || source.applicationId !== input.applicationId || source.provider !== "IQ" ||
        source.externalRequestSent !== false || source.requestedAt || source.automationJobId ||
        !["PENDING", "PENDING_PROVIDER_CONTRACT"].includes(source.status) ||
        plan.data()?.rootId !== input.rootId || plan.data()?.pagoId !== app.pagoId ||
        attempt.data()?.rootId !== input.rootId || attempt.data()?.planId !== app.iqPlanId)
      throw Error("IQ_REP_REQUEST_LOCAL_HISTORY_CHANGED");
    const job = { rootId: input.rootId, provider: "IQ", applicationId: input.applicationId,
      profileId: text(plan.data()?.iqExecutionProfileId), depositId: text(plan.data()?.plan?.pagoIqFolio || plan.data()?.pagoIqFolio),
      actorUid: text(attempt.data()?.createdBy), clientId: text(solicitud.data()?.clienteId) };
    if (job.depositId !== DEPOSIT_ID || !job.profileId || !job.actorUid || !job.clientId || attempt.data()?.profileId !== job.profileId)
      throw Error("IQ_REP_REQUEST_CONTEXT_CHANGED");
    jobId = iqRepRequestId(job.rootId, job.depositId);
    const lookupGate = await inspectIqComplementGate(job, "LOOKUP"), requestGate = await inspectIqComplementGate(job, "REQUEST");
    if (!lookupGate.allowed) throw Error(lookupGate.reason);
    if (!requestGate.allowed) throw Error(requestGate.reason);
    await db.runTransaction(async tx => {
      const jobRef = db.doc(`paymentComplementJobs/${jobId}`), requestRef = sourceSnap.ref;
      const [jobSnap, followupSnap, sameDeposit] = await Promise.all([
        tx.get(jobRef), tx.get(requestRef), tx.get(db.collection("paymentComplementJobs").where("depositId", "==", DEPOSIT_ID)),
      ]);
      if (jobSnap.exists || matchingIqRepJobs(sameDeposit.docs, input.rootId, DEPOSIT_ID).length ||
          followupSnap.data()?.rootId !== input.rootId || followupSnap.data()?.externalRequestSent !== false ||
          followupSnap.data()?.automationJobId || followupSnap.data()?.requestedAt ||
          followupSnap.data()?.fingerprint !== source.fingerprint)
        throw Error("IQ_REP_REQUEST_ALREADY_EXISTS");
      tx.create(jobRef, { ...job, requestIdentity: jobId, status: "PREPARING", canaryId: id,
        startedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.update(requestRef, { automationJobId: jobId, automationStatus: "PREPARING", updatedAt: FieldValue.serverTimestamp() });
      logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: input.rootId, actorUid: "SYSTEM", actorRole: "system",
        referenceId: id, referenceType: "complementoPago", description: "Canario C reservado para una sola solicitud IQ del depósito 220483; pendiente de compuertas y lectura B actual." });
    });
    jobReserved = true;
    await ref.update({ jobId, stage: "JOB_RESERVED", requestIdentity: jobId, updatedAt: FieldValue.serverTimestamp() });
    const lookupClaim = await claimIqComplementGate(jobId, "LOOKUP");
    if (!lookupClaim.allowed) throw Error(lookupClaim.reason);
    const lookupSession = await adapter.iqSession(job, "LOOKUP");
    const deposit = await adapter.observeIqRepDepositFields(job, lookupSession);
    await ref.update({ stage: "DEPOSIT_REVALIDATED", currentDeposit: deposit, updatedAt: FieldValue.serverTimestamp() });
    if (deposit.httpStatus !== 200 || deposit.exactMatchCount !== 1 || deposit.depositId !== DEPOSIT_ID ||
        deposit.operationStatus !== "En Operacion" || deposit.conciliationStatus !== "Conciliado" ||
        deposit.rep.value !== false || deposit.canRequestRep.value !== true)
      throw Error("IQ_REP_REQUEST_CURRENT_ELIGIBILITY_CHANGED");
    const attachmentClaim = await claimIqComplementGate(jobId, "LOOKUP");
    if (!attachmentClaim.allowed) throw Error(attachmentClaim.reason);
    const attachmentNow = await adapter.observeIqRepAttachment(job, lookupSession);
    await ref.update({ stage: "ATTACHMENT_REVALIDATED", currentAttachment: attachmentNow.shape,
      attachmentClassification: attachmentNow.classification, updatedAt: FieldValue.serverTimestamp() });
    if (attachmentNow.classification !== "REP_ATTACHMENT_NOT_AVAILABLE") throw Error("IQ_REP_REQUEST_ATTACHMENT_CHANGED");
    const currentPreview = await assessLocalIqRecovery(input.rootId, input.applicationId);
    if (currentPreview.state !== "READY_FOR_IQ_LOOKUP" || currentPreview.planFingerprint !== input.expectedFingerprint)
      throw Error("IQ_REP_REQUEST_LOCAL_EVIDENCE_CHANGED");
    const currentRequestGate = await inspectIqComplementGate(job, "REQUEST");
    if (!currentRequestGate.allowed) throw Error(currentRequestGate.reason);
    const requestClaim = await claimIqComplementGate(jobId, "REQUEST");
    if (!requestClaim.allowed) throw Error(requestClaim.reason);
    const requestSession = await adapter.iqSession(job, "REQUEST");
    const finalGate = await inspectIqComplementGate(job, "REQUEST");
    if (!finalGate.allowed) throw Error(finalGate.reason);
    await markIqSending(jobId); sending = true;
    await ref.update({ stage: "SENDING", updatedAt: FieldValue.serverTimestamp() });
    const response = await adapter.requestIqComplement(job, requestSession);
    if (response?.httpStatus !== 200 || response?.message !== "success") throw Error("IQ_REP_REQUEST_RESPONSE_AMBIGUOUS");
    const nextCheckAt = nextReview();
    await updateJob(jobId, { status: "REQUESTED", requestedAt: FieldValue.serverTimestamp(), nextCheckAt,
      repAttachmentStatus: "REP_ATTACHMENT_NOT_AVAILABLE", iqRequestResponse: response, error: null, gateReason: null },
      "IQ aceptó una única solicitud de REP. Hugo revisará el adjunto después de nextCheckAt; no repetirá C.");
    await ref.update({ status: "REQUESTED", stage: "REQUESTED", response, nextCheckAt, completedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    const reason = errorCode(error);
    const latestJob = jobReserved ? (await db.doc(`paymentComplementJobs/${jobId}`).get()).data() : null;
    if (latestJob?.status === "REQUESTED" && latestJob.requestedAt) {
      await ref.update({ status: "REQUESTED", stage: "REQUESTED", response: latestJob.iqRequestResponse || null,
        nextCheckAt: latestJob.nextCheckAt || null, completedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (jobReserved) {
      try { await updateJob(jobId, { status: sending ? "UNKNOWN" : "BLOCKED", error: reason,
        ...(sending && (error as any)?.observation ? { iqRequestResponse: (error as any).observation } : {}),
        ...(sending ? { nextCheckAt: nextReview() } : {}) },
        sending ? "Resultado IQ incierto: Hugo no repetirá el POST; solo observará el adjunto mediante B." :
          `Canario C detenido antes del POST: ${reason}.`); } catch { /* A durable SENDING job still blocks a replay. */ }
    }
    await ref.update({ status: sending ? "REQUEST_STATE_UNKNOWN" : "STOPPED", stage: sending ? "REQUEST_STATE_UNKNOWN" : "STOPPED",
      error: reason, ...((error as any)?.observation ? { response: (error as any).observation } : {}),
      completedAt: FieldValue.serverTimestamp() });
  }
}

export const runHugoIqRepRequestCanary = onDocumentCreated({ document: "hugoRepRequestCanaries/{canaryId}", region: "us-central1",
  timeoutSeconds: 540, memory: "512MiB", retry: false, secrets: providers.COMPLEMENT_SECRETS }, async event => {
  if (event.params.canaryId === IQ_REP_REQUEST_CANARY_ID) await runIqRepRequestCanary(event.params.canaryId);
});
