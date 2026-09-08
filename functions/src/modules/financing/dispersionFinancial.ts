import {
  FieldValue,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  buildBalanceAccountPatchFromMovement,
  buildBalanceMovement,
} from "../balances/service";
import {
  createBalanceMovementTx,
  readBalanceAccountTx,
  upsertBalanceAccountTx,
} from "../balances/repository";
import { money2 } from "../shared/money";
import type {
  BalanceMovementType,
  Pay0Role,
} from "../shared/domain";

type AnyDoc = Record<string, any>;
type BaseType = "TOTAL" | "SUBTOTAL";
type PricingMode = "PERCENT" | "FIXED";
type CostSource = {
  path: string;
  doc: AnyDoc;
  value: number;
  calculationBaseType: BaseType;
  pricingMode: PricingMode;
};

const H4_D82_A2_A4_DISPERSION_FINANCIAL_VERSION =
  "H4_D82_A2_A4_V1";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): AnyDoc {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as AnyDoc
    : {};
}

function normalizeBaseType(
  value: unknown,
): BaseType {
  return text(value).toUpperCase() ===
    "SUBTOTAL"
    ? "SUBTOTAL"
    : "TOTAL";
}

function normalizePricingMode(
  value: unknown,
): PricingMode {
  return text(value).toUpperCase() ===
    "FIXED"
    ? "FIXED"
    : "PERCENT";
}

function costValue(
  doc: AnyDoc | null,
  fields: string[],
): number | null {
  if (!doc || doc.active === false) {
    return null;
  }

  for (const field of fields) {
    const raw = doc[field];

    if (
      raw === null ||
      raw === undefined ||
      raw === ""
    ) {
      continue;
    }

    const value = Number(raw);

    if (
      Number.isFinite(value) &&
      value >= 0
    ) {
      return money2(value);
    }
  }

  return null;
}

function baseAmount(
  amount: number,
  baseType: BaseType,
) {
  const gross = money2(amount);

  return baseType === "SUBTOTAL"
    ? money2(gross / 1.16)
    : gross;
}

function amountFromCost(
  amount: number,
  source: CostSource,
) {
  if (source.pricingMode === "FIXED") {
    return money2(source.value);
  }

  return money2(
    baseAmount(
      amount,
      source.calculationBaseType,
    ) *
      (source.value / 100),
  );
}

function validateHierarchy(
  levels: Array<{
    label: string;
    amount: number;
  }>,
) {
  for (
    let index = 1;
    index < levels.length;
    index += 1
  ) {
    const previous = levels[index - 1];
    const current = levels[index];

    if (
      money2(previous.amount) >
      money2(current.amount)
    ) {
      throw new HttpsError(
        "failed-precondition",
        `Jerarquia de costos invalida: ${previous.label} ${previous.amount} excede ${current.label} ${current.amount}.`,
      );
    }
  }
}

function sourceFromDoc(
  pathValue: string,
  docValue: AnyDoc | null,
  fields: string[],
): CostSource | null {
  const value = costValue(
    docValue,
    fields,
  );

  if (value === null) return null;

  return {
    path: pathValue,
    doc: docValue || {},
    value,
    calculationBaseType:
      normalizeBaseType(
        docValue?.calculationBaseType,
      ),
    pricingMode:
      normalizePricingMode(
        docValue?.pricingMode,
      ),
  };
}

async function readFirst(
  readDoc: (
    pathValue: string,
  ) => Promise<AnyDoc | null>,
  paths: string[],
) {
  for (const pathValue of paths) {
    const doc = await readDoc(pathValue);

    if (doc) {
      return {
        path: pathValue,
        doc,
      };
    }
  }

  return null;
}

export function resolveDispersionOperationTypeKey(
  methodTipo: unknown,
  destinationKind: unknown,
) {
  const method = text(methodTipo)
    .toUpperCase();
  const destination =
    text(destinationKind).toUpperCase();

  if (
    method === "EFECTIVO" ||
    destination === "EFECTIVO"
  ) {
    return "EFECTIVO";
  }

  if (
    method === "TDC" ||
    method === "AMEX"
  ) {
    return "TDC";
  }

  if (method === "DEBITO") {
    return "TRANSFERENCIA";
  }

  throw new HttpsError(
    "failed-precondition",
    "El metodo no tiene un tipo canonico de dispersion soportado.",
  );
}

export type CanonicalDispersionPricing = {
  version: string;
  operationTypeKey: string;
  operationTypeName: string;
  despachoId: string;
  amount: number;
  currency: string;
  despachoCost: CostSource;
  adminCost: CostSource | null;
  operadorCost: CostSource | null;
  clientCost: CostSource;
  despachoCostAmount: number;
  superadminEarningAmount: number;
  adminEarningAmount: number;
  operadorEarningAmount: number;
  totalEarningsAmount: number;
  clientChargeAmount: number;
  totalClientDebitAmount: number;
  clientCalculationBaseType: BaseType;
  clientPricingMode: PricingMode;
  rootId: string;
  adminId: string | null;
  operadorId: string | null;
  generatesUserEarnings: boolean;
};

