import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { buildBalanceAccountPatchFromMovement, buildBalanceMovement } from "../balances/service";
import { createBalanceMovementTx, readBalanceAccountTx, upsertBalanceAccountTx } from "../balances/repository";
import { money2 } from "../shared/money";
import { applyPendingAdvancesOnClientNetTx } from "../financing/service";
import type { BalanceMovementType, HolderType, Pay0Role } from "../shared/domain";
import {
  applyForwardOnlyPaymentTx,
  prepareForwardOnlyPaymentTx,
  type ForwardOnlyCredit,
} from "../dispatchBalances/forwardOnly";
import { logActivityTx } from "../../utils/logActivity";

type AnyDoc = Record<string, any>;
type BaseType = "TOTAL" | "SUBTOTAL";
type PricingMode = "PERCENT" | "FIXED";

const H4_D65_A2_FINANCIAL_SNAPSHOT_VERSION = "H4_D65_A2_V1";

export interface PostCanonicalPagoFinancialsParams {
  db: Firestore;
  rootId: string;
  pagoId: string;
  actorUid: string;
  actorUsername: string;
  actorRole: string;
  sourceChannel?: string | null;
}

export interface PostCanonicalPagoFinancialsResult {
  ok: boolean;
  status: string;
  snapshotId?: string | null;
  distributionId?: string | null;
  dispatchCostId?: string | null;
  clientNetAmount?: number;
  clientChargeAmount?: number;
  errorMessage?: string | null;
}

type ResolvedCost = {
  rate: number;
  calculationBaseType: BaseType;
  pricingMode: PricingMode;
  operationTypeName: string;
  sourcePath: string | null;
};

type UserMeta = {
  userId: string;
  role: Pay0Role | null;
  holderName: string;
};

type OperationFinancialFlags = {
  generatesClientBalance: boolean;
  generatesUserEarnings: boolean;
  allowsDispersion: boolean;
};

function asText(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): AnyDoc {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyDoc)
    : {};
}

function firstText(doc: AnyDoc | null | undefined, keys: string[]) {
  const source = doc || {};
  for (const key of keys) {
    const value = asText(source[key]);
    if (value) return value;
  }
  return "";
}

function firstMoney(doc: AnyDoc | null | undefined, keys: string[]) {
  const source = doc || {};
  for (const key of keys) {
    const raw = source[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const num = Number(raw);
    if (Number.isFinite(num)) return money2(num);
  }
  return 0;
}

function normalizeBaseType(value: unknown): BaseType {
  return asText(value).toUpperCase() === "SUBTOTAL" ? "SUBTOTAL" : "TOTAL";
}

function normalizePricingMode(value: unknown): PricingMode {
  const mode = asText(value).toUpperCase();
  return mode === "FIXED" ? "FIXED" : "PERCENT";
}

function booleanDefaultTrue(value: unknown) {
  return typeof value === "boolean" ? value : true;
}

function baseAmountFromGross(grossAmount: number, baseType: BaseType) {
  const gross = money2(grossAmount);
  if (baseType === "SUBTOTAL") {
    return money2(gross / 1.16);
  }
  return gross;
}

function amountFromRate(
  grossAmount: number,
  rate: number,
  baseType: BaseType,
  pricingMode: PricingMode,
): number {
  const normalizedRate = money2(rate);
  if (pricingMode === "FIXED") return normalizedRate;
  return money2(baseAmountFromGross(grossAmount, baseType) * (normalizedRate / 100));
}

function resolveAssignedCost(doc: AnyDoc | null, fallbackName: string): ResolvedCost | null {
  if (!doc || doc.active === false) return null;
  const rate = firstMoney(doc, ["rate", "assignedCost", "baseCost"]);
  if (rate <= 0) return null;
  return {
    rate,
    calculationBaseType: normalizeBaseType(doc.calculationBaseType),
    pricingMode: normalizePricingMode(doc.pricingMode),
    operationTypeName: firstText(doc, ["operationTypeName"]) || fallbackName,
    sourcePath: firstText(doc, ["sourcePath"]) || null,
  };
}

function resolveDespachoCost(doc: AnyDoc | null, fallbackName: string): ResolvedCost | null {
  if (!doc || doc.active === false) return null;
  const rate = firstMoney(doc, ["rate", "baseCost", "assignedCost"]);
  if (rate <= 0) return null;
  return {
    rate,
    calculationBaseType: normalizeBaseType(doc.calculationBaseType),
    pricingMode: normalizePricingMode(doc.pricingMode),
    operationTypeName: firstText(doc, ["operationTypeName"]) || fallbackName,
    sourcePath: firstText(doc, ["sourcePath"]) || null,
  };
}

function validateRateHierarchy(params: {
  despachoCostAmount: number;
  adminBaseAmount: number | null;
  operadorBaseAmount: number | null;
  clientChargeAmount: number;
}) {
  const levels: Array<{ label: string; amount: number }> = [
    { label: "despacho", amount: money2(params.despachoCostAmount) },
  ];

  if (params.adminBaseAmount !== null) {
    levels.push({ label: "admin", amount: money2(params.adminBaseAmount) });
  }
  if (params.operadorBaseAmount !== null) {
    levels.push({ label: "operador", amount: money2(params.operadorBaseAmount) });
  }
  levels.push({ label: "cliente", amount: money2(params.clientChargeAmount) });

  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1];
    const current = levels[index];
    if (previous.amount > current.amount) {
      return {
        ok: false,
        message: `Jerarquia financiera invalida: ${previous.label} ${previous.amount} excede ${current.label} ${current.amount}.`,
      };
    }
  }

  return { ok: true, message: null as string | null };
}

