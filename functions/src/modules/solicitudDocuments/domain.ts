export const MAX_SOLICITUD_DOCUMENT_SIZE_BYTES = 1024 * 1024;

export const SOLICITUD_DOCUMENT_TYPES = [
  "FACTURA_PDF",
  "FACTURA_XML",
  "ORDEN_COMPRA",
  "COTIZACION",
  "COTIZACION_FIRMADA",
  "PRESUPUESTO",
  "CONTRATO_OPERACION",
  "AUTORIZACION_OPERATIVA",
  "FIRMA_AUTORIZADA_CLIENTE",
  "CONSTANCIA_RECEPCION_SATISFACCION",
  "COMPLEMENTO_PAGO_XML",
  "COMPLEMENTO_PAGO_PDF",
  "CFDI_GASTO_XML",
  "CFDI_GASTO_PDF",
  "SOLICITUD_GASTO_RELACIONADA",
  "COMPROBANTE_TRANSFERENCIA",
  "ESTADO_CUENTA",
  "ACUSE_RECEPCION",
  "ACUSE_CANCELACION_CFDI",
  "EVIDENCIA_ENTREGA",
  "EVIDENCIA_OPERATIVA",
  "OTRO",
] as const;

export type SolicitudDocumentType = typeof SOLICITUD_DOCUMENT_TYPES[number];

const TYPE_SET = new Set<string>(SOLICITUD_DOCUMENT_TYPES);

export function normalizeSolicitudDocumentType(input: any): SolicitudDocumentType {
  const raw = String(input || "").trim().toUpperCase();

  if (TYPE_SET.has(raw)) {
    return raw as SolicitudDocumentType;
  }

  return "OTRO";
}

export function getSolicitudDocumentTypeLabel(type: SolicitudDocumentType): string {
  switch (type) {
    case "FACTURA_PDF":
      return "Factura PDF";
    case "FACTURA_XML":
      return "Factura XML";
    case "ORDEN_COMPRA":
      return "Orden de Compra";
    case "COTIZACION":
      return "Cotizacion";
    case "COTIZACION_FIRMADA":
      return "Cotizacion Firmada";
    case "PRESUPUESTO":
      return "Presupuesto / Cotizacion";
    case "CONTRATO_OPERACION":
      return "Contrato de operacion";
    case "AUTORIZACION_OPERATIVA":
      return "Autorizacion operativa";
    case "FIRMA_AUTORIZADA_CLIENTE":
      return "Firma Autorizada del Cliente";
    case "CONSTANCIA_RECEPCION_SATISFACCION":
      return "Constancia de Recepcion y Satisfaccion";
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
    case "ACUSE_CANCELACION_CFDI":
      return "Acuse de Cancelacion CFDI";
    case "EVIDENCIA_ENTREGA":
      return "Evidencia de Entrega";
    case "EVIDENCIA_OPERATIVA":
      return "Evidencia Operativa";
    case "OTRO":
    default:
      return "Otro";
  }
}

export function sanitizeDocumentLabel(input: any): string {
  const raw = String(input || "").trim();
  return raw.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").slice(0, 80);
}

export function sanitizeFilename(input: any): string {
  const raw = String(input || "archivo").trim() || "archivo";
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
}

export function buildSolicitudDocumentStoragePath(input: {
  rootId: string;
  solicitudId: string;
  documentType: SolicitudDocumentType;
  uploadId: string;
  originalName: string;
}): string {
  const rootId = String(input.rootId || "").trim();
  const solicitudId = String(input.solicitudId || "").trim();
  const uploadId = String(input.uploadId || "").trim();
  const documentType = normalizeSolicitudDocumentType(input.documentType);
  if (!rootId || !solicitudId || !uploadId) throw new Error("SOLICITUD_DOCUMENT_STORAGE_PATH_INVALID");
  return `roots/${rootId}/solicitudes/${solicitudId}/docs/${documentType}/${uploadId}-${sanitizeFilename(input.originalName)}`;
}
