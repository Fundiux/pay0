import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "../sharedCallables/helpers";
import { logActivityTx } from "../../utils/logActivity";
import { complementRequestId } from "./complementFollowup";
import { assessLocalIqRecovery } from "./complementRecoveryPlan";
import { claimIqComplementCanaryLookup, inspectIqComplementGate } from "./complementGates";
import { validateRep } from "./complementDocuments";
import { assertSource, text } from "./complementPolicy";
import * as providers from "./complementProviders";

export const IQ_REP_CANARY_ID = "iq-rep-read-ap1c4u1e6-v1";
const FOLIO = "AP1C4U1E6";
const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const code = (error: any) => /^[A-Z0-9_]+$/.test(error?.message || "") ? error.message : "REP_CANARY_UNEXPECTED";

async function step(id: string, stage: string, detail: Record<string, unknown> = {}) {
  await db.doc(`hugoComplementCanaries/${id}`).update({ stage, updatedAt: FieldValue.serverTimestamp(),
    steps: FieldValue.arrayUnion({ stage, at: Timestamp.now(), ...detail }) });
}

async function sourceFor(rootId: string, applicationId: string) {
  const app = (await db.doc(`pagoAplicaciones/${applicationId}`).get()).data();
  if (!app || app.rootId !== rootId || app.folio !== FOLIO) throw Error("REP_CANARY_COHORT_CHANGED");
  const [requestSnap, pagoSnap, solicitudSnap] = await Promise.all([
    db.doc(`paymentComplementRequests/${complementRequestId(rootId, applicationId)}`).get(),
    db.doc(`pagos/${app.pagoId}`).get(),
    db.doc(`solicitudes/${app.solicitudId}`).get(),
  ]);
  const request = requestSnap.data(), pago = pagoSnap.data(), solicitud = solicitudSnap.data();
  if (!request || request.rootId !== rootId || request.applicationId !== applicationId || request.provider !== "IQ" ||
      !pago || pago.rootId !== rootId || !text(pago.moneda) || !solicitud || solicitud.rootId !== rootId || !solicitud.clienteId)
    throw Error("REP_CANARY_SOURCE_CHANGED");
  assertSource(rootId, app, solicitud, pago);
  return { app, request, source: { ...(request as any), currency: text(pago.moneda).toUpperCase(), clientId: solicitud.clienteId } as any, requestRef: requestSnap.ref };
}

async function verifiedDocuments(rootId: string, source: any, documents: any) {
  const files = await Promise.all([documents.xmlUploadId, documents.pdfUploadId].map((id: string) => db.doc(`uploads/${id}`).get()));
  const [xmlMeta, pdfMeta] = files.map(row => row.data());
  for (const [index, meta] of [xmlMeta, pdfMeta].entries()) {
    if (!meta || meta.rootId !== rootId || meta.applicationId !== source.applicationId || meta.pagoId !== source.pagoId ||
        meta.solicitudId !== source.solicitudId || meta.complementKey !== documents.uuid || meta.status !== "READY" ||
        meta.active !== true || meta.integritySealStatus !== "SEALED" ||
        meta.documentType !== (index === 0 ? "COMPLEMENTO_PAGO_XML" : "COMPLEMENTO_PAGO_PDF") ||
        !/^[a-f0-9]{64}$/i.test(meta.sha256 || "")) throw Error("REP_CANARY_DOCUMENT_METADATA_MISMATCH");
  }
  if (!xmlMeta || !pdfMeta) throw Error("REP_CANARY_DOCUMENT_METADATA_MISMATCH");
  const [xml, pdf] = await Promise.all([xmlMeta, pdfMeta].map(meta => admin.storage().bucket().file(meta.storagePath).download().then(parts => parts[0])));
  if (sha256(xml) !== xmlMeta.sha256 || sha256(pdf) !== pdfMeta.sha256 ||
      validateRep(xml, source) !== documents.uuid || pdf.subarray(0, 5).toString() !== "%PDF-")
    throw Error("REP_CANARY_DOCUMENT_INTEGRITY_MISMATCH");
  return { xmlSha256: xmlMeta.sha256, pdfSha256: pdfMeta.sha256, xmlBytes: xml.length, pdfBytes: pdf.length };
}

