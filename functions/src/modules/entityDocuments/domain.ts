export const ENTITY_DOCUMENT_ENTITY_TYPES = [
  "CLIENTE",
  "COMPANY",
  "DESPACHO",
] as const;

export type EntityDocumentEntityType = (typeof ENTITY_DOCUMENT_ENTITY_TYPES)[number];

export const ENTITY_DOCUMENT_LEGAL_PERSON_TYPES = [
  "PERSONA_MORAL",
  "PERSONA_FISICA",
  "PERSONA_FISICA_ACTIVIDAD_EMPRESARIAL",
] as const;

export type EntityDocumentLegalPersonType =
  (typeof ENTITY_DOCUMENT_LEGAL_PERSON_TYPES)[number];

export const ENTITY_DOCUMENT_FISCAL_ADMIN_TYPES = [
  "PROPIA_PAY0",
  "TERCERO",
  "CLIENTE_ADMINISTRADO",
  "SOLO_OPERATIVO",
] as const;

export type EntityDocumentFiscalAdminType =
  (typeof ENTITY_DOCUMENT_FISCAL_ADMIN_TYPES)[number];

export const ENTITY_DOCUMENT_TYPES = [
  "ACTA_CONSTITUTIVA",
  "OPINION_SAT",
  "OPINION_IMSS",
  "OPINION_INFONAVIT",
  "OPINION_ESTATAL",
  "CONSTANCIA_SITUACION_FISCAL",
  "RFC",
  "CURP",
  "IDENTIFICACION_OFICIAL",
  "COMPROBANTE_DOMICILIO",
  "PODER_REPRESENTANTE",
  "ESTADO_CUENTA",
  "DECLARACION_MENSUAL",
  "DECLARACION_ANUAL",
  "PAGO_IMPUESTOS",
  "ALTA_PATRONAL",
  "IMSS",
  "ALTA_BAJA_TRABAJADOR",
  "CSD_EFIRMA",
  "DOCUMENTO_CONTABLE",
  "OTRO",
] as const;

export type EntityDocumentType = (typeof ENTITY_DOCUMENT_TYPES)[number];

export const ENTITY_DOCUMENT_PERIODIC_TYPES: EntityDocumentType[] = [
  "OPINION_SAT",
  "OPINION_IMSS",
  "OPINION_INFONAVIT",
  "OPINION_ESTATAL",
  "CONSTANCIA_SITUACION_FISCAL",
  "DECLARACION_MENSUAL",
  "PAGO_IMPUESTOS",
  "ESTADO_CUENTA",
];

export const ENTITY_DOCUMENT_MONTHLY_SUGGESTED_TYPES: EntityDocumentType[] = [
  "OPINION_SAT",
  "OPINION_IMSS",
  "OPINION_INFONAVIT",
  "OPINION_ESTATAL",
  "CONSTANCIA_SITUACION_FISCAL",
  "ESTADO_CUENTA",
];

export const ENTITY_DOCUMENT_VERSIONABLE_TYPES: EntityDocumentType[] = [
  ...ENTITY_DOCUMENT_PERIODIC_TYPES,
  "ACTA_CONSTITUTIVA",
  "PODER_REPRESENTANTE",
  "COMPROBANTE_DOMICILIO",
  "CSD_EFIRMA",
  "DOCUMENTO_CONTABLE",
  "OTRO",
];

const MB = 1024 * 1024;

export const ENTITY_DOCUMENT_DEFAULT_MAX_SIZE_BYTES = 10 * MB;

export const ENTITY_DOCUMENT_MAX_SIZE_BYTES: Record<EntityDocumentType, number> = {
  ACTA_CONSTITUTIVA: 25 * MB,
  OPINION_SAT: 10 * MB,
  OPINION_IMSS: 10 * MB,
  OPINION_INFONAVIT: 10 * MB,
  OPINION_ESTATAL: 10 * MB,
  CONSTANCIA_SITUACION_FISCAL: 10 * MB,
  RFC: 5 * MB,
  CURP: 5 * MB,
  IDENTIFICACION_OFICIAL: 10 * MB,
  COMPROBANTE_DOMICILIO: 10 * MB,
  PODER_REPRESENTANTE: 15 * MB,
  ESTADO_CUENTA: 10 * MB,
  DECLARACION_MENSUAL: 10 * MB,
  DECLARACION_ANUAL: 15 * MB,
  PAGO_IMPUESTOS: 10 * MB,
  ALTA_PATRONAL: 10 * MB,
  IMSS: 10 * MB,
  ALTA_BAJA_TRABAJADOR: 10 * MB,
  CSD_EFIRMA: 10 * MB,
  DOCUMENTO_CONTABLE: 10 * MB,
  OTRO: 10 * MB,
};

export const ENTITY_DOCUMENT_LABELS: Record<EntityDocumentType, string> = {
  ACTA_CONSTITUTIVA: "Acta constitutiva",
  OPINION_SAT: "Opinion SAT",
  OPINION_IMSS: "Opinion IMSS",
  OPINION_INFONAVIT: "Opinion INFONAVIT",
  OPINION_ESTATAL: "Opinion estatal",
  CONSTANCIA_SITUACION_FISCAL: "Constancia de situacion fiscal",
  RFC: "RFC",
  CURP: "CURP",
  IDENTIFICACION_OFICIAL: "Identificacion oficial",
  COMPROBANTE_DOMICILIO: "Comprobante de domicilio",
  PODER_REPRESENTANTE: "Poder / representante legal",
  ESTADO_CUENTA: "Estado de cuenta",
  DECLARACION_MENSUAL: "Declaracion mensual",
  DECLARACION_ANUAL: "Declaracion anual",
  PAGO_IMPUESTOS: "Pago de impuestos",
  ALTA_PATRONAL: "Alta patronal",
  IMSS: "IMSS / seguro social",
  ALTA_BAJA_TRABAJADOR: "Alta/baja de trabajador",
  CSD_EFIRMA: "CSD / e.firma",
  DOCUMENTO_CONTABLE: "Documento contable",
  OTRO: "Otro",
};

