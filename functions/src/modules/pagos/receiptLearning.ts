import { createHash } from "node:crypto";

export const RECEIPT_LEARNING_VERSION = "PAY0_RECEIPT_LEARNING_V1";
export const CORRECTABLE_RECEIPT_FIELDS = ["reference", "trackingKey", "folio", "transactionId"] as const;
export type CorrectableReceiptField = typeof CORRECTABLE_RECEIPT_FIELDS[number];

const clean = (value: unknown, max = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const token = (value: unknown) => clean(value, 80).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
export const isCorrectableReceiptField = (value: unknown): value is CorrectableReceiptField => CORRECTABLE_RECEIPT_FIELDS.includes(clean(value) as CorrectableReceiptField);

export function receiptPattern(input: { readerVersion: string; bankName?: unknown; evidenceLabel?: unknown; fromField: CorrectableReceiptField; toField: CorrectableReceiptField }) {
  const bank = token(input.bankName) || "UNKNOWN_INSTITUTION";
  const label = token(input.evidenceLabel) || "UNKNOWN_LABEL";
  const key = createHash("sha256").update([input.readerVersion, bank, label, input.fromField, input.toField].join("|")).digest("hex").slice(0, 40);
  return { key, bank, label, fromField: input.fromField, toField: input.toField };
}

export function sanitizedReceiptLearningContent(pattern: ReturnType<typeof receiptPattern>) {
  return `Patron documental candidato: la etiqueta ${pattern.label} de ${pattern.bank} puede corresponder a ${pattern.toField} en lugar de ${pattern.fromField}. Confirmar siempre contra la evidencia del documento.`;
}

export function containsSensitiveLearningData(value: unknown): boolean {
  const text = clean(value, 2000);
  return /\b\d{8,}\b|\$\s*\d|\b[A-Z0-9-]{12,}\b/.test(text);
}

export function memoryCanAdvise(input: { patternKey: string; memoryPatternKey: string; memoryStatus: string; documentEvidenceDecision: string }) {
  if (input.patternKey !== input.memoryPatternKey) return false;
  if (!['CANDIDATE', 'CONFIRMED'].includes(input.memoryStatus)) return false;
  return input.documentEvidenceDecision !== "ACCEPTED";
}

// Scope the durable identity, not only the payload, to prevent cross-root overwrite.
export function receiptMemoryId(rootId: string, patternKey: string): string {
  if (!rootId || !patternKey) throw new Error("Receipt memory scope required");
  return `receipt_${createHash("sha256").update(JSON.stringify([rootId, patternKey])).digest("hex")}`;
}