async function readUserMetaTx(
  tx: Transaction,
  db: Firestore,
  userId: string | null,
  fallbackRole: Pay0Role | null,
): Promise<UserMeta | null> {
  const resolvedUserId = asText(userId);
  if (!resolvedUserId) return null;

  const snap = await tx.get(db.doc(`users/${resolvedUserId}`));
  const data = snap.exists ? ((snap.data() || {}) as AnyDoc) : {};
  const rawRole = asText(data.role || fallbackRole).toLowerCase();

  let role: Pay0Role | null = null;
  if (rawRole === "superadmin" || rawRole === "admin" || rawRole === "operador") {
    role = rawRole as Pay0Role;
  }

  const holderName =
    firstText(data, ["username", "displayName", "name", "email"]) ||
    resolvedUserId;

  return {
    userId: resolvedUserId,
    role,
    holderName,
  };
}

async function creditBalanceTx(params: {
  tx: Transaction;
  db: Firestore;
  rootId: string;
  holderType: HolderType;
  holderId: string;
  holderRole: Pay0Role | null;
  holderName: string;
  amount: number;
  direction?: "IN" | "OUT";
  movementType: BalanceMovementType;
  movementSubType?: string | null;
  referenceId: string;
  referenceFolio?: string | null;
  folio?: string | null;
  pagoFolio?: string | null;
  sourceFolio?: string | null;
  depositId: string;
  clienteId?: string | null;
  empresaId?: string | null;
  empresaNombre?: string | null;
  beneficiaryId?: string | null;
  beneficiaryNombre?: string | null;
  methodId?: string | null;
  methodTipo?: string | null;
  destinationKind?: string | null;
  bankName?: string | null;
  operationalReference?: string | null;
  displayConcept?: string | null;
  currency?: string | null;
  actorDisplayName?: string | null;
  asociadoId?: string | null;
  adminId?: string | null;
  operadorId?: string | null;
  note?: string | null;
  createdBy: string;
  actorUsername: string;
  current?: AnyDoc;
}) {
  const amount = money2(params.amount);
  if (amount <= 0) return null;

  const current = params.current;
  const beforeBalance = money2(current?.availableBalance || 0);
  const movementRef = params.db.collection("balanceMovements").doc();

  const movement = buildBalanceMovement({
    rootId: params.rootId,
    holderType: params.holderType,
    holderId: params.holderId,
    holderRole: params.holderRole,
    holderName: params.holderName,
    movementType: params.movementType,
    movementSubType: params.movementSubType ?? null,
    direction: params.direction ?? "IN",
    amount,
    beforeBalance,
    sourceModule: "DEPOSITS",
    referenceType: "DEPOSIT",
    referenceId: params.referenceId,
    referenceFolio: params.referenceFolio ?? null,
    folio: params.folio ?? null,
    pagoFolio: params.pagoFolio ?? null,
    sourceFolio: params.sourceFolio ?? null,
    depositId: params.depositId,
    clienteId: params.clienteId ?? null,
    empresaId: params.empresaId ?? null,
    empresaNombre: params.empresaNombre ?? null,
    beneficiaryId: params.beneficiaryId ?? null,
    beneficiaryNombre: params.beneficiaryNombre ?? null,
    methodId: params.methodId ?? null,
    methodTipo: params.methodTipo ?? null,
    destinationKind: params.destinationKind ?? null,
    bankName: params.bankName ?? null,
    operationalReference: params.operationalReference ?? null,
    displayConcept: params.displayConcept ?? null,
    currency: params.currency ?? "MXN",
    actorDisplayName: params.actorDisplayName ?? params.actorUsername,
    asociadoId: params.asociadoId ?? null,
    adminId: params.adminId ?? null,
    operadorId: params.operadorId ?? null,
    note: params.note ?? null,
    createdBy: params.createdBy,
    actorUsername: params.actorUsername,
    isSystemGenerated: true,
  });

  const accountPatch = buildBalanceAccountPatchFromMovement(current, movement);
  createBalanceMovementTx(params.tx, params.db, movement, movementRef.id);
  upsertBalanceAccountTx(params.tx, params.db, params.holderType, params.holderId, accountPatch);
  return { movementId: movementRef.id, accountPatch };
}

