import { isPostedCommissionPayment } from "./domain";
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { assertCommissionWithdrawalOwner, assertOwnedCommissionInstrument, commissionSettingsId } from "./userDestinations";
import { calculateUserCommissionDestinations, canonicalUserCommission } from "./domain";
import { applyCanonicalDispersionFinancialsTx, prepareCanonicalDispersionFinancialsTx, projectCanonicalDispersionFinancialBatchState, resolveDispersionOperationTypeKey, type CanonicalFinancialBatchAccountState } from "../financing/dispersionFinancial";
import { applyForwardOnlyDispersionTx, prepareForwardOnlyDispersionTx, projectForwardOnlyDispersionBatchState, type ForwardOnlyBatchAccountState } from "../dispatchBalances/forwardOnly";
import { readBalanceAccountTx } from "../balances/repository";
import { buildCanonicalFolio, reserveSequenceRangeTx } from "../sequences/service";
import { buildIqOriginIdentityPatch, captureIqOriginIdentity } from "../iq/originIdentity";
import type { DispersionFundingSource } from "../financing/dispersionFunding";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore(), timestamp = admin.firestore.FieldValue.serverTimestamp;
const text = (value: unknown) => String(value ?? "").trim();

/** Reuse canonical pricing, USER ledger and forward-only route/reservation in one transaction. */
export async function reserveUserCommissionWithdrawal(input: { distributionId: string; rootId: string; ownerUid: string; actorUid: string; source: "MANUAL" | "DAILY"; dryRun?: boolean; acceptTotalDebitMinor?: number }) {
  const ownerBefore = (await db.doc(`users/${input.ownerUid}`).get()).data();
  if (!ownerBefore || text(ownerBefore.rootId || input.ownerUid) !== input.rootId) throw new HttpsError("permission-denied", "Titular fuera de alcance.");
  assertCommissionWithdrawalOwner(input.ownerUid, ownerBefore, input.rootId);
  const identity = await captureIqOriginIdentity({ actorUid: input.ownerUid, rootId: input.rootId, role: ownerBefore.role, moduleKey: "dispersiones" });
  return db.runTransaction(async tx => {
    const distributionRef = db.doc(`commissionDistributions/${input.distributionId}`), requestRef = db.doc(`commissionDispersionRequests/${input.distributionId}`);
    const [distributionSnap, requestSnap, ownerSnap] = await Promise.all([tx.get(distributionRef), tx.get(requestRef), tx.get(db.doc(`users/${input.ownerUid}`))]);
    const previous = requestSnap.data();
    if (previous?.principalIds?.length) {
      if (input.dryRun) throw new HttpsError("failed-precondition", "Este pago ya tiene una solicitud; consulta Comisiones calculadas.");
      return { ok: true, idempotent: true, requestId: requestRef.id, principalIds: previous.principalIds, status: previous.status };
    }
    const distribution = distributionSnap.data(), owner = ownerSnap.data();
    if (!distribution || distribution.sourceType !== "USER_EARNINGS" || distribution.rootId !== input.rootId || distribution.ownerUid !== input.ownerUid || !owner || owner.active === false || owner.isActive === false || owner.isDeleted === true || text(owner.rootId || input.ownerUid) !== input.rootId) throw new HttpsError("permission-denied", "Comisión fuera de alcance o titular inactivo.");
    assertCommissionWithdrawalOwner(input.ownerUid, owner, input.rootId);
    const clientId = text(distribution.clientId);
    const [clientSnap, paymentSnap, snapshotSnap, entitlementSnap, balance] = await Promise.all([tx.get(db.doc(`clients/${clientId}`)), tx.get(db.doc(`pagos/${distribution.paymentId}`)), tx.get(db.doc(`paymentFinancialSnapshots/${distribution.financialSnapshotId}`)), tx.get(db.doc(`commissionUserEntitlements/${commissionSettingsId(input.rootId, clientId, input.ownerUid)}`)), readBalanceAccountTx(tx, db, "USER", input.ownerUid)]);
    const client = clientSnap.data(), payment = paymentSnap.data(), snapshot = snapshotSnap.data(), entitlement = entitlementSnap.data();
    if (!client || client.rootId !== input.rootId || !payment || payment.rootId !== input.rootId || text(payment.clienteId || payment.clientId) !== clientId || !isPostedCommissionPayment(payment) || payment.financialSnapshotId !== distribution.financialSnapshotId || !snapshot || snapshot.rootId !== input.rootId || snapshot.pagoId !== distribution.paymentId || snapshot.clienteId !== clientId || !entitlement?.active) throw new HttpsError("failed-precondition", "La utilidad dejó de ser elegible.");
    const earning = canonicalUserCommission(snapshot, input.ownerUid), rule = distribution.userRuleSnapshot;
    if (rule.distributionMode === "CONTRACT_COMMISSION_POINTS" && rule.contractRateBps !== earning.contractRateBps) throw new HttpsError("failed-precondition", "Los puntos no coinciden con el contrato del pago.");
    const calculation = calculateUserCommissionDestinations(earning.earnedMinor, earning.contractRateBps || 0, rule.distributionMode, rule.destinations);
    if (calculation.earnedMinor !== distribution.totalCommissionMinor || distribution.legs.length !== calculation.destinations.length) throw new HttpsError("failed-precondition", "La comisión histórica no coincide con la utilidad contabilizada.");
    const clientNumber = Number(client.clientNumber || client.numeroCliente || client.sequenceNumber), userNumber = Number(owner.userNumber || owner.numeroUsuario || owner.sequenceNumber);
    if (!Number.isSafeInteger(clientNumber) || clientNumber <= 0 || !Number.isSafeInteger(userNumber) || userNumber <= 0) throw new HttpsError("failed-precondition", "Cliente o usuario sin numeración canónica.");
    const financialState: CanonicalFinancialBatchAccountState = new Map(), routeState: ForwardOnlyBatchAccountState = new Map();
    const plans: any[] = [];
    let estimatedWrites = 5;
    for (const [index, destination] of calculation.destinations.entries()) {
      const leg = distribution.legs[index];
      if (leg.methodId !== destination.methodId || leg.beneficiaryId !== destination.beneficiaryId || leg.amountMinor !== destination.amountMinor || destination.amountMinor <= 0 || leg.iqFolio || leg.retryBlocked || ["COMPLETED", "UNCERTAIN", "PROCESSING", "CANCELLED"].includes(leg.status)) throw new HttpsError("failed-precondition", "Un destino histórico no es elegible para reservar.");
      const [methodSnap, beneficiarySnap, existingPrincipal] = await Promise.all([tx.get(db.doc(`clientBeneficiaryMethods/${leg.methodId}`)), tx.get(db.doc(`clientBeneficiaries/${leg.beneficiaryId}`)), tx.get(db.doc(`clientDispersions/${leg.canonicalDispersionId}`))]);
      if (existingPrincipal.exists) throw new HttpsError("failed-precondition", "Existe una dispersión sin solicitud enlazada; requiere conciliación.");
      const method = methodSnap.data()!, beneficiary = beneficiarySnap.data()!;
      assertOwnedCommissionInstrument(method, beneficiary, { rootId: input.rootId, clientId, ownerUid: input.ownerUid, beneficiaryId: leg.beneficiaryId });
      if (!entitlement.allowedMethodIds?.includes(leg.methodId) || method.iqBeneficiaryId !== leg.iqBeneficiaryId || method.iqAccountId !== leg.iqAccountId || method.last4 !== leg.instrumentLast4 || method.iqCredentialProfileId !== identity.originIqProfileId || text(method.iqDespachoId) !== text(snapshot.despachoId)) throw new HttpsError("failed-precondition", "El instrumento o su identidad IQ cambió desde la distribución.");
      const operationTypeKey = resolveDispersionOperationTypeKey(method.tipo, method.destinationKind);
      if (!["TRANSFERENCIA", "TDC"].includes(operationTypeKey)) throw new HttpsError("failed-precondition", "La comisión automática requiere transferencia o TDC.");
      const fundingSource: DispersionFundingSource = { holderType: "USER", ownerUid: input.ownerUid, sourceClientId: clientId, holderName: text(owner.displayName || owner.username || input.ownerUid), holderRole: owner.role, commissionDistributionId: input.distributionId, commissionLegId: leg.legId };
      const financial = await prepareCanonicalDispersionFinancialsTx({ tx, db, rootId: input.rootId, clientId, client, adminId: client.adminId || null, operadorId: client.operadorId || null, despachoId: snapshot.despachoId, operationTypeKey, amount: destination.amountMinor / 100, currency: "MXN", batchAccountState: financialState });
      const current = financialState.get(`USER_${input.ownerUid}`) || balance.snap.data();
      const route = await prepareForwardOnlyDispersionTx({ tx, db, rootId: input.rootId, clientId, clientName: text(client.nombre || client.name || clientId), principalDispersionId: leg.canonicalDispersionId, operationTypeKey, preferredDespachoId: snapshot.despachoId, pricing: financial.pricing, fundingSource, batchAccountState: routeState });
      // Each IQ verification belongs to an origin. Never route a verified destination through another one.
      if (route.route.legs.some(row => row.despachoId !== method.iqDespachoId)) throw new HttpsError("failed-precondition", "El saldo requiere otro despacho; verifica el instrumento para ese origen antes de dispersar.");
      estimatedWrites += 18 + route.route.legs.length * 12;
      if (estimatedWrites > 400) throw new HttpsError("failed-precondition", "La distribución excede la capacidad transaccional; reduce los destinos.");
      projectCanonicalDispersionFinancialBatchState({ prepared: financial, batchAccountState: financialState, clientAccountCurrent: current, clientId, clientName: text(client.nombre || clientId), fundingSource });
      projectForwardOnlyDispersionBatchState(route, routeState);
      plans.push({ leg, method, beneficiary, operationTypeKey, fundingSource, financial, route, current });
    }
    const totalDebitMinor = plans.reduce((sum, plan) => sum + Math.round(plan.financial.pricing.totalClientDebitAmount * 100), 0);
    if (input.dryRun) return { ok: true, dryRun: true, requestId: requestRef.id, principalIds: [] as string[], status: "PREVIEW", totalAmountMinor: distribution.totalCommissionMinor, totalDebitMinor, feeMinor: totalDebitMinor - distribution.totalCommissionMinor, destinations: plans.map(plan => ({ instrumentMasked: plan.method.masked, amountMinor: plan.leg.amountMinor, feeMinor: Math.round(plan.financial.pricing.clientChargeAmount * 100) })) };
    if (input.source === "MANUAL" && input.acceptTotalDebitMinor !== totalDebitMinor) throw new HttpsError("failed-precondition", "Revisa y acepta el importe total con costos antes de reservar la utilidad.");
    // Sequence is the final read phase; reserve N sequential folios atomically with all financial writes.
    const sequence = await reserveSequenceRangeTx({ db, tx, rootId: input.rootId, scope: "dispersions", scopeKey: `cliente_${clientId}__usuario_${input.ownerUid}`, count: plans.length });
    const principalIds = [];
    for (const [index, plan] of plans.entries()) {
      const number = sequence.sequenceNumbers[index];
      const folio = buildCanonicalFolio("D", number, [{ label: "C", value: clientNumber }, { label: "U", value: userNumber }]);
      const principalRef = db.doc(`clientDispersions/${plan.leg.canonicalDispersionId}`);
      const financial = applyCanonicalDispersionFinancialsTx({ tx, db, prepared: plan.financial, clientAccountCurrent: plan.current, clientId, clientName: text(client.nombre || client.name || clientId), dispersionId: principalRef.id, folio, beneficiaryId: plan.leg.beneficiaryId, beneficiaryNombre: text(plan.beneficiary.nombre), methodId: plan.leg.methodId, methodTipo: plan.method.tipo, destinationKind: plan.method.destinationKind, bankName: plan.method.bankName || null, createdBy: input.actorUid, actorUsername: text(owner.username || input.ownerUid), principalConcept: `Retiro de utilidad ${distribution.pay0Folio}`, fundingSource: plan.fundingSource });
      const forward = applyForwardOnlyDispersionTx({ tx, db, prepared: plan.route, dispersionRef: principalRef, folio, createdBy: input.actorUid, actorUsername: text(owner.username || input.ownerUid), operationTypeKey: plan.operationTypeKey });
      tx.set(principalRef, { ...forward.principalPatch, rootId: input.rootId, clientId, clienteId: clientId, clienteNombre: text(client.nombre || clientId), ownerUid: input.ownerUid, actorUid: input.ownerUid, actorRole: owner.role, adminId: client.adminId || null, operadorId: client.operadorId || null, ...buildIqOriginIdentityPatch({ ...identity, originIqContext: { ...identity.originIqContext, despachoId: snapshot.despachoId } }), folio, referenceFolio: folio, dispersionFolio: folio, sequenceNumber: number, sequenceCounterPath: sequence.counterPath, clientNumber, userNumber, beneficiaryId: plan.leg.beneficiaryId, beneficiaryNombre: text(plan.beneficiary.nombre), methodId: plan.leg.methodId, methodTipo: plan.method.tipo, destinationKind: plan.method.destinationKind, bankName: plan.method.bankName || null, bankCode: plan.method.bankCode || null, clabe: plan.method.clabe || null, cardNumber: plan.method.cardNumber || null, despachoId: snapshot.despachoId, operationTypeKey: plan.operationTypeKey, amount: plan.leg.amountMinor / 100, clientChargeAmount: financial.pricing.clientChargeAmount, totalClientDebitAmount: financial.pricing.totalClientDebitAmount, pricingSnapshot: financial.pricingSnapshot, principalMovementId: financial.principalMovementId, commissionMovementId: financial.commissionMovementId, earningMovementIds: financial.earningMovementIds, financialSnapshotId: principalRef.id, status: "REGISTRADA", iqExecutionHeld: true, commissionDistributionId: input.distributionId, commissionLegId: plan.leg.legId, createdBy: input.ownerUid, requestedBy: input.actorUid, createdAt: timestamp(), updatedAt: timestamp() }, { merge: true });
      principalIds.push(principalRef.id);
    }
    tx.set(requestRef, { rootId: input.rootId, clientId, ownerUid: input.ownerUid, paymentId: distribution.paymentId, distributionId: input.distributionId, principalIds, fundingHolderType: "USER", totalAmountMinor: distribution.totalCommissionMinor, totalDebitMinor, feeMinor: totalDebitMinor - distribution.totalCommissionMinor, status: "RESERVED_AWAITING_EXECUTION", source: input.source, executionEnabled: false, externalActions: 0, createdBy: input.actorUid, createdAt: timestamp() });
    tx.update(distributionRef, { status: "RESERVED", legs: distribution.legs.map((leg: any) => ({ ...leg, status: "RESERVED" })), updatedAt: timestamp() });
    return { ok: true, idempotent: false, requestId: requestRef.id, principalIds, status: "RESERVED_AWAITING_EXECUTION" };
  });
}
