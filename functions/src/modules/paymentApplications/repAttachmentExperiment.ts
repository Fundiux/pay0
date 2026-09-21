import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "../sharedCallables/helpers";
import { logActivityTx } from "../../utils/logActivity";
import { complementRequestId } from "./complementFollowup";
import { IQ_REP_CANARY_ID } from "./complementCanary";
import { assessLocalIqRecovery } from "./complementRecoveryPlan";
import { claimIqComplementCanaryLookup, inspectIqComplementGate } from "./complementGates";
import { assertSource, text } from "./complementPolicy";
import * as providers from "./complementProviders";

export const IQ_REP_ATTACHMENT_EXPERIMENT_ID = "iq-rep-attachment-ap1c4u1e6-v1";
const FOLIO = "AP1C4U1E6";
const code = (error: any) => /^[A-Z0-9_]+$/.test(error?.message || "") ? error.message : "REP_ATTACHMENT_EXPERIMENT_FAILED";

async function record(id: string, stage: string, detail: Record<string, unknown> = {}) {
  await db.doc(`hugoRepAttachmentExperiments/${id}`).update({ stage, updatedAt: FieldValue.serverTimestamp(),
    steps: FieldValue.arrayUnion({ stage, at: Timestamp.now(), ...detail }) });
}

export async function runRepAttachmentExperiment(id: string, adapter = providers) {
  if (id !== IQ_REP_ATTACHMENT_EXPERIMENT_ID) throw Error("REP_ATTACHMENT_EXPERIMENT_ID_INVALID");
  const ref = db.doc(`hugoRepAttachmentExperiments/${id}`);
  const input = await db.runTransaction(async tx => {
    const snap = await tx.get(ref), row = snap.data();
    if (!row || row.status !== "QUEUED" || row.capability !== "LOOKUP" || row.applicationFolio !== FOLIO || !row.rootId || row.rootId.includes("/")) return null;
    tx.update(ref, { status: "RUNNING", startedAt: FieldValue.serverTimestamp() }); return row;
  });
  if (!input) return;
  let applicationId = "";
  try {
    const rootId = input.rootId;
    const previous = (await db.doc(`hugoComplementCanaries/${IQ_REP_CANARY_ID}`).get()).data();
    if (!previous || previous.status !== "STOPPED" || previous.error !== "IQ_REP_REQUEST_STATE_REQUIRES_REVIEW" ||
        previous.rootId !== rootId || previous.applicationFolio !== FOLIO || !previous.applicationId)
      throw Error("REP_ATTACHMENT_PREVIOUS_CANARY_INVALID");
    applicationId = previous.applicationId;
    const preview = await assessLocalIqRecovery(rootId, applicationId);
    if (preview.state !== "READY_FOR_IQ_LOOKUP" || preview.planFingerprint !== previous.steps?.find((step: any) => step.stage === "LOCAL_EVIDENCE_VERIFIED")?.fingerprint)
      throw Error("REP_ATTACHMENT_LOCAL_EVIDENCE_CHANGED");
    const app = (await db.doc(`pagoAplicaciones/${applicationId}`).get()).data();
    if (!app || app.rootId !== rootId || app.folio !== FOLIO) throw Error("REP_ATTACHMENT_APPLICATION_CHANGED");
    const [solicitudSnap, pagoSnap, requestSnap, planSnap, attemptSnap] = await Promise.all([
      db.doc(`solicitudes/${app.solicitudId}`).get(), db.doc(`pagos/${app.pagoId}`).get(),
      db.doc(`paymentComplementRequests/${complementRequestId(rootId, applicationId)}`).get(),
      db.doc(`pagoApplicationIqPlans/${app.iqPlanId}`).get(), db.doc(`pagoApplicationIqAttempts/${app.iqExecutionAttemptId}`).get(),
    ]);
    const solicitud = solicitudSnap.data(), pago = pagoSnap.data(), request = requestSnap.data(), plan = planSnap.data(), attempt = attemptSnap.data();
    assertSource(rootId, app, solicitud, pago);
    if (!request || request.rootId !== rootId || request.applicationId !== applicationId || request.provider !== "IQ" || request.status === "RECEIVED" ||
        !solicitud?.clienteId || !pago?.moneda || plan?.rootId !== rootId || attempt?.rootId !== rootId)
      throw Error("REP_ATTACHMENT_SOURCE_CHANGED");
    if (!plan || !attempt) throw Error("REP_ATTACHMENT_SOURCE_CHANGED");
    const job = { rootId, provider: "IQ", applicationId, profileId: text(plan.iqExecutionProfileId),
      depositId: text(plan.plan?.pagoIqFolio || plan.pagoIqFolio), actorUid: text(attempt.createdBy), clientId: solicitud.clienteId };
    if (!/^\d{3,20}$/.test(job.depositId) || !job.profileId || !job.actorUid) throw Error("REP_ATTACHMENT_DEPOSIT_ID_INVALID");
    const gate = await inspectIqComplementGate(job, "LOOKUP");
    if (!gate.allowed) throw Error(gate.reason);
    await record(id, "LOCAL_EVIDENCE_VERIFIED", { applicationId, fingerprint: preview.planFingerprint, priorCanary: IQ_REP_CANARY_ID });
    const claim = await claimIqComplementCanaryLookup(job, id);
    if (!claim.allowed) throw Error(claim.reason);
    const beforeLogin = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeLogin.allowed) throw Error(beforeLogin.reason);
    await record(id, "LOOKUP_QUOTA_RESERVED", { limit: claim.limit });
    const session = await adapter.iqSession(job, "LOOKUP");
    await record(id, "IQ_SESSION_OPENED", { purpose: "LOOKUP" });
    const beforeGet = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeGet.allowed) throw Error(beforeGet.reason);
    const observation = await adapter.observeIqRepAttachment(job, session);
    await record(id, "IQ_REP_RESOURCE_OBSERVED", { classification: observation.classification, response: observation.shape });
    await ref.update({ httpStatus: observation.shape.httpStatus, responseShape: observation.shape,
      repGenerationStatus: "REP_GENERATION_UNKNOWN", repAttachmentStatus: observation.classification,
      applicationId });
    if (observation.classification === "REP_ATTACHMENT_NOT_AVAILABLE") {
      const nextCheckAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
      await db.runTransaction(async tx => {
        const requestRef = db.doc(`paymentComplementRequests/${complementRequestId(rootId, applicationId)}`);
        const latest = (await tx.get(requestRef)).data();
        if (!latest || latest.rootId !== rootId || latest.applicationId !== applicationId || latest.status === "RECEIVED") throw Error("REP_ATTACHMENT_FOLLOWUP_CHANGED");
        tx.update(requestRef, { status: "PENDING", automationStatus: "PENDING", repGenerationStatus: "REP_GENERATION_UNKNOWN",
          repAttachmentStatus: "REP_ATTACHMENT_NOT_AVAILABLE", nextCheckAt, lastIqReadAt: FieldValue.serverTimestamp(),
          lastIqReadResult: "NO_REP_ATTACHED_TO_RESOURCE", updatedAt: FieldValue.serverTimestamp() });
        logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId, actorUid: "SYSTEM", actorRole: "system", referenceId: id,
          referenceType: "complementoPago", description: "Hugo consultó el recurso REP: no hay adjunto disponible ahora. Generación desconocida; sin solicitud C." });
      });
      await record(id, "PENDING_B", { nextCheckAt });
      await ref.update({ status: "PENDING_B", nextCheckAt, completedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (observation.classification !== "REP_ATTACHMENT_AVAILABLE" || !observation.url) {
      await ref.update({ status: "STOPPED", error: "REP_ATTACHMENT_AMBIGUOUS", completedAt: FieldValue.serverTimestamp() });
      return;
    }
    const beforeDownload = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeDownload.allowed) throw Error(beforeDownload.reason);
    const source = { ...request, currency: text(pago.moneda).toUpperCase() };
    const validation = await adapter.validateIqRepAttachmentDownload(observation.url, source, job);
    await record(id, "REP_VALIDATED", { ...validation });
    await ref.update({ status: "VALIDATED_NOT_RECEIVED", repAttachmentStatus: "REP_VALIDATED", validation,
      completedAt: FieldValue.serverTimestamp() });
    await requestSnap.ref.update({ repGenerationStatus: "REP_GENERATION_UNKNOWN", repAttachmentStatus: "REP_VALIDATED",
      lastIqReadAt: FieldValue.serverTimestamp(), lastIqReadResult: "REP_VALIDATED_IN_MEMORY", updatedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    const reason = code(error);
    await record(id, "STOPPED", { reason });
    await ref.update({ status: "STOPPED", error: reason, repAttachmentStatus: "REP_ATTACHMENT_AMBIGUOUS", applicationId: applicationId || null,
      completedAt: FieldValue.serverTimestamp() });
  }
}

export const runHugoIqRepAttachmentExperiment = onDocumentCreated({ document: "hugoRepAttachmentExperiments/{experimentId}", region: "us-central1",
  timeoutSeconds: 540, memory: "512MiB", retry: false, secrets: providers.COMPLEMENT_SECRETS }, async event => {
  if (event.params.experimentId === IQ_REP_ATTACHMENT_EXPERIMENT_ID) await runRepAttachmentExperiment(event.params.experimentId);
});
