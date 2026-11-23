import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { commissionAccountActor, commissionMillis, commissionSettingsId } from "./userDestinations";
import { calculateClientCommissionInstructions, type ClientCommissionInstruction } from "./clientAllocation";
import { canonicalUserCommission, evaluateIqLink, isPostedCommissionPayment } from "./domain";
import { personalCommissionIqLinkId } from "./personalAccountIqCallables";
import { postedClientOperationBaseMinor } from "./postedClientAllocationPreview";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore(), stamp = admin.firestore.FieldValue.serverTimestamp;
const safeId = (value: unknown) => {
  const v = String(value || "").trim();
  if (!v || v.length > 128 || v.includes("/")) throw new HttpsError("invalid-argument", "Identificador inválido.");
  return v;
};
const expected = (value: unknown) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new HttpsError("invalid-argument", "Versión esperada inválida.");
  return Number(value);
};
/**
 * Publish an immutable, prospective configuration WITHOUT hooking it to the payout engine.
 * This cannot reserve balances, perform IQ calls, or execute a transfer.
 * Future financial integration must explicitly honor executionEnabled=false until approved.
 */
export const publishClientCommissionAllocation = onCall({ cors: true, timeoutSeconds: 120 }, async request => {
  const actor = await commissionAccountActor(request, true);
  const clientId = safeId(request.data?.clientId), ownerUid = safeId(request.data?.ownerUid);
  const paymentId = safeId(request.data?.paymentId);
  const expectedDraftVersion = expected(request.data?.expectedDraftVersion);
  const expectedVersion = expected(request.data?.expectedVersion);
  const key = commissionSettingsId(actor.rootId, clientId, ownerUid);
  const ref = db.doc(`clientCommissionAllocationRules/${key}`);
  const draftRef = db.doc(`clientCommissionAllocationDrafts/${key}`);
  return db.runTransaction(async tx => {
    const [clientSnap, ownerSnap, paymentSnap, draftSnap, previous] = await Promise.all([
      tx.get(db.doc(`clients/${clientId}`)), tx.get(db.doc(`users/${ownerUid}`)),
      tx.get(db.doc(`pagos/${paymentId}`)), tx.get(draftRef), tx.get(ref),
    ]);
    const client = clientSnap.data(), owner = ownerSnap.data(), payment = paymentSnap.data(), draft = draftSnap.data();
    if (!client || client.rootId !== actor.rootId || !owner ||
        String(owner.rootId || ownerUid) !== actor.rootId ||
        owner.active === false || owner.isActive === false || owner.isDeleted === true ||
        owner.deleted === true || !!owner.deletedAt || owner.disabled === true) {
      throw new HttpsError("permission-denied", "Cliente o titular fuera de alcance.");
    }
    if (!payment || payment.rootId !== actor.rootId ||
        String(payment.clienteId || payment.clientId || "") !== clientId || !isPostedCommissionPayment(payment)) {
      throw new HttpsError("failed-precondition", "Se requiere un pago contabilizado del mismo cliente.");
    }
    const clientIqId = String(client.iqLink?.clientId || client.iqClientId || "");
    if (!clientIqId) throw new HttpsError("failed-precondition", "El cliente no está vinculado a IQ.");
    if (!draft || draft.rootId !== actor.rootId || draft.clientId !== clientId ||
        draft.ownerUid !== ownerUid || draft.status !== "DRAFT" || draft.version !== expectedDraftVersion) {
      throw new HttpsError("aborted", "El borrador cambió; vuelve a revisar la versión.");
    }
    const instructions = draft.instructions as ClientCommissionInstruction[];
    if (!Array.isArray(instructions) || instructions.length === 0 || instructions.length > 50) {
      throw new HttpsError("failed-precondition", "Borrador sin instrucciones válidas.");
    }
    const prior = previous.data();
    if (prior?.rootId === actor.rootId && prior.clientId === clientId &&
        prior.ownerUid === ownerUid && prior.status === "CONFIGURED" &&
        prior.executionEnabled === false && prior.draftVersion === expectedDraftVersion &&
        prior.sourcePaymentId === paymentId &&
        JSON.stringify(prior.instructions || []) === JSON.stringify(instructions)) {
      return {
        ok: true, idempotent: true, version: Number(prior.version || 0),
        status: "CONFIGURED", executionEnabled: false,
        distributedMinor: Number(prior.referenceDistributedMinor || 0),
        remainingMinor: Number(prior.referenceRemainingMinor || 0),
      };
    }
    const accountIds = [...new Set(instructions.map(row => safeId(row.accountId)))];
    const financialSnapshotId = safeId(payment.financialSnapshotId);
    const [snapshotSnap, ...accountSnaps] = await Promise.all([
      tx.get(db.doc(`paymentFinancialSnapshots/${financialSnapshotId}`)),
      ...accountIds.map(accountId => tx.get(db.doc(`personalCommissionAccounts/${accountId}`))),
    ]);
    const snapshot = snapshotSnap.data();
    if (!snapshot || snapshot.rootId !== actor.rootId || snapshot.pagoId !== paymentId ||
        snapshot.clienteId !== clientId || String(snapshot.currency || payment.moneda || "MXN") !== "MXN") {
      throw new HttpsError("failed-precondition", "Snapshot financiero no válido para MXN.");
    }
    const iqSnaps = await Promise.all(accountIds.map(accountId =>
      tx.get(db.doc(`personalCommissionIqLinks/${personalCommissionIqLinkId(actor.rootId, clientId, ownerUid, accountId)}`))));
    const nowMs = Date.now();
    const destinations = accountIds.map((accountId, index) => {
      const account = accountSnaps[index].data(), iq = iqSnaps[index].data();
      if (!account || account.rootId !== actor.rootId || account.ownerUid !== ownerUid ||
          account.active !== true || !account.instrumentFingerprint) {
        throw new HttpsError("failed-precondition", "Cuenta personal inactiva o fuera de alcance.");
      }
      const link = evaluateIqLink({
        status: iq?.iqLinkStatus, verifiedAtMs: commissionMillis(iq?.verifiedAt),
        nowMs, maxAgeMs: 86400000, storedLast4: iq?.last4, currentLast4: account.last4,
      });
      if (!link.ready || !iq || iq.rootId !== actor.rootId || iq.clientId !== clientId ||
          iq.ownerUid !== ownerUid || iq.accountId !== accountId ||
          iq.accountFingerprint !== account.instrumentFingerprint ||
          String(iq.iqClientId || "") !== clientIqId || !iq.iqPartnerId ||
          !iq.iqBeneficiaryId || !iq.iqAccountId || !iq.iqCredentialProfileId) {
        throw new HttpsError("failed-precondition", "La cuenta requiere verificación exacta y vigente en IQ para este cliente.");
      }
      return {
        accountId, fingerprint: account.instrumentFingerprint, last4: account.last4,
        iqClientId: clientIqId, iqPartnerId: iq.iqPartnerId,
        iqBeneficiaryId: iq.iqBeneficiaryId, iqAccountId: iq.iqAccountId,
        iqCredentialProfileId: iq.iqCredentialProfileId,
      };
    });
    let earning: ReturnType<typeof canonicalUserCommission>;
    try { earning = canonicalUserCommission(snapshot, ownerUid); }
    catch (error: any) { throw new HttpsError("failed-precondition", error.message || "Utilidad del usuario inválida."); }
    if (earning.earnedMinor <= 0) throw new HttpsError("failed-precondition", "Sin utilidad positiva.");
    let calculation;
    try {
      calculation = calculateClientCommissionInstructions({
        earnedMinor: earning.earnedMinor,
        operationBaseMinor: postedClientOperationBaseMinor(snapshot, earning.calculationBaseType),
        contractRateBps: earning.contractRateBps, instructions,
      });
    } catch (error: any) {
      throw new HttpsError("failed-precondition", error.message || "La suma excede la comisión disponible.");
    }
    const oldVersion = Number(previous.data()?.version || 0);
    if (oldVersion !== expectedVersion) throw new HttpsError("aborted", "La configuración cambió; recarga antes de publicar.");
    const version = oldVersion + 1;
    const payload = {
      rootId: actor.rootId, clientId, ownerUid, version, draftVersion: expectedDraftVersion,
      instructions, destinations, status: "CONFIGURED", executionEnabled: false,
      effectiveFrom: stamp(), sourcePaymentId: paymentId, sourceFinancialSnapshotId: financialSnapshotId,
      referenceEarningMinor: earning.earnedMinor, referenceDistributedMinor: calculation.distributedMinor,
      referenceRemainingMinor: calculation.remainingMinor, referenceContractRateBps: earning.contractRateBps,
      createdBy: actor.uid, updatedBy: actor.uid, updatedAt: stamp(),
    };
    tx.set(ref, payload);
    tx.create(db.doc(`clientCommissionAllocationHistory/${key}__v${version}`), {
      ...payload, configurationId: key, recordedAt: stamp(),
    });
    tx.create(db.collection("commissionAuditEvents").doc(), {
      rootId: actor.rootId, clientId, ownerUid, version, actorUid: actor.uid,
      event: "CLIENT_PERSONAL_COMMISSION_RULE_CONFIGURED", createdAt: stamp(),
    });
    return { ok: true, version, status: "CONFIGURED", executionEnabled: false,
      distributedMinor: calculation.distributedMinor, remainingMinor: calculation.remainingMinor };
  });
});