async function resolvePricing(
  params: {
    rootId: string;
    clientId: string;
    client: AnyDoc;
    adminId?: string | null;
    operadorId?: string | null;
    despachoId: string;
    operationTypeKey: string;
    amount: number;
    currency?: string | null;
  },
  readDoc: (
    pathValue: string,
  ) => Promise<AnyDoc | null>,
): Promise<CanonicalDispersionPricing> {
  const rootId = text(params.rootId);
  const clientId = text(params.clientId);
  const despachoId = text(params.despachoId);
  const operationTypeKey =
    text(params.operationTypeKey)
      .toUpperCase();
  const amount = money2(params.amount);
  const adminIdRaw =
    text(
      params.adminId ||
        params.client.adminId,
    );
  const operadorIdRaw =
    text(
      params.operadorId ||
        params.client.operadorId ||
        params.client.managedByUserId,
    );

  const adminId =
    adminIdRaw &&
    adminIdRaw !== rootId
      ? adminIdRaw
      : null;
  const operadorId =
    operadorIdRaw &&
    operadorIdRaw !== rootId &&
    operadorIdRaw !== adminId
      ? operadorIdRaw
      : null;

  if (!despachoId) {
    throw new HttpsError(
      "invalid-argument",
      "despachoId requerido.",
    );
  }

  if (amount <= 0) {
    throw new HttpsError(
      "invalid-argument",
      "Monto de dispersion invalido.",
    );
  }

  const operationTypePath =
    `operationTypes/${operationTypeKey}`;
  const despachoPath =
    `despachos/${despachoId}`;
  const despachoCostPath =
    `despachos/${despachoId}/costos/${operationTypeKey}`;

  const [
    operationTypeDoc,
    despachoDoc,
    despachoCostDoc,
  ] = await Promise.all([
    readDoc(operationTypePath),
    readDoc(despachoPath),
    readDoc(despachoCostPath),
  ]);

  if (
    !operationTypeDoc ||
    operationTypeDoc.active === false
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Tipo de dispersion no encontrado o inactivo.",
    );
  }

  if (
    text(operationTypeDoc.category)
      .toUpperCase() !== "DISPERSION"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El tipo seleccionado no pertenece al grupo DISPERSION.",
    );
  }

  if (
    !despachoDoc ||
    despachoDoc.active === false
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Despacho no encontrado o inactivo.",
    );
  }

  if (
    text(despachoDoc.rootId) &&
    text(despachoDoc.rootId) !== rootId
  ) {
    throw new HttpsError(
      "permission-denied",
      "Despacho fuera de alcance.",
    );
  }

  const despachoCost = sourceFromDoc(
    despachoCostPath,
    despachoCostDoc,
    [
      "baseCost",
      "assignedCost",
    ],
  );

  if (!despachoCost) {
    throw new HttpsError(
      "failed-precondition",
      "Costo base del despacho no configurado.",
    );
  }

  const clientCostResult =
    await readFirst(readDoc, [
      `clients/${clientId}/costos/${despachoId}__${operationTypeKey}`,
      `clients/${clientId}/costos/${operationTypeKey}`,
    ]);

  const clientCost = sourceFromDoc(
    clientCostResult?.path || "",
    clientCostResult?.doc || null,
    [
      "assignedCost",
      "baseCost",
    ],
  );

  if (!clientCost) {
    throw new HttpsError(
      "failed-precondition",
      "Configura el costo final del cliente para este despacho y tipo de dispersion.",
    );
  }

  const adminCostResult = adminId
    ? await readFirst(readDoc, [
        `users/${adminId}/costos/${despachoId}__${operationTypeKey}`,
        `users/${adminId}/costos/${operationTypeKey}`,
      ])
    : null;

  const operadorCostResult = operadorId
    ? await readFirst(readDoc, [
        `users/${operadorId}/costos/${despachoId}__${operationTypeKey}`,
        `users/${operadorId}/costos/${operationTypeKey}`,
      ])
    : null;

  const adminCost = sourceFromDoc(
    adminCostResult?.path || "",
    adminCostResult?.doc || null,
    [
      "assignedCost",
      "baseCost",
    ],
  );

  const operadorCost = sourceFromDoc(
    operadorCostResult?.path || "",
    operadorCostResult?.doc || null,
    [
      "assignedCost",
      "baseCost",
    ],
  );

  const despachoCostAmount =
    amountFromCost(
      amount,
      despachoCost,
    );
  const adminBaseAmount = adminCost
    ? amountFromCost(amount, adminCost)
    : null;
  const operadorBaseAmount =
    operadorCost
      ? amountFromCost(
          amount,
          operadorCost,
        )
      : null;
  const clientChargeAmount =
    amountFromCost(
      amount,
      clientCost,
    );

  const hierarchy = [
    {
      label: "despacho",
      amount: despachoCostAmount,
    },
  ];

  if (adminBaseAmount !== null) {
    hierarchy.push({
      label: "admin",
      amount: adminBaseAmount,
    });
  }

  if (operadorBaseAmount !== null) {
    hierarchy.push({
      label: "operador",
      amount: operadorBaseAmount,
    });
  }

  hierarchy.push({
    label: "cliente",
    amount: clientChargeAmount,
  });

  validateHierarchy(hierarchy);

  const generatesUserEarnings =
    operationTypeDoc.generatesUserEarnings !==
    false;

  let superadminEarningAmount = 0;
  let adminEarningAmount = 0;
  let operadorEarningAmount = 0;

  if (generatesUserEarnings) {
    if (operadorBaseAmount !== null) {
      if (adminBaseAmount !== null) {
        superadminEarningAmount = money2(
          adminBaseAmount -
            despachoCostAmount,
        );
        adminEarningAmount = money2(
          operadorBaseAmount -
            adminBaseAmount,
        );
      } else {
        superadminEarningAmount = money2(
          operadorBaseAmount -
            despachoCostAmount,
        );
      }

      operadorEarningAmount = money2(
        clientChargeAmount -
          operadorBaseAmount,
      );
    } else if (
      adminBaseAmount !== null
    ) {
      superadminEarningAmount = money2(
        adminBaseAmount -
          despachoCostAmount,
      );
      adminEarningAmount = money2(
        clientChargeAmount -
          adminBaseAmount,
      );
    } else {
      superadminEarningAmount = money2(
        clientChargeAmount -
          despachoCostAmount,
      );
    }
  }

  const totalEarningsAmount = money2(
    superadminEarningAmount +
      adminEarningAmount +
      operadorEarningAmount,
  );

  return {
    version:
      H4_D82_A2_A4_DISPERSION_FINANCIAL_VERSION,
    operationTypeKey,
    operationTypeName:
      text(operationTypeDoc.name) ||
      operationTypeKey,
    despachoId,
    amount,
    currency:
      text(params.currency) || "MXN",
    despachoCost,
    adminCost,
    operadorCost,
    clientCost,
    despachoCostAmount,
    superadminEarningAmount,
    adminEarningAmount,
    operadorEarningAmount,
    totalEarningsAmount,
    clientChargeAmount,
    totalClientDebitAmount: money2(
      amount + clientChargeAmount,
    ),
    clientCalculationBaseType:
      clientCost.calculationBaseType,
    clientPricingMode:
      clientCost.pricingMode,
    rootId,
    adminId,
    operadorId,
    generatesUserEarnings,
  };
}

