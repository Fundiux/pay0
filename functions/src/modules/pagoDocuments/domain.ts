export const MAX_PAGO_DOCUMENT_SIZE_BYTES = 1 * 1024 * 1024;

export const PAGO_DOCUMENT_TYPES = [
  "COMPROBANTE_PAGO",
  "OTRO",
] as const;

export type PagoDocumentType = typeof PAGO_DOCUMENT_TYPES[number];

export function normalizePagoDocumentType(input: any): PagoDocumentType {
  const value = String(input || "").trim().toUpperCase();
  if ((PAGO_DOCUMENT_TYPES as readonly string[]).includes(value)) {
    return value as PagoDocumentType;
  }
  return "OTRO";
}

export function getPagoDocumentTypeLabel(type: any): string {
  const normalized = normalizePagoDocumentType(type);

  switch (normalized) {
    case "COMPROBANTE_PAGO":
      return "Comprobante de Pago";
    case "OTRO":
    default:
      return "Otro";
  }
}

export function sanitizePagoDocumentLabel(input: any): string {
  return String(input || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

export function sanitizeFilename(input: any): string {
  const raw = String(input || "archivo").trim() || "archivo";
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
}

export function buildPagoDocumentStoragePath(input: {
  rootId: string;
  pagoId: string;
  documentType: PagoDocumentType;
  uploadId: string;
  originalName: string;
}): string {
  const rootId=String(input.rootId||"").trim();
  const pagoId=String(input.pagoId||"").trim();
  const uploadId=String(input.uploadId||"").trim();
  const documentType=normalizePagoDocumentType(input.documentType);
  if(!rootId||!pagoId||!uploadId)throw new Error("PAGO_DOCUMENT_STORAGE_PATH_INVALID");
  return `roots/${rootId}/pagos/${pagoId}/docs/${documentType}/${uploadId}-${sanitizeFilename(input.originalName)}`;
}