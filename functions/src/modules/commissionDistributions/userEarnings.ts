import { isPostedCommissionPayment } from "./domain";
import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { calculateUserCommissionDestinations, canonicalUserCommission } from "./domain";
import { assertCommissionWithdrawalOwner, assertOwnedCommissionInstrument, commissionConfigurationAt, commissionMillis, commissionSettingsId } from "./userDestinations";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore(), timestamp = admin.firestore.FieldValue.serverTimestamp;
const text = (value: unknown) => String(value ?? "").trim();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);
export const terminalCommissionLeg = (leg: any) => Boolean(leg.iqFolio || leg.postAccepted || leg.retryBlocked || ["RESERVED", "CANCELLED", "COMPLETED", "CONFIRMED", "IQ_CREATED", "UNCERTAIN", "OUTCOME_UNKNOWN", "PROCESSING"].includes(leg.status));

export async function materializeUserEarningDistribution(params: { paymentId: string; ownerUid: string; actorUid: string; expectedRootId?: string; dryRun?: boolean }) {
  const paymentRef = db.doc(`pagos/${params.paymentId}`), payment = (await paymentRef.get()).data();
  if (!isPostedCommissionPayment(payment)) throw new Error("El pago no está conciliado y contabilizado.");
  const rootId = text(payment.rootId), clientId = text(payment.clienteId || payment.clientId);
  if (!rootId || !clientId || (params.expectedRootId && params.expectedRootId !== rootId)) throw new Error("Pago fuera de alcance.");
  const distributionId = hash(["USER_EARNINGS", rootId, params.paymentId, params.ownerUid]);
  const ref = db.doc(`commissionDistributions/${distributionId}`), existing = await ref.get();
  if (existing.exists) return { ok: true, idempotent: true, distributionId, data: existing.data() };
  const snapshotId = text(payment.financialSnapshotId);
  if (!snapshotId || snapshotId.includes("/")) throw new Error("El pago no tiene snapshot financiero.");
  const snapshotRef = db.doc(`paymentFinancialSnapshots/${snapshotId}`), snapshot = (await snapshotRef.get()).data();
  if (!snapshot || snapshot.rootId !== rootId || snapshot.pagoId !== params.paymentId || snapshot.clienteId !== clientId) throw new Error("Snapshot financiero fuera de alcance.");
  const earning = canonicalUserCommission(snapshot, params.ownerUid), postedAtMs = commissionMillis(snapshot.createdAt);
  if (!postedAtMs || earning.earnedMinor <= 0) return { ok: true, skipped: true, reason: "NO_POSTED_USER_EARNING" };
  if (text(snapshot.currency || payment.moneda || "MXN") !== "MXN") throw new Error("La distribución sólo admite utilidades en MXN.");
  const key = commissionSettingsId(rootId, clientId, params.ownerUid);
  const [entitlement, rule, currentEntitlement] = await Promise.all([
    commissionConfigurationAt("commissionUserEntitlements", "commissionUserEntitlementHistory", key, postedAtMs),
    commissionConfigurationAt("commissionUserDestinationRules", "commissionUserDestinationHistory", key, postedAtMs),
    db.doc(`commissionUserEntitlements/${key}`).get(),
  ]);
  if (!entitlement?.active || !currentEntitlement.data()?.active || !rule) return { ok: true, skipped: true, reason: "NO_USER_CONFIGURATION_AT_POSTING" };
  if (rule.rootId !== rootId || rule.clientId !== clientId || rule.ownerUid !== params.ownerUid || entitlement.ownerUid !== params.ownerUid) throw new Error("Regla personal fuera de alcance.");
  if (rule.distributionMode === "CONTRACT_COMMISSION_POINTS" && (!earning.contractRateBps || earning.contractRateBps !== rule.contractRateBps)) throw new Error("El porcentaje contractual del pago cambió o no es comparable. Se requiere revisar los puntos del usuario.");
  const calculation = calculateUserCommissionDestinations(earning.earnedMinor, earning.contractRateBps || 0, rule.distributionMode, rule.destinations);
  const legs = [];
  for (const [index, destination] of calculation.destinations.entries()) {
    const [methodSnap, beneficiarySnap] = await Promise.all([db.doc(`clientBeneficiaryMethods/${destination.methodId}`).get(), db.doc(`clientBeneficiaries/${destination.beneficiaryId}`).get()]);
    const method = methodSnap.data(), beneficiary = beneficiarySnap.data();
    let errorCode: string | null = null;
    try {
      if (!entitlement.allowedMethodIds?.includes(destination.methodId) || !currentEntitlement.data()?.allowedMethodIds?.includes(destination.methodId)) throw new Error("INSTRUMENT_NOT_ENTITLED");
      assertOwnedCommissionInstrument(method, beneficiary, { rootId, clientId, ownerUid: params.ownerUid, beneficiaryId: destination.beneficiaryId });
      if (destination.amountMinor <= 0) throw new Error("AMOUNT_BELOW_ONE_CENT");
    } catch (error: any) { errorCode = error.code || error.message; }
    const legId = hash([distributionId, index, destination.methodId]);
    legs.push({ ...destination, ownerUid: params.ownerUid, kind: "COMMISSIONER", alias: params.ownerUid, legId, idempotencyKey: `commission-leg:${legId}`, canonicalDispersionId: `COMMISSION__${legId}`, amount: destination.amountMinor / 100, beneficiaryName: text(beneficiary?.nombre), instrumentMasked: text(method?.masked), bankName: text(method?.bankName), iqPartnerId: text(method?.iqPartnerId), iqBeneficiaryId: text(method?.iqBeneficiaryId), iqAccountId: text(method?.iqAccountId), instrumentLast4: text(method?.last4), iqEvidenceFingerprint: text(method?.iqEvidenceFingerprint), iqFolio: null, status: errorCode ? "BLOCKED" : "READY", errorCode });
  }
  const payload = { schemaVersion: 2, sourceType: "USER_EARNINGS", rootId, clientId, ownerUid: params.ownerUid, paymentId: params.paymentId, pay0Folio: text(payment.folio || payment.referenceFolio || params.paymentId), financialSnapshotId: snapshotId, sourcePostedAtMs: postedAtMs, sourceEarningMinor: earning.earnedMinor, contractRateBps: earning.contractRateBps, calculationBaseType: earning.calculationBaseType, distributionMode: rule.distributionMode, entitlementVersion: entitlement.version, userRuleVersion: rule.version, userRuleSnapshot: { distributionMode: rule.distributionMode, destinations: rule.destinations, contractRateBps: rule.contractRateBps }, totalCommissionMinor: earning.earnedMinor, totalCommissionAmount: earning.earnedMinor / 100, differenceAmount: 0, legs, status: legs.some(leg => leg.errorCode) ? "BLOCKED" : "READY", executionGate: "USER_RESERVATION_AND_AUTHORIZED_EXECUTOR_REQUIRED", operationalDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(postedAtMs)), createdBy: params.actorUid, createdAt: timestamp(), updatedAt: timestamp() };
  if (params.dryRun) return { ok: true, dryRun: true, distributionId, data: payload };
  return db.runTransaction(async tx => {
    const [latest, currentPayment, currentSnapshot, latestEntitlement] = await Promise.all([tx.get(ref), tx.get(paymentRef), tx.get(snapshotRef), tx.get(currentEntitlement.ref)]);
    if (latest.exists) return { ok: true, idempotent: true, distributionId, data: latest.data() };
    if (currentPayment.data()?.financialSnapshotId !== snapshotId || !isPostedCommissionPayment(currentPayment.data()) || canonicalUserCommission(currentSnapshot.data(), params.ownerUid).earnedMinor !== earning.earnedMinor || latestEntitlement.data()?.version !== currentEntitlement.data()?.version || !latestEntitlement.data()?.active) throw new Error("Las referencias cambiaron; vuelve a calcular.");
    tx.create(ref, payload);
    tx.create(db.collection("commissionAuditEvents").doc(), { rootId, ownerUid: params.ownerUid, distributionId, paymentId: params.paymentId, event: "USER_COMMISSION_CALCULATED", actorUid: params.actorUid, createdAt: timestamp() });
    return { ok: true, idempotent: false, distributionId, data: payload };
  });
}

