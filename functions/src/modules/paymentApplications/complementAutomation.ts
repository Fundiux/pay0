import * as admin from "firebase-admin";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../sharedCallables/helpers";
import { context } from "../controlCenter/callables";
import { logActivityTx } from "../../utils/logActivity";
import { complementRequestId, reconcilePaymentComplement } from "./complementFollowup";
import { assertSource, dayMexico, hash, millis, overdue, text } from "./complementPolicy";
import * as providers from "./complementProviders";
import { claimIqComplementGate, inspectIqComplementGate, recordBlockedIqGate } from "./complementGates";
import { iqRepRequestId, matchingIqRepJobs } from "./complementRequestIdentity";
import { verifiedDocuments } from "./complementCanary";
import { scanDueIqFollowups } from "./complementDailyLookup";
import { assertPay0Issuer, belongsToPay0Dispatch, PAY0_DISPATCH_ID } from "../facturama/issuerGuard";
import { shouldSuppressIqHistoricalImport } from "../iq/historicalImportGuard";
import { saveComplementDocuments } from "./complementDocuments";
import { SafetyRuntime, CONSERVATIVE_POLICY, markProtectedEffectIntent, confirmProtectedEffect,
  reportProtectedFailure, classifyFailure, type TechnicalOrigin, type Result } from "../automationSafety/runtime";

const jobs = () => db.collection("paymentComplementJobs");
const errorCode = (e: any) => /^[A-Z0-9_]+$/.test(e?.message || "") ? e.message : "REP_OPERATION_FAILED";
async function sourceFor(applicationId: string) {
  const app = (await db.doc(`pagoAplicaciones/${applicationId}`).get()).data();
  if (!app) throw Error("REP_APPLICATION_MISSING");
  const [ss, pp] = await Promise.all([db.doc(`solicitudes/${app.solicitudId}`).get(), db.doc(`pagos/${app.pagoId}`).get()]);
  const solicitud = ss.data(), pago = pp.data(); assertSource(app.rootId, app, solicitud, pago);
  const ref = db.doc(`paymentComplementRequests/${complementRequestId(app.rootId, applicationId)}`), source = (await ref.get()).data();
  if (!source || source.rootId !== app.rootId || !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(source.invoiceUuid || "")) throw Error("REP_FOLLOWUP_REQUIRED");
  if (source.amountMinor !== Math.round(app.montoAplicado * 100) || source.installment !== app.numeroParcialidad || source.balanceBefore !== app.saldoAnterior || source.balanceAfter !== app.saldoInsoluto || source.invoiceUuid !== text(solicitud!.facturaUuid || solicitud!.uuidCfdi || solicitud!.iqInvoiceUuid).toUpperCase()) throw Error("REP_SOURCE_CHANGED");
  const enrichedSource: Record<string, any> = { ...source, currency: text(pago!.moneda).toUpperCase() };
  return { app, solicitud: solicitud!, pago: pago!, source: enrichedSource, ref };
}

// Maintenance entrypoint: the same validated adoption, with no provider lookup,
// request, issuance or automation dispatch. It never resumes delivery.
export async function adoptImportedIqComplementById(applicationId: string) {
  const loaded = await sourceFor(applicationId);
  if (text(loaded.app.iqComplementStatus).toUpperCase() !== "IMPORTED") throw Error("REP_IMPORTED_REQUIRED");
  return adoptImportedIqComplement(applicationId, loaded);
}

