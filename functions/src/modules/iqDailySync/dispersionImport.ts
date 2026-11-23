import type * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { logActivityTx } from "../../utils/logActivity";
import { buildBalanceAccountPatchFromMovement, buildBalanceMovement } from "../balances/service";
import { isMergedClient } from "../clients/mergeDomain";
import { resolveIqPay0Identity } from "../iq/iqPay0Identity";
import { P4_PLAN_GROUPS, type Pay0PlanRow } from "../iqHistoricalImport/planner";
import { buildCanonicalFolio, nextSequenceTx } from "../sequences/service";
import {
  historicalDispersionFolio, historicalDispersionId, methodDedupeKey, methodDocId, resolveDispersionClient, type ParsedIqDispersion,
} from "./dispersionPlan";

/**
 * Creates in PAY0 a dispersion that was made directly in IQ, with its original date (owner decisions 2026-11-23):
 * the beneficiary and the destination account when they do not exist, the dispersion record, and the debit of the
 * client's balance (principal, plus the commission when IQ charged one). It does not send anything to IQ, does not
 * reserve funds from a despacho, does not consume PAY0's dispersion numbering and does not generate user earnings.
 *
 * Everything happens in one transaction: either the whole dispersion exists afterwards or nothing does, and a second
 * run finds it and does nothing.
 */

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const OPERATION_TYPE_NAME: Record<string, string> = { TRANSFERENCIA: "Transferencia", TDC: "Pago a tarjeta de crédito", EFECTIVO: "Efectivo" };
export const DISPERSION_IMPORT_ACTOR = "system:iq-daily-sync";
export const DISPERSION_IMPORT_VERSION = 1;

export type DispersionImportResult =
  | { status: "CREATED"; dispersionId: string; createdBeneficiary: boolean; createdMethod: boolean; createdOperationType: boolean }
  | { status: "EXISTS"; dispersionId: string }
  | { status: "REVIEW"; code: string; detail: string };

class Review extends Error { constructor(readonly code: string, readonly detail: string) { super(code); } }
const review = (code: string, detail: string) => new Review(code, detail);

const dayDistance = (a: Date, b: Date) => Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));

