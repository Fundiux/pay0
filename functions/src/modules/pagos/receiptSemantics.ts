export const RECEIPT_READER_VERSION = "PAY0_RECEIPT_SEMANTIC_V3";

export type ReceiptConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type ReceiptFieldEvidence = {
  value: string | number | null;
  rawValue: string | null;
  normalizedValue: string | number | null;
  confidence: ReceiptConfidence;
  decision: "ACCEPTED" | "REVIEW" | "MISSING";
  source: "DOCUMENT_TEXT";
  label: string | null;
  excerpt: string | null;
  page: number | null;
};

export type SemanticReceipt = {
  schemaVersion: 1;
  readerVersion: string;
  fields: Record<string, ReceiptFieldEvidence>;
  reviewRequired: boolean;
  reviewReasons: string[];
  distinctions: {
    amount: "TRANSFER_AMOUNT" | "UNKNOWN";
    balance: "ACCOUNT_BALANCE" | "UNKNOWN";
    commission: "BANK_COMMISSION" | "UNKNOWN";
    date: "EXECUTION_DATE" | "UNKNOWN";
  };
};

type LegacyReceipt = Record<string, unknown>;
const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalized = (value: unknown) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function evidenceLine(lines: string[], patterns: RegExp[]): string | null {
  return lines.find(line => patterns.some(pattern => pattern.test(normalized(line)))) || null;
}

function identifierEvidence(lines: string[], label: RegExp): { value: string | null; line: string | null } {
  for (let i = 0; i < lines.length; i++) {
    const match = normalized(lines[i]).match(label);
    if (!match) continue;
    // Match the accent-normalized label, but preserve the document's value.
    const inline = lines[i].slice(match[0].length).trim();
    const value = inline || lines[i + 1] || "";
    if (!/^[a-z0-9][a-z0-9 -]*$/i.test(value) || !/\d/.test(value) || /^(?:referencia|folio|clave de rastreo|rastreo|numero|no\.|fecha|hora|cuenta|clabe|monto|importe|banco|concepto|beneficiario|ordenante)\b/.test(normalized(value))) return { value: null, line: lines[i] };
    return { value, line: inline ? lines[i] : `${lines[i]} ${value}` };
  }
  return { value: null, line: null };
}

function field(value: unknown, line: string | null, confidence: ReceiptConfidence, forceReview = false): ReceiptFieldEvidence {
  const present = typeof value === "number" ? Number.isFinite(value) && value > 0 : clean(value).length > 0;
  return {
    value: present ? value as string | number : null,
    rawValue: present ? clean(value) : null,
    normalizedValue: present ? value as string | number : null,
    confidence: present ? confidence : "NONE",
    decision: !present ? "MISSING" : forceReview || confidence !== "HIGH" ? "REVIEW" : "ACCEPTED",
    source: "DOCUMENT_TEXT",
    label: line ? clean(line).split(/[:\-]/, 1)[0].slice(0, 80) : null,
    excerpt: line ? clean(line).slice(0, 240) : null,
    page: null,
  };
}