export async function adoptImportedIqComplement(applicationId: string, loaded: Awaited<ReturnType<typeof sourceFor>>) {
  const { app, source, ref } = loaded;
  if (text(app.iqComplementStatus).toUpperCase() !== "IMPORTED") return false;
  const appRef = db.doc(`pagoAplicaciones/${applicationId}`);
  const isCanonicalDocument = (document: FirebaseFirestore.DocumentSnapshot, type: string, uuid: string) => {
    const row = document.data();
    return !!row && document.id === hash(`${source.rootId}:${source.pagoId}:${applicationId}:${uuid}:${type}:PAGO_V2`) &&
      row.rootId === source.rootId && row.pagoId === source.pagoId && row.documentType === type &&
      row.applicationId === applicationId && row.entityType === "pagos" && row.entityId === source.pagoId &&
      row.complementKey === uuid && row.status === "READY" && row.active === true && !!text(row.storagePath) &&
      row.integritySealStatus === "SEALED" && /^[a-f0-9]{64}$/i.test(row.sha256 || "");
  };
  const readState = async (tx: FirebaseFirestore.Transaction) => {
    const [currentSnap, latest] = await Promise.all([tx.get(appRef), tx.get(ref)]);
    const current = currentSnap.data(), request = latest.data();
    if (!current || current.rootId !== source.rootId || current.solicitudId !== source.solicitudId || current.pagoId !== source.pagoId ||
        text(current.iqComplementStatus).toUpperCase() !== "IMPORTED") throw Error("REP_IMPORTED_SOURCE_CHANGED");
    if (!request || request.rootId !== source.rootId || request.applicationId !== applicationId ||
        ["solicitudId", "pagoId", "invoiceUuid", "amountMinor", "installment", "balanceBefore", "balanceAfter"].some(key => request[key] !== source[key]) ||
        request.status === "VOIDED") throw Error("REP_IMPORTED_FOLLOWUP_CHANGED");
    const jobId = text(request.automationJobId);
    const xmlId = text(current.iqComplementXmlUploadId), pdfId = text(current.iqComplementPdfUploadId);
    if (!xmlId || !pdfId) throw Error("REP_IMPORTED_DOCUMENT_IDS_MISSING");
    const [solicitud, pago, xmlSnap, pdfSnap, jobSnap] = await Promise.all([
      tx.get(db.doc(`solicitudes/${current.solicitudId}`)), tx.get(db.doc(`pagos/${current.pagoId}`)),
      tx.get(db.doc(`uploads/${xmlId}`)), tx.get(db.doc(`uploads/${pdfId}`)),
      jobId ? tx.get(jobs().doc(jobId)) : Promise.resolve(null),
    ]);
    assertSource(source.rootId, current, solicitud.data(), pago.data());
    if (source.amountMinor !== Math.round(current.montoAplicado * 100) || source.installment !== current.numeroParcialidad ||
        source.balanceBefore !== current.saldoAnterior || source.balanceAfter !== current.saldoInsoluto ||
        source.invoiceUuid !== text(solicitud.data()?.facturaUuid || solicitud.data()?.uuidCfdi || solicitud.data()?.iqInvoiceUuid).toUpperCase() ||
        source.currency !== text(pago.data()?.moneda).toUpperCase()) throw Error("REP_SOURCE_CHANGED");
    const job = jobSnap?.data();
    if (jobId && (!job || job.rootId !== source.rootId)) throw Error("REP_IMPORTED_JOB_SCOPE_MISMATCH");
    // A sibling application can put a shared IQ job into review after a
    // reversal. Keep that visible stop intact; valid evidence for this one
    // application cannot resolve the financial review of the shared job.
    const stopped = job?.status === "REVIEW_REQUIRED" || job?.error === "REP_SOURCE_REVERSED" ||
      request.automationStatus === "REVIEW_REQUIRED" || request.automationError === "REP_SOURCE_REVERSED";
    if (stopped) return { stopped: true, complete: false, xmlSnap, pdfSnap, jobId };
    for (const [snap, type] of [[xmlSnap, "COMPLEMENTO_PAGO_XML"], [pdfSnap, "COMPLEMENTO_PAGO_PDF"]] as const) {
      const row = snap.data();
      if (!row || row.rootId !== source.rootId || text(row.pagoId) !== text(source.pagoId) ||
          text(row.pagoAplicacionId || row.applicationId) !== applicationId || text(row.documentType).toUpperCase() !== type ||
          !text(row.storagePath)) throw Error("REP_IMPORTED_DOCUMENT_SCOPE_MISMATCH");
    }
    const uuid = text(current.iqComplementUuid);
    const canonicalDocuments = isCanonicalDocument(xmlSnap, "COMPLEMENTO_PAGO_XML", uuid) &&
      isCanonicalDocument(pdfSnap, "COMPLEMENTO_PAGO_PDF", uuid);
    // RECEIVED alone can still reference legacy/partial evidence. A shared IQ
    // job may serve several applications, so its upload IDs are not an owner key.
    const complete = current.iqComplementDocumentOwner === "PAGO_APPLICATION" &&
      /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(uuid) && canonicalDocuments &&
      request.status === "RECEIVED" && request.automationStatus === "RECEIVED" && !request.automationError &&
      request.repAttachmentStatus === "REP_VALIDATED" && request.uuid === uuid &&
      request.xmlUploadId === xmlId && request.pdfUploadId === pdfId && (!jobId || (job?.status === "RECEIVED" && !job.error));
    return { stopped: false, complete, xmlSnap, pdfSnap, jobId };
  };
  // A completed adoption must not download, write timestamps or emit another
  // activity event: its application write invokes this same function again.
  const initial = await db.runTransaction(readState);
  if (initial.complete || initial.stopped) return true;
  const { xmlSnap, pdfSnap } = initial;
  const bucket = admin.storage().bucket();
  const [xmlBytes, pdfBytes] = await Promise.all([
    bucket.file(text(xmlSnap.data()!.storagePath)).download().then(([bytes]) => bytes),
    bucket.file(text(pdfSnap.data()!.storagePath)).download().then(([bytes]) => bytes),
  ]);
  // The retired importer accepted SAT-stamped REPs whose monetary fields differ
  // by one cent because of decimal rounding. Keep that exception confined to
  // adoption of already-issued evidence; new provider responses remain exact.
  const documents = await saveComplementDocuments({ ...source, legacyRoundingToleranceMinor: 1 }, xmlBytes, pdfBytes);
  await db.runTransaction(async tx => {
    // Recheck inside the writing transaction. Concurrent deliveries may both
    // reach the downloads, but only one may publish the completed transition.
    const latest = await readState(tx);
    if (latest.complete || latest.stopped) return;
    if (latest.xmlSnap.id !== xmlSnap.id || latest.pdfSnap.id !== pdfSnap.id) throw Error("REP_IMPORTED_SOURCE_CHANGED");
    const [canonicalXml, canonicalPdf] = await Promise.all([
      tx.get(db.doc(`uploads/${documents.xmlUploadId}`)), tx.get(db.doc(`uploads/${documents.pdfUploadId}`)),
    ]);
    // The document saver intentionally leaves existing READY metadata intact.
    // Reject an incomplete canonical row instead of publishing a transition
    // that would fail the completed check and restart this trigger forever.
    if (!isCanonicalDocument(canonicalXml, "COMPLEMENTO_PAGO_XML", documents.uuid) ||
        !isCanonicalDocument(canonicalPdf, "COMPLEMENTO_PAGO_PDF", documents.uuid)) throw Error("REP_IMPORTED_CANONICAL_DOCUMENT_INVALID");
    tx.update(ref, { ...documents, status: "RECEIVED", automationStatus: "RECEIVED", automationError: null,
      repAttachmentStatus: "REP_VALIDATED", receivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.set(appRef, { iqComplementXmlUploadId: documents.xmlUploadId,
      iqComplementPdfUploadId: documents.pdfUploadId, iqComplementUuid: documents.uuid,
      iqComplementDocumentOwner: "PAGO_APPLICATION", iqComplementReconciledAt: FieldValue.serverTimestamp(),
      iqComplementLegacyRoundingToleranceMinor: 1,
      updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    for (const legacy of [xmlSnap, pdfSnap]) {
      if (![documents.xmlUploadId, documents.pdfUploadId].includes(legacy.id)) tx.update(legacy.ref, {
        active: false, status: "REPLACED", replacedByApplicationId: applicationId,
        replacedByUploadIds: [documents.xmlUploadId, documents.pdfUploadId], replacedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const jobId = latest.jobId;
    if (jobId) tx.set(jobs().doc(jobId), { status: "RECEIVED", error: null, ...documents,
      receivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: source.rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: applicationId, referenceType: "pagoAplicacion", relatedEntityId: source.pagoId, relatedEntityType: "pago",
      description: `REP ${documents.uuid} reconciliado como documento de la aplicación de pago; documentos legacy de Solicitud retirados de la vista general.` });
  });
  return true;
}
export async function updateJob(id: string, patch: any, message?: string) {
  const ref = jobs().doc(id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref); if (!snap.exists) throw Error("REP_JOB_MISSING");
    const job = snap.data()!;
    const requests = await tx.get(db.collection("paymentComplementRequests").where("automationJobId", "==", id));
    tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    for (const source of requests.docs) {
      if (source.data().rootId !== job.rootId) throw Error("REP_FOLLOWUP_SCOPE");
      tx.update(source.ref, { automationStatus: patch.status || job.status, automationError: patch.error || null,
        ...(patch.status === "REQUESTED" && patch.requestedAt ? { status: "REQUESTED" } : {}),
        ...(patch.status === "UNKNOWN" && job.provider === "IQ" ? { status: "REQUEST_STATE_UNKNOWN", externalRequestSent: null } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "nextCheckAt") ? { nextCheckAt: patch.nextCheckAt } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "repAttachmentStatus") ? { repAttachmentStatus: patch.repAttachmentStatus } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "bReadState") ? { bReadState: patch.bReadState } : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "gateReason") ? { automationGateReason: patch.gateReason } : {}),
        ...(patch.requestedAt ? { requestedAt: patch.requestedAt, externalRequestSent: true } : {}), updatedAt: FieldValue.serverTimestamp() });
    }
    if (message) logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: job.rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: id, referenceType: "complementoPago", description: message });
  });
}

