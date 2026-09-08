import { HttpsError } from "firebase-functions/v2/https";
import type { HolderType, Pay0Role } from "../shared/domain";
import { assertPositiveMoney } from "../shared/money";

export function assertHolderType(value: unknown): HolderType {
  if (value === "CLIENT" || value === "USER") return value;
  throw new HttpsError("invalid-argument", "holderType invalido.");
}

export function assertHolderId(value: unknown, fieldName = "holderId") {
  const id = String(value || "").trim();
  if (!id) {
    throw new HttpsError("invalid-argument", `${fieldName} requerido.`);
  }
  return id;
}

export function normalizeHolderRole(value: unknown): Pay0Role | null {
  if (value === "superadmin" || value === "admin" || value === "operador") {
    return value;
  }
  return null;
}

export function assertMovementAmount(value: unknown, fieldName = "amount") {
  return assertPositiveMoney(value, fieldName);
}
