import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type ReceiptIdentification = {
  verifiedMatches?: { client: ReceiptIdentityMatch | null; company: ReceiptIdentityMatch | null };
  candidates?: { client: ReceiptIdentityMatch[]; company: ReceiptIdentityMatch[] };
  id: string;
  status: "READY" | "REQUIRES_REVIEW" | "REGISTERED";
  reasons: string[];
  evidence: { client: string[]; company: string[] };
  pagoId: string | null;
  receiptPending?: boolean;
  createPayload: (Parameters<typeof import("./pagos").createPago>[0] & { despachoId: string; empresaNombre: string; operationTypeKey: string; fechaPago: string; moneda: string; notaInicial: string }) | null;
};
export type ReceiptIdentityMatch = { id: string; name: string; despachoId?: string; evidence: string[] };
export type ReceiptCorrectionField = "transferAmount" | "executionDate" | "executionTime" | "senderName" | "beneficiaryName" | "sourceBankName" | "destinationBankName" | "bankName" | "sourceAccount" | "destinationAccount" | "concept" | "reference" | "trackingKey" | "folio" | "transactionId";
export type ReceiptParseOptions = { operationTypeKey?: string; selectedClientId?: string; selectedCompanyId?: string };

export type ParsedPagoReceipt = {
  senderName: string;
  beneficiaryName: string;
  bankName: string;
  sourceBankName?: string;
  destinationBankName?: string;
  amount: number;
  date: string;
  time: string;
  reference: string;
  concept: string;
  currency: string;
  paymentForm: string;
  rfc: string;
  payerRfc: string;
  beneficiaryRfc: string;
  clabe: string;
  account: string;
  shortName: string;
  destinationAccount: string;
  warnings: string[];
  readerVersion?: string;
  analysisId?: string;
  correctionVersion?: number;
  contentSha256?: string;
  cacheHit?: boolean;
  providerCalls?: number;
  durationMs?: number;
  semanticReceipt?: {
    schemaVersion: number;
    readerVersion: string;
    reviewRequired: boolean;
    reviewReasons: string[];
    distinctions: Record<string, string>;
    fields: Record<string, { humanCorrection?: { actorUid: string; correctedAt: string; originalValue: string | number | null }; value: string | number | null; rawValue: string | null; normalizedValue: string | number | null; confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE"; decision: "ACCEPTED" | "REVIEW" | "MISSING"; source: "DOCUMENT_TEXT" | "HUMAN_CORRECTION"; provenance?: "DETECTED" | "INFERRED" | "MISSING" | "HUMAN_CORRECTION"; label: string | null; excerpt: string | null; page: number | null }>;
  };
  learningContext?: Array<{ id: string; status: string; patternKey?: string; content: string; advisory: boolean }>;
  identification?: ReceiptIdentification;
};

export async function parsePagoReceiptPdfFile(file: File, options: ReceiptParseOptions = {}): Promise<ParsedPagoReceipt> {
  const t0 = performance.now();

  const buffer = await file.arrayBuffer();
  const t1 = performance.now();

  const bytes = new Uint8Array(buffer);

  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  const base64 = btoa(binary);
  const t2 = performance.now();

  const callable = httpsCallable(functions, "parsePagoReceiptPdf");
  const response = await callable({
    originalName: file.name,
    contentType: file.type || "application/pdf",
    sizeBytes: file.size,
    base64,
    operationTypeKey: options.operationTypeKey || "",
    selectedClientId: options.selectedClientId,
    selectedCompanyId: options.selectedCompanyId,
  });

  const t3 = performance.now();

  console.log("[PAY0 RECEIPT TIMING]", {
    sizeBytes: file.size,
    arrayBufferMs: Math.round(t1 - t0),
    base64Ms: Math.round(t2 - t1),
    callableMs: Math.round(t3 - t2),
    totalMs: Math.round(t3 - t0),
  });

  const data = (response.data as any) || {};
  const receipt = data.receipt || {};

  return {
    senderName: String(receipt.senderName || ""),
    beneficiaryName: String(receipt.beneficiaryName || ""),
    bankName: String(receipt.bankName || ""),
    sourceBankName: String(receipt.sourceBankName || ""),
    destinationBankName: String(receipt.destinationBankName || ""),
    amount: Number(receipt.amount || 0),
    date: String(receipt.date || ""),
    time: String(receipt.time || ""),
    reference: String(receipt.reference || ""),
    concept: String(receipt.concept || ""),
    currency: String(receipt.currency || ""),
    paymentForm: String(receipt.paymentForm || ""),
    rfc: String(receipt.rfc || ""),
    payerRfc: String(receipt.payerRfc || ""),
    beneficiaryRfc: String(receipt.beneficiaryRfc || ""),
    clabe: String(receipt.clabe || ""),
    account: String(receipt.account || ""),
    shortName: String(receipt.shortName || ""),
    destinationAccount: String(receipt.destinationAccount || ""),
    warnings: Array.isArray(receipt.warnings) ? receipt.warnings.map(String) : [],
    readerVersion: String(data.readerVersion || ""),
    analysisId: String(data.analysisId || ""),
    correctionVersion: Number.isSafeInteger(data.correctionVersion) && data.correctionVersion >= 0 ? data.correctionVersion : undefined,
    contentSha256: String(data.contentSha256 || ""),
    cacheHit: data.cacheHit === true,
    providerCalls: Number(data.providerCalls || 0),
    durationMs: Number(data.durationMs || 0),
    semanticReceipt: data.semanticReceipt,
    learningContext: Array.isArray(data.learningContext) ? data.learningContext : [],
    identification: data.identification,
  };
}

export async function correctPagoReceiptSemanticField(input: ReceiptParseOptions & { analysisId: string; field: ReceiptCorrectionField; correctedField: ReceiptCorrectionField; correctedValue: string; expectedCorrectionVersion?: number }) {
  const callable = httpsCallable(functions, "correctPagoReceiptSemanticField");
  const response = await callable(input);
  return response.data as { ok: true; correctionId: string; observationId: string; memoryId: string; patternKey: string; learningContext: Array<{ id: string; status: string; content: string; advisory: boolean }>; finalResult: { field: string; value: string; source: string }; receipt: ParsedPagoReceipt; semanticReceipt: ParsedPagoReceipt["semanticReceipt"]; identification: ReceiptIdentification; correctionVersion: number };
}
