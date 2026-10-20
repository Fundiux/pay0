import { createHash } from "node:crypto";

export const RECEIPT_LEARNING_VERSION = "PAY0_RECEIPT_LEARNING_V1";
export const CORRECTABLE_RECEIPT_FIELDS = ["reference", "trackingKey", "folio", "transactionId", "transferAmount", "executionDate", "executionTime", "senderName", "beneficiaryName", "sourceBankName", "destinationBankName", "bankName", "sourceAccount", "destinationAccount", "concept"] as const;
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
  if (pattern.fromField === pattern.toField) return `Patron documental candidato: correccion de extraccion en ${pattern.toField} de ${pattern.bank}. Confirmar siempre contra la evidencia del documento.`;
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


const identifierFields = new Set(["reference", "trackingKey", "folio", "transactionId"]);
/** Strict input normalization; never interpret an ambiguous localized amount/date. */
export function normalizeReceiptCorrection(from: CorrectableReceiptField, to: CorrectableReceiptField, value: unknown): string | number {
  if (from !== to && !(identifierFields.has(from) && identifierFields.has(to))) throw new Error("FIELD_MAPPING_INVALID");
  if (typeof value !== "string" && typeof value !== "number") throw new Error("VALUE_INVALID");
  const text = String(value).trim();
  if (!text || text.length > 240 || /[\u0000-\u001f]/.test(text)) throw new Error("VALUE_INVALID");
  if (to === "transferAmount") {
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("AMOUNT_INVALID");
    const amount = Number(text);
    if (!(amount > 0) || !Number.isSafeInteger(Math.round(amount * 100))) throw new Error("AMOUNT_INVALID");
    return amount;
  }
  if (to === "executionDate") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) throw new Error("DATE_INVALID");
  }
  if (to === "executionTime" && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text)) throw new Error("TIME_INVALID");
  if ((to === "sourceAccount" || to === "destinationAccount") && !/^\d{4,18}$/.test(text)) throw new Error("ACCOUNT_INVALID");
  return text.replace(/\s+/g, " ");
}

const receiptKeys: Record<CorrectableReceiptField, string> = {
  reference: "reference", trackingKey: "trackingKey", folio: "folio", transactionId: "transactionId",
  transferAmount: "amount", executionDate: "date", executionTime: "time", senderName: "senderName", beneficiaryName: "beneficiaryName",
  sourceBankName: "sourceBankName", destinationBankName: "destinationBankName", bankName: "bankName", sourceAccount: "account", destinationAccount: "destinationAccount", concept: "concept",
};

/** Apply only the durable human overlay. Original OCR evidence remains immutable. */
export function applyReceiptCorrections(receiptInput: Record<string, any>, semanticInput: Record<string, any>, corrections: Record<string, any> = {}) {
  const receipt = { ...receiptInput }, semanticReceipt = { ...semanticInput, fields: { ...semanticInput.fields } };
  for (const [from, correction] of Object.entries(corrections).sort((a, b) => (a[1].version || 0) - (b[1].version || 0))) {
    if (!isCorrectableReceiptField(from) || !isCorrectableReceiptField(correction.correctedField)) continue;
    const to = correction.correctedField as CorrectableReceiptField;
    const value = normalizeReceiptCorrection(from, to, correction.correctedValue);
    if (from !== to) {
      receipt[receiptKeys[from]] = "";
      semanticReceipt.fields[from] = { ...semanticReceipt.fields[from], value: null, normalizedValue: null, decision: "MISSING", source: "HUMAN_CORRECTION", provenance: "HUMAN_CORRECTION", originalEvidence: semanticInput.fields?.[from] || null };
    }
    receipt[receiptKeys[to]] = value;
    if (to === "transferAmount") receipt.amountVerified = true;
    if (to === "executionDate") receipt.dateVerified = true;
    semanticReceipt.fields[to] = { ...semanticReceipt.fields[to], value, normalizedValue: value, decision: "ACCEPTED", source: "HUMAN_CORRECTION", provenance: "HUMAN_CORRECTION", humanConfirmed: true, correctionId: correction.correctionId, humanCorrection: { actorUid: correction.actorUid, correctedAt: correction.correctedAt, originalValue: semanticInput.fields?.[to]?.value ?? null }, originalEvidence: semanticInput.fields?.[to] || null };
  }
  return { receipt, semanticReceipt };
}


/** OCR is shared by root; reviewed values belong exclusively to their actor. */
export function getReceiptActorCorrectionState(analysis: Record<string, any>, uid: string): { corrections: Record<string, any>; version: number } {
  const ownMap = analysis.humanCorrectionsByActor;
  const hasOwnState = (ownMap && Object.prototype.hasOwnProperty.call(ownMap, uid)) || (analysis.correctionVersionsByActor && Object.prototype.hasOwnProperty.call(analysis.correctionVersionsByActor, uid));
  if (hasOwnState) {
    const version = analysis.correctionVersionsByActor?.[uid];
    if (!Number.isSafeInteger(version) || version < 0 || (ownMap?.[uid] !== undefined && (!ownMap[uid] || typeof ownMap[uid] !== "object"))) throw new Error("INVALID_RECEIPT_CORRECTION_STATE");
    return { corrections: Object.fromEntries(Object.entries(ownMap?.[uid] || {}).filter(([, correction]: [string, any]) => correction?.actorUid === uid)), version };
  }
  const version = Number(analysis.correctionVersion || 0);
  if (!Number.isSafeInteger(version) || version < 0) throw new Error("INVALID_RECEIPT_CORRECTION_STATE");
  return { corrections: Object.fromEntries(Object.entries(analysis.humanCorrections || {}).filter(([, correction]: [string, any]) => correction?.actorUid === uid)), version };
}
