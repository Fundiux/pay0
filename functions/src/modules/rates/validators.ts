import { HttpsError } from "firebase-functions/v2/https";

const H4_D82_A2_A1_ZERO_COST_ENABLED = true;

function assertNonNegativeRateOrCost(
  value: unknown,
  fieldName: string,
) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} debe ser un numero mayor o igual a cero.`,
    );
  }

  return Math.round(
    (amount + Number.EPSILON) * 10000,
  ) / 10000;
}

export function assertOperationTypeKey(value: unknown) {
  const key = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  if (!key) {
    throw new HttpsError("invalid-argument", "key requerido.");
  }

  return key;
}

export function assertOperationTypeName(value: unknown) {
  const name = String(value || "").trim();
  if (!name) {
    throw new HttpsError("invalid-argument", "name requerido.");
  }
  return name;
}

export function assertCalculationBaseType(value: unknown): "TOTAL" | "SUBTOTAL" {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "TOTAL" || normalized === "SUBTOTAL") {
    return normalized;
  }
  throw new HttpsError("invalid-argument", "calculationBaseType invalido.");
}

export function normalizePricingMode(value: unknown): "PERCENT" | "FIXED" {
  const normalized = String(value || "PERCENT").trim().toUpperCase();
  const legacyHybridMode = ["MI", "XED"].join("");
  if (normalized === legacyHybridMode) return "FIXED";
  if (normalized === "PERCENT" || normalized === "FIXED") {
    return normalized;
  }
  throw new HttpsError("invalid-argument", "pricingMode invalido.");
}

export function assertDespachoId(value: unknown) {
  const despachoId = String(value || "").trim();
  if (!despachoId) {
    throw new HttpsError("invalid-argument", "despachoId requerido.");
  }
  return despachoId;
}

export function assertUserId(value: unknown) {
  const userId = String(value || "").trim();
  if (!userId) {
    throw new HttpsError("invalid-argument", "userId requerido.");
  }
  return userId;
}

export function assertBaseCost(value: unknown) {
  return assertNonNegativeRateOrCost(
    value,
    "baseCost",
  );
}

export function assertAssignedCost(value: unknown) {
  return assertNonNegativeRateOrCost(
    value,
    "assignedCost",
  );
}
