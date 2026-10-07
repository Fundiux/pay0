import type { ReceiptIdentification } from "@/services/pagoReceipt";

const messages: Record<string, string> = {
  INVALID_AMOUNT: "monto inválido", MISSING_DATE: "fecha incompleta o inválida", MISSING_REFERENCE: "referencia insuficiente",
  UNSUPPORTED_CURRENCY: "moneda sin confirmar", PAYMENT_FORM_REQUIRES_REVIEW: "forma o resultado de pago sin confirmar",
  MISSING_OPERATION_TYPE: "tipo de operación pendiente", OPERATION_TYPE_REQUIRES_REVIEW: "tipo de operación no disponible",
  CATALOG_REQUIRES_REVIEW: "catálogo requiere revisión", CONFLICTING_RFC: "RFC contradictorios", DUPLICATE: "comprobante ya registrado",
  CLIENT_ACCESS_REQUIRES_REVIEW: "acceso al cliente sin confirmar", COMPANY_ACCESS_REQUIRES_REVIEW: "acceso a la empresa sin confirmar",
  RECEIPT_UPLOAD_PENDING: "pago registrado; comprobante pendiente de adjuntar",
  AMOUNT_REQUIRES_REVIEW: "importe sin confirmar o contradictorio", EXECUTION_REQUIRES_REVIEW: "transferencia sin ejecución confirmada",
  DATE_REQUIRES_REVIEW: "formato de fecha ambiguo o sin confirmar",
};
const identityMessages: Record<string, string> = {
  CONFLICTING_SIGNALS: "datos contradictorios", MULTIPLE_CANDIDATES: "varias coincidencias", NO_CANDIDATE: "sin coincidencia exacta",
  INSUFFICIENT_IDENTITY_SIGNALS: "RFC o cuenta completa insuficientes", IDENTITY_NOT_CORROBORATED: "identidad sin corroborar",
};
export function receiptReviewReason(code: string): string {
  if (messages[code]) return messages[code];
  for (const [prefix, name] of [["CLIENT_", "cliente"], ["COMPANY_", "empresa"]])
    if (code.startsWith(prefix) && identityMessages[code.slice(prefix.length)]) return `${name}: ${identityMessages[code.slice(prefix.length)]}`;
  return "identificación pendiente de revisión";
}

/** A browser suggestion is never a registration authority. Only the server proposal is eligible. */
export function automaticReceiptPayload(identification: ReceiptIdentification | undefined, operationTypeKey: string) {
  const payload = identification?.createPayload;
  return identification?.status === "READY" && identification.reasons.length === 0 && payload &&
    /^[a-f0-9]{64}$/.test(identification.id) && payload.receiptIdentificationId === identification.id &&
    payload.operationTypeKey === operationTypeKey ? payload : null;
}

export function automaticReceiptMissing(identification: ReceiptIdentification | undefined, operationTypeKey: string): string[] {
  if (automaticReceiptPayload(identification, operationTypeKey)) return [];
  if (!identification) return ["identificación del servidor pendiente"];
  if (identification.status === "REGISTERED") return ["comprobante ya registrado"];
  if (identification.createPayload && identification.createPayload.operationTypeKey !== operationTypeKey)
    return ["tipo de operación cambiado: vuelve a validar"];
  return identification.reasons.length ? identification.reasons.map(receiptReviewReason) : ["identificación pendiente de revisión"];
}
