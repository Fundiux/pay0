import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../sharedCallables/helpers";
import { logActivityTx } from "../../utils/logActivity";
import { assessLocalIqRecovery } from "./complementRecoveryPlan";
import { claimIqComplementCanaryLookup, inspectIqComplementGate } from "./complementGates";
import { assertSource, dayMexico, millis, text } from "./complementPolicy";
import { verifiedDocuments } from "./complementCanary";
import * as providers from "./complementProviders";

const pending = new Set(["PENDING", "PENDING_B", "PENDING_PROVIDER_CONTRACT"]);
const code = (error: any) => /^[A-Z0-9_]+$/.test(error?.message || "") ? error.message : "REP_B_DAILY_FAILED";
// The daily 19:00 run may start seconds late. Eligibility before the next
// day's run avoids accidentally turning a daily check into a 48-hour check.
// lastBCheckDay still enforces at most one observation per Mexico civil day.
const tomorrow = (now: Date) => Timestamp.fromMillis(now.getTime() + 12 * 60 * 60 * 1000);

function eligible(row: any, now: Date) {
  return row?.provider === "IQ" && row.rootId && row.applicationId && pending.has(row.status) &&
    row.externalRequestSent === false && !row.requestedAt && !row.automationJobId &&
    row.nextCheckAt && millis(row.nextCheckAt) > 0 && millis(row.nextCheckAt) <= now.getTime() &&
    (row.status === "PENDING_B" || ["REP_ATTACHMENT_NOT_AVAILABLE", "REP_ATTACHMENT_AVAILABLE"].includes(row.repAttachmentStatus)) &&
    row.bReadState !== "EXCEPTION" && row.lastBCheckDay !== dayMexico(now);
}

async function finishBlocked(requestId: string, rootId: string, now: Date, reason: string) {
  const ref = db.doc(`paymentComplementRequests/${requestId}`);
  await db.runTransaction(async tx => {
    const row = (await tx.get(ref)).data();
    if (!row || row.rootId !== rootId || !pending.has(row.status) || row.externalRequestSent !== false || row.automationJobId) return;
    tx.update(ref, { status: "PENDING_B", automationStatus: "BLOCKED", bReadState: "BLOCKED", bReadReason: reason,
      nextCheckAt: tomorrow(now), updatedAt: FieldValue.serverTimestamp() });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: requestId, referenceType: "complementoPago", description: `Revisión B bloqueada por ${reason}; sin consulta ni solicitud C.` });
  });
}

async function finishException(requestId: string, rootId: string, reason: string, responseShape?: any) {
  const ref = db.doc(`paymentComplementRequests/${requestId}`);
  await db.runTransaction(async tx => {
    const row = (await tx.get(ref)).data();
    if (!row || row.rootId !== rootId || !pending.has(row.status) || row.externalRequestSent !== false || row.automationJobId) return;
    tx.update(ref, { status: "PENDING_B", automationStatus: "BLOCKED", bReadState: "EXCEPTION", bReadReason: reason,
      ...(responseShape ? { lastBResponse: responseShape } : {}), nextCheckAt: null, updatedAt: FieldValue.serverTimestamp() });
    logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId, actorUid: "SYSTEM", actorRole: "system",
      referenceId: requestId, referenceType: "complementoPago", description: `Revisión B detenida por ${reason}; excepción aislada y sin solicitud C.` });
  });
}

