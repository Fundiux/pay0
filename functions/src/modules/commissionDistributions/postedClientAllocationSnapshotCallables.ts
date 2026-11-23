import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { calculateClientCommissionInstructions, type ClientCommissionInstruction } from "./clientAllocation";
import { canonicalUserCommission, evaluateIqLink, isPostedCommissionPayment } from "./domain";
import { personalCommissionIqLinkId } from "./personalAllocationMirror";
import { postedClientOperationBaseMinor, postedClientIqOrigin, hasExactPublishedPersonalCommissionDestination } from "./postedClientAllocationPreview";
import { commissionAccountActor, commissionConfigurationAt, commissionMillis, commissionSettingsId } from "./userDestinations";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore(), timestamp = admin.firestore.FieldValue.serverTimestamp;
const id = (value: unknown) => {
  const v = String(value || "").trim();
  if (!v || v.length > 128 || v.includes("/")) throw new HttpsError("invalid-argument", "Referencia inválida.");
  return v;
};
export function personalCommissionCalculationId(rootId: string, clientId: string, ownerUid: string, paymentId: string) {
  return createHash("sha256").update(JSON.stringify(["PERSONAL_CLIENT_ALLOCATION_V1", rootId, clientId, ownerUid, paymentId])).digest("hex");
}
/**
 * Immutable, idempotent snapshot of personal commission allocations for a posted payment.
 * NO money movements, reservations, legacy rule changes or external IQ submissions.
 * Only rules published BEFORE the financial posting may apply (prospective-only).
 */
