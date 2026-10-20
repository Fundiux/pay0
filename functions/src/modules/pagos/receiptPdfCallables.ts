import { RECEIPT_PROCESSING_LIMITS, reserveReceiptProcessing } from "./receiptOcrQuota";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { db, getMyUser, getRootId } from "../sharedCallables/helpers";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { identifyParsedReceipt } from "./receiptIdentification";
import { buildSemanticReceipt, RECEIPT_READER_VERSION } from "./receiptSemantics";
import { getReceiptActorCorrectionState, CORRECTABLE_RECEIPT_FIELDS, applyReceiptCorrections, normalizeReceiptCorrection, containsSensitiveLearningData, receiptMemoryId, isCorrectableReceiptField, memoryCanAdvise, receiptPattern, RECEIPT_LEARNING_VERSION, sanitizedReceiptLearningContent } from "./receiptLearning";

let pdfParser: any;
let visionClient: any;

function getPdfParser(): any {
  if (!pdfParser) pdfParser = require("pdf-parse");
  return pdfParser;
}

function getVisionClient(): any {
  if (!visionClient) {
    const { ImageAnnotatorClient } = require("@google-cloud/vision").v1;
    visionClient = new ImageAnnotatorClient();
  }
  return visionClient;
}

type ReceiptData = {
  senderName: string;
  beneficiaryName: string;
  bankName: string;
  sourceBankName: string;
  destinationBankName: string;
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
  identityConflict: boolean;
  amountVerified: boolean;
  executionConfirmed: boolean;
  dateVerified: boolean;
};

async function retrieveReceiptLearningContext(rootId: string, semantic: ReturnType<typeof buildSemanticReceipt>, effectiveSemantic = semantic) {
  try {
    const fields = semantic.fields || {}, candidates: Array<{ pattern: ReturnType<typeof receiptPattern>; targetDecision: string }> = [];
    const identifiers = ["reference", "trackingKey", "folio", "transactionId"] as const;
    for (const fromField of CORRECTABLE_RECEIPT_FIELDS) {
      // Same-field feedback uses a fixed field label, never a personal value.
      const pattern = receiptPattern({ readerVersion: semantic.readerVersion, bankName: fields.bankName?.normalizedValue, evidenceLabel: fromField.replace(/([a-z])([A-Z])/g, "$1 $2"), fromField, toField: fromField });
      candidates.push({ pattern, targetDecision: effectiveSemantic.fields?.[fromField]?.decision || "MISSING" });
    }
    for (const fromField of identifiers) {
      const source = fields[fromField];
      if (!source?.label) continue;
      for (const toField of identifiers) {
        if (fromField === toField) continue;
        const pattern = receiptPattern({ readerVersion: semantic.readerVersion, bankName: fields.bankName?.normalizedValue, evidenceLabel: source.label, fromField, toField });
        candidates.push({ pattern, targetDecision: effectiveSemantic.fields?.[toField]?.decision || "MISSING" });
      }
    }
    if (!candidates.length) return [];
    const scoped = await db.getAll(...candidates.map(item => db.doc(`agent007Memory/${receiptMemoryId(rootId, item.pattern.key)}`)));
    // Legacy is read-only and usable only for its original root. No data migration.
    const legacy = await db.getAll(...candidates.map(item => db.doc(`agent007Memory/receipt_${item.pattern.key}`)));
    const snaps = scoped.map((snap, index) => snap.exists ? snap : legacy[index]);
    return snaps.flatMap((snap, index) => {
      const row = snap.data(); if (!row || row.rootId !== rootId || row.receiptLearning?.key !== candidates[index].pattern.key) return [];
      return [{ id: snap.id, status: String(row.status || ""), patternKey: candidates[index].pattern.key, content: String(row.content || "").slice(0, 500),
        advisory: memoryCanAdvise({ patternKey: candidates[index].pattern.key, memoryPatternKey: row.receiptLearning.key, memoryStatus: String(row.status || ""), documentEvidenceDecision: candidates[index].targetDecision }) }];
    });
  } catch {
    return [];
  }
}

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalize(value: unknown): string {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseMoney(value: unknown): number {
  const raw = clean(value);
  if (!raw) return 0;
  const spaced = raw.replace(/[^\d,.\- ]/g, "").trim();
  if (/\d \d/.test(spaced) && !/^\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?$/.test(spaced)) return 0;

  const compact = raw
    .replace(/[^\d,.\-]/g, "")
    .trim();

  if (!compact) return 0;

  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");

  let normalized = compact;
  if (comma >= 0 && dot >= 0) {
    const groupingValid = comma > dot ? /^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(compact) : /^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(compact);
    if (!groupingValid) return 0;
    normalized = comma > dot ? compact.replace(/\./g, "").replace(",", ".") : compact.replace(/,/g, "");
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? "," : ".", parts = compact.split(separator);
    if (/^\d{1,3}$/.test(parts[0]) && parts.slice(1).every(part => /^\d{3}$/.test(part))) normalized = parts.join("");
    else if (parts.length === 2 && /^\d{1,2}$/.test(parts[1])) normalized = parts.join(".");
    else return 0;
  }

  const number = Number(normalized);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number * 100) / 100;
}