export async function checkDueIqFollowup(requestId: string, now = new Date(), adapter = providers) {
  const ref = db.doc(`paymentComplementRequests/${requestId}`), initial = (await ref.get()).data();
  if (!initial || !eligible(initial, now)) return "SKIPPED";
  const rootId = initial.rootId;
  const preview = await assessLocalIqRecovery(rootId, initial.applicationId);
  if (preview.state === "GATE_BLOCKED") { await finishBlocked(requestId, rootId, now, preview.reason); return "BLOCKED"; }
  if (preview.state !== "READY_FOR_IQ_LOOKUP") { await finishException(requestId, rootId, preview.reason); return "EXCEPTION"; }
  const app = (await db.doc(`pagoAplicaciones/${initial.applicationId}`).get()).data();
  if (!app || app.rootId !== rootId || app.iqApplicationStatus !== "IQ_APPLIED" || app.iqActionExecuted !== true)
    { await finishException(requestId, rootId, "REP_IQ_APPLICATION_CHANGED"); return "EXCEPTION"; }
  const [solicitudSnap, pagoSnap, planSnap, attemptSnap] = await Promise.all([
    db.doc(`solicitudes/${app.solicitudId}`).get(), db.doc(`pagos/${app.pagoId}`).get(),
    db.doc(`pagoApplicationIqPlans/${app.iqPlanId}`).get(), db.doc(`pagoApplicationIqAttempts/${app.iqExecutionAttemptId}`).get(),
  ]);
  const solicitud = solicitudSnap.data(), pago = pagoSnap.data(), plan = planSnap.data(), attempt = attemptSnap.data();
  try { assertSource(rootId, app, solicitud, pago); } catch (error) { await finishException(requestId, rootId, code(error)); return "EXCEPTION"; }
  if (!plan || plan.rootId !== rootId || plan.pagoId !== app.pagoId || !attempt || attempt.rootId !== rootId ||
      attempt.planId !== app.iqPlanId || attempt.profileId !== plan.iqExecutionProfileId || !pago?.moneda)
    { await finishException(requestId, rootId, "REP_IQ_CONTEXT_CHANGED"); return "EXCEPTION"; }
  const job = { rootId, provider: "IQ", applicationId: initial.applicationId, profileId: text(plan.iqExecutionProfileId),
    depositId: text(plan.plan?.pagoIqFolio || plan.pagoIqFolio), actorUid: text(attempt.createdBy), clientId: text(solicitud?.clienteId) };
  if (!/^\d{3,20}$/.test(job.depositId) || !job.profileId || !job.actorUid || !job.clientId)
    { await finishException(requestId, rootId, "REP_IQ_CONTEXT_CHANGED"); return "EXCEPTION"; }
  const claimed = await db.runTransaction(async tx => {
    const row = (await tx.get(ref)).data();
    if (!row || !eligible(row, now) || row.rootId !== rootId || row.fingerprint !== initial.fingerprint) return false;
    tx.update(ref, { lastBCheckDay: dayMexico(now), lastBCheckAt: Timestamp.fromDate(now), bReadState: "CHECKING",
      bReadReason: null, updatedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return "SKIPPED";
  try {
    const gate = await inspectIqComplementGate(job, "LOOKUP");
    if (!gate.allowed) { await finishBlocked(requestId, rootId, now, gate.reason); return "BLOCKED"; }
    const quota = await claimIqComplementCanaryLookup(job, `${requestId}:${dayMexico(now)}:ATTACHMENT`, now);
    if (!quota.allowed) { await finishBlocked(requestId, rootId, now, quota.reason); return "BLOCKED"; }
    const session = await adapter.iqSession(job, "LOOKUP");
    const beforeGet = await inspectIqComplementGate(job, "LOOKUP");
    if (!beforeGet.allowed) { await finishBlocked(requestId, rootId, now, beforeGet.reason); return "BLOCKED"; }
    const attachment = await adapter.observeIqRepAttachment(job, session);
    if (attachment.classification === "REP_ATTACHMENT_AMBIGUOUS") {
      await finishException(requestId, rootId, "REP_ATTACHMENT_AMBIGUOUS", attachment.shape); return "EXCEPTION";
    }
    if (attachment.classification === "REP_ATTACHMENT_NOT_AVAILABLE") {
      await db.runTransaction(async tx => {
        const row = (await tx.get(ref)).data();
        if (!row || row.rootId !== rootId || row.fingerprint !== initial.fingerprint || row.externalRequestSent !== false ||
            row.automationJobId || !pending.has(row.status)) throw Error("REP_B_FOLLOWUP_CHANGED");
        tx.update(ref, { status: "PENDING_B", automationStatus: "PENDING_B", bReadState: "WAITING_B", bReadReason: null,
          repGenerationStatus: "REP_GENERATION_UNKNOWN", repAttachmentStatus: "REP_ATTACHMENT_NOT_AVAILABLE",
          nextCheckAt: tomorrow(now), lastIqReadAt: FieldValue.serverTimestamp(), lastIqReadResult: "NO_REP_ATTACHED_TO_RESOURCE",
          lastBResponse: attachment.shape, updatedAt: FieldValue.serverTimestamp() });
        logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId, actorUid: "SYSTEM", actorRole: "system",
          referenceId: requestId, referenceType: "complementoPago", description: `Hugo B revisó depósito ${job.depositId}: adjunto ausente; próxima revisión diaria, sin solicitud C.` });
      });
      return "WAITING_B";
    }
    if (attachment.classification !== "REP_ATTACHMENT_AVAILABLE" || !attachment.url) {
      await finishException(requestId, rootId, "REP_ATTACHMENT_AMBIGUOUS", attachment.shape); return "EXCEPTION";
    }
    await ref.update({ bReadState: "ATTACHMENT_AVAILABLE", repAttachmentStatus: "REP_ATTACHMENT_AVAILABLE",
      lastBResponse: attachment.shape, updatedAt: FieldValue.serverTimestamp() });
    const downloadQuota = await claimIqComplementCanaryLookup(job, `${requestId}:${dayMexico(now)}:DOWNLOAD`, now);
    if (!downloadQuota.allowed) { await finishBlocked(requestId, rootId, now, downloadQuota.reason); return "BLOCKED"; }
    const downloadGate = await inspectIqComplementGate(job, "LOOKUP");
    if (!downloadGate.allowed) { await finishBlocked(requestId, rootId, now, downloadGate.reason); return "BLOCKED"; }
    const source: Record<string, any> = { ...initial, currency: text(pago.moneda).toUpperCase() };
    const imported = await adapter.importIqComplement(attachment.url, [source], job);
    if (imported.length !== 1 || imported[0].source.applicationId !== initial.applicationId) throw Error("REP_B_DOCUMENT_AMBIGUOUS");
    const documents = imported[0].documents;
    const verification = await verifiedDocuments(rootId, source, documents);
    await db.runTransaction(async tx => {
      const row = (await tx.get(ref)).data();
      if (!row || row.rootId !== rootId || row.fingerprint !== initial.fingerprint || row.externalRequestSent !== false ||
          row.automationJobId || !pending.has(row.status) || row.invoiceUuid !== source.invoiceUuid ||
          row.installment !== source.installment || row.amountMinor !== source.amountMinor ||
          row.balanceBefore !== source.balanceBefore || row.balanceAfter !== source.balanceAfter)
        throw Error("REP_B_FOLLOWUP_CHANGED");
      tx.update(ref, { ...documents, status: "RECEIVED", automationStatus: "RECEIVED", automationError: null,
        bReadState: "REP_VALIDATED", bReadReason: null, repAttachmentStatus: "REP_VALIDATED", nextCheckAt: null,
        receivedAt: FieldValue.serverTimestamp(), lastIqReadAt: FieldValue.serverTimestamp(), lastIqReadResult: "REP_VERIFIED",
        verification, updatedAt: FieldValue.serverTimestamp() });
      logActivityTx(tx, db, { event: "COMPLEMENTO_PAGO_SEGUIMIENTO", rootId, actorUid: "SYSTEM", actorRole: "system",
        referenceId: requestId, referenceType: "complementoPago", description: `Hugo B: REP ${documents.uuid} descargado, validado, vinculado y releído; sin solicitud C.` });
    });
    return "RECEIVED";
  } catch (error) {
    const failure = code(error);
    if (["REP_IQ_PERMISSION_REQUIRED", "REP_IQ_PROFILE_CHANGED"].includes(failure) || failure.startsWith("REP_GATE_")) {
      await finishBlocked(requestId, rootId, now, failure); return "BLOCKED";
    }
    await finishException(requestId, rootId, failure); return "EXCEPTION";
  }
}

// Called by the existing 19:00 scheduler before its job pass. A bounded scan
// advances over unrelated/job-linked requests without starving due B cases.
export async function scanDueIqFollowups(now = new Date(), adapter = providers, maxCases = 10) {
  const due = Timestamp.fromDate(now);
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let pages = 0, selected = 0;
  const outcomes: Record<string, number> = {};
  while (selected < maxCases && pages < 20) {
    let query = db.collection("paymentComplementRequests").where("nextCheckAt", "<=", due).orderBy("nextCheckAt").limit(50);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get(); pages++;
    for (const row of page.docs) {
      if (!eligible(row.data(), now)) continue;
      selected++;
      let result: string;
      try { result = await checkDueIqFollowup(row.id, now, adapter); }
      catch (error) {
        try { await finishException(row.id, row.data().rootId, code(error)); } catch { /* Keep the next daily attempt if Firestore is unavailable. */ }
        result = "EXCEPTION";
      }
      outcomes[result] = (outcomes[result] || 0) + 1;
      if (selected >= maxCases) break;
    }
    if (page.size < 50 || selected >= maxCases) break;
    cursor = page.docs.at(-1);
  }
  return { selected, pages, outcomes };
}
