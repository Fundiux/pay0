import { getFunctions, httpsCallable } from "firebase/functions";
import app from "@/lib/firebase";

const functions = getFunctions(app, "us-central1");

// Source types a person may prepare by hand. The full list lives in functions whatsappDeliveryDomain.ts.
export type DocumentDeliverySourceType = "FACTURA_PDF_XML" | "DISPERSION_COMPROBANTE" | "COMPLEMENTO_PAGO_PDF_XML" | "COTIZACION_PDF" | "CONSTANCIA_FIRMADA_PDF";

export type PrepareDocumentDeliveryInput = {
  sourceType: DocumentDeliverySourceType;
  sourceId?: string;
  clienteId?: string;
  clienteNombre?: string;
  targetLabel?: string;
  targetGroupId?: string;
  notes?: string;
  forceResend?: boolean;
  documents: Array<{
    name?: string;
    fileName?: string;
    contentType?: string;
    storagePath?: string;
    downloadUrl?: string;
    url?: string;
    documentType?: string;
    uploadId?: string;
  }>;
};

export type PrepareDocumentDeliveryResult = {
  ok: boolean;
  action:
    | "CREATED"
    | "REQUIRES_CONFIRMATION"
    | "ALREADY_IN_PROGRESS"
    | "RETRY_EXISTING";
  jobId: string;
  status: string;
  channel: "WHATSAPP";
  sourceType: DocumentDeliverySourceType;
  message: string;
  documentsCount: number;
  documentFingerprint?: string;
  previousJobId?: string;
  forceResend?: boolean;
  resendOfJobId?: string | null;
};

export async function prepareDocumentDeliveryJob(
  input: PrepareDocumentDeliveryInput
): Promise<PrepareDocumentDeliveryResult> {
  const callable = httpsCallable<PrepareDocumentDeliveryInput, PrepareDocumentDeliveryResult>(
    functions,
    "prepareDocumentDeliveryJob"
  );

  const result = await callable(input);
  return result.data;
}