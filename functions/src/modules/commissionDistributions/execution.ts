import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { assertCommissionWithdrawalOwner, commissionAccountActor } from "./userDestinations";
import { preflightCommissionDistribution } from "./service";
import { reverseCanonicalDispersionFinancialsTx } from "../financing/dispersionFinancial";
import { releaseForwardOnlyDispersionTx } from "../dispatchBalances/forwardOnly";
import { assertUserDispersionCanRelease } from "../financing/dispersionFunding";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore(), timestamp = admin.firestore.FieldValue.serverTimestamp;
export const USER_COMMISSION_IQ_SECRET = defineSecret("IQ_CREDENTIALS_KEY");
type ExecutionInput = { requestId: string; rootId: string; ownerUid: string; actorUid: string };
export type CommissionExecutor = (input: { auth: { uid: string; rootId: string; role: string; username: string }; dispersionId: string; allowCommissionExecution: true; previewOnly: false }) => Promise<any>;

async function scopedRequest(input: ExecutionInput) {
  const ref = db.doc(`commissionDispersionRequests/${input.requestId}`), snap = await ref.get(), request = snap.data();
  if (!request || request.rootId !== input.rootId || request.ownerUid !== input.ownerUid || !Array.isArray(request.principalIds) || !request.principalIds.length) throw new HttpsError("permission-denied", "Solicitud reservada fuera de alcance.");
  return { ref, request };
}

/** Both manual execution and configured automation call the canonical IQ executor. */
export async function executeUserCommissionRequestCore(input: ExecutionInput, executor?: CommissionExecutor) {
  const { ref, request } = await scopedRequest(input);
  if (["COMPLETED", "UNCERTAIN", "PROCESSING", "CANCELLED", "CANCELLING"].includes(request.status)) return { ok: true, idempotent: true, requestId: ref.id, status: request.status };
  const claimed = await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.data()?.status !== "RESERVED_AWAITING_EXECUTION") return false;
    tx.update(ref, { status: "PROCESSING", executionStartedAt: timestamp(), executionActorUid: input.actorUid });
    for (const principalId of request.principalIds) tx.update(db.doc(`clientDispersions/${principalId}`), { commissionExecutionStatus: "PROCESSING" });
    return true;
  });
  if (!claimed) return { ok: true, idempotent: true, requestId: ref.id, status: (await ref.get()).data()?.status };
  let owner: any;
  try {
    const preflight = await preflightCommissionDistribution({ distributionId: request.distributionId, actorUid: input.actorUid });
    if (preflight.status !== "READY_FOR_EXECUTION") throw new HttpsError("failed-precondition", "El preflight de la comisión requiere revisión.");
    owner = (await db.doc(`users/${input.ownerUid}`).get()).data();
    assertCommissionWithdrawalOwner(input.ownerUid, owner, input.rootId);
  } catch (error) {
    // No executor has run yet: a validation failure can safely return to its reserved state.
    const batch = db.batch();
    batch.update(ref, { status: "RESERVED_AWAITING_EXECUTION", validationFailedAt: timestamp() });
    for (const principalId of request.principalIds) batch.update(db.doc(`clientDispersions/${principalId}`), { commissionExecutionStatus: "RESERVED" });
    await batch.commit();
    throw error;
  }
  const run = executor || (await import("../iq/dispersionCreationCallables")).runCreateClientDispersionIqCore;
  const outcomes: Array<{ principalId: string; status: string; iqFolio: string | null }> = [];
  for (const principalId of request.principalIds) {
    try {
      const principal = (await db.doc(`clientDispersions/${principalId}`).get()).data();
      if (!principal || principal.fundingSource?.holderType !== "USER" || principal.fundingSource.ownerUid !== input.ownerUid || principal.fundingSource.sourceClientId !== request.clientId || principal.commissionDistributionId !== request.distributionId || principal.reservationReleased) throw new Error("Reservation changed");
      const response = await run({ auth: { uid: input.ownerUid, rootId: input.rootId, role: owner.role, username: String(owner.username || input.ownerUid) }, dispersionId: principalId, allowCommissionExecution: true, previewOnly: false });
      const results = response?.data?.results;
      const complete = Array.isArray(results) && results.length > 0 && results.every(row => row.iqId && ["CREATED", "CREATED_PENDING_FOLIO"].includes(row.status));
      outcomes.push({ principalId, status: complete ? "COMPLETED" : "UNCERTAIN", iqFolio: complete ? String(results[0].iqId) : null });
      if (!complete) break;
    } catch { outcomes.push({ principalId, status: "UNCERTAIN", iqFolio: null }); break; }
  }
  const completed = outcomes.length === request.principalIds.length && outcomes.every(row => row.status === "COMPLETED");
  const status = completed ? "COMPLETED" : "UNCERTAIN";
  await db.runTransaction(async tx => {
    const distributionRef = db.doc(`commissionDistributions/${request.distributionId}`), distribution = await tx.get(distributionRef);
    if (!distribution.exists) throw new Error("Historical distribution missing");
    tx.update(ref, { status, outcomes, retryBlocked: true, executionFinishedAt: timestamp() });
    for (const outcome of outcomes) tx.update(db.doc(`clientDispersions/${outcome.principalId}`), { commissionExecutionStatus: outcome.status });
    tx.update(distributionRef, { status, legs: (distribution.data()?.legs || []).map((leg: any) => { const outcome = outcomes.find(row => row.principalId === leg.canonicalDispersionId); return outcome ? { ...leg, status: outcome.status, iqFolio: outcome.iqFolio, retryBlocked: true } : leg; }), updatedAt: timestamp() });
    tx.create(db.collection("commissionAuditEvents").doc(), { rootId: input.rootId, ownerUid: input.ownerUid, distributionId: request.distributionId, event: "USER_COMMISSION_EXECUTION_RECORDED", status, actorUid: input.actorUid, createdAt: timestamp() });
  });
  return { ok: true, requestId: ref.id, status, retryBlocked: true };
}

