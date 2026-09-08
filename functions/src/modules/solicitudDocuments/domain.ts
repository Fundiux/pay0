export const MAX_SOLICITUD_DOCUMENT_SIZE_BYTES = 1024 * 1024;

export const SOLICITUD_DOCUMENT_TYPES = [
  "FACTURA_PDF",
  "FACTURA_XML",
  "ORDEN_COMPRA",
  "PRESUPUESTO",
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
    case "PRESUPUESTO":
      return "Presupuesto / Cotizacion";
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