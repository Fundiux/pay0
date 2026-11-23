import * as admin from "firebase-admin";
import { createHash } from "node:crypto";
import { calculateClientCommissionInstructions } from "./clientAllocation";
import { postedClientOperationBaseMinor } from "./postedClientAllocationPreview";
import { canonicalUserCommission, evaluateIqLink, isPostedCommissionPayment } from "./domain";
import { commissionMillis, commissionSettingsId, assertCommissionWithdrawalOwner } from "./userDestinations";
import { personalCommissionIqLinkId } from "./personalAllocationMirror";
import { personalCommissionIqEvidence } from "./personalAllocationMirror";
import { withInheritedAuthority } from "../users/inheritedAuthority";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const timestamp = admin.firestore.FieldValue.serverTimestamp;
const text = (value: unknown) => String(value ?? "").trim();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);
const MAX_IQ_AGE_MS = 86400000;
const isTerminal = (leg: any) => Boolean(leg.iqFolio || leg.postAccepted || leg.retryBlocked ||
  ["RESERVED", "CANCELLED", "COMPLETED", "CONFIRMED", "IQ_CREATED", "UNCERTAIN", "PROCESSING"].includes(leg.status));

/** Personal rule must be ACTIVE at the posting date; changes are never retroactive. */
export async function materializePersonalEarningDistribution(input: {
  paymentId: string; ownerUid: string; actorUid: string; rootId: string; clientId: string;
  distributionId: string; paymentRef: FirebaseFirestore.DocumentReference;
  snapshotRef: FirebaseFirestore.DocumentReference; snapshotId: string;
  payment: Record<string, any>; snapshot: Record<string, any>;
  earning: ReturnType<typeof canonicalUserCommission>; postedAtMs: number;
  rule: Record<string, any>; ruleKey: string; dryRun?: boolean;
}) {
  const ref = db.doc(`commissionDistributions/${input.distributionId}`);
  const existing = await ref.get();
  if (existing.exists) return { ok: true, idempotent: true, distributionId: ref.id, data: existing.data() };
  if (input.rule.status !== "ACTIVE") return { ok: true, skipped: true, reason: "PERSONAL_RULE_NOT_ACTIVE" };
  if (input.rule.rootId !== input.rootId || input.rule.clientId !== input.clientId ||
      input.rule.ownerUid !== input.ownerUid || !Array.isArray(input.rule.instructions) ||
      !Array.isArray(input.rule.destinations)) throw new Error("Regla de distribución personal inválida.");
  const postedAt = commissionMillis(input.rule.effectiveFrom);
  if (!postedAt || postedAt > input.postedAtMs) throw new Error("La regla es posterior al movimiento financiero.");
  const calculation = calculateClientCommissionInstructions({
    earnedMinor: input.earning.earnedMinor,
    operationBaseMinor: postedClientOperationBaseMinor(input.snapshot, input.earning.calculationBaseType),
    contractRateBps: input.earning.contractRateBps,
    instructions: input.rule.instructions,
  });
  if (calculation.distributedMinor <= 0 || calculation.instructions.some(row => row.amountMinor <= 0)) {
    return { ok: true, skipped: true, reason: "PERSONAL_DISTRIBUTION_BELOW_ONE_CENT" };
  }
  const destinationByAccount = new Map<string, Record<string, any>>();
  for (const item of input.rule.destinations) {
    if (!item?.accountId || !item.methodId || !item.beneficiaryId ||
        destinationByAccount.has(item.accountId)) {
      throw new Error("Los destinos personales publicados no son únicos.");
    }
    destinationByAccount.set(item.accountId, item);
  }
  const client = (await db.doc(`clients/${input.clientId}`).get()).data();
  if (!client || client.rootId !== input.rootId) throw new Error("Cliente fuera de alcance.");
  const clientIqId = text(client.iqLink?.clientId || client.iqClientId);
  if (!clientIqId) throw new Error("Cliente sin vínculo IQ vigente.");
  const uniqueAccounts = [...new Set(calculation.instructions.map(row => row.accountId))];
  const records = await Promise.all(uniqueAccounts.map(async accountId => {
    const destination = destinationByAccount.get(accountId);
    if (!destination) throw new Error("Cuenta no publicada para este cliente.");
    const [accountSnap, linkSnap, methodSnap, beneficiarySnap] = await Promise.all([
      db.doc(`personalCommissionAccounts/${accountId}`).get(),
      db.doc(`personalCommissionIqLinks/${personalCommissionIqLinkId(input.rootId, input.clientId, input.ownerUid, accountId)}`).get(),
      db.doc(`clientBeneficiaryMethods/${destination.methodId}`).get(),
      db.doc(`clientBeneficiaries/${destination.beneficiaryId}`).get(),
    ]);
    const account = accountSnap.data(), iq = linkSnap.data(), method = methodSnap.data(), beneficiary = beneficiarySnap.data();
    const linkHealth = evaluateIqLink({
      status: iq?.iqLinkStatus, verifiedAtMs: commissionMillis(iq?.verifiedAt), nowMs: Date.now(),
      maxAgeMs: MAX_IQ_AGE_MS, storedLast4: iq?.last4, currentLast4: account?.last4,
    });
    const valid = account?.rootId === input.rootId && account?.ownerUid === input.ownerUid &&
      account?.active === true && account?.instrumentFingerprint === destination.fingerprint &&
      account?.last4 === destination.last4 && linkHealth.ready &&
      iq?.rootId === input.rootId && iq?.clientId === input.clientId &&
      iq?.ownerUid === input.ownerUid && iq?.accountId === accountId &&
      iq?.iqFullDigitsMatched === true && iq?.accountFingerprint === destination.fingerprint && text(iq?.iqClientId) === clientIqId &&
      text(iq?.iqAccountId) === text(destination.iqAccountId) &&
      text(iq?.iqBeneficiaryId) === text(destination.iqBeneficiaryId) &&
      text(iq?.iqPartnerId) === text(destination.iqPartnerId) &&
      text(iq?.iqCredentialProfileId) === text(destination.iqCredentialProfileId) &&
      !!iq?.despachoId && text(iq.despachoId) === text(input.snapshot.despachoId) &&
      method?.sourceType === "PERSONAL_COMMISSION" && method?.personalCommissionAccountId === accountId &&
      method?.commissionOwnerUid === input.ownerUid && method?.rootId === input.rootId &&
      text(method.clientId || method.clienteId) === input.clientId &&
      method?.beneficiaryId === destination.beneficiaryId && method?.active === true &&
      method?.personalAccountFingerprint === account?.instrumentFingerprint &&
      beneficiary?.rootId === input.rootId && text(beneficiary?.clientId || beneficiary?.clienteId) === input.clientId &&
      beneficiary?.active === true;
    if (!valid) throw new Error("Cuenta personal o vínculo IQ no aptos para este movimiento.");
    return { accountId, destination, account, iq, method, beneficiary };
  }));
  const byAccount = new Map(records.map(row => [row.accountId, row]));
  const legs = calculation.instructions.map((row, index) => {
    const record = byAccount.get(row.accountId)!;
    const { destination, account, method, beneficiary, iq } = record;
    const legId = hash([input.distributionId, index, row.accountId, row.pointsBps != null ? "points" : "earnings"]);
    const iqEvidenceFingerprint = personalCommissionIqEvidence({
      rootId: input.rootId, despachoId: text(iq.despachoId),
      profileId: text(iq.iqCredentialProfileId), clientIqId,
      beneficiaryId: text(iq.iqBeneficiaryId), accountId: text(iq.iqAccountId),
      last4: account.last4, operationTypeKey: account.instrumentType === "CLABE" ? "TRANSFERENCIA" : "TDC",
    });
    if (method.iqEvidenceFingerprint !== iqEvidenceFingerprint) throw new Error("Evidencia IQ histórica no coincide.");
    return {
      ...row, ownerUid: input.ownerUid, kind: "COMMISSIONER", alias: input.ownerUid,
      beneficiaryId: destination.beneficiaryId, methodId: destination.methodId,
      instrumentFingerprint: account.instrumentFingerprint, legId,
      idempotencyKey: `commission-leg:${legId}`, canonicalDispersionId: `COMMISSION__${legId}`,
      amount: row.amountMinor / 100, beneficiaryName: text(beneficiary.nombre),
      instrumentMasked: text(method.masked), bankName: text(method.bankName),
      iqPartnerId: text(iq.iqPartnerId), iqBeneficiaryId: text(iq.iqBeneficiaryId),
      iqAccountId: text(iq.iqAccountId), instrumentLast4: account.last4,
      iqEvidenceFingerprint, iqFolio: null, status: "READY", errorCode: null,
    };
  });
  const payload = {
    schemaVersion: 3, sourceType: "USER_EARNINGS", distributionMode: "PERSONAL_MIXED",
    rootId: input.rootId, clientId: input.clientId, ownerUid: input.ownerUid,
    paymentId: input.paymentId, pay0Folio: text(input.payment.folio || input.payment.referenceFolio || input.paymentId),
    financialSnapshotId: input.snapshotId, sourcePostedAtMs: input.postedAtMs,
    sourceEarningMinor: input.earning.earnedMinor, contractRateBps: input.earning.contractRateBps,
    calculationBaseType: input.earning.calculationBaseType, userRuleVersion: input.rule.version,
    userRuleSnapshot: { schemaVersion: 3, distributionMode: "PERSONAL_MIXED",
      instructions: input.rule.instructions, destinations: input.rule.destinations,
      contractRateBps: input.earning.contractRateBps, ruleVersion: input.rule.version },
    totalCommissionMinor: calculation.distributedMinor,
    totalCommissionAmount: calculation.distributedMinor / 100,
    remainingMinor: calculation.remainingMinor, differenceAmount: 0,
    legs, status: "READY",
    executionGate: "USER_RESERVATION_AND_AUTHORIZED_EXECUTOR_REQUIRED",
    operationalDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City",
      year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(input.postedAtMs)),
    createdBy: input.actorUid, createdAt: timestamp(), updatedAt: timestamp(),
  };
  if (input.dryRun) return { ok: true, dryRun: true, distributionId: input.distributionId, data: payload };
  return db.runTransaction(async tx => {
    const [current, payment, snapshot, currentRule] = await Promise.all([
      tx.get(ref), tx.get(input.paymentRef), tx.get(input.snapshotRef),
      tx.get(db.doc(`clientCommissionAllocationRules/${input.ruleKey}`)),
    ]);
    if (current.exists) return { ok: true, idempotent: true, distributionId: input.distributionId, data: current.data() };
    if (!isPostedCommissionPayment(payment.data()) || payment.data()?.financialSnapshotId !== input.snapshotId ||
        snapshot.data()?.rootId !== input.rootId || snapshot.data()?.pagoId !== input.paymentId ||
        canonicalUserCommission(snapshot.data(), input.ownerUid).earnedMinor !== input.earning.earnedMinor ||
        currentRule.data()?.status !== "ACTIVE") {
      throw new Error("Las referencias financieras o la regla activa cambiaron; vuelve a calcular.");
    }
    // A later rule version is permitted only if this historical rule was active at posting.
    tx.create(ref, payload);
    tx.create(db.collection("commissionAuditEvents").doc(), {
      rootId: input.rootId, clientId: input.clientId, ownerUid: input.ownerUid,
      distributionId: input.distributionId, paymentId: input.paymentId,
      event: "PERSONAL_USER_COMMISSION_CALCULATED", actorUid: input.actorUid,
      distributedMinor: calculation.distributedMinor, remainingMinor: calculation.remainingMinor,
      createdAt: timestamp(),
    });
    return { ok: true, idempotent: false, distributionId: input.distributionId, data: payload };
  });
}

