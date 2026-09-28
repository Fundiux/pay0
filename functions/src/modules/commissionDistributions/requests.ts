import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { commissionAccountActor } from "./userDestinations";
import { materializeCommissionDistribution, preflightCommissionDistribution } from "./service";
import { reserveUserCommissionWithdrawal } from "./withdrawal";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
/** Manual and daily preparation share the same request and immutable destination snapshot.
 * Reservation uses the USER ledger and source-client balance through the canonical dispersion pipeline.
 * Preparation alone never reserves funds; execution is a separate authorized, idempotent step.
 */
export async function requestUserCommissionDispersionCore(input: { rootId: string; paymentId: string; ownerUid: string; actorUid: string; source: "MANUAL" | "DAILY"; now?: number; reserve?: boolean; acceptTotalDebitMinor?: number }) {
  const result: any = await materializeCommissionDistribution({ paymentId: input.paymentId, ownerUid: input.ownerUid, actorUid: input.actorUid, expectedRootId: input.rootId });
  if (!result.distributionId) return result;
  const preflight = await preflightCommissionDistribution({ distributionId: result.distributionId, actorUid: input.actorUid, now: input.now });
  if (preflight.status === "READY_FOR_EXECUTION" && (input.source === "MANUAL" || input.reserve === true)) {
    const reserved = await reserveUserCommissionWithdrawal({ distributionId: result.distributionId, rootId: input.rootId, ownerUid: input.ownerUid, actorUid: input.actorUid, source: input.source, acceptTotalDebitMinor: input.acceptTotalDebitMinor });
    return { ...reserved, distributionId: result.distributionId, preflightStatus: preflight.status, executionEnabled: false, externalActions: 0 };
  }
  const ref = db.doc(`commissionDispersionRequests/${result.distributionId}`);
  const request: any = await db.runTransaction(async tx => {
    const [existing, distribution] = await Promise.all([tx.get(ref), tx.get(db.doc(`commissionDistributions/${result.distributionId}`))]);
    if (existing.exists) return { ...existing.data(), idempotent: true };
    const data = distribution.data();
    if (!data || data.rootId !== input.rootId || data.ownerUid !== input.ownerUid || data.sourceType !== "USER_EARNINGS") throw new Error("Distribución fuera de alcance.");
    const payload = { rootId: input.rootId, clientId: data.clientId, ownerUid: input.ownerUid, paymentId: input.paymentId, distributionId: result.distributionId, financialSnapshotId: data.financialSnapshotId, fundingHolderType: "USER", totalAmountMinor: data.totalCommissionMinor, destinationSnapshot: data.legs, status: preflight.status === "READY_FOR_EXECUTION" ? "PREPARED" : "BLOCKED_PREFLIGHT", executionEnabled: false, externalActions: 0, source: input.source, createdBy: input.actorUid, createdAt: admin.firestore.FieldValue.serverTimestamp() };
    tx.create(ref, payload);
    tx.create(db.collection("commissionAuditEvents").doc(), { rootId: input.rootId, clientId: data.clientId, ownerUid: input.ownerUid, distributionId: result.distributionId, event: "USER_COMMISSION_DISPERSION_REQUESTED", status: payload.status, source: input.source, actorUid: input.actorUid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return { ...payload, idempotent: false };
  });
  return { ok: true, distributionId: result.distributionId, requestId: result.distributionId, status: request.status, idempotent: request.idempotent, preflightStatus: preflight.status, executionEnabled: false, externalActions: 0 };
}
export const requestUserCommissionDispersion = onCall({ cors: true, timeoutSeconds: 120 }, async request => {
  const actor = await commissionAccountActor(request), paymentId = String(request.data?.paymentId || "").trim();
  if (!paymentId || paymentId.includes("/")) throw new HttpsError("invalid-argument", "Pago requerido.");
  const ownerUid = String(request.data?.ownerUid || actor.uid).trim();
  if (ownerUid !== actor.uid && actor.role !== "superadmin") throw new HttpsError("permission-denied", "Sólo puedes solicitar tu propia comisión.");
  try { return await requestUserCommissionDispersionCore({ rootId: actor.rootId, paymentId, ownerUid, actorUid: actor.uid, source: "MANUAL", acceptTotalDebitMinor: Number(request.data?.acceptTotalDebitMinor) }); }
  catch (error: any) { throw new HttpsError("failed-precondition", error.message || "La comisión requiere revisión."); }
});

export const previewUserCommissionWithdrawal = onCall({ cors: true, timeoutSeconds: 120 }, async request => {
  const actor = await commissionAccountActor(request), reference = String(request.data?.paymentId || "").trim();
  if (!reference || reference.includes("/")) throw new HttpsError("invalid-argument", "Folio de pago requerido.");
  let paymentId = reference;
  const direct = await db.doc(`pagos/${reference}`).get();
  if (!direct.exists || direct.data()?.rootId !== actor.rootId) {
    const matches = await db.collection("pagos").where("rootId", "==", actor.rootId).where("folio", "==", reference).limit(2).get();
    if (matches.size !== 1) throw new HttpsError("failed-precondition", "No se encontró un pago único con ese folio.");
    paymentId = matches.docs[0].id;
  }
  const clientId = String(request.data?.clientId || "").trim();
  const payment = (await db.doc(`pagos/${paymentId}`).get()).data();
  if (clientId && String(payment?.clienteId || payment?.clientId || "") !== clientId) throw new HttpsError("failed-precondition", "El pago no corresponde al cliente seleccionado.");
  const result: any = await materializeCommissionDistribution({ paymentId, actorUid: actor.uid, ownerUid: actor.uid, expectedRootId: actor.rootId });
  if (!result.distributionId) throw new HttpsError("failed-precondition", "No hay configuración vigente para la utilidad de ese pago.");
  return { ...await reserveUserCommissionWithdrawal({ distributionId: result.distributionId, rootId: actor.rootId, ownerUid: actor.uid, actorUid: actor.uid, source: "MANUAL", dryRun: true }), paymentId };
});
