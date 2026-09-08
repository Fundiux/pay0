import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type ParsedPagoReceipt = {
  senderName: string;
  beneficiaryName: string;
  bankName: string;
  amount: number;
  date: string;
  reference: string;
  concept: string;
  currency: string;
  rfc: string;
  clabe: string;
  account: string;
  shortName: string;
  destinationAccount: string;
  warnings: string[];
};

export async function parsePagoReceiptPdfFile(file: File): Promise<ParsedPagoReceipt> {
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
  });

  const t3 = performance.now();

  console.log("[PAY0 RECEIPT TIMING]", {
    file: file.name,
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
    amount: Number(receipt.amount || 0),
    date: String(receipt.date || ""),
    reference: String(receipt.reference || ""),
    concept: String(receipt.concept || ""),
    currency: String(receipt.currency || ""),
    rfc: String(receipt.rfc || ""),
    clabe: String(receipt.clabe || ""),
    account: String(receipt.account || ""),
    shortName: String(receipt.shortName || ""),
    destinationAccount: String(receipt.destinationAccount || ""),
    warnings: Array.isArray(receipt.warnings) ? receipt.warnings.map(String) : [],
  };
}