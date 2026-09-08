import { HttpsError } from "firebase-functions/v2/https";
import { assertPositiveMoney } from "../shared/money";

export function assertClienteId(value: unknown) {
  const id = String(value || "").trim();
  if (!id) {
    throw new HttpsError("invalid-argument", "clienteId requerido.");
  }
  return id;
}

export function assertBeneficiaryId(value: unknown) {
  const id = String(value || "").trim();
  if (!id) {
    throw new HttpsError("invalid-argument", "beneficiaryId requerido.");
  }
  return id;
}

export function assertMethodId(value: unknown) {
  const id = String(value || "").trim();
  if (!id) {
    throw new HttpsError("invalid-argument", "methodId requerido.");
  }
  return id;
}

export function assertAdvanceAmount(value: unknown) {
  return assertPositiveMoney(value, "amount");
}

export function assertDispersionAmount(value: unknown) {
  return assertPositiveMoney(value, "amount");
}

export function assertAdvanceReason(value: unknown) {
  const reason = String(value || "").trim();
  if (!reason) {
    throw new HttpsError("invalid-argument", "reason requerido.");
  }
  return reason;
}
