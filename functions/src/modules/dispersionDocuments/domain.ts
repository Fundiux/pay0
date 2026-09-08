export const MAX_DISPERSION_DOCUMENT_SIZE_BYTES = 1024 * 1024;

export const DISPERSION_DOCUMENT_TYPES = [
  "COMPROBANTE_DISPERSION",
] as const;

export type DispersionDocumentType = typeof DISPERSION_DOCUMENT_TYPES[number];

export function normalizeDispersionDocumentType(input: any): DispersionDocumentType {
  const raw = String(input || "").trim().toUpperCase();
  if (raw === "COMPROBANTE_DISPERSION") return "COMPROBANTE_DISPERSION";
  return "COMPROBANTE_DISPERSION";
}

export function getDispersionDocumentTypeLabel(type: DispersionDocumentType): string {
  switch (type) {
    case "COMPROBANTE_DISPERSION":
    default:
      return "Comprobante de Dispersion";
  }
}

export function sanitizeFilename(input: any): string {
  const raw = String(input || "archivo").trim() || "archivo";
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
}

export function cleanText(value: any): string {
  return String(value || "").trim();
}

export function safeDocId(value: string): string {
  return cleanText(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
}

export function toMoney(value: any): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function formatMoney(value: any): string {
  const amount = toMoney(value);
  return "$" + amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}