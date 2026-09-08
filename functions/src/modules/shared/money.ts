import { HttpsError } from "firebase-functions/v2/https";

export function money2(value: unknown) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(2));
}

export function toSafeMoneyNumber(value: unknown, fieldName = "monto") {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new HttpsError("invalid-argument", `${fieldName} invalido.`);
  }
  return money2(num);
}

export function assertPositiveMoney(value: unknown, fieldName = "monto") {
  const num = toSafeMoneyNumber(value, fieldName);
  if (num <= 0) {
    throw new HttpsError("invalid-argument", `${fieldName} invalido.`);
  }
  return num;
}

export function assertNonNegativeMoney(value: unknown, fieldName = "monto") {
  const num = toSafeMoneyNumber(value, fieldName);
  if (num < 0) {
    throw new HttpsError("invalid-argument", `${fieldName} invalido.`);
  }
  return num;
}
