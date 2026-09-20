export const MATERIALITY_REQUIRED_TYPES = [
  "ORDEN_COMPRA",
  "COTIZACION",
  "CONSTANCIA_RECEPCION_SATISFACCION",
  "FACTURA_XML",
  "FACTURA_PDF",
  "COMPROBANTE_PAGO",
] as const;

export const MATERIALITY_DOCUMENT_TYPES = [
  "CONTRATO_MARCO",
  "CONTRATO_OPERACION",
  "SOLICITUD_INTERNA",
  "AUTORIZACION_OPERATIVA",
  "FIRMA_AUTORIZADA_CLIENTE",
  "PRESUPUESTO",
  ...MATERIALITY_REQUIRED_TYPES,
  "COTIZACION_FIRMADA",
  "COMPLEMENTO_PAGO_XML",
  "COMPLEMENTO_PAGO_PDF",
  "CFDI_GASTO_XML",
  "CFDI_GASTO_PDF",
  "SOLICITUD_GASTO_RELACIONADA",
  "COMPROBANTE_TRANSFERENCIA",
  "ESTADO_CUENTA",
  "ACUSE_RECEPCION",
  "EVIDENCIA_ENTREGA",
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
    case "CONTRATO_OPERACION":
      return "Contrato de operacion";
    case "SOLICITUD_INTERNA":
      return "Solicitud interna";
    case "AUTORIZACION_OPERATIVA":
      return "Autorizacion operativa";
    case "ORDEN_COMPRA":
      return "Orden de Compra";
    case "COTIZACION":
      return "Cotizacion";
    case "COTIZACION_FIRMADA":
      return "Cotizacion Firmada";
    case "PRESUPUESTO":
      return "Presupuesto / Cotizacion";
    case "FIRMA_AUTORIZADA_CLIENTE":
      return "Firma Autorizada del Cliente";
    case "CONSTANCIA_RECEPCION_SATISFACCION":
      return "Constancia de Recepcion y Satisfaccion";
    case "FACTURA_XML":
      return "Factura XML";
    case "FACTURA_PDF":
      return "Factura PDF";
    case "COMPROBANTE_PAGO":
      return "Comprobante de Pago";
    case "COMPLEMENTO_PAGO_XML":
      return "Complemento de Pago XML";
    case "COMPLEMENTO_PAGO_PDF":
      return "Complemento de Pago PDF";
    case "CFDI_GASTO_XML":
      return "CFDI de Gasto XML";
    case "CFDI_GASTO_PDF":
      return "CFDI de Gasto PDF";
    case "SOLICITUD_GASTO_RELACIONADA":
      return "Solicitud de Gasto Relacionada";
    case "COMPROBANTE_TRANSFERENCIA":
      return "Comprobante de Transferencia";
    case "ESTADO_CUENTA":
      return "Estado de Cuenta";
    case "ACUSE_RECEPCION":
      return "Acuse de Recepcion";
    case "EVIDENCIA_ENTREGA":
      return "Evidencia de Entrega";
    case "EVIDENCIA_OPERATIVA":
      return "Evidencia Operativa";
    case "OTRO":
      return "Otro";
    default:
      return "Documento";
  }
}
