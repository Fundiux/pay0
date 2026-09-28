import { HttpsError } from "firebase-functions/v2/https";

export const RECEIPT_ACCEPTANCE_VERSION = "PAY0-RECEPCION-2026-09-28.v1";
export const RECEIPT_ACCEPTANCE_TEXT = "Confirmo la recepción y conformidad de los bienes o servicios en el lugar y dirección declarados, salvo las observaciones registradas, y acepto la política de no reclamación posterior aplicable.";

const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export function receiptAcceptance(data: any) {
  const signerName = clean(data?.signerName, 180), signerRole = clean(data?.signerRole, 120);
  const receiptLocation = clean(data?.receiptLocation, 240), receiptAddress = clean(data?.receiptAddress, 500);
  const observations = clean(data?.observations, 600);
  if (!signerName || !signerRole) throw new HttpsError("invalid-argument", "Indica el nombre y cargo de quien recibe.");
  if (!receiptLocation || !receiptAddress) throw new HttpsError("invalid-argument", "Indica el lugar y la dirección reales de recepción o prestación.");
  if (data?.acceptedNoClaimPolicy !== true) throw new HttpsError("failed-precondition", "La aceptación expresa de recepción y conformidad es obligatoria.");
  return { signerName, signerRole, receiptLocation, receiptAddress, observations,
    acceptedNoClaimPolicy: true, acceptanceVersion: RECEIPT_ACCEPTANCE_VERSION, acceptanceText: RECEIPT_ACCEPTANCE_TEXT };
}
