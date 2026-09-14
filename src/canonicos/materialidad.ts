export type MaterialityCanonicalDocument = {
  value: string;
  label: string;
  group: "INGRESO" | "CFDI_EMITIDO" | "COBRANZA" | "GASTO_RELACIONADO" | "BANCO" | "OPERACION" | "OTRO";
  requiredForCentralDossier?: boolean;
  accept: string;
  description: string;
};

export const MATERIALIDAD_CANON_VERSION = "2026-09-14.materialidad-central-dossier.v1";

export const MATERIALIDAD_CANONICAL_DOCUMENTS: readonly MaterialityCanonicalDocument[] = [
  { value: "ORDEN_COMPRA", label: "Orden de Compra", group: "INGRESO", requiredForCentralDossier: true, accept: ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv", description: "Documento detonador de la operacion; si el emisor es empresa propia puede preparar borrador CFDI." },
  { value: "COTIZACION", label: "Cotizacion", group: "INGRESO", requiredForCentralDossier: true, accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.csv", description: "Base comercial previa a la OC o soporte del precio pactado." },
  { value: "PRESUPUESTO", label: "Presupuesto / Cotizacion", group: "INGRESO", requiredForCentralDossier: true, accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.csv", description: "Presupuesto autorizado cuando la operacion no nace de una cotizacion formal." },
  { value: "CONTRATO_OPERACION", label: "Contrato de operacion", group: "OPERACION", accept: "application/pdf,.pdf,.doc,.docx", description: "Contrato, convenio, pedido firmado o instrumento equivalente de la operacion." },
  { value: "AUTORIZACION_OPERATIVA", label: "Autorizacion operativa", group: "OPERACION", accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.txt", description: "Aprobacion interna o del cliente para ejecutar/facturar la operacion." },
  { value: "FACTURA_XML", label: "Factura XML", group: "CFDI_EMITIDO", requiredForCentralDossier: true, accept: ".xml,text/xml,application/xml", description: "XML timbrado emitido por empresa propia o recibido como soporte fiscal." },
  { value: "FACTURA_PDF", label: "Factura PDF", group: "CFDI_EMITIDO", requiredForCentralDossier: true, accept: "application/pdf,.pdf", description: "Representacion impresa del CFDI." },
  { value: "COMPROBANTE_PAGO", label: "Comprobante de Pago", group: "COBRANZA", requiredForCentralDossier: true, accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp", description: "Evidencia de cobro o pago recibido contra la operacion." },
  { value: "COMPLEMENTO_PAGO_XML", label: "Complemento de Pago XML", group: "COBRANZA", accept: ".xml,text/xml,application/xml", description: "Complemento de pago cuando el CFDI sea PPD o el flujo fiscal lo requiera." },
  { value: "COMPLEMENTO_PAGO_PDF", label: "Complemento de Pago PDF", group: "COBRANZA", accept: "application/pdf,.pdf", description: "Representacion impresa del complemento de pago." },
  { value: "CFDI_GASTO_XML", label: "CFDI de Gasto XML", group: "GASTO_RELACIONADO", accept: ".xml,text/xml,application/xml", description: "XML de gasto relacionado para equilibrar ingreso/gasto de empresas propias." },
  { value: "CFDI_GASTO_PDF", label: "CFDI de Gasto PDF", group: "GASTO_RELACIONADO", accept: "application/pdf,.pdf", description: "Representacion del CFDI de gasto relacionado." },
  { value: "SOLICITUD_GASTO_RELACIONADA", label: "Solicitud de Gasto Relacionada", group: "GASTO_RELACIONADO", accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.csv", description: "Solicitud que documenta el gasto generado contra el ingreso." },
  { value: "COMPROBANTE_TRANSFERENCIA", label: "Comprobante de Transferencia", group: "BANCO", accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp", description: "Transferencia bancaria relacionada al cobro o gasto." },
  { value: "ESTADO_CUENTA", label: "Estado de Cuenta", group: "BANCO", accept: "application/pdf,.pdf,.csv,.xlsx", description: "Soporte bancario para conciliacion y materialidad." },
  { value: "ACUSE_RECEPCION", label: "Acuse de Recepcion", group: "OPERACION", accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp", description: "Acuse de recepcion del bien, servicio, documento o comprobante." },
  { value: "EVIDENCIA_ENTREGA", label: "Evidencia de Entrega", group: "OPERACION", accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.txt", description: "Evidencia operativa de entrega/ejecucion." },
  { value: "EVIDENCIA_OPERATIVA", label: "Evidencia Operativa", group: "OPERACION", accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.xlsx", description: "Soporte adicional de ejecucion." },
  { value: "OTRO", label: "Otro", group: "OTRO", accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.xml,.xlsx,.csv,.doc,.docx,.txt", description: "Documento excepcional; debe reclasificarse si se vuelve recurrente." },
] as const;

export const MATERIALIDAD_REQUIRED_DOCUMENT_VALUES = MATERIALIDAD_CANONICAL_DOCUMENTS
  .filter((document) => document.requiredForCentralDossier)
  .map((document) => document.value);