type EnqueueOutcome = { result: Result; reason: string; evidence?: { kind: "JOB" | "ADOPTED"; id: string } };
export async function enqueueComplement(applicationId: string): Promise<EnqueueOutcome> {
  const initial = (await db.doc(`pagoAplicaciones/${applicationId}`).get()).data();
  if (!initial?.rootId) return { result: "QUARANTINED", reason: "REP_APPLICATION_MISSING" };
  const config = (await db.doc(`paymentComplementConfigs/${initial.rootId}`).get()).data();
  await reconcilePaymentComplement(applicationId);
  const loaded = await sourceFor(applicationId);
  // A previous IQ pipeline may already have imported a valid REP under the
  // Solicitud. Adopt that evidence before applying the prospective-send gate;
  // this path never performs an external request.
  if (await adoptImportedIqComplement(applicationId, loaded)) return { result: "SUCCEEDED", reason: "REP_ADOPTED",
    evidence: { kind: "ADOPTED", id: loaded.ref.id } };
  // Inspect activation before touching historical follow-up or source records.
  if (!config) return { result: "DEFERRED", reason: "REP_ACTIVATION_PENDING" };
  if (!millis(initial.createdAt) || millis(initial.createdAt) < millis(config.activatedAt))
    return { result: "QUARANTINED", reason: "REP_PROSPECTIVE_ACTIVATION_REQUIRED" };
  const { app, solicitud, source, ref } = loaded;
  // Activation is prospective. Historical backfill never issues documents.
  let provider = "FACTURAMA", depositId = "", profileId = "", actorUid = text(app.createdBy);
  if (source.provider === "IQ") {
    provider = "IQ";
    if (app.iqApplicationStatus !== "IQ_APPLIED" || app.iqActionExecuted !== true || !app.iqPlanId)
      return { result: "DEFERRED", reason: "REP_APPLICATION_DEPENDENCY_PENDING" };
    const plan = (await db.doc(`pagoApplicationIqPlans/${app.iqPlanId}`).get()).data();
    if (!plan || plan.rootId !== app.rootId || plan.pagoId !== app.pagoId) throw Error("REP_IQ_PLAN_SCOPE");
    depositId = text(plan.plan?.pagoIqFolio || plan.pagoIqFolio); profileId = text(plan.iqExecutionProfileId);
    const attempt = (await db.doc(`pagoApplicationIqAttempts/${app.iqExecutionAttemptId}`).get()).data();
    if (!attempt || attempt.rootId !== app.rootId || attempt.profileId !== profileId || attempt.planId !== app.iqPlanId) throw Error("REP_IQ_ATTEMPT_SCOPE");
    actorUid = text(attempt.createdBy);
    if (!/^\d{3,20}$/.test(depositId) || !profileId) throw Error("REP_IQ_DEPOSIT_REQUIRED");
  } else {
    if (config.facturamaEnabled !== true) return { result: "DEFERRED", reason: "REP_PROVIDER_PAUSED" };
    if (!belongsToPay0Dispatch(app.rootId, solicitud.despachoId)) return { result: "QUARANTINED", reason: "REP_FACTURAMA_EXTERNAL_DISPATCH" };
    await assertPay0Issuer({ db, rootId: app.rootId, companyId: text(solicitud.companyId) });
    if (solicitud.facturamaEnvironment !== "PRODUCTION" || !solicitud.facturamaInvoiceId)
      return { result: "DEFERRED", reason: "REP_INVOICE_DEPENDENCY_PENDING" };
  }
  const canonicalId = provider === "IQ" ? iqRepRequestId(app.rootId, depositId) : hash(`${app.rootId}:${provider}:${applicationId}`);
  return db.runTransaction(async tx => {
    // Include old profile-keyed jobs before creating the new stable identity.
    // A profile switch must reuse the old job or stop, never create a second C.
    const historical = provider === "IQ" ? await tx.get(jobs().where("depositId", "==", depositId)) : null;
    const matches = historical ? matchingIqRepJobs(historical.docs, app.rootId, depositId) : [];
    if (matches.length > 1) throw Error("REP_IQ_REQUEST_IDENTITY_CONFLICT");
    const id = matches[0]?.id || canonicalId;
    const jobRef = jobs().doc(id), existing = await tx.get(jobRef), latest = await tx.get(ref);
    if (latest.data()?.automationJobId && latest.data()?.automationJobId !== id) throw Error("REP_IQ_REQUEST_IDENTITY_CONFLICT");
    if (latest.data()?.automationJobId === id) {
      if (!existing.exists || existing.data()?.rootId !== app.rootId) throw Error("REP_JOB_LINK_INVALID");
      return { result: "SUCCEEDED", reason: "REP_JOB_EXISTS", evidence: { kind: "JOB", id } } as EnqueueOutcome;
    }
    if (existing.exists && existing.data()?.rootId !== app.rootId) throw Error("REP_JOB_SCOPE");
    if (!existing.exists) tx.create(jobRef, { rootId: app.rootId, provider, depositId, profileId, actorUid, clientId: solicitud.clienteId,
      originActorUid: text(app.originActorUid || actorUid),
      originRootId: app.rootId,
      originIqProfileId: text(app.originIqProfileId || profileId),
      originIqContext: app.originIqContext || null,
      identityRevision: text(app.identityRevision || "IQ_ORIGIN_IDENTITY_V1"),
      applicationId, requestIdentity: provider === "IQ" ? canonicalId : null,
      status: "QUEUED", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    // A late application must be checked against the received REP. Never
    // interpret a previous request as evidence that this new partiality exists.
    if (existing.data()?.status === "RECEIVED") tx.update(jobRef, { status: "REQUESTED", updatedAt: FieldValue.serverTimestamp() });
    tx.update(ref, { automationJobId: id, automationStatus: existing.data()?.status === "RECEIVED" ? "REQUESTED" : existing.data()?.status || "QUEUED" });
    return { result: "SUCCEEDED", reason: "REP_JOB_QUEUED", evidence: { kind: "JOB", id } } as EnqueueOutcome;
  });
}

export async function markIqSending(id: string) {
  await db.runTransaction(async tx => {
    const ref = jobs().doc(id), snap = await tx.get(ref), job = snap.data();
    if (!job || job.provider !== "IQ" || job.status !== "PREPARING" || job.attemptedAt || job.requestedAt)
      throw Error("REP_IQ_REQUEST_ALREADY_ATTEMPTED");
    const sameDeposit = await tx.get(jobs().where("depositId", "==", job.depositId));
    const matches = matchingIqRepJobs(sameDeposit.docs, job.rootId, job.depositId);
    if (matches.length !== 1 || matches[0].id !== id) throw Error("REP_IQ_REQUEST_IDENTITY_CONFLICT");
    const identity = iqRepRequestId(job.rootId, job.depositId);
    if (job.requestIdentity && job.requestIdentity !== identity) throw Error("REP_IQ_REQUEST_IDENTITY_CONFLICT");
    const linked = await tx.get(db.collection("paymentComplementRequests").where("automationJobId", "==", id));
    if (linked.empty || linked.docs.some(row => row.data().rootId !== job.rootId || row.data().externalRequestSent === true ||
        row.data().requestedAt || ["REQUESTED", "RECEIVED", "REQUEST_STATE_UNKNOWN"].includes(row.data().status)))
      throw Error("REP_IQ_REQUEST_PREVIOUS_EVIDENCE");
    tx.update(ref, { status: "SENDING", requestIdentity: identity, attemptedAt: FieldValue.serverTimestamp(),
      attemptProfileId: job.originIqProfileId || job.profileId,
      originIqProfileId: job.originIqProfileId || job.profileId,
      effectiveIqProfileId: job.originIqProfileId || job.profileId,
      identityResolutionReason: job.originIqProfileId ? "PERSISTED_ORIGIN" : "LEGACY_EXECUTION_EVIDENCE",
      attemptActorUid: job.actorUid, updatedAt: FieldValue.serverTimestamp() });
    for (const row of linked.docs) tx.update(row.ref, { automationStatus: "SENDING", status: "SENDING", updatedAt: FieldValue.serverTimestamp() });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: job.rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: id, referenceType: "complementoPago", description: "Solicitud IQ C reservada de forma durable antes del POST; cualquier resultado incierto bloquea reenvío." });
  });
}

