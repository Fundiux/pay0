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
async function updateJob(id: string, patch: any, message?: string) {
  const ref = jobs().doc(id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref); if (!snap.exists) throw Error("REP_JOB_MISSING");
    const job = snap.data()!;
    const requests = await tx.get(db.collection("paymentComplementRequests").where("automationJobId", "==", id));
    tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    for (const source of requests.docs) {
      if (source.data().rootId !== job.rootId) throw Error("REP_FOLLOWUP_SCOPE");
      tx.update(source.ref, { automationStatus: patch.status || job.status, automationError: patch.error || null,
        ...(Object.prototype.hasOwnProperty.call(patch, "gateReason") ? { automationGateReason: patch.gateReason } : {}),
        ...(patch.requestedAt ? { requestedAt: patch.requestedAt, externalRequestSent: true } : {}), updatedAt: FieldValue.serverTimestamp() });
    }
    if (message) logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: job.rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: id, referenceType: "complementoPago", description: message });
  });
}

export async function enqueueComplement(applicationId: string) {
  const initial = (await db.doc(`pagoAplicaciones/${applicationId}`).get()).data();
  if (!initial?.rootId) return;
  const config = (await db.doc(`paymentComplementConfigs/${initial.rootId}`).get()).data();
  // Inspect activation before touching historical follow-up or source records.
  if (!config || !millis(initial.createdAt) || millis(initial.createdAt) < millis(config.activatedAt)) return;
  await reconcilePaymentComplement(applicationId);
  const loaded = await sourceFor(applicationId), { app, solicitud, source, ref } = loaded;
  // Activation is prospective. Historical backfill never issues documents.
  let provider = "FACTURAMA", depositId = "", profileId = "", actorUid = text(app.createdBy);
  if (source.provider === "IQ") {
    provider = "IQ";
    if (app.iqApplicationStatus !== "IQ_APPLIED" || app.iqActionExecuted !== true || !app.iqPlanId) return;
    const plan = (await db.doc(`pagoApplicationIqPlans/${app.iqPlanId}`).get()).data();
    if (!plan || plan.rootId !== app.rootId || plan.pagoId !== app.pagoId) throw Error("REP_IQ_PLAN_SCOPE");
    depositId = text(plan.plan?.pagoIqFolio || plan.pagoIqFolio); profileId = text(plan.iqExecutionProfileId);
    const attempt = (await db.doc(`pagoApplicationIqAttempts/${app.iqExecutionAttemptId}`).get()).data();
    if (!attempt || attempt.rootId !== app.rootId || attempt.profileId !== profileId || attempt.planId !== app.iqPlanId) throw Error("REP_IQ_ATTEMPT_SCOPE");
    actorUid = text(attempt.createdBy);
    if (!/^\d{3,20}$/.test(depositId) || !profileId) throw Error("REP_IQ_DEPOSIT_REQUIRED");
  } else if (config.facturamaEnabled !== true || solicitud.facturamaEnvironment !== "PRODUCTION" || !solicitud.facturamaInvoiceId) return;
  const canonicalId = provider === "IQ" ? iqRepRequestId(app.rootId, depositId) : hash(`${app.rootId}:${provider}:${applicationId}`);
  await db.runTransaction(async tx => {
    // Include old profile-keyed jobs before creating the new stable identity.
    // A profile switch must reuse the old job or stop, never create a second C.
    const historical = provider === "IQ" ? await tx.get(jobs().where("depositId", "==", depositId)) : null;
    const matches = historical ? matchingIqRepJobs(historical.docs, app.rootId, depositId) : [];
    if (matches.length > 1) throw Error("REP_IQ_REQUEST_IDENTITY_CONFLICT");
    const id = matches[0]?.id || canonicalId;
    const jobRef = jobs().doc(id), existing = await tx.get(jobRef), latest = await tx.get(ref);
    if (latest.data()?.automationJobId && latest.data()?.automationJobId !== id) throw Error("REP_IQ_REQUEST_IDENTITY_CONFLICT");
    if (latest.data()?.automationJobId === id) return;
    if (existing.exists && existing.data()?.rootId !== app.rootId) throw Error("REP_JOB_SCOPE");
    if (!existing.exists) tx.create(jobRef, { rootId: app.rootId, provider, depositId, profileId, actorUid, clientId: solicitud.clienteId,
      applicationId, requestIdentity: provider === "IQ" ? canonicalId : null,
      status: "QUEUED", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    // A late application must be checked against the received REP. Never
    // interpret a previous request as evidence that this new partiality exists.
    if (existing.data()?.status === "RECEIVED") tx.update(jobRef, { status: "REQUESTED", updatedAt: FieldValue.serverTimestamp() });
    tx.update(ref, { automationJobId: id, automationStatus: existing.data()?.status === "RECEIVED" ? "REQUESTED" : existing.data()?.status || "QUEUED" });
  });
}

async function markIqSending(id: string) {
  await db.runTransaction(async tx => {
    const ref = jobs().doc(id), snap = await tx.get(ref), job = snap.data();
    if (!job || job.provider !== "IQ" || job.status !== "PREPARING" || job.attemptedAt || job.requestedAt)
      throw Error("REP_IQ_REQUEST_ALREADY_ATTEMPTED");
    const sameDeposit = await tx.get(jobs().where("depositId", "==", job.depositId));
    const matches = matchingIqRepJobs(sameDeposit.docs, job.rootId, job.depositId);
    if (matches.length !== 1 || matches[0].id !== id) throw Error("REP_IQ_REQUEST_IDENTITY_CONFLICT");
    const identity = iqRepRequestId(job.rootId, job.depositId);
    if (job.requestIdentity && job.requestIdentity !== identity) throw Error("REP_IQ_REQUEST_IDENTITY_CONFLICT");
    tx.update(ref, { status: "SENDING", requestIdentity: identity, attemptedAt: FieldValue.serverTimestamp(),
      attemptProfileId: job.profileId, attemptActorUid: job.actorUid, updatedAt: FieldValue.serverTimestamp() });
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
      await adapter.requestIqComplement(job, requestSession);
      await updateJob(id, { status: "REQUESTED", requestedAt: FieldValue.serverTimestamp(), error: null, gateReason: null }, "Complemento solicitado a IQ. Se revisará diariamente a las 19:00; no significa que ya esté emitido.");
    } else {
      const payload = await adapter.prepareFacturamaComplement(job, source, app, solicitud, pago);
      await updateJob(id, { status: "SENDING", attemptedAt: FieldValue.serverTimestamp(), payloadHash: hash(JSON.stringify(payload)) }); sending = true;
      const cfdiId = await adapter.emitFacturamaComplement(payload);
      await updateJob(id, { status: "ISSUED_PENDING_FILES", cfdiId, requestedAt: FieldValue.serverTimestamp() });
      // Saving the provider ID precedes downloads; failures cannot reissue.
      const documents = await adapter.importFacturamaComplement(cfdiId, source);
      await markReceived(id, [{ source, documents }]);
    }
  } catch (error) {
    const latest = (await ref.get()).data();
    await updateJob(id, { status: latest?.cfdiId ? "ISSUED_PENDING_FILES" : sending ? "UNKNOWN" : "BLOCKED", error: errorCode(error) },
      sending ? "Complemento requiere revisión: hubo un problema después de iniciar el envío. No se repetirá la emisión o solicitud automáticamente." : `Complemento bloqueado antes de enviar: ${errorCode(error)}.`);
  }
}
async function markReceived(id: string, rows: any[]) {
  if (!rows.length) throw Error("REP_RECEIPT_EMPTY");
  await db.runTransaction(async tx => {
    const jobRef = jobs().doc(id), job = (await tx.get(jobRef)).data();
    if (!job || !["REQUESTED", "UNKNOWN", "ISSUED_PENDING_FILES"].includes(job.status)) throw Error("REP_JOB_STATE_CHANGED");
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
      receivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.update(jobRef, { status: "RECEIVED", error: null, updatedAt: FieldValue.serverTimestamp() });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId: job.rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: id, referenceType: "complementoPago", description: "Complemento recibido y validado contra UUID, parcialidad e importes; XML y PDF vinculados al pago correspondiente." });
  });
}