export async function resolveCanonicalDispersionPricing(
  params: {
    db: Firestore;
    rootId: string;
    clientId: string;
    client: AnyDoc;
    adminId?: string | null;
    operadorId?: string | null;
    despachoId: string;
    operationTypeKey: string;
    amount: number;
    currency?: string | null;
  },
) {
  return resolvePricing(
    params,
    async (pathValue) => {
      const snap =
        await params.db.doc(pathValue).get();

      return snap.exists
        ? record(snap.data())
        : null;
    },
  );
}

// H4_D87_A58_A30_CANONICAL_FINANCIAL_BATCH_STATE
export type CanonicalFinancialBatchAccountState =
  Map<string, AnyDoc>;

function canonicalBatchAccountKey(
  holderType: "CLIENT" | "USER",
  holderId: string,
) {
  return `${holderType}_${holderId}`;
}

type UserFinancialState = {
  userId: string;
  role: Pay0Role | null;
  holderName: string;
  currentAccount: AnyDoc | undefined;
};

export type PreparedDispersionFinancials = {
  pricing: CanonicalDispersionPricing;
  superadminState: UserFinancialState | null;
  adminState: UserFinancialState | null;
  operadorState: UserFinancialState | null;
};

async function readUserStateTx(
  tx: Transaction,
  db: Firestore,
  userId: string | null,
  fallbackRole: Pay0Role | null,
  batchAccountState?: CanonicalFinancialBatchAccountState,
): Promise<UserFinancialState | null> {
  const id = text(userId);

  if (!id) return null;

  const userSnap =
    await tx.get(db.doc(`users/${id}`));
  const userDoc = userSnap.exists
    ? record(userSnap.data())
    : {};
  const roleRaw = text(
    userDoc.role || fallbackRole,
  ).toLowerCase();

  const role =
    roleRaw === "superadmin" ||
    roleRaw === "admin" ||
    roleRaw === "operador"
      ? roleRaw as Pay0Role
      : fallbackRole;

  const balanceRead =
    await readBalanceAccountTx(
      tx,
      db,
      "USER",
      id,
    );

  const batchCurrent =
    batchAccountState?.get(
      canonicalBatchAccountKey(
        "USER",
        id,
      ),
    );

  return {
    userId: id,
    role,
    holderName:
      text(
        userDoc.username ||
          userDoc.displayName ||
          userDoc.name ||
          userDoc.email,
      ) || id,
    currentAccount:
      batchCurrent !== undefined
        ? record(batchCurrent)
        : balanceRead.snap.exists
          ? record(balanceRead.snap.data())
          : undefined,
  };
}

export async function prepareCanonicalDispersionFinancialsTx(
  params: {
    tx: Transaction;
    db: Firestore;
    rootId: string;
    clientId: string;
    client: AnyDoc;
    adminId?: string | null;
    operadorId?: string | null;
    despachoId: string;
    operationTypeKey: string;
    amount: number;
    currency?: string | null;
    batchAccountState?: CanonicalFinancialBatchAccountState;
  },
): Promise<PreparedDispersionFinancials> {
  const pricing = await resolvePricing(
    params,
    async (pathValue) => {
      const snap = await params.tx.get(
        params.db.doc(pathValue),
      );

      return snap.exists
        ? record(snap.data())
        : null;
    },
  );

  const superadminState =
    pricing.superadminEarningAmount > 0
      ? await readUserStateTx(
          params.tx,
          params.db,
          pricing.rootId,
          "superadmin",
          params.batchAccountState,
        )
      : null;

  const adminState =
    pricing.adminId &&
    pricing.adminEarningAmount > 0
      ? await readUserStateTx(
          params.tx,
          params.db,
          pricing.adminId,
          "admin",
          params.batchAccountState,
        )
      : null;

  const operadorState =
    pricing.operadorId &&
    pricing.operadorEarningAmount > 0
      ? await readUserStateTx(
          params.tx,
          params.db,
          pricing.operadorId,
          "operador",
          params.batchAccountState,
        )
      : null;

  return {
    pricing,
    superadminState,
    adminState,
    operadorState,
  };
}