/** Read-only account, IQ and financial preflight; never creates payments or moves balances. */
export async function preflightPersonalEarningDistribution(
  distributionId: string, actorUid: string, now = Date.now(),
) {
  const ref = db.doc(`commissionDistributions/${distributionId}`);
  const before = await ref.get(), distribution = before.data();
  if (!distribution || distribution.sourceType !== "USER_EARNINGS" ||
      distribution.distributionMode !== "PERSONAL_MIXED") throw new Error("Distribución personal no encontrada.");
  const reasons: string[] = [];
  const [paymentSnap, snapshotSnap, ownerSnap, clientSnap, ruleSnap] = await Promise.all([
    db.doc(`pagos/${distribution.paymentId}`).get(),
    db.doc(`paymentFinancialSnapshots/${distribution.financialSnapshotId}`).get(),
    db.doc(`users/${distribution.ownerUid}`).get(),
    db.doc(`clients/${distribution.clientId}`).get(),
    db.doc(`clientCommissionAllocationRules/${commissionSettingsId(distribution.rootId, distribution.clientId, distribution.ownerUid)}`).get(),
  ]);
  const payment = paymentSnap.data(), snapshot = snapshotSnap.data();
  if (!isPostedCommissionPayment(payment) || payment?.rootId !== distribution.rootId ||
      text(payment?.clienteId || payment?.clientId) !== distribution.clientId ||
      payment?.financialSnapshotId !== distribution.financialSnapshotId ||
      !snapshot || snapshot.rootId !== distribution.rootId ||
      snapshot.pagoId !== distribution.paymentId || snapshot.clienteId !== distribution.clientId) {
    reasons.push("SOURCE_PAYMENT_CHANGED");
  }
  const owner = await withInheritedAuthority(ownerSnap.data(), distribution.ownerUid);
  try { assertCommissionWithdrawalOwner(distribution.ownerUid, owner, distribution.rootId); }
  catch { reasons.push("OWNER_INACTIVE_OR_NOT_AUTHORIZED"); }
  if (ruleSnap.data()?.status !== "ACTIVE") reasons.push("PERSONAL_RULE_INACTIVE");
  const client = clientSnap.data();
  if (!client || client.rootId !== distribution.rootId) reasons.push("CLIENT_OUT_OF_SCOPE");
  const clientIqId = text(client?.iqLink?.clientId || client?.iqClientId);
  if (!clientIqId) reasons.push("CLIENT_IQ_UNLINKED");
  const rule = distribution.userRuleSnapshot;
  let calculation: ReturnType<typeof calculateClientCommissionInstructions> | null = null;
  try {
    const earning = canonicalUserCommission(snapshot, distribution.ownerUid);
    calculation = calculateClientCommissionInstructions({
      earnedMinor: earning.earnedMinor,
      operationBaseMinor: postedClientOperationBaseMinor(snapshot, earning.calculationBaseType),
      contractRateBps: earning.contractRateBps,
      instructions: rule.instructions,
    });
    if (distribution.sourceEarningMinor !== earning.earnedMinor ||
        distribution.totalCommissionMinor !== calculation.distributedMinor ||
        distribution.remainingMinor !== calculation.remainingMinor ||
        distribution.legs.length !== calculation.instructions.length) reasons.push("HISTORICAL_AMOUNT_MISMATCH");
  } catch { reasons.push("HISTORICAL_CALCULATION_INVALID"); }
  const rows = Array.isArray(distribution.legs) ? distribution.legs : [];
  const evaluated = [];
  for (const [index, leg] of rows.entries()) {
    const expected = calculation?.instructions[index];
    const legReasons: string[] = [];
    if (!expected || expected.accountId !== leg.accountId || expected.amountMinor !== leg.amountMinor ||
        leg.amountMinor <= 0 || !leg.methodId || !leg.beneficiaryId) legReasons.push("LEG_AMOUNT_OR_ACCOUNT_MISMATCH");
    const [accountSnap, iqSnap, methodSnap, beneficiarySnap] = await Promise.all([
      db.doc(`personalCommissionAccounts/${leg.accountId}`).get(),
      db.doc(`personalCommissionIqLinks/${personalCommissionIqLinkId(distribution.rootId, distribution.clientId, distribution.ownerUid, leg.accountId)}`).get(),
      db.doc(`clientBeneficiaryMethods/${leg.methodId}`).get(),
      db.doc(`clientBeneficiaries/${leg.beneficiaryId}`).get(),
    ]);
    const account = accountSnap.data(), iq = iqSnap.data(), method = methodSnap.data(), beneficiary = beneficiarySnap.data();
    const link = evaluateIqLink({
      status: iq?.iqLinkStatus, verifiedAtMs: commissionMillis(iq?.verifiedAt), nowMs: now,
      maxAgeMs: MAX_IQ_AGE_MS, storedLast4: iq?.last4, currentLast4: account?.last4,
    });
    if (!link.ready || account?.active !== true || account?.rootId !== distribution.rootId ||
        account?.ownerUid !== distribution.ownerUid || iq?.iqFullDigitsMatched !== true || iq?.accountFingerprint !== account?.instrumentFingerprint ||
        iq?.rootId !== distribution.rootId || iq?.clientId !== distribution.clientId ||
        iq?.ownerUid !== distribution.ownerUid || iq?.accountId !== leg.accountId ||
        text(iq?.iqClientId) !== clientIqId || text(iq?.iqBeneficiaryId) !== text(leg.iqBeneficiaryId) ||
        text(iq?.iqAccountId) !== text(leg.iqAccountId) || text(iq?.iqPartnerId) !== text(leg.iqPartnerId) ||
        text(iq?.despachoId) !== text(snapshot?.despachoId) ||
        text(iq?.iqCredentialProfileId) !== text(method?.iqCredentialProfileId) ||
        method?.sourceType !== "PERSONAL_COMMISSION" ||
        method?.rootId !== distribution.rootId ||
        text(method?.clientId || method?.clienteId) !== distribution.clientId ||
        method?.beneficiaryId !== leg.beneficiaryId ||
        method?.personalCommissionAccountId !== leg.accountId ||
        method?.personalAccountFingerprint !== leg.instrumentFingerprint ||
        method?.commissionOwnerUid !== distribution.ownerUid || method?.active !== true ||
        text(method?.iqAccountId) !== text(leg.iqAccountId) ||
        text(method?.iqBeneficiaryId) !== text(leg.iqBeneficiaryId) ||
        text(method?.iqDespachoId) !== text(snapshot?.despachoId) ||
        text(method?.last4) !== text(leg.instrumentLast4) ||
        method?.iqEvidenceFingerprint !== leg.iqEvidenceFingerprint ||
        beneficiary?.rootId !== distribution.rootId ||
        text(beneficiary?.clientId || beneficiary?.clienteId) !== distribution.clientId ||
        beneficiary?.active !== true) {
      legReasons.push("PERSONAL_IQ_DESTINATION_CHANGED");
    }
    evaluated.push({ ...leg, status: isTerminal(leg) ? leg.status : legReasons.length ? "BLOCKED" : "READY", preflightReasons: legReasons });
  }
  const status = reasons.length || evaluated.some(leg => leg.preflightReasons.length) ? "BLOCKED" : "READY_FOR_EXECUTION";
  const result = { status, reasons, legs: evaluated, checkedAt: new Date(now).toISOString(),
    executionAllowed: false, executionGate: "USER_RESERVATION_AND_AUTHORIZED_EXECUTOR_REQUIRED" };
  await db.runTransaction(async tx => {
    const latest = await tx.get(ref);
    if (!latest.updateTime?.isEqual(before.updateTime!)) throw new Error("La distribución cambió durante preflight.");
    const preserve = rows.some(isTerminal);
    tx.update(ref, { preflight: result, ...(preserve ? {} : { status: status === "READY_FOR_EXECUTION" ? "READY" : "BLOCKED" }),
      lastPreflightBy: actorUid, updatedAt: timestamp() });
  });
  return { ok: true, distributionId, ...result };
}
