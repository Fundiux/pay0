export type AssetKind = "VEHICLE" | "LOAN";
export type InterestModel =
  "NONE" | "SIMPLE_ON_OUTSTANDING_PRINCIPAL" | "CAPITALIZED";
export type AssetSource =
  | "MANUAL"
  | "PAY0"
  | "CASH"
  | "EXTERNAL_TRANSFER"
  | "DOCUMENT_IMPORT"
  | "OTHER";
export type MovementType =
  | "VEHICLE_INVESTMENT"
  | "VEHICLE_PRINCIPAL_RETURN"
  | "VEHICLE_PROFIT"
  | "LOAN_ORIGINATED"
  | "INTEREST_ACCRUED"
  | "INTEREST_CAPITALIZED"
  | "INTEREST_PAYMENT"
  | "PRINCIPAL_PAYMENT"
  | "ADJUSTMENT"
  | "REVERSAL";

export type AssetMovement = {
  movementType: MovementType;
  amountMinor: number;
  source: AssetSource;
  effectiveDate: string;
  interestPeriodKey?: string | null;
  allocation?: { interestMinor: number; principalMinor: number } | null;
};
export type AssetSnapshot = {
  originalPrincipalMinor: number;
  outstandingPrincipalMinor: number;
  recoveredPrincipalMinor: number;
  pendingInterestMinor: number;
  realizedProfitMinor: number;
  capitalizedInterestMinor: number;
  totalRecoveredMinor: number;
  interestBearingBalanceMinor: number;
  roi: number | null;
};

export function assertMinor(value: unknown, name = "amountMinor"): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw Error(`ASSET_${name.toUpperCase()}_INVALID`);
  return amount;
}

export function interestForPeriod(input: {
  model: InterestModel;
  outstandingPrincipalMinor: number;
  rateBasisPoints: number;
}): number {
  if (input.model === "NONE") return 0;
  if (
    !Number.isSafeInteger(input.outstandingPrincipalMinor) ||
    input.outstandingPrincipalMinor < 0
  )
    throw Error("ASSET_PRINCIPAL_INVALID");
  if (!Number.isSafeInteger(input.rateBasisPoints) || input.rateBasisPoints < 0)
    throw Error("ASSET_RATE_INVALID");
  return Math.round(
    (input.outstandingPrincipalMinor * input.rateBasisPoints) / 10_000,
  );
}

export function allocatePayment(input: {
  amountMinor: number;
  pendingInterestMinor: number;
  outstandingPrincipalMinor: number;
  rule: "MANUAL" | "INTEREST_FIRST" | "PRINCIPAL_FIRST";
  interestMinor?: number;
  principalMinor?: number;
}) {
  const amount = assertMinor(input.amountMinor);
  let interest = 0;
  let principal = 0;
  if (input.rule === "MANUAL") {
    interest = Number(input.interestMinor || 0);
    principal = Number(input.principalMinor || 0);
    if (
      !Number.isSafeInteger(interest) ||
      interest < 0 ||
      !Number.isSafeInteger(principal) ||
      principal < 0 ||
      interest + principal !== amount
    )
      throw Error("ASSET_PAYMENT_ALLOCATION_INVALID");
  } else if (input.rule === "INTEREST_FIRST") {
    interest = Math.min(amount, input.pendingInterestMinor);
    principal = amount - interest;
  } else {
    principal = Math.min(amount, input.outstandingPrincipalMinor);
    interest = amount - principal;
  }
  if (
    interest > input.pendingInterestMinor ||
    principal > input.outstandingPrincipalMinor
  )
    throw Error("ASSET_PAYMENT_OVERAPPLIED");
  return { interestMinor: interest, principalMinor: principal };
}

export function remainingLinkableAmount(
  totalMinor: number,
  linkedMinor: number,
): number {
  if (
    !Number.isSafeInteger(totalMinor) ||
    totalMinor < 0 ||
    !Number.isSafeInteger(linkedMinor) ||
    linkedMinor < 0 ||
    linkedMinor > totalMinor
  )
    throw Error("ASSET_PAY0_LINK_BALANCE_INVALID");
  return totalMinor - linkedMinor;
}

export function projectAsset(
  kind: AssetKind,
  movements: AssetMovement[],
): AssetSnapshot {
  const state: AssetSnapshot = {
    originalPrincipalMinor: 0,
    outstandingPrincipalMinor: 0,
    recoveredPrincipalMinor: 0,
    pendingInterestMinor: 0,
    realizedProfitMinor: 0,
    capitalizedInterestMinor: 0,
    totalRecoveredMinor: 0,
    interestBearingBalanceMinor: 0,
    roi: null,
  };
  for (const movement of movements) {
    const amount = assertMinor(movement.amountMinor);
    switch (movement.movementType) {
      case "VEHICLE_INVESTMENT":
      case "LOAN_ORIGINATED":
        state.originalPrincipalMinor += amount;
        state.outstandingPrincipalMinor += amount;
        break;
      case "VEHICLE_PRINCIPAL_RETURN":
      case "PRINCIPAL_PAYMENT":
        if (amount > state.outstandingPrincipalMinor)
          throw Error("ASSET_PRINCIPAL_OVERPAID");
        state.outstandingPrincipalMinor -= amount;
        state.recoveredPrincipalMinor += amount;
        state.totalRecoveredMinor += amount;
        break;
      case "VEHICLE_PROFIT":
        state.realizedProfitMinor += amount;
        state.totalRecoveredMinor += amount;
        break;
      case "INTEREST_ACCRUED":
        state.pendingInterestMinor += amount;
        break;
      case "INTEREST_CAPITALIZED":
        if (amount > state.pendingInterestMinor)
          throw Error("ASSET_INTEREST_CAPITALIZATION_INVALID");
        state.pendingInterestMinor -= amount;
        state.capitalizedInterestMinor += amount;
        state.outstandingPrincipalMinor += amount;
        break;
      case "INTEREST_PAYMENT":
        if (amount > state.pendingInterestMinor)
          throw Error("ASSET_INTEREST_OVERPAID");
        state.pendingInterestMinor -= amount;
        state.realizedProfitMinor += amount;
        state.totalRecoveredMinor += amount;
        break;
      case "ADJUSTMENT":
      case "REVERSAL":
        throw Error("ASSET_ADJUSTMENT_REQUIRES_EXPLICIT_REVERSAL_CONTRACT");
      default:
        throw Error("ASSET_MOVEMENT_TYPE_INVALID");
    }
  }
  state.interestBearingBalanceMinor =
    kind === "LOAN" ? state.outstandingPrincipalMinor : 0;
  state.roi =
    state.originalPrincipalMinor > 0
      ? state.realizedProfitMinor / state.originalPrincipalMinor
      : null;
  return state;
}