export type EntityDocumentStatus = "ACTIVE" | "INACTIVE" | "REPLACED";

export type EntityDocumentValidationStatus =
  | "PENDIENTE_VALIDACION"
  | "VALIDADO"
  | "RECHAZADO"
  | "VALIDACION_FALLIDA"
  | "NO_APLICA";

export type EntityDocumentValidationKind =
  | "CSF"
  | "CONSTANCIA_SITUACION_FISCAL"
  | "ACTA_CONSTITUTIVA"
  | "OPINION_SAT"
  | "OPINION_IMSS"
  | "OPINION_INFONAVIT"
  | "OPINION_ESTATAL"
  | "MANUAL";

export type EntityDocumentValidationSource =
  | "BACKEND_PARSE"
  | "MANUAL_REVIEW"
  | "FUTURE_OCR";

export type EntityDocumentOpinionStatus =
  | "POSITIVA"
  | "NEGATIVA"
  | "SIN_OPINION"
  | "NO_DETERMINADO";

export type EntityDocumentExtractedData = {
  rfc?: string | null;
  razonSocial?: string | null;
  regimenFiscal?: string | null;
  documentDate?: string | null;
  clientName?: string | null;
  opinionStatus?: EntityDocumentOpinionStatus | null;
  rawTextSample?: string | null;
};


export type EntityDocumentRecord = {
  id: string;
  rootId: string;
  entityType: EntityDocumentEntityType;
  entityId: string;
  legalPersonType?: EntityDocumentLegalPersonType | null;
  fiscalAdminType?: EntityDocumentFiscalAdminType | null;
  documentType: EntityDocumentType;
  documentPeriod?: string | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  version: number;
  isCurrent: boolean;
  active: boolean;
  status: EntityDocumentStatus;
  validationStatus?: EntityDocumentValidationStatus | null;
  validationKind?: EntityDocumentValidationKind | string | null;
  validationSource?: EntityDocumentValidationSource | null;
  validationErrors?: string[];
  extractedData?: EntityDocumentExtractedData | null;
  documentDate?: string | null;
  storagePath: string;
  fileName: string;
  fileSize: number;
  sha256?: string | null;
  contentType?: string | null;
  createdAt?: unknown;
  createdBy: string;
  createdByName?: string | null;
  supersedesDocumentId?: string | null;
  supersededByDocumentId?: string | null;
  validFrom?: unknown;
  validTo?: unknown;
  notes?: string | null;
};

export function isEntityDocumentEntityType(
  value: unknown
): value is EntityDocumentEntityType {
  return ENTITY_DOCUMENT_ENTITY_TYPES.includes(value as EntityDocumentEntityType);
}

export function isEntityDocumentLegalPersonType(
  value: unknown
): value is EntityDocumentLegalPersonType {
  return ENTITY_DOCUMENT_LEGAL_PERSON_TYPES.includes(
    value as EntityDocumentLegalPersonType
  );
}

export function isEntityDocumentFiscalAdminType(
  value: unknown
): value is EntityDocumentFiscalAdminType {
  return ENTITY_DOCUMENT_FISCAL_ADMIN_TYPES.includes(
    value as EntityDocumentFiscalAdminType
  );
}

export function isEntityDocumentType(value: unknown): value is EntityDocumentType {
  return ENTITY_DOCUMENT_TYPES.includes(value as EntityDocumentType);
}

export function isEntityDocumentPeriodicType(type: EntityDocumentType): boolean {
  return ENTITY_DOCUMENT_PERIODIC_TYPES.includes(type);
}

export function isEntityDocumentVersionableType(type: EntityDocumentType): boolean {
  return ENTITY_DOCUMENT_VERSIONABLE_TYPES.includes(type);
}

export function getEntityDocumentMaxSizeBytes(type: EntityDocumentType): number {
  return ENTITY_DOCUMENT_MAX_SIZE_BYTES[type] ?? ENTITY_DOCUMENT_DEFAULT_MAX_SIZE_BYTES;
}

export function getEntityDocumentLabel(type: EntityDocumentType): string {
  return ENTITY_DOCUMENT_LABELS[type] ?? type;
}

export function buildEntityDocumentStoragePath(params: {
  rootId: string;
  entityType: EntityDocumentEntityType;
  entityId: string;
  documentType: EntityDocumentType;
  documentId: string;
  safeName: string;
}): string {
  return [
    "roots",
    params.rootId,
    "entityDocuments",
    params.entityType,
    params.entityId,
    params.documentType,
    `${params.documentId}-${params.safeName}`,
  ].join("/");
}

export function buildDocumentPeriod(params: {
  documentType: EntityDocumentType;
  periodYear?: number | null;
  periodMonth?: number | null;
}): string | null {
  if (!isEntityDocumentPeriodicType(params.documentType)) {
    return null;
  }

  if (!params.periodYear || !params.periodMonth) {
    return null;
  }

  const month = String(params.periodMonth).padStart(2, "0");
  return `${params.periodYear}-${month}`;
}