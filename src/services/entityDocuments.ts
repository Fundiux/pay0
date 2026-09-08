import { getFunctions, httpsCallable } from "firebase/functions";
import { CALLABLES } from "@/lib/callableNames";
import app from "@/lib/firebase";

const functions = getFunctions(app, "us-central1");
export type EntityDocumentEntityType = "CLIENTE" | "COMPANY" | "DESPACHO";

export type EntityDocumentLegalPersonType =
  | "PERSONA_MORAL"
  | "PERSONA_FISICA"
  | "PERSONA_FISICA_ACTIVIDAD_EMPRESARIAL";

export type EntityDocumentFiscalAdminType =
  | "PROPIA_PAY0"
  | "TERCERO"
  | "CLIENTE_ADMINISTRADO"
  | "SOLO_OPERATIVO";

export type EntityDocumentType =
  | "ACTA_CONSTITUTIVA"
  | "OPINION_SAT"
  | "OPINION_IMSS"
  | "OPINION_INFONAVIT"
  | "OPINION_ESTATAL"
  | "CONSTANCIA_SITUACION_FISCAL"
  | "RFC"
  | "CURP"
  | "IDENTIFICACION_OFICIAL"
  | "COMPROBANTE_DOMICILIO"
  | "PODER_REPRESENTANTE"
  | "ESTADO_CUENTA"
  | "DECLARACION_MENSUAL"
  | "DECLARACION_ANUAL"
  | "PAGO_IMPUESTOS"
  | "ALTA_PATRONAL"
  | "IMSS"
  | "ALTA_BAJA_TRABAJADOR"
  | "CSD_EFIRMA"
  | "DOCUMENTO_CONTABLE"
  | "OTRO";

export type EntityDocumentStatus = "ACTIVE" | "INACTIVE" | "REPLACED";


export type EntityDocumentValidationStatus =
  | "PENDIENTE_VALIDACION"
  | "VALIDADO"
  | "RECHAZADO"
  | "VALIDACION_FALLIDA"
  | "NO_APLICA";

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
  rootId?: string;
  entityType: EntityDocumentEntityType;
  entityId: string;
  legalPersonType?: EntityDocumentLegalPersonType | null;
  fiscalAdminType?: EntityDocumentFiscalAdminType | null;
  documentType: EntityDocumentType;
  documentTypeLabel?: string | null;
  documentPeriod?: string | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  version?: number | null;
  isCurrent?: boolean | null;
  active?: boolean | null;
  status?: EntityDocumentStatus | string | null;
  validationStatus?: EntityDocumentValidationStatus | null;
  validationKind?: string | null;
  validationSource?: EntityDocumentValidationSource | null;
  validationErrors?: string[];
  extractedData?: EntityDocumentExtractedData | null;
  uploadStatus?: string | null;
  storagePath?: string | null;
  fileName?: string | null;
  filename?: string | null;
  originalName?: string | null;
  fileSize?: number | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  contentType?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  documentDate?: unknown;
  issuedAt?: unknown;
  createdBy?: string | null;
  createdByName?: string | null;
  finalizedAt?: unknown;
  finalizedBy?: string | null;
  finalizedByName?: string | null;
  supersedesDocumentId?: string | null;
  supersededByDocumentId?: string | null;
  validFrom?: unknown;
  validTo?: unknown;
  notes?: string | null;
};

export type InitEntityDocumentUploadInput = {
  entityType: EntityDocumentEntityType;
  entityId: string;
  documentType: EntityDocumentType;
  legalPersonType?: EntityDocumentLegalPersonType | null;
  fiscalAdminType?: EntityDocumentFiscalAdminType | null;
  originalName: string;
  fileSize: number;
  contentType?: string;
  sha256?: string | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  notes?: string | null;
};

export type InitEntityDocumentUploadResult = {
  ok: boolean;
  entityDocumentId: string;
  documentId: string;
  storagePath: string;
  documentType: EntityDocumentType;
  documentTypeLabel?: string | null;
  documentPeriod?: string | null;
  periodYear?: number | null;
  periodMonth?: number | null;
  version?: number | null;
  maxSizeBytes?: number | null;
};

export type FinalizeEntityDocumentUploadInput = {
  entityDocumentId?: string;
  documentId?: string;
  storagePath?: string;
};

export type FinalizeEntityDocumentUploadResult = {
  ok: boolean;
  entityDocumentId: string;
  documentId: string;
};

export type ListEntityDocumentsInput = {
  entityType: EntityDocumentEntityType;
  entityId: string;
  documentType?: EntityDocumentType | null;
};

export type ListEntityDocumentsResult = {
  ok: boolean;
  entityType: EntityDocumentEntityType;
  entityId: string;
  documents: EntityDocumentRecord[];
};

export type DeactivateEntityDocumentInput = {
  entityDocumentId?: string;
  documentId?: string;
  reason?: string | null;
};

export type DeactivateEntityDocumentResult = {
  ok: boolean;
  entityDocumentId: string;
  documentId: string;
};

export type ReactivateEntityDocumentInput = DeactivateEntityDocumentInput;
export type ReactivateEntityDocumentResult = DeactivateEntityDocumentResult;

export async function initEntityDocumentUpload(
  input: InitEntityDocumentUploadInput
): Promise<InitEntityDocumentUploadResult> {
  const callable = httpsCallable<
    InitEntityDocumentUploadInput,
    InitEntityDocumentUploadResult
  >(functions, CALLABLES.initEntityDocumentUpload);

  const result = await callable(input);
  return result.data;
}

export async function finalizeEntityDocumentUpload(
  input: FinalizeEntityDocumentUploadInput
): Promise<FinalizeEntityDocumentUploadResult> {
  const callable = httpsCallable<
    FinalizeEntityDocumentUploadInput,
    FinalizeEntityDocumentUploadResult
  >(functions, CALLABLES.finalizeEntityDocumentUpload);

  const result = await callable(input);
  return result.data;
}

export async function readEntityDocuments(
  input: ListEntityDocumentsInput
): Promise<ListEntityDocumentsResult> {
  const callable = httpsCallable<ListEntityDocumentsInput, ListEntityDocumentsResult>(
    functions,
    CALLABLES.listEntityDocuments
  );

  const result = await callable(input);
  return result.data;
}

export async function deactivateEntityDocument(
  input: DeactivateEntityDocumentInput
): Promise<DeactivateEntityDocumentResult> {
  const callable = httpsCallable<
    DeactivateEntityDocumentInput,
    DeactivateEntityDocumentResult
  >(functions, CALLABLES.deactivateEntityDocument);

  const result = await callable(input);
  return result.data;
}
export async function reactivateEntityDocument(
  input: ReactivateEntityDocumentInput
): Promise<ReactivateEntityDocumentResult> {
  const callable = httpsCallable<
    ReactivateEntityDocumentInput,
    ReactivateEntityDocumentResult
  >(functions, CALLABLES.reactivateEntityDocument);

  const result = await callable(input);
  return result.data;
}