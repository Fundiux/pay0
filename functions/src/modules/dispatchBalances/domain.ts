import { createHash } from "node:crypto";
import type {
  HolderType,
  Pay0Role,
} from "../shared/domain";
import type {
  DispatchSplitPolicy,
} from "./contract";

export type DispatchBalanceCurrency =
  | "MXN"
  | "USD"
  | "EUR"
  | string;

export type DispatchBalanceAccountKey = {
  rootId: string;
  holderType: HolderType;
  holderId: string;
  sourceClientId?: string | null;
  despachoId: string;
  currency: DispatchBalanceCurrency;
  channel?: string | null;
};

export type DispatchBalanceAccountDoc = {
  contractVersion: string;
  rootId: string;
  holderType: HolderType;
  holderId: string;
  sourceClientId?: string | null;
  holderRole: Pay0Role | null;
  holderName: string;
  despachoId: string;
  despachoName?: string | null;
  currency: DispatchBalanceCurrency;
  channel?: string | null;
  availableBalance: number;
  reservedBalance: number;
  executableBalance: number;
  totalGenerated: number;
  totalSpent: number;
  totalReturned: number;
  totalAdjusted: number;
  status: "ACTIVE" | "BLOCKED" | "LEGACY_UNASSIGNED";
  lastMovementAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type DispatchBalanceMovementDoc = {
  contractVersion: string;
  rootId: string;
  holderType: HolderType;
  holderId: string;
  holderRole: Pay0Role | null;
  holderName: string;
  despachoId: string;
  despachoName?: string | null;
  currency: DispatchBalanceCurrency;
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
  isSystemGenerated: boolean;
  status: "APPLIED" | "COMPENSATED";
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type DispatchRouteCandidate = {
  despachoId: string;
  despachoName?: string | null;
  currency: DispatchBalanceCurrency;
  availableBalance: number;
  priority?: number | null;
  operationalCostAmount?: number | null;
  eligible: boolean;
  ineligibleReason?: string | null;
  channel?: "IQ" | "EMAIL" | "WHATSAPP" | "MANUAL" | string;
};

export type DispatchRouteLeg = {
  legIndex: number;
  legKey: string;
  despachoId: string;
  despachoName?: string | null;
  currency: DispatchBalanceCurrency;
  principalAmount: number;
  clientCommissionAmount: number;
  totalDebitAmount: number;
  availableBalanceBefore: number;
  availableBalanceAfterReservation: number;
  operationalCostAmount: number;
  channel?: string | null;
};

export type DispatchRoutePlanStatus =
  | "READY_SINGLE"
  | "READY_SPLIT"
  | "REVIEW_REQUIRED"
  | "INSUFFICIENT_EXECUTABLE_BALANCE"
  | "NO_ELIGIBLE_DISPATCH";

export type DispatchRoutePlan = {
  version: string;
  status: DispatchRoutePlanStatus;
  splitPolicy: DispatchSplitPolicy;
  requestedAmount: number;
  clientCommissionAmount: number;
  totalDebitAmount: number;
  currency: DispatchBalanceCurrency;
  legs: DispatchRouteLeg[];
  eligibleBalanceTotal: number;
  selectedDispatchCount: number;
  reason?: string | null;
};

function requiredText(
  value: unknown,
  label: string,
) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    throw new Error(`${label} requerido.`);
  }

  if (normalized.includes("/")) {
    throw new Error(`${label} no puede contener '/'.`);
  }

  return normalized;
}

export function normalizeDispatchBalanceCurrency(
  value: unknown,
) {
  const currency = String(value ?? "MXN")
    .trim()
    .toUpperCase();

  if (!/^[A-Z0-9_-]{2,12}$/.test(currency)) {
    throw new Error("Moneda invalida.");
  }

  return currency;
}

export function normalizeDispatchBalanceAccountKey(
  input: DispatchBalanceAccountKey,
): DispatchBalanceAccountKey {
  const holderType =
    input.holderType === "USER"
      ? "USER"
      : "CLIENT";

  return {
    rootId: requiredText(input.rootId, "rootId"),
    holderType,
    holderId: requiredText(input.holderId, "holderId"),
    sourceClientId:
      String(input.holderType)
        .trim()
        .toUpperCase() === "USER"
        ? String(
            input.sourceClientId ?? "",
          ).trim() || null
        : null,
    despachoId: requiredText(input.despachoId, "despachoId"),
    currency: normalizeDispatchBalanceCurrency(
      input.currency,
    ),
    channel:
      String(input.channel ?? "")
        .trim()
        .toUpperCase() || null,
  };
}

export function buildDispatchBalanceAccountId(
  input: DispatchBalanceAccountKey,
) {
  const key =
    normalizeDispatchBalanceAccountKey(input);
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        key.rootId,
        key.holderType,
        key.holderId,
        ...(key.holderType === "USER" &&
        key.sourceClientId
          ? [key.sourceClientId]
          : []),
        key.despachoId,
        key.currency,
        ...(key.channel ? [key.channel] : []),
      ]),
    )
    .digest("hex");

  return `DBA_${digest}`;
}

export function buildDispatchBalanceMovementId(
  input: {
    rootId: string;
    sourceId: string;
    holderType: HolderType;
    holderId: string;
    sourceClientId?: string | null;
    despachoId: string;
    currency: DispatchBalanceCurrency;
    purpose: string;
  },
) {
  const rootId = requiredText(
    input.rootId,
    "rootId",
  );
  const sourceId = requiredText(
    input.sourceId,
    "sourceId",
  );
  const purpose = requiredText(
    input.purpose,
    "purpose",
  );
  const accountId =
    buildDispatchBalanceAccountId({
      rootId,
      holderType: input.holderType,
      holderId: input.holderId,
      sourceClientId: input.sourceClientId || null,
      despachoId: input.despachoId,
      currency: input.currency,
    });
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        sourceId,
        accountId,
        purpose,
      ]),
    )
    .digest("hex");

  return `DBM_${digest}`;
}

export function buildDispersionLegKey(
  principalDispersionId: string,
  despachoId: string,
  legIndex: number,
) {
  const principalId = requiredText(
    principalDispersionId,
    "principalDispersionId",
  );
  const dispatchId = requiredText(
    despachoId,
    "despachoId",
  );

  return `${principalId}__LEG_${String(
    legIndex,
  ).padStart(2, "0")}__${dispatchId}`;
}