function moneyFromLine(line: string | null): number | null {
  if (!line) return null;
  const match = line.match(/(?:\$|mxn|mxp|m\.n\.)?\s*([0-9]{1,3}(?:[, ][0-9]{3})*(?:\.[0-9]{1,2})|[0-9]+(?:\.[0-9]{1,2})?)/i);
  if (!match) return null;
  const value = Number(match[1].replace(/[ ,]/g, ""));
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

/** Builds evidence without retaining the full extracted/OCR text. */
export function buildSemanticReceipt(text: string, receipt: LegacyReceipt): SemanticReceipt {
  const lines = String(text || "").split(/\r?\n/).map(clean).filter(Boolean);
  const amountLine = evidenceLine(lines, [/^importe\b/, /^monto\b/, /^total operado\b/]);
  const balanceLine = evidenceLine(lines, [/saldo (?:disponible|final|posterior|de la cuenta)/]);
  const commissionLine = evidenceLine(lines, [/comision(?: bancaria)?/, /cargo por (?:spei|transferencia)/]);
  const tracking = identifierEvidence(lines, /^(?:clave de rastreo|rastreo)\b\s*[:\-]?\s*/);
  const referenceLine = evidenceLine(lines, [/^referencia(?: numerica)?\b/]);
  const folio = identifierEvidence(lines, /^folio(?: electronico)?\b\s*[:\-]?\s*/);
  const transaction = identifierEvidence(lines, /^(?:numero de |no\.\s*(?:de )?)(?:transaccion|operacion)\b\s*[:\-]?\s*/);
  const dateLine = evidenceLine(lines, [/fecha.*(?:operacion|transferencia|pago|ejecucion)/, /^fecha\s*[:\-]/]);
  const reviewReasons: string[] = [];
  if (receipt.amountVerified !== true) reviewReasons.push("AMOUNT_REQUIRES_REVIEW");
  if (receipt.executionConfirmed !== true) reviewReasons.push("EXECUTION_REQUIRES_REVIEW");
  if (receipt.dateVerified !== true) reviewReasons.push("DATE_REQUIRES_REVIEW");
  if (receipt.identityConflict === true) reviewReasons.push("IDENTITY_CONFLICT");

  const fields: Record<string, ReceiptFieldEvidence> = {
    transferAmount: field(receipt.amount, amountLine, receipt.amountVerified === true ? "HIGH" : "LOW", receipt.amountVerified !== true),
    accountBalance: field(moneyFromLine(balanceLine), balanceLine, balanceLine ? "HIGH" : "NONE"),
    bankCommission: field(moneyFromLine(commissionLine), commissionLine, commissionLine ? "HIGH" : "NONE"),
    executionDate: field(receipt.date, dateLine, receipt.dateVerified === true ? "HIGH" : "LOW", receipt.dateVerified !== true),
    executionTime: field(receipt.time, dateLine, receipt.dateVerified === true ? "HIGH" : "MEDIUM", receipt.dateVerified !== true),
    reference: field(receipt.reference, referenceLine, referenceLine ? "HIGH" : "MEDIUM", !referenceLine),
    trackingKey: field(tracking.value, tracking.line, "HIGH"),
    folio: field(folio.value, folio.line, "HIGH"),
    transactionId: field(transaction.value, transaction.line, "HIGH"),
    senderName: field(receipt.senderName, evidenceLine(lines, [/^(?:cliente|titular|ordenante|remitente|emisor|de|origen)\b/]), "MEDIUM", true),
    beneficiaryName: field(receipt.beneficiaryName, evidenceLine(lines, [/^(?:beneficiario|receptor|para|destino)\b/]), "MEDIUM", true),
    payerRfc: field(receipt.payerRfc, evidenceLine(lines, [/rfc.*(?:ordenante|emisor|pagador|cliente)/]), "HIGH"),
    beneficiaryRfc: field(receipt.beneficiaryRfc, evidenceLine(lines, [/rfc.*(?:beneficiario|receptor)/]), "HIGH"),
    sourceAccount: field(receipt.account, evidenceLine(lines, [/(?:cuenta|clabe).*(?:origen|cargo)/]), "MEDIUM", true),
    destinationAccount: field(receipt.destinationAccount, evidenceLine(lines, [/(?:cuenta|clabe).*(?:destino|deposito|beneficiario|receptor|abono)/]), "HIGH"),
    sourceBankName: field(receipt.sourceBankName, evidenceLine(lines, [/^(?:banco|institucion).*(?:origen|emisor|ordenante)/]), "HIGH"),
    destinationBankName: field(receipt.destinationBankName, evidenceLine(lines, [/^(?:banco|institucion).*(?:destino|receptor|beneficiario)/]), "HIGH"),
    bankName: field(receipt.bankName, evidenceLine(lines, [/banco (?:destino|receptor)/]), "MEDIUM", true),
    concept: field(receipt.concept, evidenceLine(lines, [/^(?:concepto|motivo|descripcion)\b/]), "HIGH"),
    currency: field(receipt.currency, evidenceLine(lines, [/\b(?:mxn|mxp|m\.n\.|pesos mexicanos)\b/]), "HIGH"),
    executionStatus: field(receipt.executionConfirmed === true ? "CONFIRMED" : "UNCONFIRMED", evidenceLine(lines, [/(?:operacion|transferencia|pago|estado|resultado).*(?:realizada|efectuada|exitosa|completada|aplicada|liquidada)/]), receipt.executionConfirmed === true ? "HIGH" : "LOW", receipt.executionConfirmed !== true),
  };
  return {
    schemaVersion: 1,
    readerVersion: RECEIPT_READER_VERSION,
    fields,
    // Optional identity/bank fields may remain suggestions without blocking an otherwise
    // safe receipt. Only critical semantic conflicts raise document-level review.
    reviewRequired: reviewReasons.length > 0,
    reviewReasons,
    distinctions: {
      amount: amountLine ? "TRANSFER_AMOUNT" : "UNKNOWN",
      balance: balanceLine ? "ACCOUNT_BALANCE" : "UNKNOWN",
      commission: commissionLine ? "BANK_COMMISSION" : "UNKNOWN",
      date: dateLine ? "EXECUTION_DATE" : "UNKNOWN",
    },
  };
}
