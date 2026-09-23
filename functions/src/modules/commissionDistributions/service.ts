import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { calculateCommissionDistribution } from "./domain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const cents = (value: unknown) => Math.round(Number(value || 0) * 100);

function stableId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

export async function materializeCommissionDistribution(params: {
  paymentId: string;
  actorUid: string;
  dryRun?: boolean;
}) {
  const paymentRef = db.doc(`pagos/${params.paymentId}`);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) throw new Error("Pago no encontrado.");
  const payment: any = paymentSnap.data() || {};
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
  const calculation = calculateCommissionDistribution(grossMinor, {
    totalRateBps: rule.totalRateBps,
    legs: rule.legs,
  });
  const postedCommissionMinor = cents(payment.totalComisionCliente);
  if (postedCommissionMinor !== calculation.totalAmountMinor) {
    throw new Error(`La comisión contabilizada (${postedCommissionMinor}) no coincide con la regla (${calculation.totalAmountMinor}).`);
  }
  const distributionId = stableId(`${rootId}|${params.paymentId}|${rule.version || 1}`);
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
    return {
      ...leg,
      amount: leg.amountMinor / 100,
      beneficiaryName: text(beneficiary.nombre || beneficiary.name) || null,
      instrumentMasked: text(method.masked) || null,
      bankName: text(method.bankName) || null,
      iqBeneficiaryId: verified ? text(method.iqBeneficiaryId) : null,
      iqAccountId: verified ? text(method.iqAccountId) : null,
      iqFolio: null,
      status: verified ? "READY" : "PENDING_INSTRUMENT_VERIFICATION",
      errorCode: verified ? null : "IQ_INSTRUMENT_NOT_VERIFIED",
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
    ruleSnapshot: { totalRateBps: calculation.totalRateBps, legs: rule.legs },
    grossAmount: calculation.grossMinor / 100,
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