function extractLabeled(lines: string[], labels: RegExp[]): string {
  for (let i = 0; i < lines.length; i += 1) {
    const line = clean(lines[i]);
    if (!line) continue;

    for (const label of labels) {
      const direct = line.match(label) || normalize(line).match(label);
      if (direct?.[1]) {
        // Labels are accent-insensitive; names and concepts keep their spelling.
        const value = clean(line.slice(line.length - direct[1].length));
        if (value) return value;
      }

      // PDF/OCR commonly puts a label and its value on separate lines. The
      // patterns require a nonempty capture, so a bare label followed by a
      // colon never matched. Probe with a sentinel, without inventing a value.
      const probe = `${line.replace(/[:\-]\s*$/, "")}: __PAY0_VALUE__`;
      if ((probe.match(label) || normalize(probe).match(label))?.[1]?.toUpperCase() === "__PAY0_VALUE__") {
        const next = clean(lines[i + 1] || "");
        // A missing value must not consume the following field's label.
        if (next && !/^[A-Za-zÁÉÍÓÚÑáéíóúñ][^:]{0,79}:/.test(next) && !/^(?:fecha|hora|referencia|folio|rastreo|clave de rastreo|concepto|ordenante|beneficiario|receptor|remitente|emisor|cuenta|clabe|banco|monto|importe|numero de (?:operacion|transaccion))\b/i.test(normalize(next))) return next;
      }
    }
  }

  return "";
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return "";
}

function valueAfterSection(
  lines: string[],
  sectionPattern: RegExp,
  valuePatterns: RegExp[],
  maxLookahead = 6,
): string {
  for (let i = 0; i < lines.length; i += 1) {
    const line = clean(lines[i]);
    if (!sectionPattern.test(line)) continue;

    const end = Math.min(lines.length, i + 1 + maxLookahead);
    for (let j = i + 1; j < end; j += 1) {
      const candidate = clean(lines[j]);
      if (!candidate) continue;

      for (const pattern of valuePatterns) {
        const match = candidate.match(pattern);
        if (match?.[1]) return clean(match[1]);
      }
    }
  }

  return "";
}

function detectHeaderCompany(lines: string[]): string {
  const resultIndex = lines.findIndex((line) =>
    /resultado\s+del\s+traspaso/i.test(line),
  );

  const searchEnd = resultIndex >= 0 ? resultIndex : Math.min(lines.length, 15);
  // A header inference ends where structured receipt fields begin. Otherwise
  // a beneficiary label (or its next-line value) can become the sender.
  const fieldIndex = lines.findIndex(line => /^(?:fecha|hora|referencia|folio|rastreo|clave|concepto|ordenante|beneficiario|receptor|remitente|emisor|destinatario|titular|cliente|proveedor|nombre|datos|cuenta|clabe|banco|institucion|monto|importe|total|saldo|comision|para|destino|origen|de)\b/i.test(normalize(line)) || /^[^:]{1,80}:/.test(line));
  const candidates = lines.slice(0, fieldIndex >= 0 ? Math.min(searchEnd, fieldIndex) : searchEnd);

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const line = clean(candidates[i]);
    if (!line) continue;

    if (/^\d{1,2}\/\d{1,2}\/20\d{2}/.test(line)) continue;
    if (/^\d{1,2}:\d{2}/.test(line)) continue;
    if (/comprobante|traspasos?|operaciones?|realizar|cuentas?\s+con|bbva/i.test(line)) continue;

    const words = line.split(/\s+/).filter(Boolean);
    const hasLetters = /[A-ZÃƒÂÃƒâ€°ÃƒÂÃƒâ€œÃƒÅ¡Ãƒâ€˜]/i.test(line);
    const looksCorporate =
      words.length >= 2 &&
      hasLetters &&
      line.length >= 5 &&
      line.length <= 120;

    if (looksCorporate) return line;
  }

  return "";
}

function detectBank(text: string): string {
  const upper = normalize(text);

  const known: Array<[string,string[]]> = [
    ["BBVA", ["bbva"]],
    ["BANORTE", ["banorte", "banco mercantil del norte"]],
    ["SANTANDER", ["santander"]],
    ["HSBC", ["hsbc"]],
    ["CITIBANAMEX", ["citibanamex", "banamex"]],
    ["SCOTIABANK", ["scotiabank"]],
    ["BANREGIO", ["banregio"]],
    ["AFIRME", ["afirme"]],
    ["INBURSA", ["inbursa"]],
    ["BANBAJIO", ["banbajio", "banco del bajio"]],
    ["AZTECA", ["banco azteca"]],
  ];

  for (const [label, needles] of known) {
    if (needles.some((needle) => upper.includes(needle))) {
      return label;
    }
  }

  return "";
}