export async function importIqDispersion(db: admin.firestore.Firestore, rootId: string, parsed: ParsedIqDispersion, pay0Rows: Pay0PlanRow[]): Promise<DispersionImportResult> {
  const group = P4_PLAN_GROUPS[parsed.groupId];
  const identity = group ? resolveIqPay0Identity({ canonicalIqGroupId: parsed.groupId, canonicalIqProfileId: group.canonicalIqProfileId }) : null;
  if (!group || !identity) return { status: "REVIEW", code: "DISPERSION_GROUP_UNKNOWN", detail: "El grupo de IQ no tiene un dueño configurado." };
  const ownerAdminId = identity.pay0UserId;

  const resolved = resolveDispersionClient({ groupId: parsed.groupId, clientName: parsed.clientName, pay0Rows });
  if (!resolved.ok) return { status: "REVIEW", code: resolved.code, detail: resolved.detail };
  const clientId = resolved.clientId;

  const principalId = historicalDispersionId(rootId, parsed.groupId, parsed.iqId);
  const folio = historicalDispersionFolio(parsed.groupId, parsed.iqId);
  const originalAt = new Date(parsed.createdAtIso);
  const methodId = methodDocId(clientId, parsed.destination);
  const dedupeKey = methodDedupeKey(parsed.destination);
  const totalDebit = money(parsed.amount + parsed.clientChargeAmount);

  try {
    return await db.runTransaction(async (tx): Promise<DispersionImportResult> => {
      const principalRef = db.doc(`clientDispersions/${principalId}`);
      const clientRef = db.doc(`clients/${clientId}`);
      const ownerRef = db.doc(`users/${ownerAdminId}`);
      const accountRef = db.doc(`balanceAccounts/CLIENT_${clientId}`);
      const typeRef = db.doc(`operationTypes/${parsed.operationTypeKey}`);
      const methodRef = db.doc(`clientBeneficiaryMethods/${methodId}`);

      const [principalSnap, clientSnap, ownerSnap, accountSnap, typeSnap, methodSnap, beneficiaries, sameClientDispersions] = await Promise.all([
        tx.get(principalRef), tx.get(clientRef), tx.get(ownerRef), tx.get(accountRef), tx.get(typeRef), tx.get(methodRef),
        tx.get(db.collection("clientBeneficiaries").where("clientId", "==", clientId).limit(500)),
        tx.get(db.collection("clientDispersions").where("rootId", "==", rootId).where("clientId", "==", clientId).limit(400)),
      ]);

      if (principalSnap.exists) return { status: "EXISTS", dispersionId: principalId };

      // The client and its owner, as they are now.
      const client = (clientSnap.data() || {}) as Record<string, unknown>;
      if (!clientSnap.exists || text(client.rootId) !== rootId || text(client.adminId) !== ownerAdminId) throw review("DISPERSION_CLIENT_CHANGED", "El cliente cambió o ya no es del dueño de este grupo de IQ.");
      if (client.active === false || client.isDeleted === true || isMergedClient(client as Record<string, any>)) throw review("DISPERSION_CLIENT_NOT_ACTIVE", "El cliente está inactivo o fusionado.");
      const clientNumber = Number(client.clientNumber ?? client.numeroCliente ?? client.sequenceNumber ?? 0);
      const clientName = text(client.name || client.razonSocial) || parsed.clientName;

      // A dispersion PAY0 already made but whose IQ number was never written back: same client, amount and day.
      const lookalike = sameClientDispersions.docs.find((doc) => {
        const data = doc.data();
        if (text(data.iqDispersionId) || (Array.isArray(data.iqDispersionFolios) && data.iqDispersionFolios.length)) return false;
        if (money(Number(data.amount)) !== parsed.amount) return false;
        const at = data.createdAt?.toDate?.() as Date | undefined;
        return !!at && dayDistance(at, originalAt) <= 1;
      });
      if (lookalike) throw review("POSSIBLE_PAY0_DUPLICATE", "Parece una dispersión que PAY0 ya hizo (mismo cliente, monto y día) y que no quedó enlazada a IQ.");

      // The dispersion type: created when PAY0 does not have it yet; the owner sets its costs later.
      const operationType = (typeSnap.data() || {}) as Record<string, unknown>;
      const createOperationType = !typeSnap.exists;
      if (typeSnap.exists && (operationType.active === false || text(operationType.category).toUpperCase() !== "DISPERSION")) throw review("DISPERSION_TYPE_UNUSABLE", "El tipo de dispersión de PAY0 está inactivo o no es de dispersiones.");
      const operationTypeName = text(operationType.name || operationType.nombre) || OPERATION_TYPE_NAME[parsed.operationTypeKey] || parsed.operationTypeKey;

      // The destination account and its beneficiary.
      let beneficiaryId = "";
      let beneficiaryName = parsed.beneficiaryName;
      const method = (methodSnap.data() || {}) as Record<string, unknown>;
      if (methodSnap.exists) {
        if (method.active === false) throw review("DISPERSION_METHOD_INACTIVE", "La cuenta del beneficiario existe en PAY0 pero está inactiva.");
        beneficiaryId = text(method.beneficiaryId || method.beneficiarioId);
        const owner = beneficiaries.docs.find((doc) => doc.id === beneficiaryId);
        beneficiaryName = text(owner?.get("nombre")) || beneficiaryName;
      }
      const existingBeneficiary = !beneficiaryId ? beneficiaries.docs.find((doc) => text(doc.get("nombreNormalizado") || doc.get("nombre")).toUpperCase() === parsed.beneficiaryName && doc.get("active") !== false) : null;

      // New folios are needed only when a beneficiary has to be created; they follow PAY0's own numbering.
      const createBeneficiary = !beneficiaryId && !existingBeneficiary;
      const createMethod = !methodSnap.exists;
      const owner = (ownerSnap.data() || {}) as Record<string, unknown>;
      const userNumber = Number(owner.userNumber ?? owner.numeroUsuario ?? owner.sequenceNumber ?? 0);
      if (createBeneficiary && (!(clientNumber > 0) || !(userNumber > 0))) throw review("DISPERSION_NUMBERING_MISSING", "Falta el número de cliente o de usuario para dar de alta al beneficiario.");

      let beneficiaryRef = existingBeneficiary?.ref || (beneficiaryId ? db.doc(`clientBeneficiaries/${beneficiaryId}`) : db.collection("clientBeneficiaries").doc());
      if (existingBeneficiary) beneficiaryId = existingBeneficiary.id;
      if (!beneficiaryId) beneficiaryId = beneficiaryRef.id;
      const beneficiaryDisplayName = existingBeneficiary ? text(existingBeneficiary.get("nombre")) || parsed.beneficiaryName : beneficiaryName;

      let beneficiaryFolio = existingBeneficiary ? text(existingBeneficiary.get("beneficiaryFolio") || existingBeneficiary.get("folio")) : "";
      let beneficiarySequence: { sequenceNumber: number; counterPath: string } | null = null;
      if (createBeneficiary) {
        beneficiarySequence = await nextSequenceTx({ db, tx, rootId, scope: "beneficiaries", scopeKey: `cliente_${clientId}__usuario_${ownerAdminId}` });
        beneficiaryFolio = buildCanonicalFolio("B", beneficiarySequence.sequenceNumber, [{ label: "C", value: clientNumber }, { label: "U", value: userNumber }]);
      }

      // The client's balance after the debit(s), dated on the original day.
      const account = accountSnap.exists ? (accountSnap.data() as any) : undefined;
      const before = money(Number(account?.availableBalance || 0));
      const at = Timestamp.fromDate(originalAt);
      const marker = { source: "IQ_IMPORT", importMode: "DAILY_SYNC", importVersion: DISPERSION_IMPORT_VERSION, importRunId: `iqdispersion-${principalId}`, canonicalIqProfileId: group.canonicalIqProfileId, originalIqEntityId: parsed.iqId };

      const principalMovement = buildBalanceMovement({
        rootId, holderType: "CLIENT", holderId: clientId, holderRole: null, holderName: clientName, movementType: "DISPERSION_REGISTRADA", movementSubType: parsed.operationTypeKey,
        direction: "OUT", amount: parsed.amount, beforeBalance: before, sourceModule: "FINANCING", referenceType: "DISPERSION", referenceId: principalId, referenceFolio: folio,
        folio, dispersionFolio: folio, dispersionId: principalId, clienteId: clientId, beneficiaryId, beneficiaryNombre: beneficiaryDisplayName, methodId, destinationKind: parsed.destination.kind,
        bankName: parsed.bankName || null, displayConcept: `${parsed.operationTypeKey === "TDC" ? "PAGO TDC" : "TRANSFERENCIA"} ${parsed.destination.digits}`, currency: parsed.currency,
        createdBy: DISPERSION_IMPORT_ACTOR, actorUsername: DISPERSION_IMPORT_ACTOR, isSystemGenerated: true,
      });
      let finalAccount = buildBalanceAccountPatchFromMovement(account, principalMovement);
      const principalMovementRef = db.collection("balanceMovements").doc();
      tx.set(principalMovementRef, { ...principalMovement, ...marker, createdAt: at, updatedAt: FieldValue.serverTimestamp() });

      let commissionMovementId: string | null = null;
      if (parsed.clientChargeAmount > 0) {
        const commissionMovement = buildBalanceMovement({
          rootId, holderType: "CLIENT", holderId: clientId, holderRole: null, holderName: clientName, movementType: "COMISION_CLIENTE_COBRADA", movementSubType: parsed.operationTypeKey,
          direction: "OUT", amount: parsed.clientChargeAmount, beforeBalance: money(Number(finalAccount.availableBalance)), sourceModule: "FINANCING", referenceType: "DISPERSION", referenceId: principalId,
          referenceFolio: folio, folio, dispersionFolio: folio, dispersionId: principalId, clienteId: clientId, currency: parsed.currency,
          createdBy: DISPERSION_IMPORT_ACTOR, actorUsername: DISPERSION_IMPORT_ACTOR, isSystemGenerated: true,
        });
        finalAccount = buildBalanceAccountPatchFromMovement(finalAccount, commissionMovement);
        const commissionRef = db.collection("balanceMovements").doc();
        commissionMovementId = commissionRef.id;
        tx.set(commissionRef, { ...commissionMovement, ...marker, createdAt: at, updatedAt: FieldValue.serverTimestamp() });
      }
      tx.set(accountRef, finalAccount, { merge: true });

      // The operation type, the beneficiary and the account, when they did not exist.
      if (createOperationType) {
        tx.set(typeRef, {
          key: parsed.operationTypeKey, name: operationTypeName, nombre: operationTypeName, category: "DISPERSION", active: true, createdBy: DISPERSION_IMPORT_ACTOR,
          note: "Creado al traer dispersiones de IQ; los costos todavía no están configurados.", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        });
      }
      const common = { rootId, adminId: ownerAdminId, operadorId: null, actorUid: DISPERSION_IMPORT_ACTOR, actorRole: "system", createdBy: DISPERSION_IMPORT_ACTOR, updatedBy: DISPERSION_IMPORT_ACTOR, clientId, clienteId: clientId };
      if (createBeneficiary && beneficiarySequence) {
        tx.set(beneficiaryRef, {
          ...common, nombre: parsed.beneficiaryName, nombreNormalizado: parsed.beneficiaryName, beneficiaryNumber: beneficiarySequence.sequenceNumber, numeroBeneficiario: beneficiarySequence.sequenceNumber,
          sequenceNumber: beneficiarySequence.sequenceNumber, beneficiaryFolio, folio: beneficiaryFolio, sequenceScope: `beneficiaries:${rootId}:C${clientNumber}:U${userNumber}`,
          sequenceCounterPath: beneficiarySequence.counterPath, createdUsername: DISPERSION_IMPORT_ACTOR, active: true, methodCount: 1, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
          ...marker,
        });
      } else if (createMethod && existingBeneficiary) {
        tx.set(beneficiaryRef, { methodCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      if (createMethod) {
        const digits = parsed.destination.digits;
        tx.create(methodRef, {
          ...common, beneficiaryId, beneficiarioId: beneficiaryId, beneficiaryFolio, beneficiaryNumber: beneficiarySequence?.sequenceNumber ?? existingBeneficiary?.get("beneficiaryNumber") ?? null,
          numeroBeneficiario: beneficiarySequence?.sequenceNumber ?? existingBeneficiary?.get("numeroBeneficiario") ?? null,
          tipo: "DEBITO", destinationKind: parsed.destination.kind, bankCode: parsed.destination.bankCode, bankName: parsed.bankName || null,
          clabe: parsed.destination.kind === "CLABE" ? digits : null, cardNumber: parsed.destination.kind === "TARJETA" ? digits : null, last4: digits.slice(-4),
          masked: `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`, dedupeKey, iqLinkStatus: "PENDING", iqBeneficiaryId: null, iqAccountId: null, iqLastSyncedAt: null, iqLastError: null,
          active: true, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), ...marker,
        });
      }

      // The dispersion itself.
      const concept = `${parsed.operationTypeKey === "TDC" ? "PAGO TDC" : "TRANSFERENCIA"} ${parsed.destination.digits}`;
      tx.set(principalRef, {
        rootId, clienteId: clientId, clientId, clienteNombre: clientName, adminId: ownerAdminId, operadorId: null, actorUid: DISPERSION_IMPORT_ACTOR, actorRole: "system",
        folio, referenceFolio: folio, dispersionFolio: folio, sourceFolio: folio, operationalReference: folio, displayConcept: concept, folioVersion: 1,
        beneficiaryId, beneficiaryNombre: beneficiaryDisplayName, methodId, methodTipo: "DEBITO", destinationKind: parsed.destination.kind, bankCode: parsed.destination.bankCode,
        bankName: parsed.bankName || null, clabe: parsed.destination.kind === "CLABE" ? parsed.destination.digits : null, cardNumber: parsed.destination.kind === "TARJETA" ? parsed.destination.digits : null,
        operationTypeKey: parsed.operationTypeKey, operationTypeName, currency: parsed.currency, amount: parsed.amount, clientChargeAmount: parsed.clientChargeAmount,
        totalClientDebitAmount: totalDebit, despachoCostAmount: 0, superadminEarningAmount: 0, adminEarningAmount: 0, operadorEarningAmount: 0, totalEarningsAmount: 0,
        pricingSnapshot: { source: "IQ_IMPORT", salePercentage: parsed.salePercentage, clientChargeAmount: parsed.clientChargeAmount, note: "Dispersión hecha en IQ; los costos de PAY0 no se aplican." },
        fundingSource: { holderType: "CLIENT", holderId: clientId },
        status: "REGISTRADA", note: null, reference: null, cashReceiptStatus: null,
        balanceMovementId: principalMovementRef.id, principalMovementId: principalMovementRef.id, commissionMovementId, earningMovementIds: [],
        iqDispersionId: parsed.iqId, iqDispersionFolio: parsed.iqId, iqDispersionFolios: [parsed.iqId], iqGenerationStatus: "IQ_GENERADA", iqGenerationVersion: "IQ_IMPORT",
        iqGenerationUpdatedAt: at, iqOperationStatus: "TERMINADA", canonicalIqGroupId: parsed.groupId, iqCredentialProfileId: group.canonicalIqProfileId,
        createdBy: DISPERSION_IMPORT_ACTOR, createdUsername: DISPERSION_IMPORT_ACTOR, createdAt: at, updatedAt: FieldValue.serverTimestamp(), importedAt: FieldValue.serverTimestamp(), ...marker,
      });

      logActivityTx(tx, db, {
        event: "DISPERSION_REGISTRADA", rootId, adminId: ownerAdminId, actorUid: DISPERSION_IMPORT_ACTOR, actorUsername: DISPERSION_IMPORT_ACTOR, actorRole: "system",
        entityType: "CLIENT", entityId: clientId, amount: totalDebit, referenceId: principalId, referenceFolio: folio, referenceType: "DISPERSION", createdBy: DISPERSION_IMPORT_ACTOR,
        description: `Dispersión ${folio} traída de IQ con su fecha original (${parsed.date}) por ${parsed.amount} para ${beneficiaryDisplayName}.`,
        extra: { source: "IQ_IMPORT", iqDispersionId: parsed.iqId, originalDate: parsed.date, createdBeneficiary: createBeneficiary, createdMethod: createMethod, createdOperationType: createOperationType },
      });

      return { status: "CREATED", dispersionId: principalId, createdBeneficiary: createBeneficiary, createdMethod: createMethod, createdOperationType: createOperationType };
    });
  } catch (error) {
    if (error instanceof Review) return { status: "REVIEW", code: error.code, detail: error.detail };
    throw error;
  }
}