export async function executeComplement(id: string, adapter = providers) {
  const ref = jobs().doc(id);
  const job = await db.runTransaction(async tx => {
    const snap = await tx.get(ref), row = snap.data();
    if (!row || !["QUEUED", "PAUSED"].includes(row.status)) return null;
    const config = (await tx.get(db.doc(`paymentComplementConfigs/${row.rootId}`))).data();
    if (row.provider !== "IQ" && config?.facturamaEnabled !== true) return null;
    tx.update(ref, { status: "PREPARING", startedAt: FieldValue.serverTimestamp() }); return { ...row, id } as any;
  });
  if (!job) return;
  let sending = false;
  try {
    const { source, app, solicitud, pago } = await sourceFor(job.applicationId);
    if (source.rootId !== job.rootId) throw Error("REP_JOB_SCOPE");
    if (source.provider !== job.provider) throw Error("REP_PROVIDER_MISMATCH");
    if (job.provider === "IQ") {
      if (app.iqApplicationStatus !== "IQ_APPLIED" || app.iqActionExecuted !== true) throw Error("REP_IQ_NOT_APPLIED");
      const lookupGate = await inspectIqComplementGate(job, "LOOKUP");
      if (!lookupGate.allowed) { await updateJob(id, { status: "PAUSED", gateReason: lookupGate.reason }, `Hugo no puede consultar IQ: ${lookupGate.reason}.`); return; }
      const lookupClaim = await claimIqComplementGate(id, "LOOKUP");
      if (!lookupClaim.allowed) { await updateJob(id, { status: "PAUSED", gateReason: lookupClaim.reason }, `Consulta IQ pausada: ${lookupClaim.reason}.`); return; }
      const stillAllowedToLook = await inspectIqComplementGate(job, "LOOKUP");
      if (!stillAllowedToLook.allowed) { await updateJob(id, { status: "PAUSED", gateReason: stillAllowedToLook.reason }, `Consulta IQ pausada: ${stillAllowedToLook.reason}.`); return; }
      const session = await adapter.iqSession(job, "LOOKUP");
      const afterSession = await inspectIqComplementGate(job, "LOOKUP");
      if (!afterSession.allowed) { await updateJob(id, { status: "PAUSED", gateReason: afterSession.reason }, `Consulta IQ pausada: ${afterSession.reason}.`); return; }
      const state = await adapter.preflightIqComplement(job, session);
      if (state === "AVAILABLE") { await updateJob(id, { status: "REQUESTED", alreadyAvailable: true, gateReason: null }, "IQ ya tiene un REP disponible; se verificará y descargará a las 19:00, sin duplicar la solicitud."); return; }
      await sourceFor(job.applicationId);
      const requestGate = await inspectIqComplementGate(job, "REQUEST");
      if (!requestGate.allowed) { await updateJob(id, { status: "PAUSED", gateReason: requestGate.reason }, `Hugo detectó un REP ausente, pero no puede solicitarlo: ${requestGate.reason}.`); return; }
      const requestClaim = await claimIqComplementGate(id, "REQUEST");
      if (!requestClaim.allowed) { await updateJob(id, { status: "PAUSED", gateReason: requestClaim.reason }, `Solicitud IQ pausada: ${requestClaim.reason}.`); return; }
      const stillAllowedToRequest = await inspectIqComplementGate(job, "REQUEST");
      if (!stillAllowedToRequest.allowed) { await updateJob(id, { status: "PAUSED", gateReason: stillAllowedToRequest.reason }, `Solicitud IQ pausada: ${stillAllowedToRequest.reason}.`); return; }
      const requestSession = await adapter.iqSession(job, "REQUEST");
      const afterRequestSession = await inspectIqComplementGate(job, "REQUEST");
      if (!afterRequestSession.allowed) { await updateJob(id, { status: "PAUSED", gateReason: afterRequestSession.reason }, `Solicitud IQ pausada: ${afterRequestSession.reason}.`); return; }
      await markIqSending(id); sending = true;
      await markProtectedEffectIntent();
      await adapter.requestIqComplement(job, requestSession);
      await confirmProtectedEffect();
      await updateJob(id, { status: "REQUESTED", requestedAt: FieldValue.serverTimestamp(), error: null, gateReason: null }, "Complemento solicitado a IQ. Se revisará diariamente a las 19:00; no significa que ya esté emitido.");
    } else {
      if (solicitud.despachoId !== PAY0_DISPATCH_ID) throw Error("REP_FACTURAMA_EXTERNAL_DISPATCH");
      await assertPay0Issuer({ db, rootId: job.rootId, companyId: text(solicitud.companyId) });
      const payload = await adapter.prepareFacturamaComplement(job, source, app, solicitud, pago);
      await updateJob(id, { status: "SENDING", attemptedAt: FieldValue.serverTimestamp(), payloadHash: hash(JSON.stringify(payload)) }); sending = true;
      await markProtectedEffectIntent();
      const cfdiId = await adapter.emitFacturamaComplement(payload);
      await confirmProtectedEffect();
      await updateJob(id, { status: "ISSUED_PENDING_FILES", cfdiId, requestedAt: FieldValue.serverTimestamp() });
      // Saving the provider ID precedes downloads; failures cannot reissue.
      const documents = await adapter.importFacturamaComplement(cfdiId, source);
      await markReceived(id, [{ source, documents }]);
    }
  } catch (error) {
    reportProtectedFailure(error);
    const latest = (await ref.get()).data();
    const retryableBeforeSend = ["RETRY_WAIT", "DEFERRED"].includes(classifyFailure(error).result);
    await updateJob(id, { status: latest?.cfdiId ? "ISSUED_PENDING_FILES" : sending ? "UNKNOWN" : retryableBeforeSend ? "PAUSED" : "BLOCKED", error: errorCode(error) },
      sending ? "Complemento requiere revisión: hubo un problema después de iniciar el envío. No se repetirá la emisión o solicitud automáticamente." : `Complemento bloqueado antes de enviar: ${errorCode(error)}.`);
  }
}
async function markReceived(id: string, rows: any[]) {
  if (!rows.length) throw Error("REP_RECEIPT_EMPTY");
  await db.runTransaction(async tx => {
    const jobRef = jobs().doc(id), job = (await tx.get(jobRef)).data();
    const eligibilityLookup = job?.status === "BLOCKED" && job?.error === "IQ_REP_REQUEST_ELIGIBILITY_UNVERIFIED";
    if (!job || (!eligibilityLookup && !["REQUESTED", "UNKNOWN", "ISSUED_PENDING_FILES"].includes(job.status))) throw Error("REP_JOB_STATE_CHANGED");
    const linked = await tx.get(db.collection("paymentComplementRequests").where("automationJobId", "==", id));
    if (linked.empty || linked.size !== rows.length) throw Error("REP_RECEIPT_COVERAGE_MISMATCH");
    const expected = new Map(linked.docs.map(doc => [doc.data().applicationId, doc]));
    const updates: { ref: FirebaseFirestore.DocumentReference; documents: any }[] = [];
    for (const { source, documents } of rows) {
      const request = expected.get(source.applicationId);
      if (!request || request.data().rootId !== job.rootId || source.rootId !== job.rootId ||
          request.id !== complementRequestId(job.rootId, source.applicationId) ||
          request.data().pagoId !== source.pagoId || request.data().invoiceUuid !== source.invoiceUuid ||
          request.data().installment !== source.installment || request.data().amountMinor !== source.amountMinor ||
          !documents?.uuid || !documents?.xmlUploadId || !documents?.pdfUploadId) throw Error("REP_RECEIPT_SOURCE_MISMATCH");
      for (const [type, uploadId] of [["COMPLEMENTO_PAGO_XML", documents.xmlUploadId], ["COMPLEMENTO_PAGO_PDF", documents.pdfUploadId]]) {
        const upload = (await tx.get(db.doc(`uploads/${uploadId}`))).data();
        if (!upload || upload.rootId !== job.rootId || upload.pagoId !== source.pagoId || upload.applicationId !== source.applicationId ||
            upload.documentType !== type || upload.complementKey !== documents.uuid || upload.status !== "READY" ||
            upload.active !== true || upload.integritySealStatus !== "SEALED" || !/^[a-f0-9]{64}$/i.test(upload.sha256 || "")) throw Error("REP_RECEIPT_DOCUMENT_MISMATCH");
      }
      updates.push({ ref: request.ref, documents });
      expected.delete(source.applicationId);
    }
    if (expected.size) throw Error("REP_RECEIPT_COVERAGE_MISMATCH");
    for (const { ref, documents } of updates) tx.update(ref, { ...documents, status: "RECEIVED", automationStatus: "RECEIVED", automationError: null,
      repAttachmentStatus: "REP_VALIDATED", bReadState: "REP_VALIDATED", nextCheckAt: null,
      receivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.update(jobRef, { status: "RECEIVED", bReadState: "REP_VALIDATED", nextCheckAt: null, error: null, updatedAt: FieldValue.serverTimestamp() });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: job.rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: id, referenceType: "complementoPago", description: "Complemento recibido y validado contra UUID, parcialidad e importes; XML y PDF vinculados al pago correspondiente." });
  });
}