function buildSkipPayload(status: string, errorMessage: string | null) {
  return {
    financialPostingStatus: status,
    financialPostingError: errorMessage || null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function postCanonicalPagoFinancials(
  params: PostCanonicalPagoFinancialsParams,
): Promise<PostCanonicalPagoFinancialsResult> {
  const { db, rootId, pagoId, actorUid, actorUsername, actorRole, sourceChannel } = params;
  const pagoRef = db.doc(`pagos/${pagoId}`);

  try {
    return await db.runTransaction(async (tx) => {
      const pagoSnap = await tx.get(pagoRef);
      if (!pagoSnap.exists) {
        return { ok: false, status: "PAGO_NOT_FOUND", snapshotId: null };
      }

      const pago = (pagoSnap.data() || {}) as AnyDoc;
      if (asText(pago.rootId) !== rootId) {
        return { ok: false, status: "OUT_OF_SCOPE", snapshotId: null };
      }

      const financialPostingStatus = asText(pago.financialPostingStatus).toUpperCase();
      if (financialPostingStatus === "POSTED") {
        return {
          ok: true,
          status: "POSTED",
          snapshotId: asText(pago.financialSnapshotId) || null,
        };
      }

      if (asText(pago.status).toUpperCase() !== "CONCILIADO") {
        return { ok: false, status: "NOT_CONCILIATED", snapshotId: null };
      }

      const clienteId = firstText(pago, ["clienteId", "clientId"]);
      const companyId = firstText(pago, ["companyId"]);
      const pagoFolio =
        firstText(pago, ["folio", "referenceFolio", "pagoFolio", "referencia", "reference", "uuid", "uuidCfdi"]) ||
        pagoId;
      const asociadoId = firstText(pago, ["asociadoId"]) || null;
      const grossAmount = money2(pago.montoTotal || 0);

      if (!clienteId || !companyId || grossAmount <= 0) {
        tx.set(
          pagoRef,
          buildSkipPayload("SKIPPED_MISSING_PAGO_BASE", "Pago sin base minima para posteo financiero."),
          { merge: true },
        );
        return { ok: false, status: "SKIPPED_MISSING_PAGO_BASE", snapshotId: null };
      }

      const assignmentSnapshot = asRecord(pago.financialAssignmentSnapshot);
      if (asText(assignmentSnapshot.version) !== H4_D65_A2_FINANCIAL_SNAPSHOT_VERSION) {
        tx.set(
          pagoRef,
          buildSkipPayload(
            "SKIPPED_MISSING_FINANCIAL_SNAPSHOT",
            "Pago sin fotografia financiera H4-D65-A2. No se resolveran costos historicos en vivo.",
          ),
          { merge: true },
        );
        return { ok: false, status: "SKIPPED_MISSING_FINANCIAL_SNAPSHOT", snapshotId: null };
      }

      const clientSnap = await tx.get(db.doc(`clients/${clienteId}`));
      const companySnap = await tx.get(db.doc(`companies/${companyId}`));

      if (!clientSnap.exists || !companySnap.exists) {
        tx.set(
          pagoRef,
          buildSkipPayload("SKIPPED_MISSING_REFERENCES", "Cliente o empresa no encontrados."),
          { merge: true },
        );
        return { ok: false, status: "SKIPPED_MISSING_REFERENCES", snapshotId: null };
      }

      const clientDoc = (clientSnap.data() || {}) as AnyDoc;
      const companyDoc = (companySnap.data() || {}) as AnyDoc;

      const despachoId = firstText(assignmentSnapshot, ["despachoId"]);
      const operationTypeKey = firstText(assignmentSnapshot, ["operationTypeKey"]);
      const operationTypeName = firstText(assignmentSnapshot, ["operationTypeName"]) || operationTypeKey;

      if (!despachoId) {
        tx.set(
          pagoRef,
          buildSkipPayload("SKIPPED_MISSING_DESPACHO", "Fotografia financiera sin despacho."),
          { merge: true },
        );
        return { ok: false, status: "SKIPPED_MISSING_DESPACHO", snapshotId: null };
      }

      if (!operationTypeKey) {
        tx.set(
          pagoRef,
          buildSkipPayload("SKIPPED_MISSING_OPERATION_TYPE", "Fotografia financiera sin operationTypeKey."),
          { merge: true },
        );
        return { ok: false, status: "SKIPPED_MISSING_OPERATION_TYPE", snapshotId: null };
      }

      const clientCostRaw = asRecord(assignmentSnapshot.clientCost);
      const despachoCostRaw = asRecord(assignmentSnapshot.despachoCost);
      const adminCostRaw = Object.keys(asRecord(assignmentSnapshot.adminCost)).length > 0
        ? asRecord(assignmentSnapshot.adminCost)
        : null;
      const operadorCostRaw = Object.keys(asRecord(assignmentSnapshot.operadorCost)).length > 0
        ? asRecord(assignmentSnapshot.operadorCost)
        : null;

      const clientCost = resolveAssignedCost(clientCostRaw, operationTypeName);
      const despachoCost = resolveDespachoCost(despachoCostRaw, operationTypeName);
      const adminCost = resolveAssignedCost(adminCostRaw, operationTypeName);
      const operadorCost = resolveAssignedCost(operadorCostRaw, operationTypeName);

      if (!clientCost) {
        tx.set(
          pagoRef,
          buildSkipPayload("SKIPPED_MISSING_CLIENT_RATE", "Costo cliente ausente o inactivo en la fotografia financiera."),
          { merge: true },
        );
        return { ok: false, status: "SKIPPED_MISSING_CLIENT_RATE", snapshotId: null };
      }

      if (!despachoCost) {
        tx.set(
          pagoRef,
          buildSkipPayload("SKIPPED_MISSING_DESPACHO_COST", "Costo despacho ausente o inactivo en la fotografia financiera."),
          { merge: true },
        );
        return { ok: false, status: "SKIPPED_MISSING_DESPACHO_COST", snapshotId: null };
      }

      const operationFlagsRaw = asRecord(assignmentSnapshot.operationFlags);
      const operationFlags: OperationFinancialFlags = {
        generatesClientBalance: booleanDefaultTrue(operationFlagsRaw.generatesClientBalance),
        generatesUserEarnings: booleanDefaultTrue(operationFlagsRaw.generatesUserEarnings),
        allowsDispersion: booleanDefaultTrue(operationFlagsRaw.allowsDispersion),
      };

      const clientBalanceEnabled =
        operationFlags.generatesClientBalance && operationFlags.allowsDispersion;
      const userEarningsEnabled = operationFlags.generatesUserEarnings;

      const finalClientRate = clientCost.rate;
      const finalClientBaseType = clientCost.calculationBaseType;
      const finalClientPricingMode = clientCost.pricingMode;

      const clientChargeAmount = amountFromRate(
        grossAmount,
        finalClientRate,
        finalClientBaseType,
        finalClientPricingMode,
      );
      const despachoCostAmount = amountFromRate(
        grossAmount,
        despachoCost.rate,
        despachoCost.calculationBaseType,
        despachoCost.pricingMode,
      );
      const adminBaseAmount = adminCost
        ? amountFromRate(
            grossAmount,
            adminCost.rate,
            adminCost.calculationBaseType,
            adminCost.pricingMode,
          )
        : null;
      const operadorBaseAmount = operadorCost
        ? amountFromRate(
            grossAmount,
            operadorCost.rate,
            operadorCost.calculationBaseType,
            operadorCost.pricingMode,
          )
        : null;

      const hierarchy = validateRateHierarchy({
        despachoCostAmount,
        adminBaseAmount,
        operadorBaseAmount,
        clientChargeAmount,
      });

      if (!hierarchy.ok) {
        tx.set(
          pagoRef,
          buildSkipPayload("SKIPPED_INVALID_RATE_HIERARCHY", hierarchy.message),
          { merge: true },
        );
        return {
          ok: false,
          status: "SKIPPED_INVALID_RATE_HIERARCHY",
          snapshotId: null,
          errorMessage: hierarchy.message,
        };
      }

      let superadminEarningAmount = 0;
      let adminEarningAmount = 0;
      let operadorEarningAmount = 0;

      if (userEarningsEnabled) {
        if (operadorBaseAmount !== null) {
          if (adminBaseAmount !== null) {
            superadminEarningAmount = money2(adminBaseAmount - despachoCostAmount);
            adminEarningAmount = money2(operadorBaseAmount - adminBaseAmount);
          } else {
            superadminEarningAmount = money2(operadorBaseAmount - despachoCostAmount);
          }
          operadorEarningAmount = money2(clientChargeAmount - operadorBaseAmount);
        } else if (adminBaseAmount !== null) {
          superadminEarningAmount = money2(adminBaseAmount - despachoCostAmount);
          adminEarningAmount = money2(clientChargeAmount - adminBaseAmount);
        } else {
          superadminEarningAmount = money2(clientChargeAmount - despachoCostAmount);
        }
      }

      const totalEarningsAmount = money2(
        superadminEarningAmount + adminEarningAmount + operadorEarningAmount,
      );

      const clientNetAmount = money2(grossAmount - clientChargeAmount);
      if (clientNetAmount < 0) {
        tx.set(
          pagoRef,
          buildSkipPayload("SKIPPED_INVALID_NET", "El neto cliente resulto negativo."),
          { merge: true },
        );
        return { ok: false, status: "SKIPPED_INVALID_NET", snapshotId: null };
      }

      const adminId = firstText(assignmentSnapshot, ["adminId"]) || null;
      const operadorId = firstText(assignmentSnapshot, ["operadorId"]) || null;

      const clienteNombre =
        firstText(pago, ["clienteNombre"]) ||
        firstText(clientDoc, ["nombre", "clienteNombre", "name", "razonSocial", "alias"]) ||
        clienteId;
      const empresaNombre =
        firstText(pago, ["empresaNombre", "companyName"]) ||
        firstText(companyDoc, ["nombre", "razonSocial", "name", "alias"]) ||
        null;

      const superadminMeta = userEarningsEnabled
        ? await readUserMetaTx(tx, db, rootId, "superadmin")
        : null;
      const adminMeta = userEarningsEnabled && adminId && adminId !== rootId
        ? await readUserMetaTx(tx, db, adminId, "admin")
        : null;
      const operadorMeta = userEarningsEnabled && operadorId
        ? await readUserMetaTx(tx, db, operadorId, "operador")
        : null;

      const balanceAccountReads = new Map<string, AnyDoc | undefined>();

      if (clientBalanceEnabled) {
        const clientBalanceRead = await readBalanceAccountTx(tx, db, "CLIENT", clienteId);
        balanceAccountReads.set(
          `CLIENT_${clienteId}`,
          clientBalanceRead.snap.exists ? ((clientBalanceRead.snap.data() || {}) as AnyDoc) : undefined,
        );
      }

      if (superadminMeta && superadminEarningAmount > 0) {
        const superadminBalanceRead = await readBalanceAccountTx(tx, db, "USER", superadminMeta.userId);
        balanceAccountReads.set(
          `USER_${superadminMeta.userId}`,
          superadminBalanceRead.snap.exists ? ((superadminBalanceRead.snap.data() || {}) as AnyDoc) : undefined,
        );
      }

      if (adminMeta && adminEarningAmount > 0) {
        const adminBalanceRead = await readBalanceAccountTx(tx, db, "USER", adminMeta.userId);
        balanceAccountReads.set(
          `USER_${adminMeta.userId}`,
          adminBalanceRead.snap.exists ? ((adminBalanceRead.snap.data() || {}) as AnyDoc) : undefined,
        );
      }

      if (operadorMeta && operadorEarningAmount > 0) {
        const operadorBalanceRead = await readBalanceAccountTx(tx, db, "USER", operadorMeta.userId);
        balanceAccountReads.set(
          `USER_${operadorMeta.userId}`,
          operadorBalanceRead.snap.exists ? ((operadorBalanceRead.snap.data() || {}) as AnyDoc) : undefined,
        );
      }

      const advanceSettlement = clientBalanceEnabled
        ? await applyPendingAdvancesOnClientNetTx({
            tx,
            db,
            rootId,
            pagoId,
            clienteId,
            clientNetAmount,
            actorUid,
            actorUsername,
            actorRole,
          })
        : {
            pendingBeforeAmount: 0,
            appliedAmount: 0,
            releasedAmount: 0,
            pendingAfterAmount: 0,
            updatedAdvanceIds: [] as string[],
          };

      const clientReleasedAmount = clientBalanceEnabled
        ? money2(advanceSettlement.releasedAmount)
        : 0;

      const balanceCredits: any[] = [];
      const currency = firstText(pago, ["moneda"]) || "MXN";
      const pagoOperationalReference =
        firstText(pago, ["folio", "referenceFolio", "pagoFolio", "referencia", "reference", "uuid", "uuidCfdi"]) ||
        null;

      if (clientBalanceEnabled && grossAmount > 0) {
        balanceCredits.push({
          rootId,
          holderType: "CLIENT",
          holderId: clienteId,
          holderRole: null,
          holderName: clienteNombre,
          amount: grossAmount,
          direction: "IN",
          movementType: "PAGO_RECIBIDO_BRUTO",
          movementSubType: "PAGO_CONCILIADO",
          referenceId: pagoId,
          referenceFolio: pagoFolio,
          folio: pagoFolio,
          pagoFolio,
          sourceFolio: pagoFolio,
          depositId: pagoId,
          clienteId,
          empresaId: companyId,
          empresaNombre,
          asociadoId,
          adminId,
          operadorId,
          operationalReference: pagoOperationalReference,
          displayConcept: "Pago recibido",
          currency,
          note: "Pago recibido bruto.",
          createdBy: actorUid,
          actorUsername,
          actorDisplayName: actorUsername,
        });
      }

      if (clientBalanceEnabled && clientChargeAmount > 0) {
        const commissionConcept =
          finalClientPricingMode === "PERCENT"
            ? `Comision por servicio ${finalClientRate}%`
            : "Comision por servicio";

        balanceCredits.push({
          rootId,
          holderType: "CLIENT",
          holderId: clienteId,
          holderRole: null,
          holderName: clienteNombre,
          amount: clientChargeAmount,
          direction: "OUT",
          movementType: "COMISION_CLIENTE_COBRADA",
          movementSubType: finalClientPricingMode,
          referenceId: pagoId,
          referenceFolio: pagoFolio,
          folio: pagoFolio,
          pagoFolio,
          sourceFolio: pagoFolio,
          depositId: pagoId,
          clienteId,
          empresaId: companyId,
          empresaNombre,
          asociadoId,
          adminId,
          operadorId,
          operationalReference: pagoOperationalReference,
          displayConcept: commissionConcept,
          currency,
          note: commissionConcept,
          createdBy: actorUid,
          actorUsername,
          actorDisplayName: actorUsername,
        });
      }

      if (clientBalanceEnabled && advanceSettlement.appliedAmount > 0) {
        balanceCredits.push({
          rootId,
          holderType: "CLIENT",
          holderId: clienteId,
          holderRole: null,
          holderName: clienteNombre,
          amount: advanceSettlement.appliedAmount,
          direction: "OUT",
          movementType: "ADELANTO_LIQUIDADO",
          movementSubType: "PAGO_CONCILIADO",
          referenceId: pagoId,
          referenceFolio: pagoFolio,
          folio: pagoFolio,
          pagoFolio,
          sourceFolio: pagoFolio,
          depositId: pagoId,
          clienteId,
          empresaId: companyId,
          empresaNombre,
          asociadoId,
          adminId,
          operadorId,
          operationalReference: pagoOperationalReference,
          displayConcept: "Liquidacion de adelanto",
          currency,
          note: "Liquidacion de adelanto con pago conciliado.",
          createdBy: actorUid,
          actorUsername,
          actorDisplayName: actorUsername,
        });
      }

      if (userEarningsEnabled && superadminMeta && superadminEarningAmount > 0) {
        balanceCredits.push({
          rootId,
          holderType: "USER",
          holderId: superadminMeta.userId,
          holderRole: superadminMeta.role,
          holderName: superadminMeta.holderName,
          amount: superadminEarningAmount,
          movementType: "UTILIDAD_GENERADA",
          movementSubType: "SUPERADMIN",
          referenceId: pagoId,
          referenceFolio: pagoFolio,
          folio: pagoFolio,
          pagoFolio,
          sourceFolio: pagoFolio,
          depositId: pagoId,
          clienteId,
          empresaId: companyId,
          asociadoId,
          adminId,
          operadorId,
          note: `Utilidad superadmin generada por pago ${pagoFolio}.`,
          createdBy: actorUid,
          actorUsername,
        });
      }

      if (userEarningsEnabled && adminMeta && adminEarningAmount > 0) {
        balanceCredits.push({
          rootId,
          holderType: "USER",
          holderId: adminMeta.userId,
          holderRole: adminMeta.role,
          holderName: adminMeta.holderName,
          amount: adminEarningAmount,
          movementType: "UTILIDAD_GENERADA",
          movementSubType: "ADMIN",
          referenceId: pagoId,
          referenceFolio: pagoFolio,
          folio: pagoFolio,
          pagoFolio,
          sourceFolio: pagoFolio,
          depositId: pagoId,
          clienteId,
          empresaId: companyId,
          asociadoId,
          adminId,
          operadorId,
          note: `Utilidad admin generada por pago ${pagoFolio}.`,
          createdBy: actorUid,
          actorUsername,
        });
      }

      if (userEarningsEnabled && operadorMeta && operadorEarningAmount > 0) {
        balanceCredits.push({
          rootId,
          holderType: "USER",
          holderId: operadorMeta.userId,
          holderRole: operadorMeta.role,
          holderName: operadorMeta.holderName,
          amount: operadorEarningAmount,
          movementType: "UTILIDAD_GENERADA",
          movementSubType: "OPERADOR",
          referenceId: pagoId,
          referenceFolio: pagoFolio,
          folio: pagoFolio,
          pagoFolio,
          sourceFolio: pagoFolio,
          depositId: pagoId,
          clienteId,
          empresaId: companyId,
          asociadoId,
          adminId,
          operadorId,
          note: `Utilidad operador generada por pago ${pagoFolio}.`,
          createdBy: actorUid,
          actorUsername,
        });
      }

      const snapshotRef = db.collection("paymentFinancialSnapshots").doc();
      const distributionRef = db.collection("earningsDistributions").doc();
      const dispatchRef = db.collection("paymentDispatchCosts").doc();

      const operationFlagsSnapshot = {
        generatesClientBalance: operationFlags.generatesClientBalance,
        generatesUserEarnings: operationFlags.generatesUserEarnings,
        allowsDispersion: operationFlags.allowsDispersion,
        clientBalanceEnabled,
        userEarningsEnabled,
      };

      
      // H4_D82_A3_A5_A4_A1_NET_FORWARD_ONLY_PAYMENT_HOOK
      // La cuenta ejecutable recibe efectos netos, no componentes legacy
      // que comparten el mismo saldo inicial dentro de la transaccion.
      const forwardOnlyCredits: ForwardOnlyCredit[] = [];

      if (
        clientBalanceEnabled &&
        clientReleasedAmount > 0
      ) {
        forwardOnlyCredits.push({
          rootId,
          holderType: "CLIENT",
          holderId: clienteId,
          holderRole: null,
          holderName: clienteNombre,
          amount: clientReleasedAmount,
          direction: "IN",
          movementType:
            "PAGO_SALDO_LIBERADO",
          movementSubType:
            "NETO_POST_COMISION_ADELANTO",
          referenceId: pagoId,
          referenceFolio: pagoFolio,
          clientId: clienteId,
          userId: null,
          createdBy: actorUid,
          actorUsername,
        });
      }

      const forwardOnlyUserCredits =
        new Map<string, ForwardOnlyCredit>();

      for (const credit of balanceCredits) {
        if (
          credit.holderType !== "USER" ||
          money2(credit.amount) <= 0
        ) {
          continue;
        }

        const key = [
          credit.holderId,
          clienteId,
        ].join("__");
        const current =
          forwardOnlyUserCredits.get(key);

        if (current) {
          current.amount = money2(
            current.amount +
              money2(credit.amount),
          );
          continue;
        }

        forwardOnlyUserCredits.set(key, {
          rootId,
          holderType: "USER",
          holderId: credit.holderId,
          holderRole:
            credit.holderRole || null,
          holderName: credit.holderName,
          amount: money2(credit.amount),
          direction: "IN",
          movementType:
            "UTILIDAD_GENERADA",
          movementSubType:
            credit.movementSubType || null,
          referenceId: pagoId,
          referenceFolio: pagoFolio,
          clientId: clienteId,
          userId: credit.holderId,
          createdBy: actorUid,
          actorUsername,
        });
      }

      forwardOnlyCredits.push(
        ...forwardOnlyUserCredits.values(),
      );

      const preparedForwardOnlyPayment =
        await prepareForwardOnlyPaymentTx({
          tx,
          db,
          rootId,
          sourceId: pagoId,
          despachoId,
          currency:
            firstText(pago, [
              "moneda",
              "currency",
            ]) || "MXN",
          sourceChannel:
            String(sourceChannel ?? "")
              .trim()
              .toUpperCase() || null,
          credits: forwardOnlyCredits,
        });

tx.set(snapshotRef, {
        rootId,
        pagoId,
        depositId: pagoId,
        clienteId,
        clienteNombre,
        empresaId: companyId,
        empresaPrincipalId: companyId,
        despachoId,
        adminId,
        operadorId,
        asociadoId,
        operationTypeKey,
        saleTypeKey: finalClientBaseType,
        currency,
        grossAmount,
        baseAmount: baseAmountFromGross(grossAmount, despachoCost.calculationBaseType),
        calculationBaseType: finalClientBaseType,
        clientVisibleCommissionAmount: clientChargeAmount,
        assignmentSnapshotVersion: H4_D65_A2_FINANCIAL_SNAPSHOT_VERSION,
        assignmentSnapshot,
        operationFlags: operationFlagsSnapshot,
        rateSnapshot: {
          despachoRate: despachoCost.rate,
          superadminFloorRate: adminCost?.rate || operadorCost?.rate || despachoCost.rate,
          adminFloorRate: operadorCost?.rate || adminCost?.rate || 0,
          operadorFloorRate: operadorCost?.rate || 0,
          finalClientRate,
          rateType: finalClientPricingMode,
        },
        resultSnapshot: {
          despachoCostAmount,
          superadminEarningAmount,
          adminEarningAmount,
          operadorEarningAmount,
          totalEarningsAmount,
          clientChargeAmount,
          clientNetAmount,
          clientBalanceGeneratedAmount: clientBalanceEnabled ? clientNetAmount : 0,
          advancePendingBeforeAmount: advanceSettlement.pendingBeforeAmount,
          advanceLiquidatedAmount: advanceSettlement.appliedAmount,
          advanceReleasedAmount: clientReleasedAmount,
          advancePendingAfterAmount: advanceSettlement.pendingAfterAmount,
        },
        roundingVersion: "money2_v1",
        createdBy: actorUid,
        actorUsername,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(distributionRef, {
        rootId,
        depositId: pagoId,
        clienteId,
        clienteNombre,
        empresaId: companyId,
        asociadoId,
        superadminId: rootId,
        adminId,
        operadorId,
        operationTypeKey,
        saleTypeKey: finalClientBaseType,
        currency,
        grossAmount,
        baseAmount: baseAmountFromGross(grossAmount, despachoCost.calculationBaseType),
        despachoRate: despachoCost.rate,
        superadminFloorRate: adminCost?.rate || operadorCost?.rate || despachoCost.rate,
        adminFloorRate: operadorCost?.rate || adminCost?.rate || 0,
        operadorFloorRate: operadorCost?.rate || 0,
        finalClientRate,
        despachoCostAmount,
        superadminEarningAmount,
        adminEarningAmount,
        operadorEarningAmount,
        totalEarningsAmount,
        clientChargeAmount,
        clientNetAmount,
        clientBalanceGeneratedAmount: clientBalanceEnabled ? clientNetAmount : 0,
        advancePendingBeforeAmount: advanceSettlement.pendingBeforeAmount,
        advanceLiquidatedAmount: advanceSettlement.appliedAmount,
        advanceReleasedAmount: clientReleasedAmount,
        advancePendingAfterAmount: advanceSettlement.pendingAfterAmount,
        operationFlags: operationFlagsSnapshot,
        status: "GENERATED",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(dispatchRef, {
        rootId,
        pagoId,
        snapshotId: snapshotRef.id,
        despachoId,
        clienteId,
        empresaId: companyId,
        asociadoId,
        amount: despachoCostAmount,
        baseAmount: baseAmountFromGross(grossAmount, despachoCost.calculationBaseType),
        costPercent: despachoCost.rate,
        pricingMode: despachoCost.pricingMode,
        calculationBaseType: despachoCost.calculationBaseType,
        sourcePath: despachoCost.sourcePath,
        currency,
        status: "GENERATED",
        createdAt: FieldValue.serverTimestamp(),
      });

      for (const credit of balanceCredits) {
        const accountKey = `${credit.holderType}_${credit.holderId}`;
        const posted = await creditBalanceTx({
          tx,
          db,
          ...credit,
          current: balanceAccountReads.get(accountKey),
        });

        if (posted?.accountPatch) {
          balanceAccountReads.set(accountKey, posted.accountPatch);
        }
      }

      logActivityTx(tx, db, {
        event: "PAGO_FINANCIAL_POSTED",
        rootId,
        adminId: adminId || rootId,
        actorUid,
        actorUsername,
        actorRole,
        entityType: "pago",
        entityId: pagoId,
        relatedEntityId: snapshotRef.id,
        relatedEntityType: "paymentFinancialSnapshot",
        amount: grossAmount,
        referenceId: pagoId,
        referenceFolio: pagoFolio,
        referenceType: "pago",
        description: `Pago ${pagoFolio} genero snapshot financiero, liquido adelanto ${advanceSettlement.appliedAmount} y libero saldo cliente ${clientReleasedAmount}.`,
        createdBy: actorUid,
      });

      
      applyForwardOnlyPaymentTx({
        tx,
        db,
        prepared:
          preparedForwardOnlyPayment,
        sourceRef: pagoRef,
      });

tx.update(pagoRef, {
        financialSnapshotId: snapshotRef.id,
        financialDistributionId: distributionRef.id,
        paymentDispatchCostId: dispatchRef.id,
        financialPostingStatus: "POSTED",
        financialPostingError: null,
        financialPostedAt: FieldValue.serverTimestamp(),
        coveragePostedAt: FieldValue.serverTimestamp(),
        walletPostingStatus: clientBalanceEnabled ? "POSTED" : "SKIPPED_OPERATION_FLAGS",
        walletPostedAt: clientBalanceEnabled ? FieldValue.serverTimestamp() : null,
        walletClientAmount: clientReleasedAmount,
        totalComisionCliente: clientBalanceEnabled ? clientChargeAmount : 0,
        retornoCliente: clientReleasedAmount,
        clientNetAmountGenerated: clientBalanceEnabled ? clientNetAmount : 0,
        advancePendingBeforeAmount: advanceSettlement.pendingBeforeAmount,
        advanceLiquidatedAmount: advanceSettlement.appliedAmount,
        advanceReleasedAmount: clientReleasedAmount,
        advancePendingAfterAmount: advanceSettlement.pendingAfterAmount,
        advanceRemainingConciliatedAmount: clientReleasedAmount,
        advanceLiquidatedIds: advanceSettlement.updatedAdvanceIds,
        despachoAmount: despachoCostAmount,
        superadminAmount: superadminEarningAmount,
        adminAmount: adminEarningAmount,
        operadorAmount: operadorEarningAmount,
        operationTypeKey,
        saleTypeKey: finalClientBaseType,
        pricingMode: finalClientPricingMode,
        calculationBaseType: finalClientBaseType,
        operationGeneratesClientBalance: operationFlags.generatesClientBalance,
        operationGeneratesUserEarnings: operationFlags.generatesUserEarnings,
        operationAllowsDispersion: operationFlags.allowsDispersion,
        clientBalanceEnabled,
        userEarningsEnabled,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        ok: true,
        status: "POSTED",
        snapshotId: snapshotRef.id,
        distributionId: distributionRef.id,
        dispatchCostId: dispatchRef.id,
        clientNetAmount,
        clientChargeAmount,
      };
    });
  } catch (error: any) {
    const message = asText(error?.message) || "Error no controlado al postear financiero.";
    await pagoRef.set(buildSkipPayload("ERROR", message), { merge: true });
    return {
      ok: false,
      status: "ERROR",
      snapshotId: null,
      errorMessage: message,
    };
  }
}
