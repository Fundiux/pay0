export const H4_D82_A3_DISPATCH_BALANCE_CONTRACT_VERSION =
  "H4_D82_A3_APPROVED_V1" as const;

export const H4_D82_A3_CROSS_DISPATCH_TRANSFER_ALLOWED =
  false as const;

export const H4_D82_A3_AGGREGATE_BALANCE_WRITABLE =
  false as const;

export const H4_D82_A3_UNRESOLVED_LEGACY_DISPATCH_ID =
  "SIN_ASIGNAR_LEGACY" as const;

export const H4_D82_A3_SUPPORTED_CURRENCIES = [
  "MXN",
  "USD",
  "EUR",
] as const;

export type DispatchSplitPolicy =
  | "AUTO_SPLIT"
  | "SINGLE_DISPATCH"
  | "REVIEW_REQUIRED";

export const H4_D82_A3_DEFAULT_SPLIT_POLICY_BY_TYPE = {
  TRANSFERENCIA: "AUTO_SPLIT",
  TDC: "AUTO_SPLIT",
  EFECTIVO: "REVIEW_REQUIRED",
} as const satisfies Record<string, DispatchSplitPolicy>;

export const H4_D82_A3_ROUTING_CRITERIA = [
  "ELIGIBILITY",
  "SINGLE_DISPATCH_COVERAGE",
  "CLIENT_COMMERCIAL_PRICE",
  "DISPATCH_COST_NOT_ABOVE_CLIENT_PRICE",
  "CLIENT_PRIORITY",
  "LOWER_OPERATIONAL_COST",
  "HIGHER_AVAILABLE_BALANCE",
  "STABLE_DISPATCH_ID",
] as const;

export const H4_D82_A3_CLIENT_PRICE_SCOPE =
  "CLIENT_OPERATION_TYPE_INDEPENDENT_OF_HIDDEN_DISPATCH" as const;

export const H4_D82_A3_CANONICAL_BALANCE_DIMENSIONS = [
  "rootId",
  "holderType",
  "holderId",
  "despachoId",
  "currency",
] as const;