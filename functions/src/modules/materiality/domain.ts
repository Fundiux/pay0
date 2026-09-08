export const MATERIALITY_REQUIRED_TYPES = [
  "ORDEN_COMPRA",
  "PRESUPUESTO",
  "FACTURA_XML",
  "FACTURA_PDF",
  "COMPROBANTE_PAGO",
] as const;

export const MATERIALITY_DOCUMENT_TYPES = [
  "CONTRATO_MARCO",
  ...MATERIALITY_REQUIRED_TYPES,
  "EVIDENCIA_OPERATIVA",
  "OTRO",
] as const;

export type MaterialityDocumentType = typeof MATERIALITY_DOCUMENT_TYPES[number];

export type MaterialityOperationStatus =
  | "OPEN"
  | "COMPLETE"
  | "INCOMPLETE"
  | "CANCELLED";

export type MaterialityVisibilityScope =
  | "PUBLIC_SAFE"
  | "CLIENT_PRIVATE"
  | "INTERNAL";

export function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

export function toSafeDocId(value: unknown): string {
  const raw = cleanText(value);
  return raw
    .replace(/[\/\\#?\[\]]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 500);
}

export function buildMaterialityClientCompanyId(rootId: string, clienteId: string, companyId: string): string {
  return toSafeDocId(`${rootId}_${clienteId}_${companyId}`);
}

export function normalizeMaterialityDocumentType(value: unknown): MaterialityDocumentType | "" {
  const raw = cleanText(value).toUpperCase();
  return (MATERIALITY_DOCUMENT_TYPES as readonly string[]).includes(raw)
    ? (raw as MaterialityDocumentType)
    : "";
}

export function getMaterialityDocumentLabel(type: unknown): string {
  const normalized = normalizeMaterialityDocumentType(type);
  switch (normalized) {
    case "CONTRATO_MARCO":
      return "Contrato marco";
    case "ORDEN_COMPRA":
      return "Orden de Compra";
    case "PRESUPUESTO":
      return "Presupuesto / Cotizacion";
    case "FACTURA_XML":
      return "Factura XML";
    case "FACTURA_PDF":
      return "Factura PDF";
    case "COMPROBANTE_PAGO":
      return "Comprobante de Pago";
    case "EVIDENCIA_OPERATIVA":
      return "Evidencia Operativa";
    case "OTRO":
      return "Otro";
    default:
      return "Documento";
  }
}