export const materializePostedClientCommissionAllocation = onCall({ cors: true, timeoutSeconds: 120 }, async request => {
  const actor = await commissionAccountActor(request, true);
  const clientId = id(request.data?.clientId), ownerUid = id(request.data?.ownerUid), paymentId = id(request.data?.paymentId);
  const recordId = personalCommissionCalculationId(actor.rootId, clientId, ownerUid, paymentId);
  const recordRef = db.doc(`clientCommissionAllocationCalculations/${recordId}`);
  const [previous, clientSnap, ownerSnap, paymentSnap] = await Promise.all([
    recordRef.get(), db.doc(`clients/${clientId}`).get(), db.doc(`users/${ownerUid}`).get(),
    db.doc(`pagos/${paymentId}`).get(),
  ]);
  const client = clientSnap.data(), owner = ownerSnap.data(), payment = paymentSnap.data();
  if (!client || client.rootId !== actor.rootId || !owner ||
      String(owner.rootId || ownerUid) !== actor.rootId || owner.active === false ||
      owner.isActive === false || owner.isDeleted === true || owner.deleted === true ||
      owner.disabled === true || !!owner.deletedAt) throw new HttpsError("permission-denied", "Cliente o titular fuera de alcance.");
  if (!payment || payment.rootId !== actor.rootId || String(payment.clienteId || payment.clientId || "") !== clientId ||
      !isPostedCommissionPayment(payment)) throw new HttpsError("failed-precondition", "Pago no contabilizado para este cliente.");
  if (previous.exists) {
    if (previous.data()?.rootId !== actor.rootId || previous.data()?.clientId !== clientId || previous.data()?.ownerUid !== ownerUid || previous.data()?.paymentId !== paymentId)
      throw new HttpsError("permission-denied", "Expediente fuera de alcance.");
    return { ok: true, idempotent: true, recordId, status: "CALCULATED_NOT_EXECUTABLE" };
  }
  const snapshotId = id(payment.financialSnapshotId);
  const snapshotRef = db.doc(`paymentFinancialSnapshots/${snapshotId}`);
  const snapshot = (await snapshotRef.get()).data();
  if (!snapshot || snapshot.rootId !== actor.rootId || snapshot.clienteId !== clientId ||
      snapshot.pagoId !== paymentId || String(snapshot.currency || payment.moneda || "MXN") !== "MXN") {
    throw new HttpsError("failed-precondition", "Snapshot financiero inválido para MXN.");
  }
  const sourceDespachoId = postedClientIqOrigin({ rootId: actor.rootId, clientId, paymentId, payment, snapshot });
  if (!sourceDespachoId) {
    throw new HttpsError("failed-precondition", "El origen IQ contradice el registro financiero del pago.");
  }
  const postedAtMs = commissionMillis(snapshot.createdAt);
  if (!(postedAtMs > 0)) throw new HttpsError("failed-precondition", "No hay fecha de contabilización.");
  const key = commissionSettingsId(actor.rootId, clientId, ownerUid);
  const rule = await commissionConfigurationAt("clientCommissionAllocationRules", "clientCommissionAllocationHistory", key, postedAtMs);
  if (!rule || rule.rootId !== actor.rootId || rule.clientId !== clientId || rule.ownerUid !== ownerUid ||
      rule.status !== "CONFIGURED" || rule.executionEnabled !== false ||
      commissionMillis(rule.effectiveFrom) > postedAtMs) {
    throw new HttpsError("failed-precondition", "No existía una regla prospectiva válida al contabilizar el pago.");
  }
  const instructions = rule.instructions as ClientCommissionInstruction[];
  if (!Array.isArray(instructions) || !instructions.length || instructions.length > 50) {
    throw new HttpsError("failed-precondition", "Regla sin instrucciones válidas.");
  }
  const accountIds = [...new Set(instructions.map(row => id(row.accountId)))];
  const clientIqId = String(client.iqLink?.clientId || client.iqClientId || "");
  if (!clientIqId) throw new HttpsError("failed-precondition", "Cliente sin vínculo IQ.");
  let earning: ReturnType<typeof canonicalUserCommission>;
  try { earning = canonicalUserCommission(snapshot, ownerUid); }
  catch (error: any) { throw new HttpsError("failed-precondition", error.message || "No hay utilidad válida."); }
  if (earning.earnedMinor <= 0) throw new HttpsError("failed-precondition", "No hay utilidad positiva.");
  let calculation;
  try {
    calculation = calculateClientCommissionInstructions({
      earnedMinor: earning.earnedMinor,
      operationBaseMinor: postedClientOperationBaseMinor(snapshot, earning.calculationBaseType),
      contractRateBps: earning.contractRateBps,
      instructions,
    });
  } catch (error: any) {
    throw new HttpsError("failed-precondition", error.message || "Regla incompatible con la utilidad contabilizada.");
  }
  return db.runTransaction(async tx => {
    const [existing, currentPayment, currentSnapshot, ...accounts] = await Promise.all([
      tx.get(recordRef), tx.get(paymentSnap.ref), tx.get(snapshotRef),
      ...accountIds.map(accountId => tx.get(db.doc(`personalCommissionAccounts/${accountId}`))),
    ]);
    if (existing.exists) return { ok: true, idempotent: true, recordId, status: "CALCULATED_NOT_EXECUTABLE" };
    if (!currentPayment.exists || !isPostedCommissionPayment(currentPayment.data()) ||
        currentPayment.data()?.financialSnapshotId !== snapshotId ||
        currentSnapshot.data()?.pagoId !== paymentId ||
        !postedClientIqOrigin({ rootId: actor.rootId, clientId, paymentId,
          payment: currentPayment.data(), snapshot: currentSnapshot.data() }) ||
        canonicalUserCommission(currentSnapshot.data(), ownerUid).earnedMinor !== earning.earnedMinor) {
      throw new HttpsError("aborted", "La contabilización cambió durante el cálculo.");
    }
    const iqLinks = await Promise.all(accountIds.map(accountId =>
      tx.get(db.doc(`personalCommissionIqLinks/${personalCommissionIqLinkId(actor.rootId, clientId, ownerUid, accountId)}`))));
    const now = Date.now();
    const destinationSnapshots = accounts.map((accountSnap, index) => {
      const account = accountSnap.data(), iq = iqLinks[index].data();
      if (!account || account.rootId !== actor.rootId || account.ownerUid !== ownerUid || account.active !== true ||
          !iq || iq.rootId !== actor.rootId || iq.clientId !== clientId || iq.ownerUid !== ownerUid ||
          iq.accountId !== accountSnap.id || iq.accountFingerprint !== account.instrumentFingerprint ||
          iq.last4 !== account.last4 || String(iq.iqClientId || "") !== clientIqId ||
          !iq.iqPartnerId || !iq.iqBeneficiaryId || !iq.iqAccountId || !iq.iqCredentialProfileId) {
        throw new HttpsError("failed-precondition", "Cuenta o vínculo IQ fuera de alcance.");
      }
      const link = evaluateIqLink({ status: iq.iqLinkStatus, verifiedAtMs: commissionMillis(iq.verifiedAt),
        nowMs: now, maxAgeMs: 86400000, storedLast4: iq.last4, currentLast4: account.last4 });
      if (!link.ready) throw new HttpsError("failed-precondition", "Vínculo IQ caducado o alterado.");
      const publishedDestination = (rule.destinations || []).find((d: any) => d.accountId === accountSnap.id);
      if (!hasExactPublishedPersonalCommissionDestination({
        rootId: actor.rootId, clientId, ownerUid, accountId: accountSnap.id,
        clientIqId, despachoId: sourceDespachoId, account, link: iq,
        published: publishedDestination,
      })) {
        throw new HttpsError("failed-precondition", "La evidencia completa de IQ no coincide con el destino publicado.");
      }
      return {
        accountId: accountSnap.id, instrumentMasked: "••" + String(account.last4 || ""),
        bankName: String(account.bankName || ""), beneficiaryName: String(account.beneficiaryName || ""),
        iqPartnerId: iq.iqPartnerId, iqBeneficiaryId: iq.iqBeneficiaryId,
        iqAccountId: iq.iqAccountId, iqClientId: clientIqId,
        instrumentFingerprint: account.instrumentFingerprint,
      };
    });
    const destinationById = new Map(destinationSnapshots.map(destination => [destination.accountId, destination]));
    const rows = calculation.instructions.map(row => ({
      ...row, ...destinationById.get(row.accountId), status: "CALCULATED_ONLY",
      retryBlocked: true, externalSubmissionAllowed: false,
    }));
    const payload = {
      rootId: actor.rootId, clientId, ownerUid, paymentId, financialSnapshotId: snapshotId,
      sourcePostedAtMs: postedAtMs, sourceEarningMinor: earning.earnedMinor,
      ruleVersion: rule.version, ruleEffectiveFromMs: commissionMillis(rule.effectiveFrom),
      calculationBaseType: earning.calculationBaseType, contractRateBps: earning.contractRateBps,
      rows, distributedMinor: calculation.distributedMinor, remainingMinor: calculation.remainingMinor,
      status: "CALCULATED_NOT_EXECUTABLE", executionEnabled: false, externalActions: 0,
      fundingReserved: false, actorUid: actor.uid, createdAt: timestamp(),
    };
    tx.create(recordRef, payload);
    tx.create(db.collection("commissionAuditEvents").doc(), {
      rootId: actor.rootId, clientId, ownerUid, paymentId, recordId,
      event: "PERSONAL_CLIENT_COMMISSION_CALCULATED_ONLY", actorUid: actor.uid, createdAt: timestamp(),
    });
    return { ok: true, idempotent: false, recordId, status: payload.status,
      distributedMinor: calculation.distributedMinor, remainingMinor: calculation.remainingMinor };
  });
});
