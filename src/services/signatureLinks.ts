import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";
import { CALLABLES } from "@/lib/callableNames";

/** purpose REMOTE = a link to share with the client (sent by WhatsApp automatically); IN_PERSON = signed right here. */
export async function createSolicitudSignatureLink(solicitudId: string, purpose: "REMOTE" | "IN_PERSON" = "IN_PERSON") {
  const fn = httpsCallable<
    { solicitudId: string; origin?: string; purpose?: "REMOTE" | "IN_PERSON" },
    { ok: boolean; token: string; url: string; expiresAtMillis: number }
  >(functions, CALLABLES.createSolicitudSignatureLink);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (await fn({ solicitudId, origin, purpose })).data;
}

export async function getSolicitudSignatureRequest(token: string) {
  const fn = httpsCallable<
    { token: string },
    { ok: boolean; solicitudFolio?: string | null; clienteNombre?: string | null; expiresAtMillis: number }
  >(functions, CALLABLES.getSolicitudSignatureRequest);
  return (await fn({ token })).data;
}

export async function submitSolicitudSignature(input: {
  token: string;
  signerName: string;
  signerRole?: string;
  receiptLocation: string;
  receiptAddress: string;
  observations?: string;
  acceptedNoClaimPolicy: boolean;
  signatureDataUrl: string;
}) {
  const fn = httpsCallable<
    typeof input,
    { ok: boolean; uploadId: string; version: number; constanciaPending?: boolean }
  >(functions, CALLABLES.submitSolicitudSignature);
  return (await fn(input)).data;
}

export async function generateSolicitudReceiptCertificate(solicitudId: string) {
  return (await httpsCallable<{ solicitudId: string }, { ok: boolean; alreadyExists?: boolean }>(
    functions, "generateSolicitudReceiptCertificate",
  )({ solicitudId })).data;
}

export async function generateSolicitudQuotation(solicitudId: string, replaceExisting = false) {
  const fn = httpsCallable<
    { solicitudId: string; replaceExisting: boolean },
    { ok: boolean; uploadId: string; alreadyExists?: boolean }
  >(functions, CALLABLES.generateSolicitudQuotation);
  return (await fn({ solicitudId, replaceExisting })).data;
}