export async function preflightUserEarningDistribution(distributionId: string, actorUid: string, now = Date.now()) {
  const ref = db.doc(`commissionDistributions/${distributionId}`), before = await ref.get(), distribution = before.data();
  if (!distribution || distribution.sourceType !== "USER_EARNINGS") throw new Error("Distribución de usuario no encontrada.");
  const reasons: string[] = [];
  const [paymentSnap, snapshotSnap, entitlementSnap, userSnap] = await Promise.all([db.doc(`pagos/${distribution.paymentId}`).get(), db.doc(`paymentFinancialSnapshots/${distribution.financialSnapshotId}`).get(), db.doc(`commissionUserEntitlements/${commissionSettingsId(distribution.rootId, distribution.clientId, distribution.ownerUid)}`).get(), db.doc(`users/${distribution.ownerUid}`).get()]);
  const payment = paymentSnap.data(), snapshot = snapshotSnap.data(), entitlement = entitlementSnap.data(), user = userSnap.data();
  if (!payment || payment.rootId !== distribution.rootId || text(payment.clienteId || payment.clientId) !== distribution.clientId || !isPostedCommissionPayment(payment) || payment.financialSnapshotId !== distribution.financialSnapshotId) reasons.push("PAYMENT_NOT_ELIGIBLE");
  if (!entitlement?.active || entitlement.rootId !== distribution.rootId || entitlement.ownerUid !== distribution.ownerUid) reasons.push("ENTITLEMENT_INACTIVE");
  try { assertCommissionWithdrawalOwner(distribution.ownerUid, user, distribution.rootId); } catch { reasons.push("OWNER_INACTIVE_OR_NOT_AUTHORIZED"); }
  let calculation: ReturnType<typeof calculateUserCommissionDestinations> | null = null;
  try {
    if (!snapshot || snapshot.rootId !== distribution.rootId || snapshot.pagoId !== distribution.paymentId || snapshot.clienteId !== distribution.clientId) throw new Error("source");
    const earning = canonicalUserCommission(snapshot, distribution.ownerUid), rule = distribution.userRuleSnapshot;
    calculation = calculateUserCommissionDestinations(earning.earnedMinor, earning.contractRateBps || 0, rule.distributionMode, rule.destinations);
    if (earning.earnedMinor !== distribution.totalCommissionMinor || earning.earnedMinor !== distribution.sourceEarningMinor || (rule.distributionMode === "CONTRACT_COMMISSION_POINTS" && rule.contractRateBps !== earning.contractRateBps)) reasons.push("SOURCE_EARNING_MISMATCH");
  } catch { reasons.push("HISTORICAL_CALCULATION_INVALID"); }
  const legs = [];
  const historicalLegs = Array.isArray(distribution.legs) ? distribution.legs : [];
  if (!historicalLegs.length || historicalLegs.length !== calculation?.destinations.length) reasons.push("HISTORICAL_LEGS_INVALID");
  for (const [index, leg] of historicalLegs.entries()) {
    const legReasons = [];
    const expected = calculation?.destinations[index];
    if (!expected || leg.amountMinor !== expected.amountMinor || leg.amountMinor <= 0 || leg.methodId !== expected.methodId || leg.beneficiaryId !== expected.beneficiaryId) legReasons.push("LEG_AMOUNT_OR_DESTINATION_MISMATCH");
    const [methodSnap, beneficiarySnap] = await Promise.all([db.doc(`clientBeneficiaryMethods/${leg.methodId}`).get(), db.doc(`clientBeneficiaries/${leg.beneficiaryId}`).get()]);
    const method = methodSnap.data();
    try {
      assertOwnedCommissionInstrument(method, beneficiarySnap.data(), { rootId: distribution.rootId, clientId: distribution.clientId, ownerUid: distribution.ownerUid, beneficiaryId: leg.beneficiaryId, now });
      if (!entitlement?.allowedMethodIds?.includes(leg.methodId)) throw new Error("INSTRUMENT_NOT_ENTITLED");
      if (text(method?.iqBeneficiaryId) !== leg.iqBeneficiaryId || text(method?.iqAccountId) !== leg.iqAccountId || text(method?.last4) !== leg.instrumentLast4) throw new Error("HISTORICAL_INSTRUMENT_CHANGED");
      if (text(method?.iqDespachoId) !== text(snapshot?.despachoId)) throw new Error("IQ_ORIGIN_CHANGED");
    } catch (error: any) { legReasons.push(error.code || error.message); }
    legs.push({ ...leg, status: terminalCommissionLeg(leg) ? leg.status : legReasons.length ? "BLOCKED" : "READY", preflightReasons: legReasons });
  }
  const result = { status: reasons.length || legs.some(leg => leg.preflightReasons.length) ? "BLOCKED" : "READY_FOR_EXECUTION", reasons, legs, checkedAt: new Date(now).toISOString(), executionAllowed: false, executionGate: "USER_RESERVATION_AND_AUTHORIZED_EXECUTOR_REQUIRED" };
  await db.runTransaction(async tx => {
    const latest = await tx.get(ref);
    if (!latest.updateTime?.isEqual(before.updateTime!)) throw new Error("La distribución cambió durante la revisión; vuelve a intentar.");
    const preserve = historicalLegs.some(terminalCommissionLeg);
    tx.update(ref, { preflight: result, ...(preserve ? {} : { status: result.status === "READY_FOR_EXECUTION" ? "READY" : "BLOCKED" }), lastPreflightBy: actorUid, updatedAt: timestamp() });
  });
  return { ok: true, distributionId, ...result };
}