/** Authorized read of the prospective, non-executing allocation rule. */
export const getPublishedClientCommissionAllocation = onCall({ cors: true }, async request => {
  const actor = await commissionAccountActor(request, true);
  const clientId = safeId(request.data?.clientId), ownerUid = safeId(request.data?.ownerUid);
  const [client, owner, rule] = await Promise.all([
    db.doc(`clients/${clientId}`).get(),
    db.doc(`users/${ownerUid}`).get(),
    db.doc(`clientCommissionAllocationRules/${commissionSettingsId(actor.rootId, clientId, ownerUid)}`).get(),
  ]);
  const ownerData = owner.data() || {};
  if (!client.exists || client.data()?.rootId !== actor.rootId || !owner.exists ||
      String(ownerData.rootId || ownerUid) !== actor.rootId ||
      ownerData.active === false || ownerData.isActive === false ||
      ownerData.disabled === true || ownerData.deleted === true ||
      ownerData.isDeleted === true || !!ownerData.deletedAt) {
    throw new HttpsError("permission-denied", "Cliente o titular fuera de alcance.");
  }
  const data = rule.data();
  if (!data) return { ok: true, rule: null };
  if (data.rootId !== actor.rootId || data.clientId !== clientId || data.ownerUid !== ownerUid) {
    throw new HttpsError("permission-denied", "Regla fuera de alcance.");
  }
  return { ok: true, rule: {
    version: Number(data.version || 0), status: "CONFIGURED",
    executionEnabled: false, draftVersion: Number(data.draftVersion || 0),
    instructions: data.instructions || [],
    sourcePaymentId: String(data.sourcePaymentId || ""),
    referenceEarningMinor: data.referenceEarningMinor || 0,
    referenceDistributedMinor: data.referenceDistributedMinor || 0,
    referenceRemainingMinor: data.referenceRemainingMinor || 0,
    effectiveFromMs: commissionMillis(data.effectiveFrom),
  } };
});
