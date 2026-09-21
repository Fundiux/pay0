import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { db } from "../sharedCallables/helpers";
import { logActivityTx } from "../../utils/logActivity";
import { assessLocalIqRecovery } from "./complementRecoveryPlan";
import { complementRequestId } from "./complementFollowup";
import { claimIqComplementCanaryLookup, inspectIqComplementGate } from "./complementGates";
import { assertSource, text } from "./complementPolicy";
import { verifiedDocuments } from "./complementCanary";
import * as providers from "./complementProviders";

export const IQ_REP_READ_COHORT = {
  "iq-rep-read-ap2c4u1e6-v1": "AP2C4U1E6",
  "iq-rep-read-ap3c4u1e6-v1": "AP3C4U1E6",
  "iq-rep-read-ap4c4u1e6-v1": "AP4C4U1E6",
} as const;
const reason = (error: any) => /^[A-Z0-9_]+$/.test(error?.message || "") ? error.message : "IQ_REP_READ_COHORT_FAILED";

export async function runIqRepReadCohort(id: string, adapter = providers) {
  const folio = IQ_REP_READ_COHORT[id as keyof typeof IQ_REP_READ_COHORT];
  if (!folio) throw Error("IQ_REP_READ_COHORT_ID_INVALID");
  const ref = db.doc(`hugoRepReadCohort/${id}`);
  const input = await db.runTransaction(async tx => {
    const snap = await tx.get(ref), row = snap.data();
    if (!row || row.status !== "QUEUED" || row.capability !== "LOOKUP" || row.applicationFolio !== folio ||
        !row.rootId || row.rootId.includes("/") || !row.applicationId || !row.expectedFingerprint) return null;
    tx.update(ref, { status: "RUNNING", stage: "RUNNING", startedAt: FieldValue.serverTimestamp() });
    return row;
  });
  if (!input) return;
  try {
    const preview = await assessLocalIqRecovery(input.rootId, input.applicationId);
    if (preview.state !== "READY_FOR_IQ_LOOKUP" || preview.planFingerprint !== input.expectedFingerprint)
      throw Error("IQ_REP_READ_LOCAL_EVIDENCE_CHANGED");
    const app = (await db.doc(`pagoAplicaciones/${input.applicationId}`).get()).data();
    if (!app || app.rootId !== input.rootId || app.folio !== folio || app.iqApplicationStatus !== "IQ_APPLIED" || app.iqActionExecuted !== true)
      throw Error("IQ_REP_READ_APPLICATION_CHANGED");
    const [solicitudSnap, pagoSnap, requestSnap, planSnap, attemptSnap] = await Promise.all([
      db.doc(`solicitudes/${app.solicitudId}`).get(), db.doc(`pagos/${app.pagoId}`).get(),
      db.doc(`paymentComplementRequests/${complementRequestId(input.rootId, input.applicationId)}`).get(),
      db.doc(`pagoApplicationIqPlans/${app.iqPlanId}`).get(), db.doc(`pagoApplicationIqAttempts/${app.iqExecutionAttemptId}`).get(),
    ]);
    const solicitud = solicitudSnap.data(), pago = pagoSnap.data(), request = requestSnap.data();
    const plan = planSnap.data(), attempt = attemptSnap.data();
    assertSource(input.rootId, app, solicitud, pago);
    if (!request || request.rootId !== input.rootId || request.applicationId !== input.applicationId || request.provider !== "IQ" ||
        !["PENDING", "PENDING_PROVIDER_CONTRACT"].includes(request.status) || request.externalRequestSent !== false ||
        request.requestedAt || request.automationJobId || !pago?.moneda ||
        !plan || plan.rootId !== input.rootId || plan.pagoId !== app.pagoId || !attempt || attempt.rootId !== input.rootId ||
        attempt.planId !== app.iqPlanId) throw Error("IQ_REP_READ_SOURCE_CHANGED");
    const job = { rootId: input.rootId, provider: "IQ", applicationId: input.applicationId,
      profileId: text(plan.iqExecutionProfileId), depositId: text(plan.plan?.pagoIqFolio || plan.pagoIqFolio),
      actorUid: text(attempt.createdBy), clientId: text(solicitud?.clienteId) };
    if (!/^\d{3,20}$/.test(job.depositId) || !job.profileId || !job.actorUid || !job.clientId ||
        attempt.profileId !== job.profileId || job.depositId !== input.expectedDepositId)
      throw Error("IQ_REP_READ_CONTEXT_CHANGED");
    await ref.update({ stage: "LOCAL_EVIDENCE_VERIFIED", depositId: job.depositId, updatedAt: FieldValue.serverTimestamp() });
    const beforeLogin = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeLogin.allowed) throw Error(beforeLogin.reason);
    const depositClaim = await claimIqComplementCanaryLookup(job, `${id}:DEPOSIT`);
    if (!depositClaim.allowed) throw Error(depositClaim.reason);
    const session = await adapter.iqSession(job, "LOOKUP");
    const beforeDeposit = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeDeposit.allowed) throw Error(beforeDeposit.reason);
    const deposit = await adapter.observeIqRepDepositFields(job, session);
    await ref.update({ stage: "DEPOSIT_OBSERVED", deposit, updatedAt: FieldValue.serverTimestamp() });
    if (deposit.httpStatus !== 200 || deposit.exactMatchCount !== 1 || deposit.depositId !== job.depositId)
      throw Error("IQ_REP_READ_DEPOSIT_MISMATCH");
    if (deposit.rep.type !== "boolean" || deposit.canRequestRep.type !== "boolean" ||
        !deposit.operationStatus || !deposit.conciliationStatus) throw Error("IQ_REP_READ_DEPOSIT_STRUCTURE_UNKNOWN");
    const attachmentClaim = await claimIqComplementCanaryLookup(job, `${id}:ATTACHMENT`);
    if (!attachmentClaim.allowed) throw Error(attachmentClaim.reason);
    const beforeAttachment = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeAttachment.allowed) throw Error(beforeAttachment.reason);
    const attachment = await adapter.observeIqRepAttachment(job, session);
    await ref.update({ stage: "ATTACHMENT_OBSERVED", attachmentClassification: attachment.classification,
      attachmentShape: attachment.shape, updatedAt: FieldValue.serverTimestamp() });
    if (attachment.classification === "REP_ATTACHMENT_AMBIGUOUS") throw Error("IQ_REP_READ_ATTACHMENT_AMBIGUOUS");
    if (attachment.classification === "REP_ATTACHMENT_NOT_AVAILABLE") {
      if (deposit.rep.value === true) throw Error("IQ_REP_READ_FIELD_ATTACHMENT_CONFLICT");
      const nextCheckAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
      await db.runTransaction(async tx => {
        const latest = (await tx.get(requestSnap.ref)).data();
        if (!latest || latest.rootId !== input.rootId || latest.applicationId !== input.applicationId ||
            latest.fingerprint !== request.fingerprint || latest.externalRequestSent !== false || latest.requestedAt ||
            !["PENDING", "PENDING_PROVIDER_CONTRACT"].includes(latest.status)) throw Error("IQ_REP_READ_FOLLOWUP_CHANGED");
        tx.update(requestSnap.ref, { status: "PENDING", automationStatus: "PENDING", repGenerationStatus: "REP_GENERATION_UNKNOWN",
          repAttachmentStatus: "REP_ATTACHMENT_NOT_AVAILABLE", nextCheckAt, lastIqReadAt: FieldValue.serverTimestamp(),
          lastIqReadResult: "NO_REP_ATTACHED_TO_RESOURCE", updatedAt: FieldValue.serverTimestamp() });
        logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: input.rootId, actorUid: "SYSTEM", actorRole: "system",
          referenceId: id, referenceType: "complementoPago", description: `Hugo B: depósito IQ ${job.depositId} comprobado; no hay REP adjunto. No se ejecutó C.` });
      });
      await ref.update({ status: "PENDING_B", stage: "PENDING_B", nextCheckAt, completedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (attachment.classification !== "REP_ATTACHMENT_AVAILABLE" || !attachment.url) throw Error("IQ_REP_READ_ATTACHMENT_AMBIGUOUS");
    const downloadClaim = await claimIqComplementCanaryLookup(job, `${id}:DOWNLOAD`);
    if (!downloadClaim.allowed) throw Error(downloadClaim.reason);
    const beforeDownload = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeDownload.allowed) throw Error(beforeDownload.reason);
    const source: Record<string, any> = { ...request, currency: text(pago.moneda).toUpperCase() };
    const imported = await adapter.importIqComplement(attachment.url, [source], job);
    if (imported.length !== 1 || imported[0].source.applicationId !== input.applicationId) throw Error("IQ_REP_READ_DOCUMENT_AMBIGUOUS");
    const documents = imported[0].documents;
    const verification = await verifiedDocuments(input.rootId, source, documents);
    await ref.update({ stage: "DOCUMENTS_VERIFIED", validation: { repUuid: documents.uuid, ...verification }, updatedAt: FieldValue.serverTimestamp() });
    await db.runTransaction(async tx => {
      const latest = (await tx.get(requestSnap.ref)).data();
      if (!latest || latest.rootId !== input.rootId || latest.applicationId !== input.applicationId ||
          latest.fingerprint !== request.fingerprint || latest.externalRequestSent !== false || latest.requestedAt ||
          !["PENDING", "PENDING_PROVIDER_CONTRACT"].includes(latest.status) ||
          latest.invoiceUuid !== source.invoiceUuid || latest.installment !== source.installment ||
          latest.amountMinor !== source.amountMinor || latest.balanceBefore !== source.balanceBefore || latest.balanceAfter !== source.balanceAfter)
        throw Error("IQ_REP_READ_FOLLOWUP_CHANGED");
      tx.update(requestSnap.ref, { ...documents, status: "RECEIVED", automationStatus: "RECEIVED", automationError: null,
        repGenerationStatus: "REP_GENERATION_UNKNOWN", repAttachmentStatus: "REP_VALIDATED", nextCheckAt: null,
        receivedAt: FieldValue.serverTimestamp(), lastIqReadAt: FieldValue.serverTimestamp(), lastIqReadResult: "REP_VERIFIED",
        updatedAt: FieldValue.serverTimestamp() });
      logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: input.rootId, actorUid: "SYSTEM", actorRole: "system",
        referenceId: id, referenceType: "complementoPago", description: `Hugo B: REP IQ ${documents.uuid} descargado, validado, vinculado y verificado. Sin solicitud C.` });
    });
    await ref.update({ status: "RECEIVED", stage: "RECEIVED", completedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    await ref.update({ status: "STOPPED", stage: "STOPPED", error: reason(error), completedAt: FieldValue.serverTimestamp() });
  }
}

export const runHugoIqRepReadCohort = onDocumentWritten({ document: "hugoRepReadCohort/{readId}", region: "us-central1",
  timeoutSeconds: 540, memory: "512MiB", retry: false, secrets: providers.COMPLEMENT_SECRETS }, async event => {
  if (Object.prototype.hasOwnProperty.call(IQ_REP_READ_COHORT, event.params.readId)) await runIqRepReadCohort(event.params.readId);
});