export async function checkComplementDaily(id: string, now = new Date(), adapter = providers): Promise<Result> {
  const ref = jobs().doc(id), day = dayMexico(now);
  const current = (await ref.get()).data();
  const currentEligibilityLookup = current?.status === "BLOCKED" && current?.error === "IQ_REP_REQUEST_ELIGIBILITY_UNVERIFIED";
  if (current?.bReadState === "EXCEPTION") return "QUARANTINED";
  if (current?.nextCheckAt && millis(current.nextCheckAt) > now.getTime()) return "DEFERRED";
  if (current?.provider === "IQ" && (currentEligibilityLookup || ["REQUESTED", "UNKNOWN", "ISSUED_PENDING_FILES"].includes(current.status))) {
    const gate = await inspectIqComplementGate(current, "LOOKUP");
    if (!gate.allowed) { await recordBlockedIqGate(id, "LOOKUP", gate.reason, now); return "DEFERRED"; }
  }
  const job = await db.runTransaction(async tx => {
    const row = (await tx.get(ref)).data();
    const eligibilityLookup = row?.status === "BLOCKED" && row?.error === "IQ_REP_REQUEST_ELIGIBILITY_UNVERIFIED";
    if (!row || row.bReadState === "EXCEPTION" || (!eligibilityLookup && !["REQUESTED", "UNKNOWN", "ISSUED_PENDING_FILES"].includes(row.status)) || row.lastCheckDay === day ||
        row.nextCheckAt && millis(row.nextCheckAt) > now.getTime()) return null;
    tx.update(ref, { lastCheckDay: day, lastCheckedAt: Timestamp.fromDate(now) }); return { ...row, id } as any;
  });
  if (!job) return "DEFERRED";
  let result: Result = "DEFERRED";
  try {
    const refs = await db.collection("paymentComplementRequests").where("automationJobId", "==", id).get(), sources = [];
    for (const doc of refs.docs) { const loaded = await sourceFor(doc.data().applicationId); if (loaded.source.rootId !== job.rootId) throw Error("REP_JOB_SCOPE"); sources.push(loaded.source); }
    if (!sources.length) throw Error("REP_APPLICATION_MISSING");
    if (job.provider === "IQ") {
      const claim = await claimIqComplementGate(id, "LOOKUP", now);
      if (!claim.allowed) { await recordBlockedIqGate(id, "LOOKUP", claim.reason, now); return "DEFERRED"; }
      const stillAllowed = await inspectIqComplementGate(job, "LOOKUP");
      if (!stillAllowed.allowed) { await recordBlockedIqGate(id, "LOOKUP", stillAllowed.reason, now); return "DEFERRED"; }
      const session = await adapter.iqSession(job, "LOOKUP");
      const afterSession = await inspectIqComplementGate(job, "LOOKUP");
      if (!afterSession.allowed) { await recordBlockedIqGate(id, "LOOKUP", afterSession.reason, now); return "DEFERRED"; }
      const url = await adapter.availableIqComplement(job, session);
      if (url) {
        const downloadGate = await inspectIqComplementGate(job, "LOOKUP");
        if (!downloadGate.allowed) { await recordBlockedIqGate(id, "LOOKUP", downloadGate.reason, now); return "DEFERRED"; }
        const imported = await adapter.importIqComplement(url, sources, job);
        for (const row of imported) await verifiedDocuments(job.rootId, row.source, row.documents);
        await markReceived(id, imported); return "SUCCEEDED";
      }
      // Daily scheduler is at 19:00; a strict +24h from its actual start
      // could miss the next run by seconds and defer B for 48 hours.
      const nextCheckAt = Timestamp.fromMillis(now.getTime() + 12 * 60 * 60 * 1000);
      await updateJob(id, { nextCheckAt, repAttachmentStatus: "REP_ATTACHMENT_NOT_AVAILABLE", bReadState: "WAITING_B" },
        "IQ todavía no ofrece un REP adjunto; Hugo volverá a consultar después de la siguiente revisión programada.");
      result = "SUCCEEDED"; // The daily read completed; the financial REP remains pending.
      if (job.status === "REQUESTED") {
        const linked = await db.collection("paymentComplementRequests").where("automationJobId", "==", id).get();
        for (const row of linked.docs) await row.ref.update({ status: "ATTACHMENT_PENDING", automationStatus: "ATTACHMENT_PENDING",
          nextCheckAt, updatedAt: FieldValue.serverTimestamp() });
      }
    } else if (job.cfdiId) {
      const solicitud = (await db.doc(`solicitudes/${sources[0].solicitudId}`).get()).data();
      if (!solicitud || solicitud.despachoId !== PAY0_DISPATCH_ID) throw Error("REP_FACTURAMA_EXTERNAL_DISPATCH");
      await assertPay0Issuer({ db, rootId: job.rootId, companyId: text(solicitud.companyId) });
      await markReceived(id, [{ source: sources[0], documents: await adapter.importFacturamaComplement(job.cfdiId, sources[0]) }]); return "SUCCEEDED";
    }
  } catch (error) { result = "QUARANTINED"; reportProtectedFailure(error); await updateJob(id, { error: errorCode(error), bReadState: "EXCEPTION", nextCheckAt: null },
    `Revisión B detenida por ${errorCode(error)}; resultado de solicitud C conservado, sin reenvío.`); }
  if (!job.overdueAlertedAt && overdue(job.requestedAt, now)) await updateJob(id, { overdueAlertedAt: Timestamp.fromDate(now) }, `El complemento ${job.provider === "IQ" ? `del depósito IQ ${job.depositId}` : `de la aplicación ${job.applicationId}`} lleva 7 días sin recibirse. Solicítalo por WhatsApp al proveedor; PAY0 continuará la revisión diaria. No se envió WhatsApp automáticamente.`);
  return result;
}