function postMovementTx(
  params: {
    tx: Transaction;
    db: Firestore;
    movementId: string;
    rootId: string;
    holderType: "CLIENT" | "USER";
    holderId: string;
    holderRole: Pay0Role | null;
    holderName: string;
    movementType: BalanceMovementType;
    movementSubType?: string | null;
    direction: "IN" | "OUT";
    amount: number;
    current: AnyDoc | undefined;
    dispersionId: string;
    folio: string;
    clientId: string;
    empresaId?: string | null;
    asociadoId?: string | null;
    adminId?: string | null;
    operadorId?: string | null;
    beneficiaryId?: string | null;
    beneficiaryNombre?: string | null;
    methodId?: string | null;
    methodTipo?: string | null;
    destinationKind?: string | null;
    bankName?: string | null;
    displayConcept: string;
    note: string;
    createdBy: string;
    actorUsername: string;
    isSystemGenerated: boolean;
    correctionOfMovementId?: string | null;
  },
) {
  const beforeBalance = money2(
    params.current?.availableBalance || 0,
  );

  const movement = buildBalanceMovement({
    rootId: params.rootId,
    holderType: params.holderType,
    holderId: params.holderId,
    holderRole: params.holderRole,
    holderName: params.holderName,
    movementType: params.movementType,
    movementSubType:
      params.movementSubType || null,
    direction: params.direction,
    amount: params.amount,
    beforeBalance,
    sourceModule: "FINANCING",
    referenceType:
      params.correctionOfMovementId
        ? "CORRECTION"
        : "DISPERSION",
    referenceId: params.dispersionId,
    referenceFolio: params.folio,
    folio: params.folio,
    dispersionFolio: params.folio,
    sourceFolio: params.folio,
    dispersionId: params.dispersionId,
    correctionOfMovementId:
      params.correctionOfMovementId ||
      null,
    clienteId: params.clientId,
    empresaId: params.empresaId || null,
    asociadoId: params.asociadoId || null,
    adminId: params.adminId || null,
    operadorId: params.operadorId || null,
    beneficiaryId:
      params.beneficiaryId || null,
    beneficiaryNombre:
      params.beneficiaryNombre || null,
    methodId: params.methodId || null,
    methodTipo:
      params.methodTipo || null,
    destinationKind:
      params.destinationKind || null,
    bankName: params.bankName || null,
    operationalReference: params.folio,
    displayConcept: params.displayConcept,
    note: params.note,
    createdBy: params.createdBy,
    actorUsername:
      params.actorUsername,
    isSystemGenerated:
      params.isSystemGenerated,
  });

  const patch =
    buildBalanceAccountPatchFromMovement(
      params.current,
      movement,
    );

  createBalanceMovementTx(
    params.tx,
    params.db,
    movement,
    params.movementId,
  );
  upsertBalanceAccountTx(
    params.tx,
    params.db,
    params.holderType,
    params.holderId,
    patch,
  );

  return {
    movement,
    accountPatch: patch,
  };
}

// H4_D87_A58_A30_PROJECT_CANONICAL_FINANCIAL_BATCH_STATE
export function projectCanonicalDispersionFinancialBatchState(
  params: {
    prepared: PreparedDispersionFinancials;
    batchAccountState: CanonicalFinancialBatchAccountState;
    clientAccountCurrent: AnyDoc | undefined;
    clientId: string;
    clientName: string;
  },
) {
  const { pricing } = params.prepared;
  const clientKey =
    canonicalBatchAccountKey(
      "CLIENT",
      params.clientId,
    );

  const clientCurrent =
    params.batchAccountState.get(clientKey) ??
    params.clientAccountCurrent;

  const beforeBalance = money2(
    clientCurrent?.availableBalance || 0,
  );

  if (
    beforeBalance <
    pricing.totalClientDebitAmount
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Saldo insuficiente para monto y comision de la dispersion.",
    );
  }

  const principalMovement =
    buildBalanceMovement({
      rootId: pricing.rootId,
      holderType: "CLIENT",
      holderId: params.clientId,
      holderRole: null,
      holderName: params.clientName,
      movementType:
        "DISPERSION_REGISTRADA",
      movementSubType:
        pricing.operationTypeKey,
      direction: "OUT",
      amount: pricing.amount,
      beforeBalance,
      sourceModule: "FINANCING",
      referenceType: "DISPERSION",
      referenceId: "BATCH_PROJECTION",
      createdBy: "BATCH_PROJECTION",
      actorUsername:
        "BATCH_PROJECTION",
      isSystemGenerated: true,
    });

  let clientFinalAccount =
    buildBalanceAccountPatchFromMovement(
      clientCurrent,
      principalMovement,
    );

  if (
    pricing.clientChargeAmount > 0
  ) {
    const commissionMovement =
      buildBalanceMovement({
        rootId: pricing.rootId,
        holderType: "CLIENT",
        holderId: params.clientId,
        holderRole: null,
        holderName:
          params.clientName,
        movementType:
          "COMISION_CLIENTE_COBRADA",
        movementSubType:
          pricing.operationTypeKey,
        direction: "OUT",
        amount:
          pricing.clientChargeAmount,
        beforeBalance: money2(
          clientFinalAccount
            .availableBalance,
        ),
        sourceModule: "FINANCING",
        referenceType: "DISPERSION",
        referenceId:
          "BATCH_PROJECTION",
        createdBy:
          "BATCH_PROJECTION",
        actorUsername:
          "BATCH_PROJECTION",
        isSystemGenerated: true,
      });

    clientFinalAccount =
      buildBalanceAccountPatchFromMovement(
        clientFinalAccount,
        commissionMovement,
      );
  }

  params.batchAccountState.set(
    clientKey,
    clientFinalAccount,
  );

  const earnings = [
    {
      state:
        params.prepared
          .superadminState,
      amount:
        pricing
          .superadminEarningAmount,
    },
    {
      state:
        params.prepared.adminState,
      amount:
        pricing.adminEarningAmount,
    },
    {
      state:
        params.prepared
          .operadorState,
      amount:
        pricing
          .operadorEarningAmount,
    },
  ];

  for (const item of earnings) {
    if (
      !item.state ||
      item.amount <= 0
    ) {
      continue;
    }

    const userKey =
      canonicalBatchAccountKey(
        "USER",
        item.state.userId,
      );

    const current =
      params.batchAccountState.get(
        userKey,
      ) ??
      item.state.currentAccount;

    const before = money2(
      current?.availableBalance || 0,
    );

    const earningMovement =
      buildBalanceMovement({
        rootId: pricing.rootId,
        holderType: "USER",
        holderId:
          item.state.userId,
        holderRole:
          item.state.role,
        holderName:
          item.state.holderName,
        movementType:
          "UTILIDAD_GENERADA",
        movementSubType:
          `DISPERSION_${String(
            item.state.role || "USER",
          ).toUpperCase()}`,
        direction: "IN",
        amount: item.amount,
        beforeBalance: before,
        sourceModule: "FINANCING",
        referenceType: "DISPERSION",
        referenceId:
          "BATCH_PROJECTION",
        createdBy:
          "BATCH_PROJECTION",
        actorUsername:
          "BATCH_PROJECTION",
        isSystemGenerated: true,
      });

    const next =
      buildBalanceAccountPatchFromMovement(
        current,
        earningMovement,
      );

    params.batchAccountState.set(
      userKey,
      next,
    );
  }

  return {
    clientFinalAccount,
    batchAccountState:
      params.batchAccountState,
  };
}