export async function checkComplementDaily(id: string, now = new Date(), adapter = providers) {
  const ref = jobs().doc(id), day = dayMexico(now);
  const current = (await ref.get()).data();
  if (current?.provider === "IQ" && ["REQUESTED", "UNKNOWN", "ISSUED_PENDING_FILES"].includes(current.status)) {
    const gate = await inspectIqComplementGate(current, "LOOKUP");
    if (!gate.allowed) { await recordBlockedIqGate(id, "LOOKUP", gate.reason, now); return; }
  }
  const job = await db.runTransaction(async tx => {
    const row = (await tx.get(ref)).data();
    if (!row || !["REQUESTED", "UNKNOWN", "ISSUED_PENDING_FILES"].includes(row.status) || row.lastCheckDay === day) return null;
    tx.update(ref, { lastCheckDay: day, lastCheckedAt: Timestamp.fromDate(now) }); return { ...row, id } as any;
  });
  if (!job) return;
  try {
    const refs = await db.collection("paymentComplementRequests").where("automationJobId", "==", id).get(), sources = [];
    for (const doc of refs.docs) { const loaded = await sourceFor(doc.data().applicationId); if (loaded.source.rootId !== job.rootId) throw Error("REP_JOB_SCOPE"); sources.push(loaded.source); }
    if (!sources.length) throw Error("REP_APPLICATION_MISSING");
    if (job.provider === "IQ") {
      const claim = await claimIqComplementGate(id, "LOOKUP", now);
      if (!claim.allowed) { await recordBlockedIqGate(id, "LOOKUP", claim.reason, now); return; }
      const stillAllowed = await inspectIqComplementGate(job, "LOOKUP");
      if (!stillAllowed.allowed) { await recordBlockedIqGate(id, "LOOKUP", stillAllowed.reason, now); return; }
      const session = await adapter.iqSession(job, "LOOKUP");
      const afterSession = await inspectIqComplementGate(job, "LOOKUP");
      if (!afterSession.allowed) { await recordBlockedIqGate(id, "LOOKUP", afterSession.reason, now); return; }
      const url = await adapter.availableIqComplement(job, session);
      if (url) {
        const downloadGate = await inspectIqComplementGate(job, "LOOKUP");
        if (!downloadGate.allowed) { await recordBlockedIqGate(id, "LOOKUP", downloadGate.reason, now); return; }
        await markReceived(id, await adapter.importIqComplement(url, sources, job)); return;
      }
    } else if (job.cfdiId) {
      await markReceived(id, [{ source: sources[0], documents: await adapter.importFacturamaComplement(job.cfdiId, sources[0]) }]); return;
    }
  } catch (error) { await updateJob(id, { error: errorCode(error) }); }
  if (!job.overdueAlertedAt && overdue(job.requestedAt, now)) await updateJob(id, { overdueAlertedAt: Timestamp.fromDate(now) }, `El complemento ${job.provider === "IQ" ? `del depósito IQ ${job.depositId}` : `de la aplicación ${job.applicationId}`} lleva 7 días sin recibirse. Solicítalo por WhatsApp al proveedor; PAY0 continuará la revisión diaria. No se envió WhatsApp automáticamente.`);
}