const safety = new SafetyRuntime(db);
const enqueueFields = ["rootId", "status", "invoiceType", "solicitudId", "pagoId", "montoAplicado", "numeroParcialidad",
  "saldoAnterior", "saldoInsoluto", "iqApplicationStatus", "iqActionExecuted", "iqPlanId", "iqExecutionAttemptId",
  "iqComplementStatus", "iqComplementUuid", "iqComplementXmlUploadId", "iqComplementPdfUploadId", "iqComplementDocumentOwner",
  "originActorUid", "originRootId", "originIqProfileId", "originIqContext", "identityRevision"];

export async function protectedEnqueueComplement(applicationId: string, technicalOrigin: TechnicalOrigin = "TRIGGER") {
  const app = (await db.doc(`pagoAplicaciones/${applicationId}`).get()).data();
  if (!app?.rootId) return;
  const fingerprint = hash(JSON.stringify(enqueueFields.map(key => [key, app[key] ?? null])));
  return safety.run({ rootId: app.rootId, process: "REP", partition: `ENQUEUE:${applicationId}`,
    operationType: "REP_ENQUEUE", operationId: applicationId, idempotencyKey: `${applicationId}:${fingerprint}`,
    origin: "AUTOMATIC", technicalOrigin, localCompletion: "DETERMINISTIC_ENQUEUE",
    policy: { ...CONSERVATIVE_POLICY, spacingMs: 0, maxExternalRequests: 0 },
  }, () => enqueueComplement(applicationId), value => value.result,
    value => ({ evidence: value.evidence, reason: value.reason }));
}

