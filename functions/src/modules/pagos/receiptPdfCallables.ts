import { RECEIPT_PROCESSING_LIMITS, reserveReceiptProcessing } from "./receiptOcrQuota";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { db, getMyUser, getRootId } from "../sharedCallables/helpers";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { identifyParsedReceipt } from "./receiptIdentification";
import { buildSemanticReceipt, RECEIPT_READER_VERSION } from "./receiptSemantics";
import { containsSensitiveLearningData, receiptMemoryId, isCorrectableReceiptField, memoryCanAdvise, receiptPattern, RECEIPT_LEARNING_VERSION, sanitizedReceiptLearningContent } from "./receiptLearning";

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

async function retrieveReceiptLearningContext(rootId: string, semantic: ReturnType<typeof buildSemanticReceipt>) {
  try {
    const fields = semantic.fields || {}, candidates: Array<{ pattern: ReturnType<typeof receiptPattern>; targetDecision: string }> = [];
    for (const fromField of ["reference", "trackingKey", "folio", "transactionId"] as const) {
      const source = fields[fromField];
      if (!source?.label) continue;
      for (const toField of ["reference", "trackingKey", "folio", "transactionId"] as const) {
        if (fromField === toField) continue;
        const pattern = receiptPattern({ readerVersion: semantic.readerVersion, bankName: fields.bankName?.normalizedValue, evidenceLabel: source.label, fromField, toField });
        candidates.push({ pattern, targetDecision: fields[toField]?.decision || "MISSING" });
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
      const direct = line.match(label);
      if (direct?.[1]) {
        const value = clean(direct[1]);
        if (value) return value;
      }

      if (label.test(`${line}:`)) {
        const next = clean(lines[i + 1] || "");
        if (next) return next;
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
  const candidates = lines.slice(0, searchEnd);

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
  const priorityPatterns: RegExp[] = [
    /importe\s+total\s+del?\s*deposito[^0-9]*\$?\s*([\d,.]+)/i,
    /importe\s+total\s+(?:mxp|mxn|m\.n\.)[^0-9]*\$?\s*([\d,.]+)/i,
    /total\s+operado\s+(?:mxp|mxn|m\.n\.)?[^0-9]*\$?\s*([\d,.]+)/i,
    /total\s+aceptados?[^0-9]*\$?\s*([\d,.]+)/i,
    /total\s+presentado[^0-9]*\$?\s*([\d,.]+)/i,
    /cheques\s+otros\s+bancos[^0-9]*\$?\s*([\d,.]+)/i,
  ];

  for (const lineRaw of lines) {
    const line = normalize(lineRaw);

    for (const pattern of priorityPatterns) {
      const match = line.match(pattern);
      if (match?.[1] && parseMoney(match[1]) > 0) {
        return clean(match[1]);
      }
    }
  }

  return firstMatch(text, [
    /(?:importe|monto\s+(?:pagado|transferido|de\s+la\s+operacion)|monto|total)\s*[:$ ]+\s*(?:mxn|mxp|m\.n\.)?\s*\$?\s*([\d,.]+)/i,
    /\$\s*([\d]{1,3}(?:,\d{3})*(?:\.\d{2})?)\b/,
  ]);
}
export function parseReceiptText(textRaw: string): ReceiptData {
  const text = String(textRaw || "")
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

  const destinationAccount = extractLabeled(lines, [
    /^cuenta\s+de\s+dep[oÃƒÂ³]sito\s*[:\-]\s*(.+)$/i,
    /^cuenta\s+destino\s*[:\-]\s*(.+)$/i,
    /^clabe\s+destino\s*[:\-]\s*(.+)$/i,
  ]);

  const amountRaw = extractReceiptAmount(lines, text);
  // Unlabelled monetary values remain manual suggestions; they never authorize an automatic payment.
  const explicitAmounts = lines.map(line => normalize(line).match(/^(?:importe(?:\s+total(?:\s+del?\s+deposito)?)?|monto(?:\s+(?:pagado|transferido|de\s+la\s+operacion))?|total\s+operado)\s*(?:mxn|mxp|m\.n\.)?\s*[:$ ]+\s*(?:mxn|mxp|m\.n\.)?\s*\$?\s*([\d,.]+)\s*(?:mxn|mxp|m\.n\.)?\s*$/)?.[1])
    .filter(Boolean).map(value => parseMoney(value));
  const amountVerified = explicitAmounts.length > 0 && explicitAmounts.every(value => value > 0 && value === explicitAmounts[0]);
  const normalizedText = normalize(text);
  const blockedExecution = /\b(?:pendiente|programad[oa]|por\s+autorizar|en\s+proceso|capturad[oa]|rechazad[oa]|cancelad[oa]|fallid[oa]|no\s+(?:realizad[oa]|procesad[oa]|efectuad[oa]|completad[oa]|liquidad[oa]|aplicad[oa]|exitos[oa]))\b/.test(normalizedText);
  const positiveExecution = /\b(?:operacion|transferencia|pago|estado|resultado)\s*(?:[:\-]|de\s+la\s+operacion)?\s*(?:fue\s+)?(?:realizad[oa]|efectuad[oa]|exitos[oa]|completad[oa]|aplicad[oa]|liquidad[oa])\b/;
  const declaredStates = lines.map(normalize).filter(line => /^(?:estado|resultado)\b.*[:\-]/.test(line));
  const executionConfirmed = !blockedExecution && positiveExecution.test(normalizedText) && declaredStates.every(line => positiveExecution.test(line));

  const dateRaw =
    extractLabeled(lines, [
      /^fecha\s*(?:\/\s*hora)?\s*[:\-]\s*(.+)$/i,
      /^fecha\s+y\s+hora\s+de\s+captura\s*[:\-]\s*(.+)$/i,
      /^fecha\s+(?:de\s+)?(?:operacion|transferencia|pago)\s*[:\-]\s*(.+)$/i,
    ]) ||
    firstMatch(normalize(text), [
      /\b(\d{1,2}[-\/]\d{1,2}[-\/]20\d{2})\b/,
      /\b(20\d{2}[-\/]\d{1,2}[-\/]\d{1,2})\b/,
      /\b(\d{1,2}[\s\-\/.]+[a-z]+[\s\-\/.]+20\d{2})\b/i,
      /\b(\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de|del)\s+20\d{2})\b/i,
    ]);
  const time = parseTimeValue(dateRaw) || parseTimeValue(extractLabeled(lines, [
    /^hora\s*(?:de\s+)?(?:operacion|transferencia|pago)?\s*[:\-]\s*(.+)$/i,
  ]));
  const shortDate = dateRaw.match(/\b(\d{1,2})[-\/](\d{1,2})[-\/](20\d{2})\b/);
  const dateVerified = !!dateRaw && (!shortDate || Number(shortDate[1]) > 12 || shortDate[1] === shortDate[2]);

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

  const clabe = firstMatch(text, [
    /(?:clabe|clabe\s+interbancaria|cuenta\s+clabe)\s*[:\-]?\s*(\d[\d\s-]{16,22}\d)/i,
    /\b(\d{18})\b/,
  ]).replace(/\D/g, "").slice(0, 18);

  const account = firstMatch(text, [
    /(?:cuenta|n[uÃƒÂº]mero\s+de\s+cuenta|cta\.?)\s*[:\-]?\s*([0-9*Xx\- ]{4,30})/i,
  ]).replace(/\s+/g, " ").trim();

  const warnings: string[] = [];
  if (!amountVerified) warnings.push("Importe sin etiqueta inequívoca o importes contradictorios; requiere revisión.");
  if (!executionConfirmed) warnings.push("Ejecución de la transferencia sin confirmar; requiere revisión.");
  if (!dateVerified) warnings.push("Formato de fecha ambiguo; requiere revisión.");
  if (identityConflict) warnings.push("RFC de ordenante o beneficiario ambiguo; requiere revisión.");

  if (!senderName) warnings.push("Ordenante/proveedor no detectado.");
  if (!beneficiaryName) warnings.push("Beneficiario/receptor no detectado.");

  const amount = amountVerified ? explicitAmounts[0] : parseMoney(amountRaw);
  if (!amount) warnings.push("Monto no detectado.");

  const date = parseDateValue(dateRaw);
  if (!date) warnings.push("Fecha no detectada.");

  if (!reference) warnings.push("Referencia no detectada.");

  return {
    senderName,
    beneficiaryName,
    bankName:
      extractLabeled(lines, [
        /^banco\s+destino\s*[:\-]\s*(.+)$/i,
        /^banco\s+receptor\s*[:\-]\s*(.+)$/i,
      ]) ||
      detectBank(text),
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

    if (cached.exists && cached.get("rootId") === rootId && cached.get("readerVersion") === RECEIPT_READER_VERSION && cached.get("processingPolicyVersion") === 2) {
      receipt = cached.get("receipt") as ReceiptData;
      semanticReceipt = cached.get("semanticReceipt") as ReturnType<typeof buildSemanticReceipt>;
      textSource = clean(cached.get("textSource"));
      cacheHit = true;
    } else {

    if (contentType === "application/pdf") {
      try {
        const parsed = await getPdfParser()(buffer, { max: RECEIPT_PROCESSING_LIMITS.pdfPages });
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
    await analysisRef.set({
      schemaVersion: 1, processingPolicyVersion: 2, readerVersion: RECEIPT_READER_VERSION, rootId, contentSha256,
      contentType, textSource, receipt, semanticReceipt, textLength: text.length,
      providerCalls: textSource === "VISION_OCR" ? 1 : 0,
      createdAt: new Date(), updatedAt: new Date(),
    }, { merge: false });
    }
    const identification = await identifyParsedReceipt({ db,
      actor: { uid, rootId, role: getUserRole(user) as "superadmin" | "admin" | "operador" },
      receipt, contentSha256, operationTypeKey: clean(data.operationTypeKey), analysisId,
      readerVersion: RECEIPT_READER_VERSION, semanticReceipt,
    });
    const learningContext = await retrieveReceiptLearningContext(rootId, semanticReceipt);

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
    const correctedValue = clean(request.data?.correctedValue);
    if (!/^[a-f0-9]{64}$/.test(analysisId) || !isCorrectableReceiptField(fromField) || !isCorrectableReceiptField(toField) || !correctedValue)
      throw new HttpsError("invalid-argument", "Correccion semantica invalida.");
    const analysisRef = db.doc(`pagoReceiptAnalyses/${analysisId}`), analysis = await analysisRef.get();
    if (!analysis.exists || analysis.get("rootId") !== rootId) throw new HttpsError("not-found", "Interpretacion no encontrada.");
    const semantic = analysis.get("semanticReceipt") || {}, fields = semantic.fields || {}, auto = fields[fromField];
    if (!auto || auto.value == null) throw new HttpsError("failed-precondition", "El campo automatico no tiene evidencia corregible.");
    const pattern = receiptPattern({ readerVersion: clean(analysis.get("readerVersion")), bankName: fields.bankName?.normalizedValue, evidenceLabel: auto.label, fromField, toField });
    const content = sanitizedReceiptLearningContent(pattern);
    if (containsSensitiveLearningData(content)) throw new HttpsError("failed-precondition", "La observacion no supero sanitizacion.");
    const correctionId = createHash("sha256").update([rootId, analysisId, fromField, toField, correctedValue].join("|")).digest("hex");
    const correctionRef = db.doc(`pagoReceiptCorrections/${correctionId}`), observationRef = db.doc(`agent007Observations/receipt_${correctionId}`), memoryRef = db.doc(`agent007Memory/${receiptMemoryId(rootId, pattern.key)}`);
    const now = new Date().toISOString();
    await db.runTransaction(async tx => {
      tx.set(correctionRef, { schemaVersion: 1, learningVersion: RECEIPT_LEARNING_VERSION, rootId, analysisId, documentFingerprint: analysis.get("contentSha256"), readerVersion: analysis.get("readerVersion"), field: fromField,
        autoResult: { rawValue: auto.rawValue ?? null, normalizedValue: auto.normalizedValue ?? auto.value, confidence: auto.confidence, evidence: { label: auto.label ?? null, excerpt: auto.excerpt ?? null } },
        humanCorrection: { correctedField: toField, correctedValue, actorUid: uid, actorRole: String(user?.role || ""), correctedAt: now }, finalResult: { field: toField, value: correctedValue, source: "HUMAN_CONFIRMED" }, patternKey: pattern.key,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: false });
      tx.set(analysisRef, { [`humanCorrections.${fromField}`]: { correctionId, correctedField: toField, correctedValue, actorUid: uid, actorRole: String(user?.role || ""), correctedAt: now }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(observationRef, { rootId, agentId: "AGENTE_007", phase: "OBSERVATION", source: "PAYMENT_RECEIPT_HUMAN_CORRECTION", caseType: "PAYMENT_RECEIPT_PATTERN", caseId: pattern.key, intent: "Aprender clasificacion de etiqueta documental", humanDecision: `${fromField}->${toField}`, outcome: content,
        pattern: { ...pattern, version: RECEIPT_LEARNING_VERSION }, actorUid: uid, actorRole: String(user?.role || ""), authorization: { role: String(user?.role || ""), scope: "rootId", rootId }, retrievalEligible: true,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), expiresAt: null }, { merge: false });
      tx.set(memoryRef, { id: memoryRef.id, version: "memory-v2", rootId, kind: "HYPOTHESIS", status: "CANDIDATE", scope: { level: "ENTITY_TYPE", rootId, system: "PAY0", entityType: "PAYMENT_RECEIPT_PATTERN" }, entityKey: null,
        content, source: "EXPLICIT_HUMAN", sourceSystem: "PAY0", authorUid: uid, confidence: null, createdAt: now, effectiveAt: now, lastVerifiedAt: null, validUntil: null, supersedes: [],
        receiptLearning: { ...pattern, version: RECEIPT_LEARNING_VERSION, observationId: observationRef.id, confirmations: FieldValue.increment(1) } }, { merge: true });
    });
    const memory = await memoryRef.get();
    const learningContext = memory.exists && memory.get("rootId") === rootId ? [{ id: memory.id, status: memory.get("status"), content: memory.get("content"), advisory: memoryCanAdvise({ patternKey: pattern.key, memoryPatternKey: memory.get("receiptLearning.key"), memoryStatus: memory.get("status"), documentEvidenceDecision: fields[toField]?.decision || "MISSING" }) }] : [];
    return { ok: true, correctionId, observationId: observationRef.id, memoryId: memoryRef.id, patternKey: pattern.key, learningContext,
      finalResult: { field: toField, value: correctedValue, source: "HUMAN_CONFIRMED" } };
  },
);
