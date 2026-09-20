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
    if (config.iqEnabled !== true || app.iqApplicationStatus !== "IQ_APPLIED" || app.iqActionExecuted !== true || !app.iqPlanId) return;
    const plan = (await db.doc(`pagoApplicationIqPlans/${app.iqPlanId}`).get()).data();
    if (!plan || plan.rootId !== app.rootId || plan.pagoId !== app.pagoId) throw Error("REP_IQ_PLAN_SCOPE");
    depositId = text(plan.plan?.pagoIqFolio || plan.pagoIqFolio); profileId = text(plan.iqExecutionProfileId);
    const attempt = (await db.doc(`pagoApplicationIqAttempts/${app.iqExecutionAttemptId}`).get()).data();
    if (!attempt || attempt.rootId !== app.rootId || attempt.profileId !== profileId || attempt.planId !== app.iqPlanId) throw Error("REP_IQ_ATTEMPT_SCOPE");
    actorUid = text(attempt.createdBy);
    if (!/^\d{3,20}$/.test(depositId) || !profileId) throw Error("REP_IQ_DEPOSIT_REQUIRED");
  } else if (config.facturamaEnabled !== true || solicitud.facturamaEnvironment !== "PRODUCTION" || !solicitud.facturamaInvoiceId) return;
  const id = hash(`${app.rootId}:${provider}:${provider === "IQ" ? `${profileId}:${depositId}` : applicationId}`);
  await db.runTransaction(async tx => {
    const jobRef = jobs().doc(id), existing = await tx.get(jobRef), latest = await tx.get(ref);
    if (latest.data()?.automationJobId === id) return;
    if (existing.exists && existing.data()?.rootId !== app.rootId) throw Error("REP_JOB_SCOPE");
    if (!existing.exists) tx.create(jobRef, { rootId: app.rootId, provider, depositId, profileId, actorUid, clientId: solicitud.clienteId,
      applicationId, status: "QUEUED", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    // A late application must be checked against the received REP. Never
    // interpret a previous request as evidence that this new partiality exists.
    if (existing.data()?.status === "RECEIVED") tx.update(jobRef, { status: "REQUESTED", updatedAt: FieldValue.serverTimestamp() });
    tx.update(ref, { automationJobId: id, automationStatus: existing.data()?.status === "RECEIVED" ? "REQUESTED" : existing.data()?.status || "QUEUED" });
  });
}

export async function executeComplement(id: string, adapter = providers) {
  const ref = jobs().doc(id);
  const job = await db.runTransaction(async tx => {
    const snap = await tx.get(ref), row = snap.data();
    if (!row || row.status !== "QUEUED") return null;
    const config = (await tx.get(db.doc(`paymentComplementConfigs/${row.rootId}`))).data();
    if (config?.[row.provider === "IQ" ? "iqEnabled" : "facturamaEnabled"] !== true) return null;
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
      const session = await adapter.iqSession(job);
      const state = await adapter.preflightIqComplement(job, session);
      if (state === "AVAILABLE") { await updateJob(id, { status: "REQUESTED", alreadyAvailable: true }, "IQ ya tiene un REP disponible; se verificará y descargará a las 19:00, sin duplicar la solicitud."); return; }
      await sourceFor(job.applicationId);
      await updateJob(id, { status: "SENDING", attemptedAt: FieldValue.serverTimestamp() }); sending = true;
      await adapter.requestIqComplement(job, session);
      await updateJob(id, { status: "REQUESTED", requestedAt: FieldValue.serverTimestamp(), error: null }, "Complemento solicitado a IQ. Se revisará diariamente a las 19:00; no significa que ya esté emitido.");
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
  for (const { source, documents } of rows) await db.doc(`paymentComplementRequests/${complementRequestId(source.rootId, source.applicationId)}`).update({ ...documents, status: "RECEIVED", automationStatus: "RECEIVED", receivedAt: FieldValue.serverTimestamp() });
  await updateJob(id, { status: "RECEIVED", error: null }, "Complemento recibido y validado contra UUID, parcialidad e importes; XML y PDF vinculados al pago correspondiente.");
}

export async function checkComplementDaily(id: string, now = new Date(), adapter = providers) {
  const ref = jobs().doc(id), day = dayMexico(now);
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
      const session = await adapter.iqSession(job), url = await adapter.availableIqComplement(job, session);
      if (url) { await markReceived(id, await adapter.importIqComplement(url, sources)); return; }
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
      activatedAt: existing.data()?.activatedAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: request.auth!.uid });
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