export async function protectedExecuteComplement(id: string, technicalOrigin: TechnicalOrigin = "TRIGGER", adapter = providers) {
  const job = (await jobs().doc(id).get()).data();
  if (!job || !["QUEUED", "PAUSED"].includes(job.status)) return;
  // Gate-only wakeups do not consume execution attempts or provider capacity.
  if (job.provider === "IQ" && !(await inspectIqComplementGate(job, "LOOKUP")).allowed) return;
  if (job.provider !== "IQ" && (await db.doc(`paymentComplementConfigs/${job.rootId}`).get()).data()?.facturamaEnabled !== true) return;
  return safety.run({ rootId: job.rootId, process: "REP", partition: job.provider,
    operationType: "REP_EXECUTE", operationId: id, idempotencyKey: job.requestIdentity || id,
    origin: "AUTOMATIC", technicalOrigin, externalTarget: job.provider,
  }, async () => {
    await executeComplement(id, adapter);
    const latest = (await jobs().doc(id).get()).data();
    return latest?.status === "UNKNOWN" ? "OUTCOME_UNKNOWN" : latest?.status === "PAUSED" ? "DEFERRED"
      : latest?.status === "BLOCKED" ? "QUARANTINED"
      : ["REQUESTED", "RECEIVED", "ISSUED_PENDING_FILES"].includes(latest?.status) ? "SUCCEEDED"
      : ["PREPARING", "SENDING"].includes(latest?.status) ? "OUTCOME_UNKNOWN" : "DEFERRED";
  }, value => value as Result);
}

export async function protectedCheckComplementDaily(id: string, now = new Date(), adapter = providers) {
  const job = (await jobs().doc(id).get()).data();
  if (!job || job.bReadState === "EXCEPTION" || job.lastCheckDay === dayMexico(now) ||
      !["REQUESTED", "UNKNOWN", "ISSUED_PENDING_FILES", "BLOCKED"].includes(job.status)) return;
  return safety.run({ rootId: job.rootId, process: "REP", partition: job.provider,
    operationType: "REP_RECONCILE", operationId: id, idempotencyKey: `${id}:${dayMexico(now)}`,
    origin: "AUTOMATIC", technicalOrigin: "SCHEDULER", externalTarget: job.provider,
  }, () => checkComplementDaily(id, now, adapter), value => value);
}

