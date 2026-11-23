import type * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { logActivityTx } from "../../utils/logActivity";
import { buildBalanceAccountPatchFromMovement, buildBalanceMovement } from "../balances/service";
import { isIqDailySyncImport } from "../iq/historicalImportGuard";
import { planPagoPosting, type PagoPostingPlan } from "./pagoPostingPlan";

/**
 * Posts to the client's wallet a pago recovered from an IQ deposit, on the day of the deposit (owner decisions 2026-11-22/23):
 * the gross amount comes in and the commission IQ charged goes out, exactly as PAY0 does for its own pagos. It does not settle
 * advances (they are being eliminated), does not generate user earnings and does not reserve funds of a despacho.
 * One transaction per pago; a pago already posted is left alone, so a second run does nothing.
 */

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const PAGO_POSTING_ACTOR = "system:iq-daily-sync";

export type PagoPostingResult =
  | { status: "POSTED"; clientNetAmount: number; clientChargeAmount: number }
  | { status: "SKIPPED"; code: string; detail: string };

export async function postRecoveredPagoToWallet(db: admin.firestore.Firestore, rootId: string, pagoId: string, deposit: Record<string, unknown>): Promise<PagoPostingResult> {
  const pagoRef = db.doc(`pagos/${pagoId}`);
  return db.runTransaction(async (tx): Promise<PagoPostingResult> => {
    const pagoSnap = await tx.get(pagoRef);
    const pago = (pagoSnap.data() || {}) as Record<string, unknown>;
    if (!pagoSnap.exists || text(pago.rootId) !== rootId) return { status: "SKIPPED", code: "PAGO_OUT_OF_SCOPE", detail: "El pago no existe o no es de esta raíz." };
    // Only a pago the daily sync itself recovered from IQ: a pago PAY0 created is posted by its own flow.
    if (!isIqDailySyncImport(pago)) return { status: "SKIPPED", code: "PAGO_NOT_RECOVERED_FROM_IQ", detail: "El pago no fue traído de IQ por la sincronización." };

    const decision = planPagoPosting(deposit, pago);
    if (!decision.ok) return { status: "SKIPPED", code: decision.code, detail: decision.detail };
    const plan: PagoPostingPlan = decision.plan;

    const clientId = text(pago.clienteId || pago.clientId);
    const clientRef = db.doc(`clients/${clientId}`);
    const accountRef = db.doc(`balanceAccounts/CLIENT_${clientId}`);
    const [clientSnap, accountSnap] = await Promise.all([tx.get(clientRef), tx.get(accountRef)]);
    const client = (clientSnap.data() || {}) as Record<string, unknown>;
    if (!clientSnap.exists || text(client.rootId) !== rootId) return { status: "SKIPPED", code: "PAGO_CLIENT_OUT_OF_SCOPE", detail: "El cliente del pago no es de esta raíz." };
    const clientName = text(client.name || client.razonSocial || pago.clienteNombre) || clientId;
    const folio = text(pago.folio || pago.referenceFolio || pago.pagoFolio) || pagoId;

    const account = accountSnap.exists ? (accountSnap.data() as any) : undefined;
    const at = Timestamp.fromDate(new Date(plan.originalIso));
    const common = {
      rootId, holderType: "CLIENT" as const, holderId: clientId, holderRole: null, holderName: clientName, referenceId: pagoId, referenceFolio: folio, folio, pagoFolio: folio, sourceFolio: folio,
      depositId: pagoId, clienteId: clientId, currency: plan.currency, sourceModule: "DEPOSITS" as const, referenceType: "DEPOSIT" as const,
      createdBy: PAGO_POSTING_ACTOR, actorUsername: PAGO_POSTING_ACTOR, isSystemGenerated: true,
    };
    const marker = { source: "IQ_IMPORT", importMode: "DAILY_SYNC", importVersion: Number(pago.importVersion) || 1, importRunId: text(pago.importRunId) || `iqpago-${pagoId}`, canonicalIqProfileId: text(pago.canonicalIqProfileId), originalIqEntityId: text(pago.originalIqEntityId) };

    const before = money(Number(account?.availableBalance || 0));
    const gross = buildBalanceMovement({ ...common, movementType: "PAGO_RECIBIDO_BRUTO", movementSubType: "PAGO_CONCILIADO", direction: "IN", amount: plan.grossAmount, beforeBalance: before, displayConcept: "Pago recibido", note: "Pago recibido bruto." });
    let finalAccount = buildBalanceAccountPatchFromMovement(account, gross);
    tx.set(db.collection("balanceMovements").doc(), { ...gross, ...marker, createdAt: at, updatedAt: FieldValue.serverTimestamp() });

    if (plan.clientChargeAmount > 0) {
      const concept = `Comision por servicio ${plan.salePercentage}%`;
      const commission = buildBalanceMovement({ ...common, movementType: "COMISION_CLIENTE_COBRADA", movementSubType: "PERCENT", direction: "OUT", amount: plan.clientChargeAmount, beforeBalance: money(Number(finalAccount.availableBalance)), displayConcept: concept, note: concept });
      finalAccount = buildBalanceAccountPatchFromMovement(finalAccount, commission);
      tx.set(db.collection("balanceMovements").doc(), { ...commission, ...marker, createdAt: at, updatedAt: FieldValue.serverTimestamp() });
    }
    tx.set(accountRef, finalAccount, { merge: true });

    tx.update(pagoRef, {
      financialPostingStatus: "POSTED", financialPostingError: null, financialPostedAt: FieldValue.serverTimestamp(), financialPostingSource: "IQ_IMPORT",
      walletPostingStatus: "POSTED", walletPostedAt: FieldValue.serverTimestamp(), walletClientAmount: plan.clientNetAmount, retornoCliente: plan.clientNetAmount,
      totalComisionCliente: plan.clientChargeAmount, clientNetAmountGenerated: plan.clientNetAmount, finalClientRate: plan.salePercentage, pricingMode: "PERCENT",
      calculationBaseType: plan.baseType, saleTypeKey: plan.baseType, operationTypeKey: plan.operationType, iqSalePercentage: plan.salePercentage, iqBasePercentage: plan.basePercentage,
      advancePendingBeforeAmount: 0, advanceLiquidatedAmount: 0, advanceReleasedAmount: plan.clientNetAmount, advancePendingAfterAmount: 0, advanceLiquidatedIds: [],
      despachoAmount: 0, superadminAmount: 0, adminAmount: 0, operadorAmount: 0, clientBalanceEnabled: true, userEarningsEnabled: false, updatedAt: FieldValue.serverTimestamp(),
    });

    logActivityTx(tx, db, {
      event: "PAGO_ABONADO_A_CARTERA", rootId, adminId: text(client.adminId) || null, actorUid: PAGO_POSTING_ACTOR, actorUsername: PAGO_POSTING_ACTOR, actorRole: "system", entityType: "CLIENT", entityId: clientId,
      amount: plan.clientNetAmount, referenceId: pagoId, referenceFolio: folio, referenceType: "DEPOSIT", createdBy: PAGO_POSTING_ACTOR,
      description: `Pago ${folio} traído de IQ abonado a la cartera con su fecha original: ${plan.grossAmount} menos comisión ${plan.clientChargeAmount} (${plan.salePercentage}%), neto ${plan.clientNetAmount}.`,
      extra: { source: "IQ_IMPORT", grossAmount: plan.grossAmount, clientChargeAmount: plan.clientChargeAmount, clientNetAmount: plan.clientNetAmount, salePercentage: plan.salePercentage, baseType: plan.baseType, originalDate: plan.originalIso.slice(0, 10) },
    });

    return { status: "POSTED", clientNetAmount: plan.clientNetAmount, clientChargeAmount: plan.clientChargeAmount };
  });
}