export async function cancelUserCommissionRequestCore(input: ExecutionInput) {
  const { ref, request } = await scopedRequest(input);
  const claim = await db.runTransaction(async tx => {
    const current = await tx.get(ref), data = current.data();
    if (data?.status === "CANCELLED") return false;
    if (!["RESERVED_AWAITING_EXECUTION", "CANCELLING"].includes(data?.status)) throw new HttpsError("failed-precondition", "La solicitud ya fue enviada o requiere conciliación; no puede cancelarse automáticamente.");
    for (const principalId of request.principalIds) {
      const principal = await tx.get(db.doc(`clientDispersions/${principalId}`));
      const legs = await tx.get(db.collection("clientDispersionLegs").where("principalDispersionId", "==", principalId));
      assertUserDispersionCanRelease(principal.data(), legs.docs.map(doc => doc.data()));
    }
    tx.update(ref, { status: "CANCELLING", updatedAt: timestamp() });
    return true;
  });
  if (!claim) return { ok: true, idempotent: true, status: "CANCELLED" };
  for (const principalId of request.principalIds) {
    const principalRef = db.doc(`clientDispersions/${principalId}`);
    await db.runTransaction(async tx => {
      const principal = await tx.get(principalRef), data = principal.data();
      if (!data || data.fundingSource?.holderType !== "USER" || data.fundingSource.ownerUid !== input.ownerUid || data.commissionDistributionId !== request.distributionId) throw new Error("Principal fuera de alcance");
      await reverseCanonicalDispersionFinancialsTx({ tx, db, dispersion: data, dispersionId: principalId, actorUid: input.actorUid, actorUsername: input.actorUid, decision: "CANCELACION_APLICADA" });
      tx.update(principalRef, { status: "CANCELADA", updatedAt: timestamp() });
    });
    // Same idempotent release used by the terminal trigger; retry finishes a partial cancellation.
    await db.runTransaction(async tx => { const current = await tx.get(principalRef); await releaseForwardOnlyDispersionTx({ tx, db, dispersionRef: principalRef, dispersion: current.data()!, actorUsername: input.actorUid }); });
  }
  await db.runTransaction(async tx => {
    const distributionRef = db.doc(`commissionDistributions/${request.distributionId}`), distribution = await tx.get(distributionRef);
    tx.update(ref, { status: "CANCELLED", cancelledBy: input.actorUid, cancelledAt: timestamp() });
    tx.update(distributionRef, { status: "CANCELLED", legs: (distribution.data()?.legs || []).map((leg: any) => ({ ...leg, status: "CANCELLED", retryBlocked: true })), updatedAt: timestamp() });
  });
  return { ok: true, idempotent: false, status: "CANCELLED" };
}

async function authorizedExecutionInput(request: any): Promise<ExecutionInput> {
  const actor = await commissionAccountActor(request), requestId = String(request.data?.requestId || "").trim();
  if (!requestId || requestId.includes("/")) throw new HttpsError("invalid-argument", "Solicitud requerida.");
  const stored = (await db.doc(`commissionDispersionRequests/${requestId}`).get()).data();
  if (!stored || stored.rootId !== actor.rootId || (stored.ownerUid !== actor.uid && actor.role !== "superadmin")) throw new HttpsError("permission-denied", "Solicitud fuera de alcance.");
  return { requestId, rootId: actor.rootId, ownerUid: stored.ownerUid, actorUid: actor.uid };
}
export const executeUserCommissionDispersion = onCall({ cors: true, timeoutSeconds: 540, memory: "2GiB", maxInstances: 2, secrets: [USER_COMMISSION_IQ_SECRET] }, async request => executeUserCommissionRequestCore(await authorizedExecutionInput(request)));
export const cancelUserCommissionDispersion = onCall({ cors: true, timeoutSeconds: 120 }, async request => cancelUserCommissionRequestCore(await authorizedExecutionInput(request)));