export const enqueueAutomaticPaymentComplement = onDocumentWritten({ document: "pagoAplicaciones/{applicationId}", region: "us-central1", retry: true }, async event => {
  const app = event.data?.after.data();
  if (!app || app.status !== "APLICADA" || app.invoiceType !== "PPD") {
    const old = event.data?.before.data();
    if (old?.rootId) {
      const source = (await db.doc(`paymentComplementRequests/${complementRequestId(old.rootId, event.params.applicationId)}`).get()).data();
      if (source?.automationJobId) await updateJob(source.automationJobId, { status: "REVIEW_REQUIRED", error: "REP_SOURCE_REVERSED" }, "La aplicación de pago cambió o se canceló. Revisa el complemento relacionado; no se canceló ningún CFDI automáticamente.");
    }
    return;
  }
  try { await enqueueComplement(event.params.applicationId); }
  catch (error) {
    const ref = db.doc(`paymentComplementRequests/${complementRequestId(app.rootId, event.params.applicationId)}`);
    if ((await ref.get()).exists) await ref.update({ automationStatus: "BLOCKED", automationError: errorCode(error) });
    else throw error;
  }
});
export const executeAutomaticPaymentComplement = onDocumentWritten({ document: "paymentComplementJobs/{jobId}", region: "us-central1", retry: true, timeoutSeconds: 540, memory: "512MiB", secrets: providers.COMPLEMENT_SECRETS }, async event => {
  if (event.data?.after.data()?.status === "QUEUED") await executeComplement(event.params.jobId);
});
export const checkPaymentComplementsDaily = onSchedule({ schedule: "0 19 * * *", timeZone: "America/Mexico_City", region: "us-central1", timeoutSeconds: 540, memory: "512MiB", secrets: providers.COMPLEMENT_SECRETS, retryCount: 0 }, async () => {
  let cursor: string | undefined;
  while (true) {
    let query = jobs().orderBy(FieldPath.documentId()).limit(50); if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const row of page.docs) {
      const job = row.data();
      if (["PREPARING", "SENDING"].includes(job.status) && Date.now() - millis(job.startedAt) > 15 * 60000) await updateJob(row.id,
        { status: job.status === "SENDING" ? "UNKNOWN" : "BLOCKED", error: "REP_INTERRUPTED" }, "El procesamiento del complemento se interrumpió. Se requiere revisión; no se repetirá el envío automáticamente.");
      if (job.provider === "IQ" && ["QUEUED", "PAUSED"].includes(job.status)) await executeComplement(row.id);
      await checkComplementDaily(row.id);
    }
    if (page.size < 50) return; cursor = page.docs.at(-1)?.id;
  }
});

export const configurePaymentComplementAutomation = onCall({ region: "us-central1", cors: true }, async request => {
  const { rootId } = await context(request);
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
    tx.update(pagoRef, { paymentForm, paymentFormConfirmedBy: request.auth!.uid, paymentFormConfirmedAt: FieldValue.serverTimestamp() });
    tx.update(jobRef, { status: "QUEUED", error: null, updatedAt: FieldValue.serverTimestamp() });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId, actorUid: request.auth!.uid, actorRole: "superadmin",
      referenceId: source.pagoId, referenceType: "pago", description: "Forma de pago SAT confirmada por Superadmin; complemento vuelve a validación antes de emisión." });
  });
  return { ok: true };
});
