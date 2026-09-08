import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  H4_D82_A3_DEFAULT_SPLIT_POLICY_BY_TYPE,
  H4_D82_A3_DISPATCH_BALANCE_CONTRACT_VERSION,
} from "./contract";
import {
  normalizeDispatchBalanceCurrency,
  type DispatchBalanceAccountDoc,
  type DispatchRouteLeg,
  type DispatchRoutePlan,
} from "./domain";
import {
  CLIENT_DISPERSION_LEGS_COLLECTION,
  DISPATCH_BALANCE_ACCOUNTS_COLLECTION,
  createDispatchBalanceMovementTx,
  dispatchBalanceAccountRef,
  upsertDispatchBalanceAccountTx,
} from "./repository";
import { planDispatchRoute } from "./routing";

type AnyDoc = Record<string, any>;

// H4_D87_A58_A26_FORWARD_ONLY_BATCH_ACCOUNT_STATE
export type ForwardOnlyBatchAccountState =
  Map<string, Record<string, any>>;

export const H4_D82_A3_A2_FORWARD_ONLY_VERSION =
  "H4_D82_A3_A2_FORWARD_ONLY_V1" as const;

export const H4_D82_A3_A5_ACCOUNT_ORIGIN_VERSION =
  "H4_D82_A3_A5_ACCOUNT_ORIGIN_V1" as const;

type HolderType = "CLIENT" | "USER";

type PreparedAccount = {
  ref: DocumentReference;
  exists: boolean;
  current: AnyDoc;
  key: {
    rootId: string;
    holderType: HolderType;
    holderId: string;
    sourceClientId?: string | null;
    despachoId: string;
    currency: string;
    channel?: string | null;
  };
};

export type ForwardOnlyCredit = {
  rootId: string;
  holderType: HolderType;
  holderId: string;
  holderRole?: string | null;
  holderName: string;
  amount: number;
  direction?: "IN" | "OUT";
  movementType: string;
  movementSubType?: string | null;
  referenceId: string;
  referenceFolio?: string | null;
  clientId?: string | null;
  userId?: string | null;
  createdBy: string;
  actorUsername: string;
};

export type PreparedForwardOnlyCredit = {
  credit: ForwardOnlyCredit;
  account: PreparedAccount;
};

export type PreparedForwardOnlyPayment = {
  version: string;
  rootId: string;
  sourceId: string;
  despachoId: string;
  currency: string;
  credits: PreparedForwardOnlyCredit[];
};

export type PreparedForwardOnlyDispersion = {
  version: string;
  principalDispersionId: string;
  route: DispatchRoutePlan;
  clientId: string;
  clientName: string;
  rootId: string;
  currency: string;
  clientAccounts: Map<string, PreparedAccount>;
  earnings: Array<{
    ownerId: string;
    ownerRole: string | null;
    ownerName: string;
    sourceClientId: string;
    despachoId: string;
    legKey: string;
    amount: number;
    account: PreparedAccount;
  }>;
};

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

function money2(value: unknown) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.round(
    (number + Number.EPSILON) * 100,
  ) / 100;
}

function cents(value: unknown) {
  return Math.round(money2(value) * 100);
}

function fromCents(value: number) {
  return Math.round(value) / 100;
}

function accountCurrent(
  snap:
    | DocumentSnapshot
    | QueryDocumentSnapshot,
) {
  return snap.exists
    ? record(snap.data())
    : {};
}

function available(current: AnyDoc) {
  return money2(
    current.availableBalance ??
      current.executableBalance ??
      0,
  );
}

function reserved(current: AnyDoc) {
  return money2(
    current.reservedBalance || 0,
  );
}

function accountPatch(
  params: {
    current: AnyDoc;
    key: PreparedAccount["key"];
    holderName: string;
    holderRole?: string | null;
    availableBalance: number;
    reservedBalance: number;
    generatedDelta?: number;
    spentDelta?: number;
    returnedDelta?: number;
    adjustedDelta?: number;
  },
): Partial<DispatchBalanceAccountDoc> {
  const now = FieldValue.serverTimestamp();

  return {
    contractVersion:
      H4_D82_A3_DISPATCH_BALANCE_CONTRACT_VERSION,
    rootId: params.key.rootId,
    holderType: params.key.holderType,
    holderId: params.key.holderId,
    sourceClientId:
      params.key.sourceClientId || null,
    holderRole:
      (params.holderRole || null) as any,
    holderName: params.holderName,
    despachoId: params.key.despachoId,
    despachoName:
      params.current.despachoName || null,
    currency: params.key.currency,
    channel:
      params.key.channel ||
      String(params.current.channel ?? "")
        .trim()
        .toUpperCase() ||
      null,
    availableBalance:
      money2(params.availableBalance),
    reservedBalance:
      money2(params.reservedBalance),
    executableBalance:
      money2(params.availableBalance),
    totalGenerated: money2(
      Number(
        params.current.totalGenerated || 0,
      ) +
        Number(params.generatedDelta || 0),
    ),
    totalSpent: money2(
      Number(params.current.totalSpent || 0) +
        Number(params.spentDelta || 0),
    ),
    totalReturned: money2(
      Number(
        params.current.totalReturned || 0,
      ) +
        Number(params.returnedDelta || 0),
    ),
    totalAdjusted: money2(
      Number(
        params.current.totalAdjusted || 0,
      ) +
        Number(params.adjustedDelta || 0),
    ),
    status: "ACTIVE",
    lastMovementAt: now,
    updatedAt: now,
    ...(!params.current.createdAt
      ? { createdAt: now }
      : {}),
  };
}