export async function runIqRepReadCanary(id: string, adapter = providers) {
  if (id !== IQ_REP_CANARY_ID) throw Error("REP_CANARY_ID_INVALID");
  const ref = db.doc(`hugoComplementCanaries/${id}`);
  const input = await db.runTransaction(async tx => {
    const snap = await tx.get(ref), row = snap.data();
    if (!row || row.status !== "QUEUED" || row.capability !== "LOOKUP" || row.applicationFolio !== FOLIO ||
        !row.rootId || row.rootId.includes("/")) return null;
    tx.update(ref, { status: "RUNNING", startedAt: FieldValue.serverTimestamp() });
    return row;
  });
  if (!input) return;
  try {
    const rootId = input.rootId;
    const applications = await db.collection("pagoAplicaciones").where("rootId", "==", rootId).where("folio", "==", FOLIO).limit(2).get();
    if (applications.size !== 1) throw Error("REP_CANARY_COHORT_AMBIGUOUS");
    const applicationId = applications.docs[0].id;
    const preview = await assessLocalIqRecovery(rootId, applicationId);
    if (preview.state !== "READY_FOR_IQ_LOOKUP") throw Error(`REP_CANARY_${preview.state}`);
    const { app, source } = await sourceFor(rootId, applicationId);
    const plan = (await db.doc(`pagoApplicationIqPlans/${app.iqPlanId}`).get()).data();
    const attempt = (await db.doc(`pagoApplicationIqAttempts/${app.iqExecutionAttemptId}`).get()).data();
    const job = { rootId, provider: "IQ", profileId: text(plan?.iqExecutionProfileId), depositId: text(plan?.plan?.pagoIqFolio || plan?.pagoIqFolio),
      actorUid: text(attempt?.createdBy), clientId: source.clientId, applicationId };
    if (!job.depositId || !job.profileId || !job.actorUid) throw Error("REP_CANARY_IQ_CONTEXT_MISSING");
    const gate = await inspectIqComplementGate(job, "LOOKUP");
    if (!gate.allowed) throw Error(gate.reason);
    await step(id, "LOCAL_EVIDENCE_VERIFIED", { applicationId, fingerprint: preview.planFingerprint, gate: gate.reason });
    const claim = await claimIqComplementCanaryLookup(job, id);
    if (!claim.allowed) throw Error(claim.reason);
    const beforeLogin = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeLogin.allowed) throw Error(beforeLogin.reason);
    await step(id, "LOOKUP_QUOTA_RESERVED", { limit: claim.limit });
    const session = await adapter.iqSession(job, "LOOKUP");
    await step(id, "IQ_SESSION_OPENED", { purpose: "LOOKUP" });
    const afterLogin = await inspectIqComplementGate(job, "LOOKUP");
    if (!afterLogin.allowed) throw Error(afterLogin.reason);
    const deposit = await adapter.preflightIqComplement(job, session);
    await step(id, "IQ_DEPOSIT_CHECKED", { result: deposit });
    let url: string | null = null;
    if (deposit === "AVAILABLE") {
      const beforeLookup = await inspectIqComplementGate(job, "LOOKUP");
      if (!beforeLookup.allowed) throw Error(beforeLookup.reason);
      url = await adapter.availableIqComplement(job, session);
      await step(id, "IQ_REP_CHECKED", { result: url ? "AVAILABLE" : "PENDING" });
    }
    if (!url) {
      const nextCheckAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
      await db.runTransaction(async tx => {
        const requestRef = db.doc(`paymentComplementRequests/${complementRequestId(rootId, applicationId)}`);
        const latest = (await tx.get(requestRef)).data();
        if (!latest || latest.rootId !== rootId || latest.status === "RECEIVED" || latest.applicationId !== applicationId)
          throw Error("REP_CANARY_FOLLOWUP_CHANGED");
        tx.update(requestRef, { status: "PENDING", automationStatus: "PENDING", nextCheckAt,
          lastIqReadAt: FieldValue.serverTimestamp(), lastIqReadResult: "NO_REP_AVAILABLE", updatedAt: FieldValue.serverTimestamp() });
        logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId, actorUid: "SYSTEM", actorRole: "system",
          referenceId: id, referenceType: "complementoPago", description: "Canario B: depósito IQ consultado; REP no disponible. Sin solicitud de generación; siguiente revisión registrada." });
      });
      await step(id, "PENDING", { iqResult: "NO_REP_AVAILABLE", nextCheckAt });
      await ref.update({ status: "PENDING", applicationId, completedAt: FieldValue.serverTimestamp() });
      return;
    }
    const beforeDownload = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeDownload.allowed) throw Error(beforeDownload.reason);
    const imported = await adapter.importIqComplement(url, [source], job);
    if (imported.length !== 1 || imported[0].source.applicationId !== applicationId) throw Error("REP_CANARY_DOCUMENT_AMBIGUOUS");
    const documents = imported[0].documents;
    await step(id, "IQ_DOCUMENTS_IMPORTED", { repUuid: documents.uuid });
    const verification = await verifiedDocuments(rootId, source, documents);
    await step(id, "DOCUMENTS_RELOADED_AND_VERIFIED", { repUuid: documents.uuid, ...verification });
    await db.runTransaction(async tx => {
      const requestRef = db.doc(`paymentComplementRequests/${complementRequestId(rootId, applicationId)}`);
      const latest = (await tx.get(requestRef)).data();
      if (!latest || latest.rootId !== rootId || latest.applicationId !== applicationId || latest.status === "RECEIVED" ||
          latest.invoiceUuid !== source.invoiceUuid || latest.installment !== source.installment || latest.amountMinor !== source.amountMinor ||
          latest.balanceBefore !== source.balanceBefore || latest.balanceAfter !== source.balanceAfter)
        throw Error("REP_CANARY_FOLLOWUP_CHANGED");
      tx.update(requestRef, { ...documents, status: "RECEIVED", automationStatus: "RECEIVED", automationError: null,
        receivedAt: FieldValue.serverTimestamp(), lastIqReadAt: FieldValue.serverTimestamp(), lastIqReadResult: "REP_VERIFIED",
        updatedAt: FieldValue.serverTimestamp() });
      logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId, actorUid: "SYSTEM", actorRole: "system",
        referenceId: id, referenceType: "complementoPago", description: "Canario B: REP IQ descargado, XML/PDF íntegros y vinculados; seguimiento marcado RECEIVED." });
    });
    await step(id, "RECEIVED", { repUuid: documents.uuid, ...verification });
    await ref.update({ status: "RECEIVED", applicationId, completedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    const reason = code(error);
    await step(id, "STOPPED", { reason });
    await ref.update({ status: "STOPPED", error: reason, completedAt: FieldValue.serverTimestamp() });
  }
}

export const runHugoIqRepReadCanary = onDocumentCreated({ document: "hugoComplementCanaries/{canaryId}", region: "us-central1",
  timeoutSeconds: 540, memory: "512MiB", retry: false, secrets: providers.COMPLEMENT_SECRETS }, async event => {
  if (event.params.canaryId === IQ_REP_CANARY_ID) await runIqRepReadCanary(event.params.canaryId);
});
