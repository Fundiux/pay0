import { onCall, HttpsError } from "firebase-functions/v2/https";

const pdfParse = require("pdf-parse");
const { ImageAnnotatorClient } = require("@google-cloud/vision").v1;
const visionClient = new ImageAnnotatorClient();

type ReceiptData = {
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

  const normalized =
    comma > dot
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact.replace(/,/g, "");

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

async function extractVisionOcrText(buffer: Buffer, contentType: string): Promise<string> {
  if (contentType === "application/pdf") {
    const [result] = await visionClient.batchAnnotateFiles({
      requests: [
        {
          inputConfig: {
            mimeType: "application/pdf",
            content: buffer,
          },
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

  const [response] = await visionClient.documentTextDetection({
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
function parseReceiptText(textRaw: string): ReceiptData {
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
  ]).replace(/\D/g, "");

  const amountRaw = extractReceiptAmount(lines, text);

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
    /\b(?:mxn|m\.n\.|pesos\s+mexicanos)\b/i.test(text)
      ? "MXN"
      : "";

  const rfc = firstMatch(text, [
    /(?:rfc\s+(?:ordenante|emisor|remitente|beneficiario|receptor)?|rfc)\s*[:\-]\s*([A-Z&Ãƒâ€˜]{3,4}\d{6}[A-Z0-9]{3})/i,
    /\b([A-Z&Ãƒâ€˜]{3,4}\d{6}[A-Z0-9]{3})\b/i,
  ]).toUpperCase();

  const clabe = firstMatch(text, [
    /(?:clabe|clabe\s+interbancaria|cuenta\s+clabe)\s*[:\-]?\s*(\d[\d\s-]{16,22}\d)/i,
    /\b(\d{18})\b/,
  ]).replace(/\D/g, "").slice(0, 18);

  const account = firstMatch(text, [
    /(?:cuenta|n[uÃƒÂº]mero\s+de\s+cuenta|cta\.?)\s*[:\-]?\s*([0-9*Xx\- ]{4,30})/i,
  ]).replace(/\s+/g, " ").trim();

  const warnings: string[] = [];

  if (!senderName) warnings.push("Ordenante/proveedor no detectado.");
  if (!beneficiaryName) warnings.push("Beneficiario/receptor no detectado.");

  const amount = parseMoney(amountRaw);
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
    reference,
    concept,
    currency,
    rfc,
    clabe,
    account,
    shortName,
    destinationAccount,
    warnings,
  };
}

export const parsePagoReceiptPdf = onCall(
  {
    cors: true,
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    const uid = clean(request.auth?.uid);
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sesion requerida.");
    }

    const data = request.data || {};
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
      );
    }

    let text = "";
    let textSource = "";

    if (contentType === "application/pdf") {
      try {
        const parsed = await pdfParse(buffer);
        text = clean(parsed?.text);

        if (text) {
          textSource = "PDF_TEXT";
        }
      } catch {
        text = "";
      }
    }

    if (!text) {
      try {
        text = await extractVisionOcrText(buffer, contentType);
        if (text) {
          textSource = "VISION_OCR";
        }
      } catch (error) {
        throw new HttpsError(
          "failed-precondition",
          `No se pudo ejecutar OCR sobre el comprobante: ${clean((error as any)?.message || error)}`,
        );
      }
    }

    if (!text) {
      throw new HttpsError(
        "failed-precondition",
        "No se pudo detectar texto en el comprobante.",
      );
    }

    const receipt = parseReceiptText(text);

    return {
      ok: true,
      originalName,
      contentType,
      textSource,
      ocrUsed: textSource === "VISION_OCR",
      textLength: text.length,
      receipt,
    };
  },
);