async function readPreparedAccountTx(
  tx: Transaction,
  db: Firestore,
  key: PreparedAccount["key"],
  batchAccountState?: ForwardOnlyBatchAccountState,
): Promise<PreparedAccount> {
  const ref = dispatchBalanceAccountRef(
    db,
    key,
  );
  const snap = await tx.get(ref);
  const batchCurrent =
    batchAccountState?.get(ref.path);

  return {
    ref,
    exists:
      batchCurrent !== undefined
        ? true
        : snap.exists,
    current:
      batchCurrent !== undefined
        ? record(batchCurrent)
        : accountCurrent(snap),
    key,
  };
}

function movementDoc(
  params: {
    account: PreparedAccount;
    holderName: string;
    holderRole?: string | null;
    direction: "IN" | "OUT";
    amount: number;
    beforeBalance: number;
    afterBalance: number;
    movementType: string;
    movementSubType?: string | null;
    sourceModule: string;
    referenceType: string;
    referenceId: string;
    referenceFolio?: string | null;
    principalDispersionId?: string | null;
    dispersionLegId?: string | null;
    clientId?: string | null;
    sourceClientId?: string | null;
    userId?: string | null;
    createdBy: string;
    actorUsername: string;
  },
) {
  return {
    contractVersion:
      H4_D82_A3_DISPATCH_BALANCE_CONTRACT_VERSION,
    rootId: params.account.key.rootId,
    holderType:
      params.account.key.holderType,
    holderId: params.account.key.holderId,
    holderRole:
      (params.holderRole || null) as any,
    holderName: params.holderName,
    despachoId:
      params.account.key.despachoId,
    despachoName:
      params.account.current
        .despachoName || null,
    currency: params.account.key.currency,
    direction: params.direction,
    amount: money2(params.amount),
    beforeBalance:
      money2(params.beforeBalance),
    afterBalance:
      money2(params.afterBalance),
    movementType: params.movementType,
    movementSubType:
      params.movementSubType || null,
    sourceModule: params.sourceModule,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    referenceFolio:
      params.referenceFolio || null,
    principalDispersionId:
      params.principalDispersionId || null,
    dispersionLegId:
      params.dispersionLegId || null,
    clientId: params.clientId || null,
    sourceClientId:
      params.sourceClientId || null,
    userId: params.userId || null,
    createdBy: params.createdBy,
    actorUsername: params.actorUsername,
    isSystemGenerated: true,
    status: "APPLIED" as const,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function allocationByLeg(
  totalAmount: number,
  legs: DispatchRouteLeg[],
) {
  const total = cents(totalAmount);
  const totalWeight = legs.reduce(
    (sum, leg) =>
      sum + cents(leg.totalDebitAmount),
    0,
  );

  if (
    total <= 0 ||
    totalWeight <= 0 ||
    legs.length === 0
  ) {
    return legs.map(() => 0);
  }

  let assigned = 0;

  return legs.map((leg, index) => {
    if (index === legs.length - 1) {
      return fromCents(total - assigned);
    }

    const amount = Math.floor(
      (total *
        cents(leg.totalDebitAmount)) /
        totalWeight,
    );
    assigned += amount;
    return fromCents(amount);
  });
}

function earningOwners(
  pricing: AnyDoc,
  fallbackNames: {
    superadminName: string;
    adminName: string;
    operadorName: string;
  },
) {
  return [
    {
      ownerId: text(pricing.rootId),
      ownerRole: "superadmin",
      ownerName:
        fallbackNames.superadminName ||
        text(pricing.rootId),
      amount: money2(
        pricing.superadminEarningAmount,
      ),
    },
    {
      ownerId: text(pricing.adminId),
      ownerRole: "admin",
      ownerName:
        fallbackNames.adminName ||
        text(pricing.adminId),
      amount: money2(
        pricing.adminEarningAmount,
      ),
    },
    {
      ownerId: text(pricing.operadorId),
      ownerRole: "operador",
      ownerName:
        fallbackNames.operadorName ||
        text(pricing.operadorId),
      amount: money2(
        pricing.operadorEarningAmount,
      ),
    },
  ].filter(
    (item) =>
      item.ownerId &&
      item.amount > 0,
  );
}

export function deriveDispatchBalanceFromRows(
  rows: AnyDoc[],
) {
  return money2(
    rows.reduce(
      (sum, row) =>
        sum + available(record(row)),
      0,
    ),
  );
}

export async function readForwardOnlyDerivedBalanceTx(
  params: {
    tx: Transaction;
    db: Firestore;
    rootId: string;
    holderType: HolderType;
    holderId: string;
    despachoId?: string | null;
    sourceClientId?: string | null;
    currency?: string | null;
  },
) {
  const currency =
    normalizeDispatchBalanceCurrency(
      params.currency || "MXN",
    );
  const query = params.db
    .collection(
      DISPATCH_BALANCE_ACCOUNTS_COLLECTION,
    )
    .where(
      "holderId",
      "==",
      params.holderId,
    );
  const snap = await params.tx.get(query);
  const rows = snap.docs
    .map((doc) => record(doc.data()))
    .filter(
      (row) =>
        text(row.rootId) === params.rootId &&
        text(row.holderType).toUpperCase() ===
          params.holderType &&
        (!params.despachoId ||
          text(row.despachoId) ===
            text(params.despachoId)) &&
        (!params.sourceClientId ||
          text(row.sourceClientId) ===
            text(params.sourceClientId)) &&
        text(row.currency).toUpperCase() ===
          currency &&
        text(row.status).toUpperCase() !==
          "BLOCKED",
    );

  return deriveDispatchBalanceFromRows(rows);
}

export async function prepareForwardOnlyPaymentTx(
  params: {
    tx: Transaction;
    db: Firestore;
    rootId: string;
    sourceId: string;
    despachoId: string;
    currency?: string | null;
    sourceChannel?: string | null;
    credits: ForwardOnlyCredit[];
  },
): Promise<PreparedForwardOnlyPayment> {
  const despachoId = text(
    params.despachoId,
  );

  if (!despachoId) {
    throw new HttpsError(
      "failed-precondition",
      "El pago nuevo no tiene despacho de origen.",
    );
  }

  const currency =
    normalizeDispatchBalanceCurrency(
      params.currency || "MXN",
    );
  const credits:
    PreparedForwardOnlyCredit[] = [];

  for (const credit of params.credits) {
    const amount = money2(credit.amount);

    if (amount <= 0) {
      continue;
    }

    const sourceClientId =
      credit.holderType === "USER"
        ? text(credit.clientId)
        : "";

    if (
      credit.holderType === "USER" &&
      !sourceClientId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "El movimiento USER no tiene cliente de origen.",
      );
    }

    const account =
      await readPreparedAccountTx(
        params.tx,
        params.db,
        {
          rootId: params.rootId,
          holderType: credit.holderType,
          holderId: credit.holderId,
          sourceClientId: sourceClientId || null,
          despachoId,
          currency,
          channel:
            String(params.sourceChannel ?? "")
              .trim()
              .toUpperCase() || null,
        },
      );

    credits.push({
      credit: {
        ...credit,
        amount,
      },
      account,
    });
  }

  return {
    version:
      H4_D82_A3_A2_FORWARD_ONLY_VERSION,
    rootId: params.rootId,
    sourceId: params.sourceId,
    despachoId,
    currency,
    credits,
  };
}

export function applyForwardOnlyPaymentTx(
  params: {
    tx: Transaction;
    db: Firestore;
    prepared: PreparedForwardOnlyPayment;
    sourceRef?: DocumentReference | null;
  },
) {
  const movementIds: string[] = [];

  for (const item of params.prepared.credits) {
    const direction =
      item.credit.direction || "IN";
    const amount = money2(
      item.credit.amount,
    );
    const before = available(
      item.account.current,
    );
    const after =
      direction === "IN"
        ? money2(before + amount)
        : money2(before - amount);

    if (after < 0) {
      throw new HttpsError(
        "failed-precondition",
        "El movimiento forward-only dejaria saldo negativo.",
      );
    }

    const purpose =
      `PAYMENT_${item.credit.movementType}`;
    const movementRef =
      createDispatchBalanceMovementTx(
        params.tx,
        params.db,
        {
          rootId:
            params.prepared.rootId,
          sourceId:
            params.prepared.sourceId,
          holderType:
            item.account.key.holderType,
          holderId:
            item.account.key.holderId,
          sourceClientId:
            item.account.key.sourceClientId ||
            null,
          despachoId:
            params.prepared.despachoId,
          currency:
            params.prepared.currency,
          purpose,
        },
        movementDoc({
          account: item.account,
          holderName:
            item.credit.holderName,
          holderRole:
            item.credit.holderRole,
          direction,
          amount,
          beforeBalance: before,
          afterBalance: after,
          movementType:
            item.credit.movementType,
          movementSubType:
            item.credit.movementSubType,
          sourceModule: "DEPOSITS",
          referenceType: "PAGO",
          referenceId:
            item.credit.referenceId,
          referenceFolio:
            item.credit.referenceFolio,
          clientId:
            item.credit.clientId,
          userId:
            item.credit.userId,
          createdBy:
            item.credit.createdBy,
          actorUsername:
            item.credit.actorUsername,
        }),
      );

    movementIds.push(movementRef.id);

    upsertDispatchBalanceAccountTx(
      params.tx,
      params.db,
      item.account.key,
      accountPatch({
        current: item.account.current,
        key: item.account.key,
        holderName:
          item.credit.holderName,
        holderRole:
          item.credit.holderRole,
        availableBalance: after,
        reservedBalance: reserved(
          item.account.current,
        ),
        generatedDelta:
          direction === "IN"
            ? amount
            : 0,
        spentDelta:
          direction === "OUT"
            ? amount
            : 0,
      }),
    );
  }

  if (params.sourceRef) {
    params.tx.set(
      params.sourceRef,
      {
        forwardOnlyDispatchBalanceVersion:
          H4_D82_A3_A2_FORWARD_ONLY_VERSION,
        forwardOnlyDispatchPosted: true,
        forwardOnlyDispatchId:
          params.prepared.despachoId,
        forwardOnlyDispatchCurrency:
          params.prepared.currency,
        forwardOnlyDispatchMovementIds:
          movementIds,
        forwardOnlyDispatchPostedAt:
          FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  return {
    movementIds,
  };
}

export async function prepareForwardOnlyDispersionTx(
  params: {
    tx: Transaction;
    db: Firestore;
    rootId: string;
    clientId: string;
    clientName: string;
    principalDispersionId: string;
    operationTypeKey: string;
    preferredDespachoId?: string | null;
    pricing: AnyDoc;
    batchAccountState?: ForwardOnlyBatchAccountState;
    fallbackNames?: {
      superadminName?: string;
      adminName?: string;
      operadorName?: string;
    };
  },
): Promise<PreparedForwardOnlyDispersion> {
  const currency =
    normalizeDispatchBalanceCurrency(
      params.pricing.currency || "MXN",
    );
  const query = params.db
    .collection(
      DISPATCH_BALANCE_ACCOUNTS_COLLECTION,
    )
    .where(
      "holderId",
      "==",
      params.clientId,
    );
  const snap = await params.tx.get(query);
  const clientAccounts =
    new Map<string, PreparedAccount>();

  for (const doc of snap.docs) {
    const current = record(doc.data());

    if (
      text(current.rootId) !== params.rootId ||
      text(current.holderType)
        .toUpperCase() !== "CLIENT" ||
      text(current.currency)
        .toUpperCase() !== currency ||
      text(current.status)
        .toUpperCase() === "BLOCKED"
    ) {
      continue;
    }

    const despachoId = text(
      current.despachoId,
    );

    if (!despachoId) {
      continue;
    }

    const batchCurrent =
      params.batchAccountState?.get(
        doc.ref.path,
      );

    clientAccounts.set(despachoId, {
      ref: doc.ref,
      exists: true,
      current:
        batchCurrent !== undefined
          ? record(batchCurrent)
          : current,
      key: {
        rootId: params.rootId,
        holderType: "CLIENT",
        holderId: params.clientId,
        despachoId,
        currency,
        // H4_D87_A58_A44_FORWARD_ONLY_PRESERVE_ACCOUNT_CHANNEL
        // La llave de dispatchBalanceAccounts incluye channel.
        // Debe conservarse al reconstruir una cuenta existente.
        channel:
          text(current.channel)
            .toUpperCase() || null,
      },
    });
  }

  const preferred = text(
    params.preferredDespachoId,
  );
  const operationTypeKey = text(
    params.operationTypeKey,
  ).toUpperCase();
  const splitPolicy =
    H4_D82_A3_DEFAULT_SPLIT_POLICY_BY_TYPE[
      operationTypeKey as keyof typeof H4_D82_A3_DEFAULT_SPLIT_POLICY_BY_TYPE
    ] || "AUTO_SPLIT";

  const route = planDispatchRoute({
    principalDispersionId:
      params.principalDispersionId,
    requestedAmount:
      money2(params.pricing.amount),
    clientCommissionAmount:
      money2(
        params.pricing.clientChargeAmount,
      ),
    currency,
    splitPolicy,
    candidates: [
      ...clientAccounts.values(),
    ].map((account) => ({
      despachoId:
        account.key.despachoId,
      despachoName:
        account.current.despachoName ||
        null,
      currency,
      availableBalance:
        available(account.current),
      priority:
        account.key.despachoId ===
        preferred
          ? 0
          : 100,
      operationalCostAmount:
        account.key.despachoId ===
        text(params.pricing.despachoId)
          ? money2(
              params.pricing
                .despachoCostAmount,
            )
          : 0,
      eligible: true,
      channel:
        account.current.channel ||
        null,
    })),
  });

  if (
    route.status !== "READY_SINGLE" &&
    route.status !== "READY_SPLIT"
  ) {
    throw new HttpsError(
      "failed-precondition",
      route.reason ||
        "No existe saldo ejecutable por despacho para reservar la dispersion.",
    );
  }

  const fallbacks = {
    superadminName:
      text(
        params.fallbackNames
          ?.superadminName,
      ),
    adminName:
      text(
        params.fallbackNames?.adminName,
      ),
    operadorName:
      text(
        params.fallbackNames
          ?.operadorName,
      ),
  };
  const earnings: PreparedForwardOnlyDispersion["earnings"] =
    [];

  for (const owner of earningOwners(
    params.pricing,
    fallbacks,
  )) {
    const allocations =
      allocationByLeg(
        owner.amount,
        route.legs,
      );

    for (
      let index = 0;
      index < route.legs.length;
      index += 1
    ) {
      const leg = route.legs[index];
      const amount = money2(
        allocations[index],
      );

      if (amount <= 0) {
        continue;
      }

      const account =
        await readPreparedAccountTx(
          params.tx,
          params.db,
          {
            rootId: params.rootId,
            holderType: "USER",
            holderId: owner.ownerId,
            sourceClientId:
              params.clientId,
            despachoId:
              leg.despachoId,
            currency,
          },
          params.batchAccountState,
        );

      earnings.push({
        ownerId: owner.ownerId,
        ownerRole: owner.ownerRole,
        ownerName: owner.ownerName,
        sourceClientId:
          params.clientId,
        despachoId: leg.despachoId,
        legKey: leg.legKey,
        amount,
        account,
      });
    }
  }

  return {
    version:
      H4_D82_A3_A2_FORWARD_ONLY_VERSION,
    principalDispersionId:
      params.principalDispersionId,
    route,
    clientId: params.clientId,
    clientName: params.clientName,
    rootId: params.rootId,
    currency,
    clientAccounts,
    earnings,
  };
}

// H4_D87_A58_A28_PROJECT_FORWARD_ONLY_BATCH_STATE
export function projectForwardOnlyDispersionBatchState(
  prepared: PreparedForwardOnlyDispersion,
  batchAccountState: ForwardOnlyBatchAccountState,
) {
  for (const leg of prepared.route.legs) {
    const account =
      prepared.clientAccounts.get(
        leg.despachoId,
      );

    if (!account) {
      throw new HttpsError(
        "internal",
        `No se encontro cuenta preparada del despacho ${leg.despachoId}.`,
      );
    }

    const before = available(
      account.current,
    );
    const currentReserved = reserved(
      account.current,
    );
    const amount = money2(
      leg.totalDebitAmount,
    );
    const after = money2(
      before - amount,
    );

    if (after < 0) {
      throw new HttpsError(
        "failed-precondition",
        `El despacho ${leg.despachoId} ya no tiene saldo suficiente.`,
      );
    }

    const nextClientAccount =
      accountPatch({
        current: account.current,
        key: account.key,
        holderName:
          prepared.clientName,
        holderRole: null,
        availableBalance: after,
        reservedBalance: money2(
          currentReserved + amount,
        ),
      });

    batchAccountState.set(
      account.ref.path,
      {
        ...account.current,
        ...nextClientAccount,
      },
    );
  }

  for (const earning of prepared.earnings) {
    const before = available(
      earning.account.current,
    );
    const after = money2(
      before + earning.amount,
    );

    const nextEarningAccount =
      accountPatch({
        current:
          earning.account.current,
        key: earning.account.key,
        holderName:
          earning.ownerName,
        holderRole:
          earning.ownerRole,
        availableBalance: after,
        reservedBalance: reserved(
          earning.account.current,
        ),
        generatedDelta:
          earning.amount,
      });

    batchAccountState.set(
      earning.account.ref.path,
      {
        ...earning.account.current,
        ...nextEarningAccount,
      },
    );
  }

  return batchAccountState;
}

export function applyForwardOnlyDispersionTx(
  params: {
    tx: Transaction;
    db: Firestore;
    prepared: PreparedForwardOnlyDispersion;
    dispersionRef: DocumentReference;
    folio: string;
    createdBy: string;
    actorUsername: string;
    operationTypeKey: string;
    batchAccountState?: ForwardOnlyBatchAccountState;
  },
) {
  const reservationMovementIds: string[] =
    [];
  const earningMovementIds: string[] = [];
  const earningAllocations: AnyDoc[] = [];

  for (const leg of params.prepared.route.legs) {
    const account =
      params.prepared.clientAccounts.get(
        leg.despachoId,
      );

    if (!account) {
      throw new HttpsError(
        "internal",
        `No se encontro cuenta preparada del despacho ${leg.despachoId}.`,
      );
    }

    const before = available(
      account.current,
    );
    const currentReserved = reserved(
      account.current,
    );
    const amount = money2(
      leg.totalDebitAmount,
    );
    const after = money2(before - amount);

    if (after < 0) {
      throw new HttpsError(
        "failed-precondition",
        `El despacho ${leg.despachoId} ya no tiene saldo suficiente.`,
      );
    }

    const movementRef =
      createDispatchBalanceMovementTx(
        params.tx,
        params.db,
        {
          rootId:
            params.prepared.rootId,
          sourceId:
            params.prepared
              .principalDispersionId,
          holderType: "CLIENT",
          holderId:
            params.prepared.clientId,
          despachoId:
            leg.despachoId,
          currency:
            params.prepared.currency,
          purpose:
            `RESERVATION_${leg.legKey}`,
        },
        movementDoc({
          account,
          holderName:
            params.prepared.clientName,
          holderRole: null,
          direction: "OUT",
          amount,
          beforeBalance: before,
          afterBalance: after,
          movementType:
            "DISPERSION_RESERVADA",
          movementSubType:
            params.operationTypeKey,
          sourceModule: "DISPERSIONES",
          referenceType:
            "DISPERSION_PRINCIPAL",
          referenceId:
            params.prepared
              .principalDispersionId,
          referenceFolio: params.folio,
          principalDispersionId:
            params.prepared
              .principalDispersionId,
          dispersionLegId:
            leg.legKey,
          clientId:
            params.prepared.clientId,
          createdBy: params.createdBy,
          actorUsername:
            params.actorUsername,
        }),
      );

    reservationMovementIds.push(
      movementRef.id,
    );

    const nextClientAccount =
      accountPatch({
        current: account.current,
        key: account.key,
        holderName:
          params.prepared.clientName,
        holderRole: null,
        availableBalance: after,
        reservedBalance: money2(
          currentReserved + amount,
        ),
      });

    upsertDispatchBalanceAccountTx(
      params.tx,
      params.db,
      account.key,
      nextClientAccount,
    );

    params.batchAccountState?.set(
      account.ref.path,
      {
        ...account.current,
        ...nextClientAccount,
      },
    );

    params.tx.create(
      params.db
        .collection(
          CLIENT_DISPERSION_LEGS_COLLECTION,
        )
        .doc(leg.legKey),
      {
        forwardOnlyVersion:
          H4_D82_A3_A2_FORWARD_ONLY_VERSION,
        contractVersion:
          H4_D82_A3_DISPATCH_BALANCE_CONTRACT_VERSION,
        rootId:
          params.prepared.rootId,
        principalDispersionId:
          params.prepared
            .principalDispersionId,
        principalFolio: params.folio,
        legIndex: leg.legIndex,
        legKey: leg.legKey,
        clientId:
          params.prepared.clientId,
        despachoId: leg.despachoId,
        despachoName:
          leg.despachoName || null,
        currency:
          params.prepared.currency,
        principalAmount:
          money2(leg.principalAmount),
        clientCommissionAmount:
          money2(
            leg.clientCommissionAmount,
          ),
        totalDebitAmount: amount,
        operationalCostAmount:
          money2(
            leg.operationalCostAmount,
          ),
        channel: leg.channel || null,
        status: "SALDO_RESERVADO",
        reservationMovementId:
          movementRef.id,
        reservationReleased: false,
        createdBy: params.createdBy,
        actorUsername:
          params.actorUsername,
        createdAt:
          FieldValue.serverTimestamp(),
        updatedAt:
          FieldValue.serverTimestamp(),
      },
    );
  }

  for (const earning of params.prepared.earnings) {
    const before = available(
      earning.account.current,
    );
    const after = money2(
      before + earning.amount,
    );
    const purpose =
      `DISPERSION_EARNING_${earning.ownerRole}_${earning.legKey}`;
    const movementRef =
      createDispatchBalanceMovementTx(
        params.tx,
        params.db,
        {
          rootId:
            params.prepared.rootId,
          sourceId:
            params.prepared
              .principalDispersionId,
          holderType: "USER",
          holderId: earning.ownerId,
          sourceClientId:
            earning.sourceClientId,
          despachoId:
            earning.despachoId,
          currency:
            params.prepared.currency,
          purpose,
        },
        movementDoc({
          account: earning.account,
          holderName:
            earning.ownerName,
          holderRole:
            earning.ownerRole,
          direction: "IN",
          amount: earning.amount,
          beforeBalance: before,
          afterBalance: after,
          movementType:
            "UTILIDAD_GENERADA",
          movementSubType:
            params.operationTypeKey,
          sourceModule: "DISPERSIONES",
          referenceType:
            "DISPERSION_PRINCIPAL",
          referenceId:
            params.prepared
              .principalDispersionId,
          referenceFolio: params.folio,
          principalDispersionId:
            params.prepared
              .principalDispersionId,
          dispersionLegId:
            earning.legKey,
          clientId:
            params.prepared.clientId,
          sourceClientId:
            earning.sourceClientId,
          userId: earning.ownerId,
          createdBy: params.createdBy,
          actorUsername:
            params.actorUsername,
        }),
      );

    earningMovementIds.push(
      movementRef.id,
    );
    earningAllocations.push({
      ownerId: earning.ownerId,
      ownerRole: earning.ownerRole,
      ownerName: earning.ownerName,
      sourceClientId:
        earning.sourceClientId,
      despachoId:
        earning.despachoId,
      legKey: earning.legKey,
      amount: earning.amount,
      movementId: movementRef.id,
      reversed: false,
    });

    const nextEarningAccount =
      accountPatch({
        current:
          earning.account.current,
        key: earning.account.key,
        holderName:
          earning.ownerName,
        holderRole:
          earning.ownerRole,
        availableBalance: after,
        reservedBalance: reserved(
          earning.account.current,
        ),
        generatedDelta:
          earning.amount,
      });

    upsertDispatchBalanceAccountTx(
      params.tx,
      params.db,
      earning.account.key,
      nextEarningAccount,
    );

    params.batchAccountState?.set(
      earning.account.ref.path,
      {
        ...earning.account.current,
        ...nextEarningAccount,
      },
    );
  }

  const principalPatch = {
    forwardOnlyVersion:
      H4_D82_A3_A2_FORWARD_ONLY_VERSION,
    forwardOnlyAccountOriginVersion:
      H4_D82_A3_A5_ACCOUNT_ORIGIN_VERSION,
    routingVersion:
      params.prepared.route.version,
    routingStatus:
      params.prepared.route.status,
    routingReason:
      params.prepared.route.reason || null,
    routingCurrency:
      params.prepared.currency,
    selectedDispatchCount:
      params.prepared.route
        .selectedDispatchCount,
    selectedDespachoIds:
      params.prepared.route.legs.map(
        (leg) => leg.despachoId,
      ),
    routeLegKeys:
      params.prepared.route.legs.map(
        (leg) => leg.legKey,
      ),
    routePlan: {
      status:
        params.prepared.route.status,
      splitPolicy:
        params.prepared.route
          .splitPolicy,
      requestedAmount:
        params.prepared.route
          .requestedAmount,
      clientCommissionAmount:
        params.prepared.route
          .clientCommissionAmount,
      totalDebitAmount:
        params.prepared.route
          .totalDebitAmount,
      eligibleBalanceTotal:
        params.prepared.route
          .eligibleBalanceTotal,
      selectedDispatchCount:
        params.prepared.route
          .selectedDispatchCount,
      legs:
        params.prepared.route.legs,
    },
    reservationStatus:
      "SALDO_RESERVADO",
    reservationMovementIds,
    forwardOnlyEarningMovementIds:
      earningMovementIds,
    forwardOnlyEarningAllocations:
      earningAllocations,
    reservationReleased: false,
    reservationCreatedAt:
      FieldValue.serverTimestamp(),
    updatedAt:
      FieldValue.serverTimestamp(),
  };

  params.tx.set(
    params.dispersionRef,
    principalPatch,
    { merge: true },
  );

  return {
    principalPatch,
    reservationMovementIds,
    earningMovementIds,
  };
}

export function terminalDispersion(
  doc: AnyDoc,
) {
  const values = [
    doc.status,
    doc.estado,
    doc.decision,
    doc.incidentResolutionDecision,
    doc.resolutionDecision,
  ]
    .map((value) =>
      text(value).toUpperCase(),
    )
    .filter(Boolean);

  return values.some((value) =>
    [
      "RECHAZADA",
      "RECHAZADO",
      "CANCELADA",
      "CANCELADO",
      "CANCELACION_APLICADA",
      "DEVOLUCION_APLICADA",
      "REINTEGRADA",
      "REINTEGRADO",
    ].includes(value),
  );
}

export async function releaseForwardOnlyDispersionTx(
  params: {
    tx: Transaction;
    db: Firestore;
    dispersionRef: DocumentReference;
    dispersion: AnyDoc;
    actorUsername?: string | null;
  },
) {
  if (
    text(params.dispersion.forwardOnlyVersion) !==
      H4_D82_A3_A2_FORWARD_ONLY_VERSION ||
    params.dispersion.reservationReleased ===
      true
  ) {
    return {
      released: false,
      reason: "NOT_APPLICABLE",
    };
  }

  const rootId = text(
    params.dispersion.rootId,
  );
  const clientId = text(
    params.dispersion.clientId ||
      params.dispersion.clienteId,
  );
  const currency =
    normalizeDispatchBalanceCurrency(
      params.dispersion
        .routingCurrency ||
        params.dispersion.currency ||
        "MXN",
    );
  const dispersionId =
    params.dispersionRef.id;
  const folio =
    text(params.dispersion.folio) ||
    dispersionId;
  const actorUsername =
    text(params.actorUsername) ||
    "PAY0_FORWARD_ONLY";

  const legsQuery = params.db
    .collection(
      CLIENT_DISPERSION_LEGS_COLLECTION,
    )
    .where(
      "principalDispersionId",
      "==",
      dispersionId,
    );
  const legsSnap =
    await params.tx.get(legsQuery);
  const legs = legsSnap.docs
    .map((doc) => ({
      ref: doc.ref,
      doc: record(doc.data()),
    }))
    .filter(
      (item) =>
        item.doc.reservationReleased !==
          true &&
        text(item.doc.status)
          .toUpperCase() ===
          "SALDO_RESERVADO",
    );

  const preparedLegs: Array<{
    ref: DocumentReference;
    doc: AnyDoc;
    account: PreparedAccount;
  }> = [];

  for (const leg of legs) {
    const despachoId = text(
      leg.doc.despachoId,
    );

    if (!despachoId) continue;

    preparedLegs.push({
      ...leg,
      account:
        await readPreparedAccountTx(
          params.tx,
          params.db,
          {
            rootId,
            holderType: "CLIENT",
            holderId: clientId,
            despachoId,
            currency,
            // H4_D87_A58_A45_FORWARD_ONLY_RELEASE_PRESERVE_CHANNEL
            // La leg conserva el canal usado al reservar.
            // La liberacion debe reconstruir exactamente la misma cuenta.
            channel:
              text(leg.doc.channel)
                .toUpperCase() || null,
          },
        ),
    });
  }

  const earningRows = Array.isArray(
    params.dispersion
      .forwardOnlyEarningAllocations,
  )
    ? params.dispersion
        .forwardOnlyEarningAllocations
        .map(record)
        .filter(
          (item) =>
            item.reversed !== true &&
            text(item.ownerId) &&
            text(item.despachoId) &&
            money2(item.amount) > 0,
        )
    : [];

  const preparedEarnings: Array<{
    row: AnyDoc;
    account: PreparedAccount;
  }> = [];

  for (const row of earningRows) {
    preparedEarnings.push({
      row,
      account:
        await readPreparedAccountTx(
          params.tx,
          params.db,
          {
            rootId,
            holderType: "USER",
            holderId:
              text(row.ownerId),
            sourceClientId:
              text(row.sourceClientId) ||
              null,
            despachoId:
              text(row.despachoId),
            currency,
          },
        ),
    });
  }

  const releaseMovementIds: string[] = [];
  const reversalMovementIds: string[] = [];

  for (const item of preparedLegs) {
    const amount = money2(
      item.doc.totalDebitAmount,
    );
    const before = available(
      item.account.current,
    );
    const currentReserved = reserved(
      item.account.current,
    );
    const after = money2(
      before + amount,
    );
    const reservedAfter = money2(
      Math.max(
        0,
        currentReserved - amount,
      ),
    );
    const movementRef =
      createDispatchBalanceMovementTx(
        params.tx,
        params.db,
        {
          rootId,
          sourceId: dispersionId,
          holderType: "CLIENT",
          holderId: clientId,
          despachoId:
            item.account.key.despachoId,
          currency,
          purpose:
            `RELEASE_${item.doc.legKey}`,
        },
        movementDoc({
          account: item.account,
          holderName:
            text(
              params.dispersion
                .clienteNombre ||
                params.dispersion
                  .clientName,
            ) || clientId,
          holderRole: null,
          direction: "IN",
          amount,
          beforeBalance: before,
          afterBalance: after,
          movementType:
            "DISPERSION_RESERVA_LIBERADA",
          movementSubType:
            text(
              params.dispersion
                .operationTypeKey,
            ) || null,
          sourceModule: "DISPERSIONES",
          referenceType:
            "DISPERSION_PRINCIPAL",
          referenceId: dispersionId,
          referenceFolio: folio,
          principalDispersionId:
            dispersionId,
          dispersionLegId:
            text(item.doc.legKey),
          clientId,
          createdBy:
            text(
              params.dispersion
                .createdBy,
            ) || rootId,
          actorUsername,
        }),
      );

    releaseMovementIds.push(
      movementRef.id,
    );

    upsertDispatchBalanceAccountTx(
      params.tx,
      params.db,
      item.account.key,
      accountPatch({
        current: item.account.current,
        key: item.account.key,
        holderName:
          text(
            params.dispersion
              .clienteNombre ||
              params.dispersion
                .clientName,
          ) || clientId,
        holderRole: null,
        availableBalance: after,
        reservedBalance: reservedAfter,
        returnedDelta: amount,
      }),
    );

    params.tx.set(
      item.ref,
      {
        status: "RESERVA_LIBERADA",
        reservationReleased: true,
        reservationReleaseMovementId:
          movementRef.id,
        reservationReleasedAt:
          FieldValue.serverTimestamp(),
        updatedAt:
          FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  for (const item of preparedEarnings) {
    const amount = money2(
      item.row.amount,
    );
    const before = available(
      item.account.current,
    );
    const after = money2(
      before - amount,
    );

    if (after < 0) {
      throw new HttpsError(
        "failed-precondition",
        "No se puede revertir utilidad por despacho porque el saldo ya fue consumido.",
      );
    }

    const movementRef =
      createDispatchBalanceMovementTx(
        params.tx,
        params.db,
        {
          rootId,
          sourceId: dispersionId,
          holderType: "USER",
          holderId:
            item.account.key.holderId,
          sourceClientId:
            item.account.key.sourceClientId ||
            null,
          despachoId:
            item.account.key.despachoId,
          currency,
          purpose:
            `EARNING_REVERSAL_${text(
              item.row.legKey,
            )}_${text(
              item.row.ownerRole,
            )}`,
        },
        movementDoc({
          account: item.account,
          holderName:
            text(item.row.ownerName) ||
            item.account.key.holderId,
          holderRole:
            text(item.row.ownerRole) ||
            null,
          direction: "OUT",
          amount,
          beforeBalance: before,
          afterBalance: after,
          movementType:
            "UTILIDAD_REVERSADA",
          movementSubType:
            text(
              params.dispersion
                .operationTypeKey,
            ) || null,
          sourceModule: "DISPERSIONES",
          referenceType:
            "DISPERSION_PRINCIPAL",
          referenceId: dispersionId,
          referenceFolio: folio,
          principalDispersionId:
            dispersionId,
          dispersionLegId:
            text(item.row.legKey),
          clientId,
          sourceClientId:
            item.account.key.sourceClientId ||
            null,
          userId:
            item.account.key.holderId,
          createdBy:
            text(
              params.dispersion
                .createdBy,
            ) || rootId,
          actorUsername,
        }),
      );

    reversalMovementIds.push(
      movementRef.id,
    );

    upsertDispatchBalanceAccountTx(
      params.tx,
      params.db,
      item.account.key,
      accountPatch({
        current: item.account.current,
        key: item.account.key,
        holderName:
          text(item.row.ownerName) ||
          item.account.key.holderId,
        holderRole:
          text(item.row.ownerRole) ||
          null,
        availableBalance: after,
        reservedBalance: reserved(
          item.account.current,
        ),
        adjustedDelta: -amount,
      }),
    );
  }

  params.tx.set(
    params.dispersionRef,
    {
      reservationStatus:
        "RESERVA_LIBERADA",
      reservationReleased: true,
      reservationReleaseMovementIds:
        releaseMovementIds,
      forwardOnlyEarningReversalMovementIds:
        reversalMovementIds,
      forwardOnlyEarningAllocations:
        earningRows.map((row) => ({
          ...row,
          reversed: true,
        })),
      reservationReleasedAt:
        FieldValue.serverTimestamp(),
      updatedAt:
        FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    released: true,
    releaseMovementIds,
    reversalMovementIds,
  };
}
