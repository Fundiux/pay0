import { FieldValue } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "../sharedCallables/helpers";
import { logActivityTx } from "../../utils/logActivity";
import { assessLocalIqRecovery } from "./complementRecoveryPlan";
import { claimIqComplementCanaryLookup, inspectIqComplementGate } from "./complementGates";
import { IQ_REP_CANARY_ID } from "./complementCanary";
import { IQ_REP_ATTACHMENT_EXPERIMENT_ID } from "./repAttachmentExperiment";
import { text } from "./complementPolicy";
import * as providers from "./complementProviders";

export const IQ_REP_DEPOSIT_FIELD_PROBE_ID = "iq-rep-deposit-fields-ap1c4u1e6-v1";
const FOLIO = "AP1C4U1E6";
const errorCode = (error: any) => /^[A-Z0-9_]+$/.test(error?.message || "") ? error.message : "IQ_REP_FIELD_PROBE_FAILED";

export async function runIqRepDepositFieldProbe(id: string, adapter = providers) {
  if (id !== IQ_REP_DEPOSIT_FIELD_PROBE_ID) throw Error("IQ_REP_FIELD_PROBE_ID_INVALID");
  const ref = db.doc(`hugoRepDepositFieldProbes/${id}`);
  const input = await db.runTransaction(async tx => {
    const snap = await tx.get(ref), row = snap.data();
    if (!row || row.status !== "QUEUED" || row.capability !== "LOOKUP" || row.applicationFolio !== FOLIO ||
        !row.rootId || !row.applicationId || row.rootId.includes("/")) return null;
    tx.update(ref, { status: "RUNNING", startedAt: FieldValue.serverTimestamp() });
    return row;
  });
  if (!input) return;
  try {
    const [previous, attachment] = await Promise.all([
      db.doc(`hugoComplementCanaries/${IQ_REP_CANARY_ID}`).get(),
      db.doc(`hugoRepAttachmentExperiments/${IQ_REP_ATTACHMENT_EXPERIMENT_ID}`).get(),
    ]);
    if (previous.data()?.rootId !== input.rootId || previous.data()?.applicationId !== input.applicationId ||
        attachment.data()?.rootId !== input.rootId || attachment.data()?.applicationId !== input.applicationId ||
        attachment.data()?.repAttachmentStatus !== "REP_ATTACHMENT_NOT_AVAILABLE") throw Error("IQ_REP_FIELD_PRIOR_EVIDENCE_INVALID");
    const preview = await assessLocalIqRecovery(input.rootId, input.applicationId);
    if (preview.state !== "READY_FOR_IQ_LOOKUP" || preview.planFingerprint !== input.expectedFingerprint)
      throw Error("IQ_REP_FIELD_LOCAL_EVIDENCE_CHANGED");
    const app = (await db.doc(`pagoAplicaciones/${input.applicationId}`).get()).data();
    if (!app || app.rootId !== input.rootId || app.folio !== FOLIO) throw Error("IQ_REP_FIELD_APPLICATION_CHANGED");
    const [plan, attempt, solicitud] = await Promise.all([
      db.doc(`pagoApplicationIqPlans/${app.iqPlanId}`).get(),
      db.doc(`pagoApplicationIqAttempts/${app.iqExecutionAttemptId}`).get(),
      db.doc(`solicitudes/${app.solicitudId}`).get(),
    ]);
    const job = { rootId: input.rootId, provider: "IQ", applicationId: input.applicationId,
      profileId: text(plan.data()?.iqExecutionProfileId), depositId: text(plan.data()?.plan?.pagoIqFolio || plan.data()?.pagoIqFolio),
      actorUid: text(attempt.data()?.createdBy), clientId: text(solicitud.data()?.clienteId) };
    if (!/^\d{3,20}$/.test(job.depositId) || !job.profileId || !job.actorUid || !job.clientId ||
        plan.data()?.rootId !== input.rootId || attempt.data()?.rootId !== input.rootId ||
        attempt.data()?.profileId !== job.profileId || attempt.data()?.planId !== app.iqPlanId)
      throw Error("IQ_REP_FIELD_CONTEXT_INVALID");
    const gate = await inspectIqComplementGate(job, "LOOKUP");
    if (!gate.allowed) throw Error(gate.reason);
    const quota = await claimIqComplementCanaryLookup(job, id);
    if (!quota.allowed) throw Error(quota.reason);
    const beforeLogin = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeLogin.allowed) throw Error(beforeLogin.reason);
    const session = await adapter.iqSession(job, "LOOKUP");
    const beforeGet = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeGet.allowed) throw Error(beforeGet.reason);
    const observed = await adapter.observeIqRepDepositFields(job, session);
    if (observed.depositId !== job.depositId || observed.exactMatchCount !== 1) throw Error("IQ_REP_FIELD_DEPOSIT_MISMATCH");
    await db.runTransaction(async tx => {
      tx.update(ref, { status: "OBSERVED", httpStatus: observed.httpStatus, observation: observed,
        applicationId: input.applicationId, completedAt: FieldValue.serverTimestamp() });
      logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: input.rootId, actorUid: "SYSTEM", actorRole: "system",
        referenceId: id, referenceType: "complementoPago", description: `Canario B: depósito IQ ${job.depositId} observado una vez; can_request_rep? ${observed.canRequestRep.type}=${String(observed.canRequestRep.value)}, rep ${observed.rep.type}=${String(observed.rep.value)}. Sin solicitud C.` });
    });
  } catch (error) {
    await ref.update({ status: "STOPPED", error: errorCode(error), completedAt: FieldValue.serverTimestamp() });
  }
}

export const runHugoIqRepDepositFieldProbe = onDocumentCreated({ document: "hugoRepDepositFieldProbes/{probeId}", region: "us-central1",
  timeoutSeconds: 180, memory: "512MiB", retry: false, secrets: providers.COMPLEMENT_SECRETS }, async event => {
  if (event.params.probeId === IQ_REP_DEPOSIT_FIELD_PROBE_ID) await runIqRepDepositFieldProbe(event.params.probeId);
});