function parseDateValue(value: string): string {
  const raw = clean(value);
  if (!raw) return "";

  const iso = raw.match(/\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
  if (iso) {
    const yyyy = iso[1];
    const mm = iso[2].padStart(2, "0");
    const dd = iso[3].padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const latam = raw.match(/\b(\d{1,2})[-\/](\d{1,2})[-\/](20\d{2})\b/);
  if (latam) {
    const dd = latam[1].padStart(2, "0");
    const mm = latam[2].padStart(2, "0");
    const yyyy = latam[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const normalized = normalize(raw);

  const months: Record<string, string> = {
    jan: "01",
    january: "01",
    ene: "01",
    enero: "01",

    feb: "02",
    february: "02",
    febrero: "02",

    mar: "03",
    march: "03",
    marzo: "03",

    apr: "04",
    april: "04",
    abr: "04",
    abril: "04",

    may: "05",
    mayo: "05",

    jun: "06",
    june: "06",
    junio: "06",

    jul: "07",
    july: "07",
    julio: "07",

    aug: "08",
    august: "08",
    ago: "08",
    agosto: "08",

    sep: "09",
    sept: "09",
    september: "09",
    septiembre: "09",
    setiembre: "09",

    oct: "10",
    october: "10",
    octubre: "10",

    nov: "11",
    november: "11",
    noviembre: "11",

    dec: "12",
    december: "12",
    dic: "12",
    diciembre: "12",
  };

  const textual = normalized.match(
    /\b(\d{1,2})[\s\-\/.]+([a-z]+)[\s\-\/.]+(20\d{2})\b/,
  );

  if (textual) {
    const dd = textual[1].padStart(2, "0");
    const mm = months[textual[2]];
    const yyyy = textual[3];

    if (mm) return `${yyyy}-${mm}-${dd}`;
  }

  const written = normalized.match(
    /\b(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de|del)\s+(20\d{2})\b/,
  );

  if (written) {
    const dd = written[1].padStart(2, "0");
    const mm = months[written[2]];
    const yyyy = written[3];

    if (mm) return `${yyyy}-${mm}-${dd}`;
  }

  return "";
}

function parseTimeValue(value: string): string {
  const raw = clean(value);
  const match = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?\b/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const suffix = normalize(match[4] || "").replace(/\s|\./g, "");
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour > 23) return "";
  return `${String(hour).padStart(2, "0")}:${match[2]}:${match[3] || "00"}`;
}

function labeledRfcs(lines: string[], party: "payer" | "beneficiary"): string[] {
  const labels = party === "payer"
    ? /^(?:rfc\s+(?:ordenante|emisor|remitente|pagador|cliente)|(?:ordenante|emisor|remitente|pagador|cliente)\s+rfc)\s*[:\-]\s*([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})$/i
    : /^(?:rfc\s+(?:beneficiario|receptor)|(?:beneficiario|receptor)\s+rfc)\s*[:\-]\s*([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})$/i;
  return [...new Set(lines.map(line => firstMatch(line, [labels]).toUpperCase()).filter(Boolean))];
}
function detectReceiptContentType(input: {
  declaredContentType: string;
  originalName: string;
  buffer: Buffer;
}): string {
  if (input.buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }

  const declared = clean(input.declaredContentType)
    .toLowerCase()
    .split(";")[0]
    .trim();

  if (declared === "image/jpg") return "image/jpeg";

  if (
    declared === "application/pdf" ||
    declared === "image/jpeg" ||
    declared === "image/png" ||
    declared === "image/webp"
  ) {
    return declared;
  }

  const name = clean(input.originalName).toLowerCase();

  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";

  return "";
}

export async function extractVisionOcrText(buffer: Buffer, contentType: string, pdfPageCount?: number): Promise<string> {
  const client = getVisionClient();
  if (contentType === "application/pdf") {
    if (!Number.isInteger(pdfPageCount) || Number(pdfPageCount) < 1 || Number(pdfPageCount) > RECEIPT_PROCESSING_LIMITS.pdfPages) {
      throw new HttpsError("invalid-argument", "El comprobante debe tener entre 1 y 5 paginas verificadas.");
    }
    const [result] = await client.batchAnnotateFiles({
      requests: [
        {
          inputConfig: {
            mimeType: "application/pdf",
            content: buffer,
          },
          pages: Array.from({ length: pdfPageCount! }, (_, index) => index + 1),
          features: [
            { type: "DOCUMENT_TEXT_DETECTION" },
          ],
          imageContext: {
            languageHints: ["es"],
          },
        },
      ],
    });

    const fileResponse = result?.responses?.[0];

    if (fileResponse?.error?.message) {
      throw new Error(fileResponse.error.message);
    }

    const pageResponses = Array.isArray(fileResponse?.responses)
      ? fileResponse.responses
      : [];

    if (Number(fileResponse?.totalPages) > RECEIPT_PROCESSING_LIMITS.pdfPages || pageResponses.length > RECEIPT_PROCESSING_LIMITS.pdfPages) {
      throw new HttpsError("invalid-argument", "El comprobante debe tener como maximo 5 paginas.");
    }
    if (pageResponses.length !== pdfPageCount || pageResponses.some((page: any) => page?.error)) throw new Error("OCR_PAGE_FAILED");
    return pageResponses
      .map((response: any) =>
        clean(
          response?.fullTextAnnotation?.text ||
            response?.textAnnotations?.[0]?.description ||
            "",
        ),
      )
      .filter(Boolean)
      .join("\n");
  }

  const [response] = await client.documentTextDetection({
    image: {
      content: buffer,
    },
    imageContext: {
      languageHints: ["es"],
    },
  });

  if (response?.error?.message) {
    throw new Error(response.error.message);
  }

  return clean(
    response?.fullTextAnnotation?.text ||
      response?.textAnnotations?.[0]?.description ||
      "",
  );
}

function extractReceiptAmount(lines: string[], text: string): string {
  const nonTransferLabel = /\b(?:saldo|comision|iva|cargo por)\b/;
  const transferLines = lines.filter((line, index) => !nonTransferLabel.test(normalize(line)) &&
    !(index > 0 && nonTransferLabel.test(normalize(lines[index - 1])) && !/\d/.test(lines[index - 1])));
  const priorityPatterns: RegExp[] = [
    /importe\s+total\s+del?\s*deposito[^0-9]*\$?\s*([\d,.]+)/i,
    /importe\s+total\s+(?:mxp|mxn|m\.n\.)[^0-9]*\$?\s*([\d,.]+)/i,
    /total\s+operado\s+(?:mxp|mxn|m\.n\.)?[^0-9]*\$?\s*([\d,.]+)/i,
    /total\s+aceptados?[^0-9]*\$?\s*([\d,.]+)/i,
    /total\s+presentado[^0-9]*\$?\s*([\d,.]+)/i,
    /cheques\s+otros\s+bancos[^0-9]*\$?\s*([\d,.]+)/i,
  ];

  for (const lineRaw of transferLines) {
    const line = normalize(lineRaw);

    for (const pattern of priorityPatterns) {
      const match = line.match(pattern);
      if (match?.[1] && parseMoney(match[1]) > 0) {
        return clean(match[1]);
      }
    }
  }

  const labelled = firstMatch(transferLines.join("\n"), [
    /(?:importe|monto\s+(?:pagado|transferido|de\s+la\s+operacion)|monto|total)\s*[:$ ]+\s*(?:mxn|mxp|m\.n\.)?\s*\$?\s*([\d,.]+)/i,
  ]);
  if (labelled) return labelled;
  // A balance or bank fee is not the transfer amount. Accept a single monetary
  // suggestion, never the first of several different amounts.
  const candidates = transferLines
    .flatMap(line => [...line.matchAll(/\$\s*(\d[\d,.]*)/g)].map(match => match[1]));
  const values = [...new Set(candidates.map(parseMoney).filter(value => value > 0))];
  return values.length === 1 ? candidates.find(value => parseMoney(value) === values[0]) || "" : "";
}
export function parseReceiptText(textRaw: string): ReceiptData {
  const text = String(textRaw || "")
    .normalize("NFC")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n");

  const lines = text
    .split("\n")
    .map(clean)
    .filter(Boolean);

  const senderName =
    extractLabeled(lines, [
      /^(?:cliente|titular)\s*[:\-]\s*(.+)$/i,
      /^(?:ordenante|remitente|emisor|nombre\s+del\s+ordenante|nombre\s+ordenante|titular\s+origen|cliente\s+ordenante|proveedor)\s*[:\-]\s*(.+)$/i,
      /^(?:de|origen)\s*[:\-]\s*(.+)$/i,
    ]) ||
    detectHeaderCompany(lines);

  const beneficiaryName =
    extractLabeled(lines, [
      /^(?:beneficiario|receptor|nombre\s+del\s+beneficiario|nombre\s+beneficiario|titular\s+destino|destinatario)\s*[:\-]\s*(.+)$/i,
      /^(?:para|destino)\s*[:\-]\s*(.+)$/i,
    ]) ||
    valueAfterSection(
      lines,
      /^datos\s+del\s+beneficiario$/i,
      [
        /^nombre\s*[:\-]\s*(.+)$/i,
        /^beneficiario\s*[:\-]\s*(.+)$/i,
      ],
      5,
    );

  const shortName = extractLabeled(lines, [
    /^nombre\s+corto\s*[:\-]\s*(.+)$/i,
    /^alias\s*[:\-]\s*(.+)$/i,
  ]);

  const normalizeAccount = (value: string) => /^[\d Xx*\-]+$/.test(value) ? value.replace(/[\s-]/g, "") : value;
  const destinationAccount = normalizeAccount(extractLabeled(lines, [
    /^cuenta\s+de\s+dep[oÃƒÂ³]sito\s*[:\-]\s*(.+)$/i,
    /^cuenta\s+destino\s*[:\-]\s*(.+)$/i,
    /^(?:cuenta|clabe)(?:\s+interbancaria)?\s+(?:de\s+)?(?:destino|beneficiario|receptor|abono|deposito)\s*[:\-]\s*(.+)$/i,
  ]));
  const sourceAccount = normalizeAccount(extractLabeled(lines, [
    /^(?:cuenta|clabe)(?:\s+interbancaria)?\s+(?:de\s+)?(?:origen|ordenante|emisor|cargo)\s*[:\-]\s*(.+)$/i,
  ]));
  const sourceBankName = extractLabeled(lines, [/^(?:banco|institucion)\s+(?:de\s+)?(?:origen|emisor|ordenante)\s*[:\-]\s*(.+)$/i]);
  const destinationBankName = extractLabeled(lines, [/^(?:banco|institucion)\s+(?:de\s+)?(?:destino|receptor|beneficiario)\s*[:\-]\s*(.+)$/i]);

  const amountRaw = extractReceiptAmount(lines, text);
  // Confidence remains evidence; a usable amount does not confirm bank execution.
  const amountLabel = /^(?:importe(?:\s+total(?:\s+del?\s+deposito)?)?|monto(?:\s+(?:pagado|transferido|de\s+la\s+operacion))?|total\s+operado)\b\s*(?:mxn|mxp|m\.n\.)?\s*[:\-]?\s*/;
  const explicitAmounts = lines.flatMap((line, index) => {
    const match = normalize(line).match(amountLabel);
    if (!match) return [];
    const value = normalize(line).slice(match[0].length) || normalize(lines[index + 1] || "");
    const money = value.match(/^(?:mxn|mxp|m\.n\.)?\s*\$?\s*(\d[\d,. ]*)\s*(?:mxn|mxp|m\.n\.)?$/);
    // Missing or malformed explicit amounts also invalidate conflicting receipts.
    return [money ? parseMoney(money[1]) : 0];
  });
  const amountVerified = explicitAmounts.length > 0 && explicitAmounts.every(value => value > 0 && value === explicitAmounts[0]);
  const normalizedText = normalize(text);
  const blockedExecution = /\b(?:pendiente|programad[oa]|por\s+autorizar|en\s+proceso|capturad[oa]|rechazad[oa]|cancelad[oa]|fallid[oa]|no\s+(?:realizad[oa]|procesad[oa]|efectuad[oa]|completad[oa]|liquidad[oa]|aplicad[oa]|exitos[oa]))\b/.test(normalizedText);
  const positiveExecution = /\b(?:operacion|transferencia|pago|estado|resultado)\s*(?:[:\-]|de\s+la\s+operacion)?\s*(?:fue\s+)?(?:realizad[oa]|efectuad[oa]|exitos[oa]|completad[oa]|aplicad[oa]|liquidad[oa])\b/;
  const declaredStates = lines.map(normalize).filter(line => /^(?:estado|resultado)\b.*[:\-]/.test(line));
  const executionConfirmed = !blockedExecution && positiveExecution.test(normalizedText) && declaredStates.every(line => positiveExecution.test(line));

  const dateLabels = [
      /^fecha\s*(?:\/\s*hora)?\s*[:\-]\s*(.+)$/i,
      /^fecha(?:\s+y\s+hora)?\s+(?:de\s+)?(?:operacion|transferencia|pago|ejecucion)\s*[:\-]\s*(.+)$/i,
  ];
  const executionDates = lines.flatMap((line, index) => {
    const value = extractLabeled([line, lines[index + 1] || ""], dateLabels);
    return value ? [value] : [];
  });
  const dateRaw = executionDates[0] || extractLabeled(lines, [/^fecha\s+y\s+hora\s+de\s+captura\s*[:\-]\s*(.+)$/i]) ||
    firstMatch(normalize(text), [
      /\b(\d{1,2}[-\/]\d{1,2}[-\/]20\d{2})\b/,
      /\b(20\d{2}[-\/]\d{1,2}[-\/]\d{1,2})\b/,
      /\b(\d{1,2}[\s\-\/.]+[a-z]+[\s\-\/.]+20\d{2})\b/i,
      /\b(\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de|del)\s+20\d{2})\b/i,
    ]);
  const time = parseTimeValue(dateRaw) || parseTimeValue(extractLabeled(lines, [
    /^hora\s*(?:de\s+)?(?:operacion|transferencia|pago)?\s*[:\-]\s*(.+)$/i,
  ]));
  const unambiguousDate = (value: string) => {
    const short = value.match(/\b(\d{1,2})[-\/](\d{1,2})[-\/](20\d{2})\b/);
    return !short || Number(short[1]) > 12 || short[1] === short[2];
  };
  const parsedDate = parseDateValue(dateRaw);
  const calendarTime = Date.parse(parsedDate);
  const validDate = Number.isFinite(calendarTime) && new Date(calendarTime).toISOString().slice(0, 10) === parsedDate;
  const dateVerified = executionDates.length > 0 && validDate && executionDates.every(value => parseDateValue(value) === parsedDate && unambiguousDate(value));

  const reference =
    extractLabeled(lines, [
      /^folio\s+electronico\s*[:\-]\s*(.+)$/i,
    ]) ||
    extractLabeled(lines, [
      /^(?:referencia|referencia\s+numerica|clave\s+de\s+rastreo|rastreo|folio|movimiento|num\.?\s*transaccion|numero\s+de\s+transaccion|numero\s+de\s+operacion|no\.\s*operacion)\s*[:\-]\s*(.+)$/i,
    ]);

  const concept = extractLabeled(lines, [
    /^(?:concepto|concepto\s+de\s+pago|motivo|descripci[oÃƒÂ³]n)\s*[:\-]\s*(.+)$/i,
  ]);

  const currency =
    /\b(?:mxn|m\.n\.|pesos\s+mexicanos)\b/i.test(text) && !/\b(?:usd|eur|dolares|euros)\b/i.test(normalizedText)
      ? "MXN"
      : "";

  const rfc = firstMatch(text, [
    /(?:rfc\s+(?:ordenante|emisor|remitente|beneficiario|receptor)?|rfc)\s*[:\-]\s*([A-Z&Ãƒâ€˜]{3,4}\d{6}[A-Z0-9]{3})/i,
    /\b([A-Z&Ãƒâ€˜]{3,4}\d{6}[A-Z0-9]{3})\b/i,
  ]).toUpperCase();
  const payerRfcs = labeledRfcs(lines, "payer"), beneficiaryRfcs = labeledRfcs(lines, "beneficiary");
  const identityConflict = payerRfcs.length > 1 || beneficiaryRfcs.length > 1;
  const payerRfc = payerRfcs.length === 1 ? payerRfcs[0] : "";
  const beneficiaryRfc = beneficiaryRfcs.length === 1 ? beneficiaryRfcs[0] : "";

  const genericClabe = normalizeAccount(extractLabeled(lines, [/^(?:clabe|clabe\s+interbancaria|cuenta\s+clabe)\s*[:\-]\s*(.+)$/i]));
  const clabe = /^\d{18}$/.test(destinationAccount) ? destinationAccount : /^\d{18}$/.test(genericClabe) ? genericClabe : "";

  // Unqualified or destination accounts must never identify the payer.
  const account = sourceAccount;

  const warnings: string[] = [];
  if (!dateVerified) warnings.push("Formato de fecha ambiguo; requiere revisión.");
  if (identityConflict) warnings.push("RFC de ordenante o beneficiario ambiguo; requiere revisión.");

  if (!senderName) warnings.push("Ordenante/proveedor no detectado.");
  if (!beneficiaryName) warnings.push("Beneficiario/receptor no detectado.");

  const amount = explicitAmounts.length > 0 ? (amountVerified ? explicitAmounts[0] : 0) : parseMoney(amountRaw);
  if (!amount) warnings.push("Monto no detectado.");

  const date = validDate ? parsedDate : "";
  if (!date) warnings.push("Fecha no detectada.");

  if (!reference) warnings.push("Referencia no detectada.");

  return {
    senderName,
    beneficiaryName,
    bankName: destinationBankName || detectBank(text),
    sourceBankName,
    destinationBankName,
    amount,
    date,
    time,
    reference,
    concept,
    currency,
    paymentForm: /\b(?:SPEI|TRANSFERENCIA)\b/i.test(text) && !/\b(?:RECHAZAD[OA]|CANCELAD[OA]|FALLID[OA]|CHEQUE|EFECTIVO)\b/i.test(text) ? "03" : "",
    rfc,
    payerRfc,
    beneficiaryRfc,
    clabe,
    account,
    shortName,
    destinationAccount,
    warnings,
    identityConflict,
    amountVerified,
    executionConfirmed,
    dateVerified,
  };
}

export const parsePagoReceiptPdf = onCall(
  {
    cors: true,
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    const startedAt = Date.now();
    const uid = clean(request.auth?.uid);
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sesion requerida.");
    }

    const [user, rootId] = await Promise.all([getMyUser(uid), getRootId(uid)]);
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: "create" });

    const data = request.data || {};
    if (typeof data.base64 !== "string" || data.base64.length > 4 * Math.ceil(1024 * 1024 / 3)) {
      throw new HttpsError("invalid-argument", "Comprobante invalido o mayor a 1 MB.");
    }
    const base64 = clean(data.base64);
    const originalName = clean(data.originalName);
    const declaredContentType = clean(data.contentType);

    if (!base64) {
      throw new HttpsError("invalid-argument", "Comprobante requerido.");
    }

    const buffer = Buffer.from(base64, "base64");

    if (!buffer.length) {
      throw new HttpsError("invalid-argument", "Comprobante vacio.");
    }

    if (buffer.length > 1024 * 1024) {
      throw new HttpsError("invalid-argument", "El comprobante excede el limite de 1 MB.");
    }

    const contentType = detectReceiptContentType({
      declaredContentType,
      originalName,
      buffer,
    });

    if (!contentType) {
      throw new HttpsError(
        "invalid-argument",
        "El comprobante debe ser PDF, JPG, PNG o WEBP.",
        { code: "DOCUMENT_UNSUPPORTED" },
      );
    }

    // Cache reads also reserve a slot: authorization and aggregate use stay bounded.
    await reserveReceiptProcessing(db, request.auth);
    const contentSha256 = createHash("sha256").update(buffer).digest("hex");
    const analysisId = createHash("sha256").update(`${rootId}|${contentSha256}|${RECEIPT_READER_VERSION}`).digest("hex");
    const analysisRef = db.doc(`pagoReceiptAnalyses/${analysisId}`);
    const cached = await analysisRef.get();
    let text = "";
    let pdfPageCount: number | undefined;
    let textSource = "";
    let receipt: ReceiptData;
    let semanticReceipt: ReturnType<typeof buildSemanticReceipt>;
    let cacheHit = false;

    if (cached.exists && cached.get("rootId") === rootId && cached.get("readerVersion") === RECEIPT_READER_VERSION && cached.get("processingPolicyVersion") === 3) {
      receipt = cached.get("receipt") as ReceiptData;
      semanticReceipt = cached.get("semanticReceipt") as ReturnType<typeof buildSemanticReceipt>;
      textSource = clean(cached.get("textSource"));
      cacheHit = true;
    } else {

    if (contentType === "application/pdf") {
      try {
        const parsed = await getPdfParser()(new Uint8Array(buffer), { max: RECEIPT_PROCESSING_LIMITS.pdfPages });
        const pages = Number(parsed?.numpages);
        if (!Number.isInteger(pages) || pages < 1) throw new HttpsError("failed-precondition", "No se pudo verificar el numero de paginas del comprobante.");
        if (pages > RECEIPT_PROCESSING_LIMITS.pdfPages) throw new HttpsError("invalid-argument", "El comprobante debe tener como maximo 5 paginas.");
        pdfPageCount = pages;
        text = clean(parsed?.text);

        if (text) {
          textSource = "PDF_TEXT";
        }
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        // An unparsed PDF has no trusted page count; do not send a partial OCR selection.
        throw new HttpsError("failed-precondition", "No se pudo verificar el PDF. Intenta con un archivo valido.");
      }
    }

    if (!text) {
      try {
        text = await extractVisionOcrText(buffer, contentType, pdfPageCount);
        if (text) {
          textSource = "VISION_OCR";
        }
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError(
          "failed-precondition",
          "No se pudo procesar visualmente el comprobante. Puedes reintentar o capturar los datos para revision.",
          { code: "DOCUMENT_PROCESSING_FAILED" },
        );
      }
    }

    if (!text) {
      throw new HttpsError(
        "failed-precondition",
        "No se pudo detectar texto en el comprobante.",
        { code: "DOCUMENT_UNREADABLE" },
      );
    }

    receipt = parseReceiptText(text);
    semanticReceipt = buildSemanticReceipt(text, receipt);
    await db.runTransaction(async tx => {
    const existing = await tx.get(analysisRef);
    if (existing.exists && existing.get("processingPolicyVersion") === 3 && existing.data()?.receipt && existing.data()?.semanticReceipt) return;
    // Re-read old extraction policy under the same document identity. Merge only
    // original extraction fields: all actor corrections and versions survive.
    tx.set(analysisRef, {
      schemaVersion: 1, processingPolicyVersion: 3, readerVersion: RECEIPT_READER_VERSION, rootId, contentSha256,
      contentType, textSource, receipt, semanticReceipt, textLength: text.length,
      providerCalls: textSource === "VISION_OCR" ? 1 : 0,
      ...(!existing.exists ? { createdAt: new Date() } : {}), updatedAt: new Date(),
    }, { merge: true });
    });
    }
    const latestAnalysis = await analysisRef.get();
    const actorCorrectionState = getReceiptActorCorrectionState(latestAnalysis.data() || {}, uid);
    const correctionVersion = actorCorrectionState.version;
    const overlay = applyReceiptCorrections(latestAnalysis.get("receipt") || receipt, latestAnalysis.get("semanticReceipt") || semanticReceipt, actorCorrectionState.corrections);
    receipt = overlay.receipt as ReceiptData;
    semanticReceipt = overlay.semanticReceipt as ReturnType<typeof buildSemanticReceipt>;
    const identification = await identifyParsedReceipt({ db,
      actor: { uid, rootId, role: getUserRole(user) as "superadmin" | "admin" | "operador" },
      receipt, contentSha256, operationTypeKey: clean(data.operationTypeKey), analysisId,
      readerVersion: RECEIPT_READER_VERSION, semanticReceipt, correctionVersion,
      selectedClientId: clean(data.selectedClientId), selectedCompanyId: clean(data.selectedCompanyId),
    });
    const learningContext = await retrieveReceiptLearningContext(rootId, latestAnalysis.get("semanticReceipt") || semanticReceipt, semanticReceipt);

    return {
      ok: true,
      originalName,
      contentType,
      textSource,
      readerVersion: RECEIPT_READER_VERSION,
      analysisId,
      contentSha256,
      cacheHit,
      providerCalls: cacheHit ? 0 : textSource === "VISION_OCR" ? 1 : 0,
      durationMs: Date.now() - startedAt,
      ocrUsed: textSource === "VISION_OCR",
      textLength: cacheHit ? Number(cached.get("textLength") || 0) : text.length,
      receipt,
      semanticReceipt,
      learningContext,
      correctionVersion,
      identification,
    };
  },
);