export const enqueueAutomaticPaymentComplement = onDocumentWritten({ document: "pagoAplicaciones/{applicationId}", region: "us-central1", retry: true, maxInstances: 1, concurrency: 1 }, async event => {
  const app = event.data?.after.data();
  if (shouldSuppressIqHistoricalImport(event.data?.before.data(), app)) return;
  if (!app || app.status !== "APLICADA" || app.invoiceType !== "PPD") {
    const old = event.data?.before.data();
    if (old?.rootId) {
      const source = (await db.doc(`paymentComplementRequests/${complementRequestId(old.rootId, event.params.applicationId)}`).get()).data();
      if (source?.automationJobId) await updateJob(source.automationJobId, { status: "REVIEW_REQUIRED", error: "REP_SOURCE_REVERSED" }, "La aplicación de pago cambió o se canceló. Revisa el complemento relacionado; no se canceló ningún CFDI automáticamente.");
    }
    return;
  }
  try { await protectedEnqueueComplement(event.params.applicationId); }
  catch (error) {
    const ref = db.doc(`paymentComplementRequests/${complementRequestId(app.rootId, event.params.applicationId)}`);
    if ((await ref.get()).exists) await ref.update({ automationStatus: "BLOCKED", automationError: errorCode(error) });
    else throw error;
  }
});
export const executeAutomaticPaymentComplement = onDocumentWritten({ document: "paymentComplementJobs/{jobId}", region: "us-central1", retry: true, maxInstances: 1, concurrency: 1, timeoutSeconds: 540, memory: "512MiB", secrets: providers.COMPLEMENT_SECRETS }, async event => {
  if (event.data?.after.data()?.status === "QUEUED") await protectedExecuteComplement(event.params.jobId);
});
export async function runProtectedRepDaily(now = new Date(), adapter = providers) {
  return safety.run({ rootId: "SYSTEM", process: "REP", partition: "SCAN", operationType: "REP_DAILY",
    operationId: dayMexico(now), idempotencyKey: dayMexico(now), origin: "AUTOMATIC", technicalOrigin: "SCHEDULER",
  }, async () => {
  const checkpointRef = db.doc("automationSafetyCheckpoints/rep-daily");
  const checkpoint = (await checkpointRef.get()).data() || {};
  const deadline = Date.now() + 480_000;
  // Revisit persisted local intents too: a process kill may have prevented the
  // original event from creating a job. Activation still prohibits backfill POSTs.
  let importedQuery = db.collection("pagoAplicaciones").orderBy(FieldPath.documentId()).limit(50);
  if (checkpoint.importedCursor) importedQuery = importedQuery.startAfter(checkpoint.importedCursor);
  const imported = await importedQuery.get();
  for (const row of imported.docs) {
    if (Date.now() >= deadline) return;
    try { if (row.data().status === "APLICADA" && row.data().invoiceType === "PPD") await protectedEnqueueComplement(row.id, "SCHEDULER"); }
    catch (error) { console.error("REP_IMPORTED_RECONCILIATION_EXCEPTION", row.id, errorCode(error)); }
    await checkpointRef.set({ importedCursor: row.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  if (imported.size < 50) await checkpointRef.set({ importedCursor: null }, { merge: true });
  const jobsFirst = checkpoint.nextPhase !== "FOLLOWUPS";
  if (!jobsFirst) await scanDueIqFollowups(now, adapter);
  let cursor: string | undefined = checkpoint.jobCursor;
  // One page/run, durable cursor; never sweep the entire historical collection.
  {
    let query = jobs().orderBy(FieldPath.documentId()).limit(50); if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const row of page.docs) {
      if (Date.now() >= deadline) return;
      try {
        const job = row.data();
        if (["PREPARING", "SENDING"].includes(job.status) && Date.now() - millis(job.startedAt) > 15 * 60000) await updateJob(row.id,
          { status: job.status === "SENDING" ? "UNKNOWN" : "BLOCKED", error: "REP_INTERRUPTED" }, "El procesamiento del complemento se interrumpió. Se requiere revisión; no se repetirá el envío automáticamente.");
        const execution = ["QUEUED", "PAUSED"].includes(job.status) ? await protectedExecuteComplement(row.id, "SCHEDULER", adapter) : undefined;
        const observation = execution?.admitted ? undefined : await protectedCheckComplementDaily(row.id, now, adapter);
        if (execution?.admitted || observation?.admitted) {
          // Resume after the admitted case, not after capacity-skipped cases.
          // This prevents the first slow/poison record from starving the rest.
          await checkpointRef.set({ jobCursor: row.id, nextPhase: "FOLLOWUPS", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          return;
        }
      } catch (error) {
        // A failed expediente must not prevent the other due B observations.
        console.error("REP_DAILY_JOB_EXCEPTION", row.id, errorCode(error));
      }
      await checkpointRef.set({ jobCursor: row.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    if (page.size < 50) await checkpointRef.set({ jobCursor: null }, { merge: true });
  }
  if (jobsFirst) await scanDueIqFollowups(now, adapter);
  await checkpointRef.set({ nextPhase: "JOBS" }, { merge: true });
  });
}
export const checkPaymentComplementsDaily = onSchedule({ schedule: "0 19 * * 1-5", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 540, memory: "512MiB", secrets: providers.COMPLEMENT_SECRETS, retryCount: 0, maxInstances: 1, concurrency: 1 }, () => runProtectedRepDaily().then(() => undefined));

export const configurePaymentComplementAutomation = onCall({ region: "us-central1", cors: true }, async request => {
  const { rootId } = await context(request);
  if (request.data?.safetyOnly === true) {
    const scope = request.data.scope, paused = request.data.paused, reason = text(request.data.reason);
    if (!["REP", "MASTER"].includes(scope) || typeof paused !== "boolean" || !reason || reason.length > 240)
      throw new HttpsError("invalid-argument", "Indica ámbito REP o MASTER, pausa y motivo de hasta 240 caracteres.");
    // MASTER here is tenant-scoped. System-wide emergency control requires IAM
    // administration; a tenant Superadmin never pauses another root.
    await safety.setControl({ rootId, process: "REP", master: scope === "MASTER", paused, reason, actor: request.auth!.uid });
    return { ok: true };
  }
  if (typeof request.data?.iqEnabled !== "boolean" || typeof request.data?.facturamaEnabled !== "boolean") throw new HttpsError("invalid-argument", "Indica qué proveedores automatizar.");
  if (request.data.facturamaEnabled && request.data.confirmation !== "AUTORIZO_REP_AUTOMATICO") throw new HttpsError("failed-precondition", "Confirma la emisión automática de CFDI de pago reales.");
  const ref = db.doc(`paymentComplementConfigs/${rootId}`);
  await db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    tx.set(ref, { rootId, iqEnabled: request.data.iqEnabled, facturamaEnabled: request.data.facturamaEnabled,
      activatedAt: existing.data()?.activatedAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: request.auth!.uid }, { merge: true });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId, actorUid: request.auth!.uid, actorRole: "superadmin",
      referenceId: rootId, referenceType: "configuracion", description: `Automatización de complementos actualizada: IQ ${request.data.iqEnabled ? "activo" : "pausado"}; Facturama ${request.data.facturamaEnabled ? "activo" : "pausado"}. Sólo aplicaciones posteriores a la activación.` });
  });
  return { ok: true };
});

export const setComplementPaymentForm = onCall({ region: "us-central1", cors: true }, async request => {
  const { rootId } = await context(request), id = text(request.data?.requestId), paymentForm = text(request.data?.paymentForm);
  if (!/^[a-f0-9]{64}$/.test(id) || !/^(01|02|03|04|28|29)$/.test(paymentForm)) throw new HttpsError("invalid-argument", "Selecciona la forma real del pago.");
  await db.runTransaction(async tx => {
    const source = (await tx.get(db.doc(`paymentComplementRequests/${id}`))).data();
    if (!source || source.rootId !== rootId || !source.automationJobId) throw new HttpsError("permission-denied", "Complemento fuera de alcance.");
    const jobRef = jobs().doc(source.automationJobId), job = (await tx.get(jobRef)).data();
    const pagoRef = db.doc(`pagos/${source.pagoId}`), pago = (await tx.get(pagoRef)).data();
    if (!job || job.rootId !== rootId || !pago || pago.rootId !== rootId) throw new HttpsError("permission-denied", "Pago fuera de alcance.");
    if (job.status !== "BLOCKED" || job.error !== "REP_PAYMENT_FORM_REQUIRED") throw new HttpsError("failed-precondition", "Este complemento no está bloqueado por forma de pago.");
    if (pago.paymentForm && pago.paymentForm !== paymentForm) throw new HttpsError("failed-precondition", "El pago ya tiene otra forma registrada; requiere revisión.");
    await safety.releaseUnsentRepair(tx, { rootId, process: "REP", partition: job.provider,
      operationType: "REP_EXECUTE", operationId: source.automationJobId, idempotencyKey: job.requestIdentity || source.automationJobId,
      origin: "MANUAL", technicalOrigin: "CALLABLE" }, request.auth!.uid, "PAYMENT_FORM_CONFIRMED");
    tx.update(pagoRef, { paymentForm, paymentFormConfirmedBy: request.auth!.uid, paymentFormConfirmedAt: FieldValue.serverTimestamp() });
    tx.update(jobRef, { status: "QUEUED", error: null, updatedAt: FieldValue.serverTimestamp() });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId, actorUid: request.auth!.uid, actorRole: "superadmin",
      referenceId: source.pagoId, referenceType: "pago", description: "Forma de pago SAT confirmada por Superadmin; complemento vuelve a validación antes de emisión." });
  });
  return { ok: true };
});