export function applyCanonicalDispersionFinancialsTx(
  params: {
    tx: Transaction;
    db: Firestore;
    prepared: PreparedDispersionFinancials;
    clientAccountCurrent: AnyDoc | undefined;
    clientId: string;
    clientName: string;
    dispersionId: string;
    folio: string;
    empresaId?: string | null;
    asociadoId?: string | null;
    beneficiaryId: string;
    beneficiaryNombre: string;
    methodId: string;
    methodTipo?: string | null;
    destinationKind?: string | null;
    bankName?: string | null;
    createdBy: string;
    actorUsername: string;
    principalConcept: string;
  },
) {
  const { pricing } = params.prepared;
  const beforeBalance = money2(
    params.clientAccountCurrent
      ?.availableBalance || 0,
  );

  if (
    beforeBalance <
    pricing.totalClientDebitAmount
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Saldo insuficiente para monto y comision de la dispersion.",
    );
  }

  const principalMovementId =
    `${params.dispersionId}__PRINCIPAL`;
  const commissionMovementId =
    pricing.clientChargeAmount > 0
      ? `${params.dispersionId}__CLIENT_COMMISSION`
      : null;

  const principal = postMovementTx({
    tx: params.tx,
    db: params.db,
    movementId: principalMovementId,
    rootId: pricing.rootId,
    holderType: "CLIENT",
    holderId: params.clientId,
    holderRole: null,
    holderName: params.clientName,
    movementType:
      "DISPERSION_REGISTRADA",
    movementSubType:
      pricing.operationTypeKey,
    direction: "OUT",
    amount: pricing.amount,
    current:
      params.clientAccountCurrent,
    dispersionId:
      params.dispersionId,
    folio: params.folio,
    clientId: params.clientId,
    empresaId: params.empresaId,
    asociadoId: params.asociadoId,
    adminId: pricing.adminId,
    operadorId: pricing.operadorId,
    beneficiaryId:
      params.beneficiaryId,
    beneficiaryNombre:
      params.beneficiaryNombre,
    methodId: params.methodId,
    methodTipo: params.methodTipo,
    destinationKind:
      params.destinationKind,
    bankName: params.bankName,
    displayConcept:
      params.principalConcept,
    note: params.principalConcept,
    createdBy: params.createdBy,
    actorUsername:
      params.actorUsername,
    isSystemGenerated: false,
  });

  let clientFinalAccount =
    principal.accountPatch;
  let commissionMovement:
    | ReturnType<typeof postMovementTx>
    | null = null;

  if (
    commissionMovementId &&
    pricing.clientChargeAmount > 0
  ) {
    const commissionConcept =
      pricing.clientPricingMode ===
      "PERCENT"
        ? `COMISION DISPERSION ${pricing.operationTypeKey} ${pricing.clientCost.value}%`
        : `COMISION DISPERSION ${pricing.operationTypeKey}`;

    commissionMovement = postMovementTx({
      tx: params.tx,
      db: params.db,
      movementId:
        commissionMovementId,
      rootId: pricing.rootId,
      holderType: "CLIENT",
      holderId: params.clientId,
      holderRole: null,
      holderName: params.clientName,
      movementType:
        "COMISION_CLIENTE_COBRADA",
      movementSubType:
        pricing.operationTypeKey,
      direction: "OUT",
      amount:
        pricing.clientChargeAmount,
      current: clientFinalAccount,
      dispersionId:
        params.dispersionId,
      folio: params.folio,
      clientId: params.clientId,
      empresaId: params.empresaId,
      asociadoId: params.asociadoId,
      adminId: pricing.adminId,
      operadorId:
        pricing.operadorId,
      beneficiaryId:
        params.beneficiaryId,
      beneficiaryNombre:
        params.beneficiaryNombre,
      methodId: params.methodId,
      methodTipo: params.methodTipo,
      destinationKind:
        params.destinationKind,
      bankName: params.bankName,
      displayConcept:
        commissionConcept,
      note: commissionConcept,
      createdBy: params.createdBy,
      actorUsername:
        params.actorUsername,
      isSystemGenerated: true,
    });

    clientFinalAccount =
      commissionMovement.accountPatch;
  }

  const earningMovementIds: {
    superadmin: string | null;
    admin: string | null;
    operador: string | null;
  } = {
    superadmin: null,
    admin: null,
    operador: null,
  };

  const postEarning = (
    state: UserFinancialState | null,
    roleLabel:
      | "SUPERADMIN"
      | "ADMIN"
      | "OPERADOR",
    amount: number,
  ) => {
    if (!state || amount <= 0) {
      return null;
    }

    const movementId =
      `${params.dispersionId}__EARNING__${state.userId}`;

    postMovementTx({
      tx: params.tx,
      db: params.db,
      movementId,
      rootId: pricing.rootId,
      holderType: "USER",
      holderId: state.userId,
      holderRole: state.role,
      holderName:
        state.holderName,
      movementType:
        "UTILIDAD_GENERADA",
      movementSubType:
        `DISPERSION_${roleLabel}`,
      direction: "IN",
      amount,
      current:
        state.currentAccount,
      dispersionId:
        params.dispersionId,
      folio: params.folio,
      clientId: params.clientId,
      empresaId: params.empresaId,
      asociadoId: params.asociadoId,
      adminId: pricing.adminId,
      operadorId:
        pricing.operadorId,
      beneficiaryId:
        params.beneficiaryId,
      beneficiaryNombre:
        params.beneficiaryNombre,
      methodId: params.methodId,
      methodTipo: params.methodTipo,
      destinationKind:
        params.destinationKind,
      bankName: params.bankName,
      displayConcept:
        `UTILIDAD DISPERSION ${pricing.operationTypeKey}`,
      note:
        `Utilidad ${roleLabel.toLowerCase()} generada por dispersion ${params.folio}.`,
      createdBy: params.createdBy,
      actorUsername:
        params.actorUsername,
      isSystemGenerated: true,
    });

    return movementId;
  };

  earningMovementIds.superadmin =
    postEarning(
      params.prepared.superadminState,
      "SUPERADMIN",
      pricing.superadminEarningAmount,
    );

  earningMovementIds.admin =
    postEarning(
      params.prepared.adminState,
      "ADMIN",
      pricing.adminEarningAmount,
    );

  earningMovementIds.operador =
    postEarning(
      params.prepared.operadorState,
      "OPERADOR",
      pricing.operadorEarningAmount,
    );

  const snapshotRef = params.db.doc(
    `dispersionFinancialSnapshots/${params.dispersionId}`,
  );
  const distributionRef =
    params.db.doc(
      `earningsDistributions/DISPERSION__${params.dispersionId}`,
    );
  const dispatchCostRef =
    params.db.doc(
      `dispersionDispatchCosts/${params.dispersionId}`,
    );

  const pricingSnapshot = {
    version: pricing.version,
    operationTypeKey:
      pricing.operationTypeKey,
    operationTypeName:
      pricing.operationTypeName,
    despachoId: pricing.despachoId,
    currency: pricing.currency,
    amount: pricing.amount,
    clientChargeAmount:
      pricing.clientChargeAmount,
    totalClientDebitAmount:
      pricing.totalClientDebitAmount,
    despachoCostAmount:
      pricing.despachoCostAmount,
    superadminEarningAmount:
      pricing.superadminEarningAmount,
    adminEarningAmount:
      pricing.adminEarningAmount,
    operadorEarningAmount:
      pricing.operadorEarningAmount,
    totalEarningsAmount:
      pricing.totalEarningsAmount,
    rates: {
      despacho:
        pricing.despachoCost.value,
      admin:
        pricing.adminCost?.value ??
        null,
      operador:
        pricing.operadorCost?.value ??
        null,
      client:
        pricing.clientCost.value,
    },
    modes: {
      despacho:
        pricing.despachoCost.pricingMode,
      admin:
        pricing.adminCost
          ?.pricingMode ?? null,
      operador:
        pricing.operadorCost
          ?.pricingMode ?? null,
      client:
        pricing.clientCost.pricingMode,
    },
    bases: {
      despacho:
        pricing.despachoCost
          .calculationBaseType,
      admin:
        pricing.adminCost
          ?.calculationBaseType ?? null,
      operador:
        pricing.operadorCost
          ?.calculationBaseType ?? null,
      client:
        pricing.clientCost
          .calculationBaseType,
    },
    sources: {
      despacho:
        pricing.despachoCost.path,
      admin:
        pricing.adminCost?.path ??
        null,
      operador:
        pricing.operadorCost?.path ??
        null,
      client:
        pricing.clientCost.path,
    },
  };

  params.tx.set(snapshotRef, {
    rootId: pricing.rootId,
    dispersionId:
      params.dispersionId,
    clientId: params.clientId,
    clienteId: params.clientId,
    despachoId: pricing.despachoId,
    operationTypeKey:
      pricing.operationTypeKey,
    pricingSnapshot,
    principalMovementId,
    commissionMovementId,
    earningMovementIds,
    status: "POSTED",
    createdBy: params.createdBy,
    actorUsername:
      params.actorUsername,
    createdAt:
      FieldValue.serverTimestamp(),
    updatedAt:
      FieldValue.serverTimestamp(),
  });

  params.tx.set(distributionRef, {
    rootId: pricing.rootId,
    sourceType: "DISPERSION",
    depositId: null,
    dispersionId:
      params.dispersionId,
    clienteId: params.clientId,
    clienteNombre:
      params.clientName,
    empresaId:
      params.empresaId || null,
    asociadoId:
      params.asociadoId || null,
    superadminId:
      pricing.rootId,
    adminId: pricing.adminId,
    operadorId: pricing.operadorId,
    operationTypeKey:
      pricing.operationTypeKey,
    saleTypeKey:
      pricing.clientCalculationBaseType,
    currency: pricing.currency,
    grossAmount: pricing.amount,
    baseAmount: baseAmount(
      pricing.amount,
      pricing.clientCalculationBaseType,
    ),
    despachoRate:
      pricing.despachoCost.value,
    adminFloorRate:
      pricing.adminCost?.value || 0,
    operadorFloorRate:
      pricing.operadorCost?.value || 0,
    finalClientRate:
      pricing.clientCost.value,
    despachoCostAmount:
      pricing.despachoCostAmount,
    superadminEarningAmount:
      pricing.superadminEarningAmount,
    adminEarningAmount:
      pricing.adminEarningAmount,
    operadorEarningAmount:
      pricing.operadorEarningAmount,
    totalEarningsAmount:
      pricing.totalEarningsAmount,
    clientChargeAmount:
      pricing.clientChargeAmount,
    clientNetAmount:
      pricing.amount,
    totalClientDebitAmount:
      pricing.totalClientDebitAmount,
    principalMovementId,
    commissionMovementId,
    earningMovementIds,
    pricingSnapshot,
    status: "GENERATED",
    createdAt:
      FieldValue.serverTimestamp(),
    updatedAt:
      FieldValue.serverTimestamp(),
  });

  params.tx.set(dispatchCostRef, {
    rootId: pricing.rootId,
    dispersionId:
      params.dispersionId,
    despachoId: pricing.despachoId,
    clienteId: params.clientId,
    empresaId:
      params.empresaId || null,
    asociadoId:
      params.asociadoId || null,
    operationTypeKey:
      pricing.operationTypeKey,
    amount:
      pricing.despachoCostAmount,
    baseAmount: baseAmount(
      pricing.amount,
      pricing.despachoCost
        .calculationBaseType,
    ),
    costValue:
      pricing.despachoCost.value,
    pricingMode:
      pricing.despachoCost.pricingMode,
    calculationBaseType:
      pricing.despachoCost
        .calculationBaseType,
    sourcePath:
      pricing.despachoCost.path,
    currency: pricing.currency,
    status: "GENERATED",
    createdAt:
      FieldValue.serverTimestamp(),
    updatedAt:
      FieldValue.serverTimestamp(),
  });

  return {
    pricing,
    pricingSnapshot,
    principalMovementId,
    commissionMovementId,
    earningMovementIds,
    beforeBalance,
    afterBalance:
      money2(
        clientFinalAccount.availableBalance,
      ),
  };
}