export const correctPagoReceiptSemanticField = onCall(
  { cors: true, timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const uid = clean(request.auth?.uid);
    if (!uid) throw new HttpsError("unauthenticated", "Sesion requerida.");
    const [user, rootId] = await Promise.all([getMyUser(uid), getRootId(uid)]);
    assertAuthorized(request.auth, user, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: "create" });
    const analysisId = clean(request.data?.analysisId), fromField = clean(request.data?.field), toField = clean(request.data?.correctedField);
    let correctedValue: string | number;
    if (!/^[a-f0-9]{64}$/.test(analysisId) || !isCorrectableReceiptField(fromField) || !isCorrectableReceiptField(toField))
      throw new HttpsError("invalid-argument", "Correccion semantica invalida.");
    try { correctedValue = normalizeReceiptCorrection(fromField, toField, request.data?.correctedValue); }
    catch { throw new HttpsError("invalid-argument", "Valor o reclasificacion invalida."); }
    const expectedVersion = request.data?.expectedCorrectionVersion;
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) throw new HttpsError("invalid-argument", "Version invalida.");
    const analysisRef = db.doc(`pagoReceiptAnalyses/${analysisId}`), analysis = await analysisRef.get();
    if (!analysis.exists || analysis.get("rootId") !== rootId) throw new HttpsError("not-found", "Interpretacion no encontrada.");
    const semantic = analysis.get("semanticReceipt") || {}, fields = semantic.fields || {}, auto = fields[fromField] || {};
    if (fromField !== toField && auto.value == null) throw new HttpsError("failed-precondition", "El campo automatico no tiene evidencia reclasificable.");
    const pattern = receiptPattern({ readerVersion: clean(analysis.get("readerVersion")), bankName: fields.bankName?.normalizedValue, evidenceLabel: fromField === toField ? fromField.replace(/([a-z])([A-Z])/g, "$1 $2") : auto.label, fromField, toField });
    const content = sanitizedReceiptLearningContent(pattern);
    if (containsSensitiveLearningData(content)) throw new HttpsError("failed-precondition", "La observacion no supero sanitizacion.");
    const initialActorState = getReceiptActorCorrectionState(analysis.data() || {}, uid);
    const previousOverlay = initialActorState.corrections[fromField];
    const sameCurrentCorrection = expectedVersion === undefined && previousOverlay?.actorUid === uid && previousOverlay?.correctedField === toField && previousOverlay?.correctedValue === correctedValue;
    const baseVersion = expectedVersion ?? initialActorState.version;
    const correctionId = sameCurrentCorrection ? String(previousOverlay.correctionId) : createHash("sha256").update(JSON.stringify([rootId, uid, analysisId, fromField, toField, correctedValue, baseVersion])).digest("hex");
    const correctionRef = db.doc(`pagoReceiptCorrections/${correctionId}`), observationRef = db.doc(`agent007Observations/receipt_${correctionId}`), memoryRef = db.doc(`agent007Memory/${receiptMemoryId(rootId, pattern.key)}`);
    const now = new Date().toISOString();
    await db.runTransaction(async tx => {
      const [previousCorrection, previousMemory, currentAnalysis] = await Promise.all([tx.get(correctionRef), tx.get(memoryRef), tx.get(analysisRef)]);
      if (!currentAnalysis.exists || currentAnalysis.get("rootId") !== rootId) throw new HttpsError("not-found", "Interpretacion no encontrada.");
      // A retry of the same authorized correction is not new learning evidence.
      if (previousCorrection.exists) return;
      const currentActorState = getReceiptActorCorrectionState(currentAnalysis.data() || {}, uid);
      const currentVersion = currentActorState.version;
      if (baseVersion !== currentVersion) throw new HttpsError("aborted", "El comprobante cambio. Actualiza antes de corregir.");
      const version = currentVersion + 1;
      const memory = previousMemory.data();
      tx.set(correctionRef, { schemaVersion: 1, version, learningVersion: RECEIPT_LEARNING_VERSION, rootId, analysisId, documentFingerprint: analysis.get("contentSha256"), readerVersion: analysis.get("readerVersion"), field: fromField,
        autoResult: { rawValue: auto.rawValue ?? null, normalizedValue: auto.normalizedValue ?? auto.value ?? null, confidence: auto.confidence ?? "NONE", evidence: { label: auto.label ?? null, excerpt: auto.excerpt ?? null } },
        humanCorrection: { correctedField: toField, correctedValue, actorUid: uid, actorRole: String(user?.role || ""), correctedAt: now }, finalResult: { field: toField, value: correctedValue, source: "HUMAN_CONFIRMED" }, patternKey: pattern.key,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: false });
      tx.set(analysisRef, { correctionVersionsByActor: { [uid]: version }, humanCorrectionsByActor: { [uid]: { ...currentActorState.corrections, [fromField]: { version, correctionId, correctedField: toField, correctedValue, actorUid: uid, actorRole: String(user?.role || ""), correctedAt: now } } }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(observationRef, { rootId, agentId: "AGENTE_007", phase: "OBSERVATION", source: "PAYMENT_RECEIPT_HUMAN_CORRECTION", caseType: "PAYMENT_RECEIPT_PATTERN", caseId: pattern.key, intent: "Aprender clasificacion de etiqueta documental", humanDecision: `${fromField}->${toField}`, outcome: content,
        pattern: { ...pattern, version: RECEIPT_LEARNING_VERSION }, actorUid: uid, actorRole: String(user?.role || ""), authorization: { role: String(user?.role || ""), scope: "rootId", rootId }, retrievalEligible: true,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), expiresAt: null }, { merge: false });
      tx.set(memoryRef, { id: memoryRef.id, version: "memory-v2", rootId, kind: memory?.kind || "HYPOTHESIS", status: memory?.status || "CANDIDATE", scope: { level: "ENTITY_TYPE", rootId, system: "PAY0", entityType: "PAYMENT_RECEIPT_PATTERN" }, entityKey: null,
        content, source: "EXPLICIT_HUMAN", sourceSystem: "PAY0", authorUid: uid, confidence: memory?.confidence ?? null, createdAt: memory?.createdAt || now, effectiveAt: memory?.effectiveAt || now, lastVerifiedAt: memory?.lastVerifiedAt ?? null, validUntil: memory?.validUntil ?? null, supersedes: memory?.supersedes || [],
        receiptLearning: { ...pattern, version: RECEIPT_LEARNING_VERSION, observationId: observationRef.id, confirmations: FieldValue.increment(1) } }, { merge: true });
    });
    const memory = await memoryRef.get();
    const learningContext = memory.exists && memory.get("rootId") === rootId ? [{ id: memory.id, status: memory.get("status"), content: memory.get("content"), advisory: memoryCanAdvise({ patternKey: pattern.key, memoryPatternKey: memory.get("receiptLearning.key"), memoryStatus: memory.get("status"), documentEvidenceDecision: fields[toField]?.decision || "MISSING" }) }] : [];
    const latestAnalysis = await analysisRef.get();
    const actorCorrectionState = getReceiptActorCorrectionState(latestAnalysis.data() || {}, uid);
    const correctionVersion = actorCorrectionState.version;
    const { receipt, semanticReceipt } = applyReceiptCorrections(latestAnalysis.get("receipt") || {}, latestAnalysis.get("semanticReceipt") || {}, actorCorrectionState.corrections);
    const identification = await identifyParsedReceipt({ db,
      actor: { uid, rootId, role: getUserRole(user) as "superadmin" | "admin" | "operador" },
      receipt, semanticReceipt, contentSha256: clean(latestAnalysis.get("contentSha256")), analysisId,
      readerVersion: clean(latestAnalysis.get("readerVersion")), correctionVersion,
      operationTypeKey: clean(request.data?.operationTypeKey), selectedClientId: clean(request.data?.selectedClientId), selectedCompanyId: clean(request.data?.selectedCompanyId),
    });
    return { ok: true, receipt, semanticReceipt, identification, correctionVersion, analysisId, correctionId, observationId: observationRef.id, memoryId: memoryRef.id, patternKey: pattern.key, learningContext,
      finalResult: { field: toField, value: correctedValue, source: "HUMAN_CONFIRMED" } };
  },
);
