import { HttpsError } from "firebase-functions/v2/https";

export function normalizeIqAssociatedName(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function requireIqAssociatedName(value: unknown): string {
  const associatedName = normalizeIqAssociatedName(value);
  if (!associatedName) {
    throw new HttpsError(
      "failed-precondition",
      "El perfil IQ seleccionado no tiene configurado el Asociado IQ.",
    );
  }
  return associatedName;
}