export async function reverseCanonicalDispersionFinancialsTx(
  params: {
    tx: Transaction;
    db: Firestore;
    dispersion: AnyDoc;
    dispersionId: string;
    actorUid: string;
    actorUsername: string;
    decision: string;
  },
) {
  const dispersion = params.dispersion;
  const rootId = text(dispersion.rootId);
  const clientId = text(
    dispersion.clienteId ||
      dispersion.clientId,
  );
  const clientName =
    text(dispersion.clienteNombre) ||
    clientId;
  const folio =
    text(dispersion.folio) ||
    params.dispersionId;
  const distributionRef =
    params.db.doc(
      `earningsDistributions/DISPERSION__${params.dispersionId}`,
    );
  const distributionSnap =
    await params.tx.get(distributionRef);
  const distribution =
    distributionSnap.exists
      ? record(distributionSnap.data())
      : {};

  if (
    text(distribution.status)
      .toUpperCase() === "COMPENSATED"
  ) {
    return {
      reintegrated: true,
      reintegrationMovementId:
        text(
          distribution
            .reintegrationMovementId,
        ) || null,
      beforeBalance: null,
      afterBalance: null,
      reintegrationAmount:
        money2(
          distribution
            .totalClientDebitAmount ||
            dispersion
              .totalClientDebitAmount ||
            dispersion.amount ||
            0,
        ),
      reversedEarningsAmount:
        money2(
          distribution
            .totalEarningsAmount || 0,
        ),
      reversalMovementIds:
        record(
          distribution
            .reversalMovementIds,
        ),
    };
  }

  const reintegrationAmount = money2(
    distribution.totalClientDebitAmount ||
      dispersion.totalClientDebitAmount ||
      money2(
        Number(dispersion.amount || 0) +
          Number(
            dispersion.clientChargeAmount ||
              0,
          ),
      ),
  );

  if (reintegrationAmount <= 0) {
    throw new HttpsError(
      "failed-precondition",
      "Monto total invalido para reintegro.",
    );
  }

  const clientBalance =
    await readBalanceAccountTx(
      params.tx,
      params.db,
      "CLIENT",
      clientId,
    );
  const clientCurrent =
    clientBalance.snap.exists
      ? record(clientBalance.snap.data())
      : undefined;

  const earningDefinitions = [
    {
      key: "superadmin",
      userId:
        text(
          distribution.superadminId,
        ) || rootId,
      role: "superadmin" as Pay0Role,
      amount: money2(
        distribution
          .superadminEarningAmount || 0,
      ),
      originalMovementId:
        text(
          record(
            distribution
              .earningMovementIds,
          ).superadmin,
        ) || null,
    },
    {
      key: "admin",
      userId: text(
        distribution.adminId,
      ),
      role: "admin" as Pay0Role,
      amount: money2(
        distribution
          .adminEarningAmount || 0,
      ),
      originalMovementId:
        text(
          record(
            distribution
              .earningMovementIds,
          ).admin,
        ) || null,
    },
    {
      key: "operador",
      userId: text(
        distribution.operadorId,
      ),
      role: "operador" as Pay0Role,
      amount: money2(
        distribution
          .operadorEarningAmount || 0,
      ),
      originalMovementId:
        text(
          record(
            distribution
              .earningMovementIds,
          ).operador,
        ) || null,
    },
  ].filter(
    (item) =>
      item.userId &&
      item.amount > 0,
  );

  const userStates = new Map<
    string,
    UserFinancialState
  >();

  for (
    const item of earningDefinitions
  ) {
    const state =
      await readUserStateTx(
        params.tx,
        params.db,
        item.userId,
        item.role,
      );

    if (state) {
      userStates.set(
        item.userId,
        state,
      );
    }
  }

  const reintegrationMovementId =
    `${params.dispersionId}__REINTEGRATION`;

  const clientReintegration =
    postMovementTx({
      tx: params.tx,
      db: params.db,
      movementId:
        reintegrationMovementId,
      rootId,
      holderType: "CLIENT",
      holderId: clientId,
      holderRole: null,
      holderName: clientName,
      movementType:
        "DISPERSION_REINTEGRADA",
      movementSubType:
        params.decision,
      direction: "IN",
      amount:
        reintegrationAmount,
      current: clientCurrent,
      dispersionId:
        params.dispersionId,
      folio,
      clientId,
      empresaId:
        text(dispersion.empresaId) ||
        null,
      asociadoId:
        text(dispersion.asociadoId) ||
        null,
      adminId:
        text(dispersion.adminId) ||
        null,
      operadorId:
        text(
          dispersion.operadorId,
        ) || null,
      beneficiaryId:
        text(
          dispersion.beneficiaryId,
        ) || null,
      beneficiaryNombre:
        text(
          dispersion
            .beneficiaryNombre,
        ) || null,
      methodId:
        text(dispersion.methodId) ||
        null,
      methodTipo:
        text(dispersion.methodTipo) ||
        null,
      destinationKind:
        text(
          dispersion.destinationKind,
        ) || null,
      bankName:
        text(dispersion.bankName) ||
        null,
      displayConcept:
        `REINTEGRO DISPERSION ${folio}`,
      note:
        `Reintegro de monto y comision por ${params.decision}.`,
      createdBy: params.actorUid,
      actorUsername:
        params.actorUsername,
      isSystemGenerated: true,
    });

  const reversalMovementIds:
    Record<string, string> = {};

  for (
    const item of earningDefinitions
  ) {
    const state =
      userStates.get(item.userId);

    if (!state) continue;

    const movementId =
      `${params.dispersionId}__EARNING_REVERSAL__${item.userId}`;

    postMovementTx({
      tx: params.tx,
      db: params.db,
      movementId,
      rootId,
      holderType: "USER",
      holderId: item.userId,
      holderRole: state.role,
      holderName:
        state.holderName,
      movementType:
        "CORRECCION_MOVIMIENTO",
      movementSubType:
        "REVERSA_UTILIDAD_DISPERSION",
      direction: "OUT",
      amount: item.amount,
      current:
        state.currentAccount,
      dispersionId:
        params.dispersionId,
      folio,
      clientId,
      empresaId:
        text(dispersion.empresaId) ||
        null,
      asociadoId:
        text(dispersion.asociadoId) ||
        null,
      adminId:
        text(dispersion.adminId) ||
        null,
      operadorId:
        text(
          dispersion.operadorId,
        ) || null,
      beneficiaryId:
        text(
          dispersion.beneficiaryId,
        ) || null,
      beneficiaryNombre:
        text(
          dispersion
            .beneficiaryNombre,
        ) || null,
      methodId:
        text(dispersion.methodId) ||
        null,
      methodTipo:
        text(dispersion.methodTipo) ||
        null,
      destinationKind:
        text(
          dispersion.destinationKind,
        ) || null,
      bankName:
        text(dispersion.bankName) ||
        null,
      displayConcept:
        "REVERSA UTILIDAD DISPERSION",
      note:
        `Reversa de utilidad por ${params.decision} de dispersion ${folio}.`,
      createdBy: params.actorUid,
      actorUsername:
        params.actorUsername,
      isSystemGenerated: true,
      correctionOfMovementId:
        item.originalMovementId,
    });

    reversalMovementIds[
      item.key
    ] = movementId;
  }

  params.tx.set(
    distributionRef,
    {
      status: "COMPENSATED",
      reintegrationMovementId,
      reintegrationAmount,
      reversalMovementIds,
      compensatedBy:
        params.actorUid,
      compensatedAt:
        FieldValue.serverTimestamp(),
      updatedAt:
        FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  params.tx.set(
    params.db.doc(
      `dispersionFinancialSnapshots/${params.dispersionId}`,
    ),
    {
      status: "COMPENSATED",
      reintegrationMovementId,
      reversalMovementIds,
      compensatedBy:
        params.actorUid,
      compensatedAt:
        FieldValue.serverTimestamp(),
      updatedAt:
        FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  params.tx.set(
    params.db.doc(
      `dispersionDispatchCosts/${params.dispersionId}`,
    ),
    {
      status: "COMPENSATED",
      compensatedBy:
        params.actorUid,
      compensatedAt:
        FieldValue.serverTimestamp(),
      updatedAt:
        FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    reintegrated: true,
    reintegrationMovementId,
    beforeBalance:
      clientReintegration
        .movement.beforeBalance,
    afterBalance:
      clientReintegration
        .movement.afterBalance,
    reintegrationAmount,
    reversedEarningsAmount:
      money2(
        earningDefinitions.reduce(
          (sum, item) =>
            sum + item.amount,
          0,
        ),
      ),
    reversalMovementIds,
  };
}
