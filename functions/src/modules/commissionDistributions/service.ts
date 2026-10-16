import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { aggregateCommissionStatus, allocatePostedCommission, decideCommissionPreflight, evaluateIqLink } from "./domain";
import { materializeUserEarningDistribution, preflightUserEarningDistribution, terminalCommissionLeg } from "./userEarnings";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
export const IQ_LINK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function stableCommissionId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

export async function materializeCommissionDistribution(params: {
  paymentId: string;
  actorUid: string;
  dryRun?: boolean;
  expectedRootId?: string;
  ownerUid?: string;
}) {
  if (params.ownerUid) return materializeUserEarningDistribution({ ...params, ownerUid: params.ownerUid });
  const paymentRef = db.doc(`pagos/${params.paymentId}`);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) throw new Error("Pago no encontrado.");
  const payment: any = paymentSnap.data() || {};
  if (params.expectedRootId && text(payment.rootId) !== params.expectedRootId) throw new Error("Pago fuera de alcance.");
  if (upper(payment.status) !== "CONCILIADO" || upper(payment.financialPostingStatus) !== "POSTED") {
    throw new Error("El ingreso todavía no está conciliado y contabilizado.");
  }
  const clientId = text(payment.clienteId || payment.clientId);
  const rootId = text(payment.rootId);
  if (!clientId || !rootId) throw new Error("El pago no conserva cliente y raíz canónicos.");
  const ruleSnap = await db.doc(`clientCommissionRules/${clientId}`).get();
  if (!ruleSnap.exists || ruleSnap.data()?.active !== true || ruleSnap.data()?.automationEnabled !== true) {
    return { ok: true, skipped: true, reason: "CLIENT_RULE_NOT_ENABLED" };
  }
  const rule: any = ruleSnap.data() || {};
  if (text(rule.rootId) !== rootId) throw new Error("La regla de comisión está fuera de alcance.");
  const grossMinor = cents(payment.montoTotal || payment.amount || payment.total);
  const financialSnapshotId = text(payment.financialSnapshotId);
  const financialSnapshot = financialSnapshotId ? (await db.doc(`paymentFinancialSnapshots/${financialSnapshotId}`).get()).data() || {} : {};
  const observedRateBps = Math.round(Number((financialSnapshot as any)?.rateSnapshot?.finalClientRate ?? payment.finalClientRate ?? 0) * 100);
  if (observedRateBps > 0 && observedRateBps !== Number(rule.totalRateBps)) {
    throw new Error(`La tasa cobrada (${(observedRateBps / 100).toFixed(2)}%) no coincide con la regla (${(Number(rule.totalRateBps) / 100).toFixed(2)}%).`);
  }
  const postedCommissionMinor = cents(payment.totalComisionCliente);
  const calculation = allocatePostedCommission(postedCommissionMinor, {
    totalRateBps: rule.totalRateBps,
    legs: rule.legs,
  });
  // Identity excludes the mutable rule version. Adopt any existing legacy calculation.
  const historical = await db.collection("commissionDistributions").where("paymentId", "==", params.paymentId).get();
  const prior = historical.docs.filter(doc => doc.data().rootId === rootId && doc.data().sourceType !== "USER_EARNINGS");
  if (prior.length > 1) throw new Error("Existen distribuciones duplicadas para este pago; requieren conciliación.");
  if (prior.length === 1) return { ok: true, skipped: false, idempotent: true, distributionId: prior[0].id, data: prior[0].data() };
  const distributionId = stableCommissionId(`${rootId}|${params.paymentId}`);
  const distributionRef = db.doc(`commissionDistributions/${distributionId}`);
  const existing = await distributionRef.get();
  if (existing.exists) return { ok: true, skipped: false, idempotent: true, distributionId, data: existing.data() };

  const [beneficiaries, methods] = await Promise.all([
    Promise.all(calculation.legs.map((leg) => db.doc(`clientBeneficiaries/${leg.beneficiaryId}`).get())),
    Promise.all(calculation.legs.map((leg) => db.doc(`clientBeneficiaryMethods/${leg.methodId}`).get())),
  ]);
  const legs = calculation.legs.map((leg, index) => {
    const beneficiary: any = beneficiaries[index].data() || {};
    const method: any = methods[index].data() || {};
    const belongs = beneficiaries[index].exists && methods[index].exists && text(beneficiary.rootId) === rootId && text(method.rootId) === rootId && text(method.beneficiaryId) === leg.beneficiaryId;
    const verified = belongs && upper(method.iqLinkStatus) === "VERIFIED" && Boolean(text(method.iqBeneficiaryId)) && Boolean(text(method.iqAccountId));
    const legId = stableCommissionId(`${distributionId}|${index}|${leg.kind}|${leg.methodId}`);
    return {
      ...leg,
      legId,
      idempotencyKey: `commission-leg:${legId}`,
      canonicalDispersionId: `COMMISSION__${legId}`,
      amount: leg.amountMinor / 100,
      beneficiaryName: text(beneficiary.nombre || beneficiary.name) || null,
      instrumentMasked: text(method.masked) || null,
      bankName: text(method.bankName) || null,
      iqBeneficiaryId: verified ? text(method.iqBeneficiaryId) : null,
      iqAccountId: verified ? text(method.iqAccountId) : null,
      iqFolio: null,
      status: verified ? "READY" : "PENDING_INSTRUMENT_VERIFICATION",
      errorCode: verified ? null : "IQ_INSTRUMENT_NOT_VERIFIED",
      deliveryPreference: leg.deliveryPreference || "MANUAL",
      deliveryContact: leg.deliveryContact || null,
      deliveryStatus: "DELIVERY_PENDING",
    };
  });
  const blocked = legs.some((leg) => leg.status !== "READY");
  const payload = {
    rootId,
    clientId,
    clientName: text(payment.clienteNombre || payment.clientName) || null,
    adminId: text(payment.adminId) || null,
    operadorId: text(payment.operadorId) || null,
    paymentId: params.paymentId,
    pay0Folio: text(payment.folio || payment.referenceFolio || payment.pagoFolio) || params.paymentId,
    originalReference: text(payment.referencia || payment.reference || payment.uuid || payment.uuidCfdi) || null,
    ruleId: ruleSnap.id,
    ruleVersion: Number(rule.version || 1),
    observedRateBps: observedRateBps || null,
    ruleSnapshot: { totalRateBps: calculation.totalRateBps, legs: rule.legs },
    grossAmount: grossMinor / 100,
    totalCommissionAmount: calculation.totalAmountMinor / 100,
    distributedAmount: calculation.distributedAmountMinor / 100,
    differenceAmount: calculation.differenceMinor / 100,
    baseAmount: legs.filter((leg) => leg.kind === "BASE").reduce((sum, leg) => sum + leg.amount, 0),
    legs,
    status: blocked ? "BLOCKED" : "READY",
    dryRun: params.dryRun === true,
    operationalDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    createdBy: params.actorUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (params.dryRun === true) return { ok: true, skipped: false, dryRun: true, distributionId, data: payload };
  await db.runTransaction(async (tx) => {
    const latest = await tx.get(distributionRef);
    if (latest.exists) return;
    tx.create(distributionRef, payload);
    tx.set(db.collection("commissionAuditEvents").doc(), {
      rootId, distributionId, paymentId: params.paymentId, event: "COMMISSION_CALCULATED",
      status: payload.status, actorUid: params.actorUid, createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, skipped: false, distributionId, data: payload };
}

function millis(value: any): number | null {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function preflightCommissionDistribution(params: { distributionId: string; actorUid: string; now?: number }) {
  const now = params.now || Date.now();
  const ref = db.doc(`commissionDistributions/${params.distributionId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Distribución no encontrada.");
  const distribution: any = snap.data() || {};
  if (distribution.sourceType === "USER_EARNINGS") return preflightUserEarningDistribution(params.distributionId, params.actorUid, now);
  const paymentSnap = await db.doc(`pagos/${text(distribution.paymentId)}`).get();
  const payment: any = paymentSnap.data() || {};
  const ruleSnapshot = distribution.ruleSnapshot || {};
  const reasons: Array<{ code: string; scope: "DISTRIBUTION" | "LEG"; legId?: string; message: string }> = [];
  if (!paymentSnap.exists || upper(payment.status) !== "CONCILIADO" || upper(payment.financialPostingStatus) !== "POSTED") reasons.push({ code: "PAYMENT_NOT_ELIGIBLE", scope: "DISTRIBUTION", message: "El pago no está conciliado y contabilizado." });
  let recalculation: any = null;
  try { recalculation = allocatePostedCommission(cents(distribution.totalCommissionAmount), ruleSnapshot); }
  catch { reasons.push({ code: "RULE_SNAPSHOT_INVALID", scope: "DISTRIBUTION", message: "El snapshot histórico de la regla no es válido." }); }
  if (recalculation && cents(distribution.totalCommissionAmount) !== recalculation.totalAmountMinor) reasons.push({ code: "COMMISSION_TOTAL_MISMATCH", scope: "DISTRIBUTION", message: "El total histórico no coincide con el recálculo del snapshot." });
  if (distribution.observedRateBps && Number(distribution.observedRateBps) !== Number(ruleSnapshot.totalRateBps)) reasons.push({ code: "COMMISSION_RATE_MISMATCH", scope: "DISTRIBUTION", message: "La tasa cobrada no coincide con el snapshot de distribución." });
  const despachoId = text(payment.despachoId);
  const despachoSnap = despachoId ? await db.doc(`despachos/${despachoId}`).get() : null;
  const despacho: any = despachoSnap?.data() || {};
  const originMarker = upper([despacho.erpProvider, despacho.provider, despacho.nombre, despacho.integrationType, despacho.channel].filter(Boolean).join(" "));
  if (!despachoSnap?.exists || !originMarker.includes("IQ")) reasons.push({ code: "IQ_ORIGIN_NOT_RESOLVED", scope: "DISTRIBUTION", message: "El pago no conserva un despacho de origen IQ utilizable." });
  const clientSnap = await db.doc(`clients/${text(distribution.clientId)}`).get();
  const client: any = clientSnap.data() || {};
  const clientIqId = text(client?.iqLink?.clientId || client.iqClientId);
  if (!clientIqId) reasons.push({ code: "IQ_CLIENT_LINK_MISSING", scope: "DISTRIBUTION", message: "El cliente no tiene vínculo canónico con IQ." });

  const evaluatedLegs: any[] = [];
  for (const leg of Array.isArray(distribution.legs) ? distribution.legs : []) {
    const methodSnap = await db.doc(`clientBeneficiaryMethods/${text(leg.methodId)}`).get();
    const method: any = methodSnap.data() || {};
    const legReasons: string[] = [];
    if (!methodSnap.exists || method.active === false) legReasons.push("INSTRUMENT_MISSING_OR_INACTIVE");
    const verifiedAt = millis(method.iqVerifiedAt);
    const freshness = evaluateIqLink({ status: method.iqLinkStatus, verifiedAtMs: verifiedAt, nowMs: now, maxAgeMs: IQ_LINK_MAX_AGE_MS, storedLast4: method.iqInstrumentLast4, currentLast4: method.last4 });
    legReasons.push(...freshness.reasons);
    if (upper(method.iqLinkStatus) === "VERIFIED" && freshness.reasons.some((reason) => reason === "IQ_LINK_STALE" || reason === "IQ_INSTRUMENT_CHANGED")) {
      await methodSnap.ref.set({ iqLinkStatus: "STALE", iqLastError: freshness.reasons.join(","), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    if (text(method.iqDespachoId) !== despachoId) legReasons.push("IQ_ORIGIN_CHANGED");
    if (!text(method.iqBeneficiaryId) || !text(method.iqAccountId)) legReasons.push("IQ_IDENTIFIERS_MISSING");
    for (const code of legReasons) reasons.push({ code, scope: "LEG", legId: leg.legId, message: `Destino ${leg.alias}: ${code}.` });
    evaluatedLegs.push({ ...leg, status: terminalCommissionLeg(leg) ? leg.status : legReasons.length ? "BLOCKED" : "READY", preflightReasons: legReasons, iqBeneficiaryId: text(method.iqBeneficiaryId) || null, iqAccountId: text(method.iqAccountId) || null, iqLinkVerifiedAt: verifiedAt ? new Date(verifiedAt).toISOString() : null, origin: { rootId: distribution.rootId, despachoId, iqCredentialProfileId: text(method.iqCredentialProfileId) || null, clientIqId: clientIqId || null } });
  }
  const decision = decideCommissionPreflight(reasons.filter((reason) => reason.scope === "DISTRIBUTION").map((reason) => reason.code), evaluatedLegs.map((leg: any) => leg.preflightReasons));
  const ready = decision.ready;
  const result = { status: ready ? "READY_FOR_EXECUTION" : "BLOCKED", checkedAt: new Date(now).toISOString(), reasons, payment: { id: distribution.paymentId, folio: distribution.pay0Folio, status: payment.status, financialPostingStatus: payment.financialPostingStatus }, commission: { grossAmount: distribution.grossAmount, totalCommissionAmount: distribution.totalCommissionAmount, differenceAmount: distribution.differenceAmount, ruleVersion: distribution.ruleVersion }, origin: { rootId: distribution.rootId, despachoId: despachoId || null, despachoName: text(despacho.nombre) || null, clientIqId: clientIqId || null }, legs: evaluatedLegs };
  await db.runTransaction(async tx => {
    const latest = await tx.get(ref);
    if (!latest.updateTime?.isEqual(snap.updateTime!)) throw new Error("La distribución cambió durante la revisión.");
    const preserve = (distribution.legs || []).some(terminalCommissionLeg);
    tx.update(ref, { preflight: result, ...(preserve ? {} : { status: ready ? "READY" : aggregateCommissionStatus(evaluatedLegs.map((leg: any) => leg.status)) }), updatedAt: FieldValue.serverTimestamp(), lastPreflightBy: params.actorUid });
  });
  return { ok: true, distributionId: params.distributionId, ...result };
}
