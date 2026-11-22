/**
 * Tolerant purchase-order (OC) recognizer.
 *
 * Layer 2 of the OC pipeline. The deterministic reader in service.ts runs
 * first and its output is never altered; this module only reads OCs that the
 * deterministic reader could not. It accepts other layouts (label synonyms in
 * Spanish and English, Mexican and European number formats, repeated table
 * headers on multi-page exports, CSV and plain/PDF text) but it never trusts
 * what it reads: every candidate is validated arithmetically and against the
 * solicitud, and any doubt yields REVIEW_REQUIRED instead of acceptance.
 *
 * Pure module: no Firestore, no Storage, no network.
 */

export type OcRecognitionStatus = "ACCEPTED" | "REVIEW_REQUIRED" | "UNREADABLE";
export type OcRecognitionLayer = "DETERMINISTIC" | "TOLERANT" | "SEMANTIC";
export type OcSourceFormat = "XLSX" | "CSV" | "TEXT" | "PDF";

export type OcCandidateItem = { quantity: number; unit: string; productCode: string; description: string; unitPrice: number | null; amount: number | null };
export type OcCandidate = {
  items: OcCandidateItem[];
  subtotal: number | null; iva: number | null; retention: number | null; total: number | null;
  currency: string; clientName: string; clientRfc: string; rfcs: string[];
  number: string; date: string; paymentMethod: string;
};
export type OcValidationContext = {
  /** Total of the solicitud the OC is attached to; the OC must match it to be accepted. */
  solicitudTotal?: number | null;
  /** RFC registered for the solicitud's client. */
  registeredClientRfc?: string | null;
  /** RFC of the issuing company (supplier); never taken as the client RFC. */
  companyRfc?: string | null;
};
export type OcRecognitionResult = {
  status: OcRecognitionStatus;
  layer: OcRecognitionLayer;
  format: OcSourceFormat;
  confidence: number;
  /** Reason codes only; never client data. */
  issues: string[];
  candidate: OcCandidate | null;
};

/** Minimum confidence for the tolerant layer to accept without review. */
export const OC_TOLERANT_MIN_CONFIDENCE = 0.85;

/** Issues that always force human review, whatever the confidence. */
export const OC_BLOCKING_ISSUES = new Set([
  "NO_ITEMS", "ITEM_WITHOUT_DESCRIPTION", "ITEM_WITHOUT_AMOUNT", "ITEM_ARITHMETIC_MISMATCH",
  "TOTAL_NOT_FOUND", "TOTALS_INCONSISTENT", "LINES_DO_NOT_MATCH_SUBTOTAL", "NON_POSITIVE_TOTAL",
  "FOREIGN_CURRENCY", "CURRENCY_AMBIGUOUS", "CLIENT_RFC_MISMATCH", "TOTAL_DIFFERS_FROM_SOLICITUD",
  "SEMANTIC_REQUIRES_REVIEW", "SEMANTIC_VALUE_NOT_IN_SOURCE",
]);
const PENALTIES: Record<string, number> = {
  CURRENCY_ASSUMED_MXN: 0.05, SUBTOTAL_DERIVED: 0.05, IVA_DERIVED: 0.05, IVA_RATE_UNUSUAL: 0.2,
  OC_NUMBER_NOT_FOUND: 0.02, DATE_NOT_FOUND: 0.02, RFC_NOT_FOUND: 0.03, RFC_INVALID_FORMAT: 0.1,
  TABLE_HEADER_NOT_FOUND: 0.08, RETENTION_PRESENT: 0.03, TEXT_LINE_ITEMS: 0.05, SOLICITUD_TOTAL_UNKNOWN: 0.1,
};

const MONEY_EPSILON = 0.01 + 1e-9;
export const roundCents = (value: number) => Math.round(Number((value * 100).toPrecision(12))) / 100;

/** Uppercase, accent-free, punctuation collapsed to spaces. */
export function normalizeOcLabel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[.:;_\-/\\#°º()[\]*]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Reads an amount written in any of the usual formats: 1,234.56 / 1.234,56 /
 * 1 234,56 / $1,234.56 MXN / (1,234.56). Returns null when the text is not
 * an amount (it never guesses digits out of prose).
 */
export function parseLocaleAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let text = String(raw ?? "").replace(/[   ]/g, " ").trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  text = text.replace(/^(?:MXN|MXP|M\.?\s?N\.?|USD|US\$|EUR|PESOS?)\s*/i, "").replace(/\s*(?:MXN|MXP|M\.?\s?N\.?|USD|EUR|PESOS?(?:\s+MEXICANOS)?)\.?$/i, "").trim();
  text = text.replace(/^\$\s*/, "").replace(/^-\s*\$\s*/, "-");
  if (text.startsWith("-")) { negative = !negative; text = text.slice(1).trim(); }
  if (text.endsWith("-")) { negative = !negative; text = text.slice(0, -1).trim(); }
  if (!/^\d[\d\s.,']*$/.test(text)) return null;
  // Space and apostrophe are only thousands separators.
  if (/\d[\s']\d/.test(text) && !/^\d{1,3}(?:[\s']\d{3})+(?:[.,]\d+)?$/.test(text)) return null;
  text = text.replace(/[\s']/g, "");
  const lastComma = text.lastIndexOf(","), lastDot = text.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    const [integer, fraction] = [text.slice(0, Math.max(lastComma, lastDot)), text.slice(Math.max(lastComma, lastDot) + 1)];
    if (integer.includes(decimal) || !new RegExp(`^\\d{1,3}(?:\\${thousands}\\d{3})*$`).test(integer)) return null;
    normalized = `${integer.split(thousands).join("")}.${fraction}`;
  } else if (lastComma >= 0) {
    // 1,234 and 1,234,567 are thousands (Mexican usage); 1234,5 / 12,50 are decimals.
    if (/^\d{1,3}(?:,\d{3})+$/.test(text)) normalized = text.replace(/,/g, "");
    else if (/^\d+,\d{1,2}$/.test(text)) normalized = text.replace(",", ".");
    else return null;
  } else if (lastDot >= 0) {
    if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(text)) normalized = text.replace(/\./g, "");
    else if (/^\d+\.\d+$/.test(text)) normalized = text;
    else return null;
  } else normalized = text;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

const SPANISH_MONTHS: Record<string, number> = {
  ENE: 1, ENERO: 1, JAN: 1, JANUARY: 1, FEB: 2, FEBRERO: 2, FEBRUARY: 2, MAR: 3, MARZO: 3, MARCH: 3,
  ABR: 4, ABRIL: 4, APR: 4, APRIL: 4, MAY: 5, MAYO: 5, JUN: 6, JUNIO: 6, JUNE: 6, JUL: 7, JULIO: 7, JULY: 7,
  AGO: 8, AGOSTO: 8, AUG: 8, AUGUST: 8, SEP: 9, SEPT: 9, SEPTIEMBRE: 9, SETIEMBRE: 9, SEPTEMBER: 9,
  OCT: 10, OCTUBRE: 10, OCTOBER: 10, NOV: 11, NOVIEMBRE: 11, NOVEMBER: 11, DIC: 12, DICIEMBRE: 12, DEC: 12, DECEMBER: 12,
};
function isoDate(year: number, month: number, day: number): string {
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day && year >= 2000 && year <= 2100
    ? at.toISOString().slice(0, 10) : "";
}
/** Day-first numeric dates, ISO, Excel serials and month names (es/en). */
export function parseFlexibleOcDate(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const serial = value.match(/^(\d{5})(?:\.\d+)?$/);
  if (serial) {
    const at = new Date(Date.UTC(1899, 11, 30) + Number(serial[1]) * 86_400_000);
    return isoDate(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
  }
  const iso = value.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dayFirst = value.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
  if (dayFirst) return isoDate(Number(dayFirst[3].length === 2 ? `20${dayFirst[3]}` : dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  const words = normalizeOcLabel(value).replace(/,/g, " ").replace(/\bDE(L)?\b/g, " ").replace(/\s+/g, " ");
  const named = words.match(/\b(\d{1,2}) ([A-Z]{3,10}) (\d{4})\b/);
  if (named && SPANISH_MONTHS[named[2]]) return isoDate(Number(named[3]), SPANISH_MONTHS[named[2]], Number(named[1]));
  const monthFirst = words.match(/\b([A-Z]{3,10}) (\d{1,2}) (\d{4})\b/);
  if (monthFirst && SPANISH_MONTHS[monthFirst[1]]) return isoDate(Number(monthFirst[3]), SPANISH_MONTHS[monthFirst[1]], Number(monthFirst[2]));
  return "";
}

/** RFC shape plus a real yymmdd date. Generic RFCs (XAXX/XEXX) are valid shapes. */
export function isValidRfcShape(value: string): boolean {
  const match = String(value || "").toUpperCase().match(/^([A-ZÑ&]{3,4})(\d{2})(\d{2})(\d{2})([A-Z0-9]{3})$/);
  if (!match) return false;
  const month = Number(match[3]), day = Number(match[4]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}
const RFC_PATTERN = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g;
const RFC_ONE = /[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}/;
const normalizeRfc = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9Ñ&]/g, "");

// ---- Label vocabularies (matched against normalizeOcLabel output) ----------

const SUBTOTAL_LABEL = /^(?:SUB ?TOTAL(?: GENERAL| MXN| M N| NETO)?|SUMA(?: PARCIAL)?|IMPORTE (?:NETO|SIN IVA|ANTES DE IVA)|TOTAL ANTES DE (?:IVA|IMPUESTOS)|NET AMOUNT|NET TOTAL|BASE GRAVABLE)$/;
const IVA_LABEL = /^(?:I ?V ?A|IVA TRASLADADO|IMPUESTOS?(?: TRASLADADOS?| AL VALOR AGREGADO)?|TRASLADOS?|TAX(?:ES)?|VAT|SALES TAX)(?: \d{1,2}(?: \d+)? ?%?| AL \d{1,2} ?%?| %)?(?: MXN| M N)?$/;
const RETENTION_LABEL = /^(?:(?:IVA |ISR )?RETEN(?:IDO|CION(?:ES)?)(?: (?:DE )?(?:IVA|ISR))?(?: \d{1,2}(?: \d+)? ?%?)?|WITHHOLDING(?: TAX)?)$/;
const TOTAL_LABEL = /^(?:TOTAL(?: GENERAL| A PAGAR| OC| O C| DE LA ORDEN| ORDEN| PEDIDO| NETO| MXN| M N| CON IVA| FACTURA)?|GRAN TOTAL|IMPORTE TOTAL|MONTO TOTAL|GRAND TOTAL|TOTAL AMOUNT|ORDER TOTAL|TOTAL DUE|AMOUNT DUE)$/;
const NOT_A_MONEY_TOTAL = /\b(?:PARTIDAS|ARTICULOS|PIEZAS|PZAS|CANTIDAD|UNIDADES|ITEMS|LINEAS|KG|KILOS|PESO)\b/;
const PAGE_NOISE = /^(?:PAGINA|PAG|PAGE|HOJA) ?\d+(?: (?:DE|OF) \d+)?$|^(?:CONTINUA|CONTINUED|VAN|VIENEN|A LA VUELTA|SUBTOTAL (?:DE )?PAGINA)\b/;

type Role = "quantity" | "unit" | "code" | "description" | "unitPrice" | "amount";
const HEADER_ROLES: Array<[Role, RegExp]> = [
  ["code", /^(?:CLAVE ?(?:SAT|PROD(?:UCTO)?(?: ?SERV(?:ICIO)?)?|CONCEPTO|SERV)|CODIGO SAT|CLAVE PRODSERV|PROD SERV|SAT CODE)$/],
  ["quantity", /^(?:CANT(?:IDAD)?|CANT SOLICITADA|QTY|QUANTITY|PIEZAS|PZAS|PZS|NO PIEZAS|UNIDADES SOLICITADAS)$/],
  ["unit", /^(?:(?:CLAVE )?UNIDAD(?: DE MEDIDA)?|U ?M|UDM|UOM|UNIT|MEDIDA|UNID)$/],
  ["unitPrice", /^(?:PRECIO(?: UNITARIO| UNIT| U| POR UNIDAD)?|P ?U|P UNIT(?:ARIO)?|V(?:ALOR)? UNIT(?:ARIO)?|COSTO(?: UNITARIO| UNIT| U)?|UNIT PRICE|PRICE|UNIT COST|RATE)$/],
  ["amount", /^(?:IMPORTE(?: TOTAL| NETO)?|MONTO|TOTAL(?: LINEA| PARTIDA)?|SUBTOTAL|AMOUNT|EXTENDED(?: PRICE)?|LINE TOTAL|EXT PRICE|VALOR TOTAL)$/],
  ["description", /^(?:DESCRIPCION(?: DEL? (?:PRODUCTO|SERVICIO|ARTICULO|CONCEPTO))?|CONCEPTO|PRODUCTO|SERVICIO|ARTICULO|DETALLE|DESCRIPTION|ITEM(?: DESCRIPTION)?|MATERIAL|BIEN(?:ES)? O SERVICIOS?)$/],
];
function headerRole(cell: unknown): Role | null {
  const label = normalizeOcLabel(cell);
  if (!label || label.length > 40) return null;
  for (const [role, pattern] of HEADER_ROLES) if (pattern.test(label)) return role;
  return null;
}

const CLIENT_NAME_LABELS = /^(?:RAZON SOCIAL(?: (?:DEL )?CLIENTE)?|CLIENTE|NOMBRE (?:DEL )?CLIENTE|COMPRADOR|FACTURAR A|BILL TO|SOLD TO|CUSTOMER|BUYER|EMPRESA COMPRADORA)$/;
const NUMBER_LABELS = /^(?:(?:NO|NUM|NUMERO|N) ?(?:DE )?(?:ORDEN(?: DE COMPRA)?|OC|O C|PEDIDO|PO)|ORDEN DE COMPRA(?: NO| NUM| NUMERO| N)?|OC(?: NO| NUM)?|O C(?: NO)?|PO(?: NUMBER| NO)?|P O(?: NUMBER| NO)?|PURCHASE ORDER(?: NO| NUMBER)?|FOLIO(?: OC| ORDEN)?|PEDIDO(?: NO)?)$/;
const DATE_LABELS = /^(?:FECHA(?: DE)?(?: EMISION| ORDEN| OC| PEDIDO| ELABORACION| DE LA ORDEN)?|DATE|ORDER DATE|PO DATE|ISSUE DATE)$/;
const PAYMENT_METHOD_LABELS = /^(?:METODO DE PAGO|METODO PAGO|PAYMENT METHOD)$/;

// ---- Row helpers -----------------------------------------------------------

const cellText = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Splits "Label: value" written inside a single cell. */
function splitInlineLabel(cell: string): [string, string] | null {
  const match = cell.match(/^([^:=]{2,60})[:=]\s*(.+)$/);
  return match ? [match[1], match[2].trim()] : null;
}

/** First value right of (or below) a matching label; also reads "Label: value" cells. */
function findLabelled(rows: string[][], labels: RegExp, accept: (value: string) => boolean = v => !!v, pickLast = false): string {
  const hits: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const raw = cellText(row[c]);
      if (!raw) continue;
      const inline = splitInlineLabel(raw);
      if (inline && labels.test(normalizeOcLabel(inline[0])) && accept(inline[1])) { hits.push(inline[1]); continue; }
      if (!labels.test(normalizeOcLabel(raw))) continue;
      const right = row.slice(c + 1).map(cellText).find(value => value && accept(value));
      if (right) { hits.push(right); continue; }
      const below = cellText(rows[r + 1]?.[c]);
      if (below && accept(below) && !headerRole(below)) hits.push(below);
    }
  }
  return pickLast ? hits[hits.length - 1] || "" : hits[0] || "";
}

/** Amount for a totals label; the LAST occurrence wins (per-page subtotals precede the final ones). */
function findLabelledAmount(rows: string[][], labels: RegExp): number | null {
  const value = findLabelled(rows, labels, v => parseLocaleAmount(v) !== null, true);
  return value ? parseLocaleAmount(value) : null;
}

function isTotalsRow(row: string[]): boolean {
  return row.some(cell => {
    const raw = cellText(cell);
    const label = normalizeOcLabel(splitInlineLabel(raw)?.[0] ?? raw);
    return (SUBTOTAL_LABEL.test(label) || IVA_LABEL.test(label) || RETENTION_LABEL.test(label) || (TOTAL_LABEL.test(label) && !NOT_A_MONEY_TOTAL.test(label)));
  });
}
const isPageNoise = (row: string[]) => {
  const joined = normalizeOcLabel(row.filter(Boolean).join(" "));
  return !joined || PAGE_NOISE.test(joined);
};

// ---- Table extraction ------------------------------------------------------

type Header = { index: number; columns: Partial<Record<Role, number>>; score: number };

function detectHeader(rows: string[][]): Header | null {
  let best: Header | null = null;
  for (let r = 0; r < rows.length; r++) {
    const columns: Partial<Record<Role, number>> = {};
    rows[r].forEach((cell, c) => {
      const role = headerRole(cell);
      // "Clave Concepto" matches code; a later plain "Concepto" is the description.
      if (role && columns[role] === undefined) columns[role] = c;
    });
    const priced = ["quantity", "unitPrice", "amount"].filter(role => columns[role as Role] !== undefined).length;
    if (columns.description === undefined || priced < 2) continue;
    const score = Object.keys(columns).length;
    if (!best || score > best.score) best = { index: r, columns, score };
  }
  return best;
}

const SAT_CODE = /^\d{8}$/;
const UNIT_CODE = /^[A-Z0-9]{2,3}$/;

function itemsFromGrid(rows: string[][], header: Header): OcCandidateItem[] {
  const { columns } = header;
  const items: OcCandidateItem[] = [];
  const headerSignature = rows[header.index].map(normalizeOcLabel).join("|");
  for (const row of rows.slice(header.index + 1)) {
    // Multi-page exports repeat the header row and page markers.
    if (row.map(normalizeOcLabel).join("|") === headerSignature || isPageNoise(row)) continue;
    if (isTotalsRow(row)) continue;
    const get = (role: Role) => columns[role] === undefined ? "" : cellText(row[columns[role]!]);
    const description = get("description").slice(0, 1000);
    const amount = parseLocaleAmount(get("amount"));
    const unitPrice = parseLocaleAmount(get("unitPrice"));
    const quantityRaw = get("quantity");
    const quantity = quantityRaw ? parseLocaleAmount(quantityRaw) : (amount !== null || unitPrice !== null ? 1 : null);
    // A row is a line only when it carries a description and some pricing.
    if (!description && amount === null && unitPrice === null) continue;
    if (!description && !(quantity && quantity > 0)) continue;
    if (description && amount === null && unitPrice === null && !(quantity && quantity > 0)) continue;
    const code = get("code");
    const productCode = SAT_CODE.test(code) ? code : String(row.map(cellText).find(cell => SAT_CODE.test(cell)) || "");
    const unitRaw = get("unit").toUpperCase();
    const unit = UNIT_CODE.test(unitRaw) ? unitRaw : unitRaw.slice(0, 20);
    items.push(completeItem({ quantity: quantity ?? 0, unit, productCode, description, unitPrice, amount }));
  }
  return items;
}

function completeItem(item: OcCandidateItem): OcCandidateItem {
  const amount = item.amount ?? (item.unitPrice !== null && item.quantity > 0 ? roundCents(item.quantity * item.unitPrice) : null);
  const unitPrice = item.unitPrice ?? (amount !== null && item.quantity > 0 ? Math.round((amount / item.quantity) * 10000) / 10000 : null);
  return { ...item, amount, unitPrice };
}

const AMOUNT_TOKEN = /^\(?-?\$?\s?\d[\d.,']*\)?$/;
/**
 * Plain-text line items (PDF text, OCR-like text, rows without a header):
 * "<qty> [unit] [sat code] <description> <unit price> <amount>". A line is
 * only accepted when quantity x unit price reconciles with the amount, which
 * filters out addresses, phone numbers and other noise.
 */
export function itemsFromTextLines(lines: string[]): OcCandidateItem[] {
  const items: OcCandidateItem[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/[|¦]/g, " ").replace(/\$\s+/g, "$").replace(/\s+/g, " ").trim();
    if (!line || isTotalsRow([line]) || PAGE_NOISE.test(normalizeOcLabel(line))) continue;
    const tokens = line.split(" ");
    if (tokens.length < 4) continue;
    const amount = AMOUNT_TOKEN.test(tokens[tokens.length - 1]) ? parseLocaleAmount(tokens[tokens.length - 1]) : null;
    const unitPrice = AMOUNT_TOKEN.test(tokens[tokens.length - 2]) ? parseLocaleAmount(tokens[tokens.length - 2]) : null;
    const quantity = /^\d+(?:[.,]\d+)?$/.test(tokens[0]) ? parseLocaleAmount(tokens[0]) : null;
    if (amount === null || unitPrice === null || quantity === null || quantity <= 0) continue;
    if (Math.abs(roundCents(quantity * unitPrice) - amount) > Math.max(0.02, quantity * 0.005)) continue;
    let middle = tokens.slice(1, -2);
    let unit = "", productCode = "";
    for (let i = 0; i < 3 && middle.length > 1; i++) {
      const token = middle[0].toUpperCase();
      if (!productCode && SAT_CODE.test(token)) { productCode = token; middle = middle.slice(1); continue; }
      if (!unit && UNIT_CODE.test(token) && /[A-Z]/.test(token)) { unit = token; middle = middle.slice(1); continue; }
      if (!unit && /^(?:PZA|PZAS|PIEZA|PIEZAS|SERV|SERVICIO|KG|LT|LTS|MTS|M2|M3|HRS|HORA|HORAS|CAJA|JGO|PAQ|EA|UNIDAD)$/.test(token)) { unit = token; middle = middle.slice(1); continue; }
      break;
    }
    const description = middle.join(" ").trim().slice(0, 1000);
    if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(description)) continue;
    items.push({ quantity, unit, productCode, description, unitPrice, amount });
  }
  return items;
}

// ---- Field extraction ------------------------------------------------------

function detectCurrency(text: string): { currency: string; issues: string[] } {
  const upper = normalizeOcLabel(text);
  const found = new Set<string>();
  if (/\bMXN\b|\bMXP\b|\bM N\b|\bPESOS?(?: MEXICANOS?)?\b|\bMONEDA NACIONAL\b/.test(upper)) found.add("MXN");
  if (/\bUSD\b|\bDOLARES\b|\bDLLS?\b|\bUS DOLLARS?\b|US\$/.test(upper) || /US\$/.test(text)) found.add("USD");
  if (/\bEUR\b|\bEUROS?\b/.test(upper)) found.add("EUR");
  if (found.size > 1) return { currency: "", issues: ["CURRENCY_AMBIGUOUS"] };
  if (found.has("USD") || found.has("EUR")) return { currency: [...found][0], issues: ["FOREIGN_CURRENCY"] };
  if (found.has("MXN")) return { currency: "MXN", issues: [] };
  return { currency: "MXN", issues: ["CURRENCY_ASSUMED_MXN"] };
}

function extractFields(rows: string[][], context: OcValidationContext) {
  const fullText = rows.map(row => row.map(cellText).filter(Boolean).join(" ")).join("\n");
  const rfcs = Array.from(new Set((fullText.toUpperCase().match(RFC_PATTERN) || []).map(normalizeRfc)));
  const company = normalizeRfc(context.companyRfc);
  const registered = normalizeRfc(context.registeredClientRfc);
  const labelledRfc = normalizeRfc(findLabelled(rows, /^(?:RFC|R F C)(?: (?:DEL )?CLIENTE| COMPRADOR| RECEPTOR)?$/, v => RFC_ONE.test(v.toUpperCase())).toUpperCase().match(RFC_ONE)?.[0]);
  const clientRfc = (registered && rfcs.includes(registered) ? registered : "")
    || (labelledRfc && labelledRfc !== company ? labelledRfc : "")
    || rfcs.find(rfc => rfc !== company) || "";
  const numberRaw = findLabelled(rows, NUMBER_LABELS, v => /\d/.test(v) && v.length <= 40)
    // Text layers often write the number on the title line: "Orden de Compra No. 4500123".
    || fullText.match(/(?:ORDEN DE COMPRA|PURCHASE ORDER|\bO\.?C\.?|\bP\.?O\.?|FOLIO|PEDIDO)[ \t]*(?:NO\.?|N[°º.]|NUM\.?|N[UÚ]MERO|NUMBER|#)?[ \t]*[:#]?[ \t]*([A-Z0-9-]*\d[A-Z0-9-]*)\b/i)?.[1] || "";
  const number = numberRaw.trim().split(/\s+/)[0].replace(/^(?:NO|N|#)[.:]?/i, "");
  const afterDateLabel = (line: string) => line.replace(/^.*?\b(?:FECHA|DATE)\b[^:\d]*:?/i, "");
  const dateRaw = findLabelled(rows, DATE_LABELS, v => !!parseFlexibleOcDate(v))
    || afterDateLabel(fullText.split("\n").find(line => /\b(?:FECHA|DATE)\b/i.test(line) && !!parseFlexibleOcDate(afterDateLabel(line))) || "");
  const methodRaw = normalizeOcLabel(findLabelled(rows, PAYMENT_METHOD_LABELS));
  const paymentMethod = /\bPPD\b|PARCIALIDADES|DIFERIDO/.test(methodRaw) ? "PPD" : /\bPUE\b|UNA SOLA EXHIBICION/.test(methodRaw) ? "PUE" : "";
  const clientName = findLabelled(rows, CLIENT_NAME_LABELS, v => /[A-Za-z]{2}/.test(v) && !RFC_ONE.test(v.toUpperCase())).slice(0, 200);
  return {
    fullText, rfcs, clientRfc, clientName,
    number: /^[A-Z0-9-]{1,30}$/i.test(number) && /\d/.test(number) ? number : "",
    date: parseFlexibleOcDate(dateRaw), paymentMethod,
  };
}

// ---- Validation ------------------------------------------------------------

/**
 * Cross-checks a candidate from any layer. Derives subtotal/IVA only from the
 * stated figures, never invents a total, and lists every doubt as a reason
 * code. Acceptance requires no blocking issue and enough confidence.
 */
export function validateOcCandidate(input: OcCandidate, context: OcValidationContext, baseIssues: string[] = [], minConfidence = OC_TOLERANT_MIN_CONFIDENCE): { candidate: OcCandidate; issues: string[]; confidence: number; status: OcRecognitionStatus } {
  const issues = [...baseIssues];
  const candidate: OcCandidate = { ...input, items: input.items.map(item => ({ ...item })) };
  const { items } = candidate;
  if (!items.length) issues.push("NO_ITEMS");
  if (items.some(item => !item.description)) issues.push("ITEM_WITHOUT_DESCRIPTION");
  if (items.some(item => item.amount === null || item.unitPrice === null || !(item.quantity > 0))) issues.push("ITEM_WITHOUT_AMOUNT");
  if (items.some(item => item.amount !== null && item.unitPrice !== null && item.quantity > 0 &&
    Math.abs(roundCents(item.quantity * item.unitPrice) - roundCents(item.amount)) > Math.max(0.02, item.quantity * 0.005))) issues.push("ITEM_ARITHMETIC_MISMATCH");
  const linesSum = items.every(item => item.amount !== null) && items.length ? roundCents(items.reduce((sum, item) => sum + (item.amount || 0), 0)) : null;
  const retention = candidate.retention ?? 0;
  if (candidate.retention) issues.push("RETENTION_PRESENT");
  if (candidate.total === null) issues.push("TOTAL_NOT_FOUND");
  else if (!(candidate.total > 0)) issues.push("NON_POSITIVE_TOTAL");
  if (candidate.subtotal === null && linesSum !== null) { candidate.subtotal = linesSum; issues.push("SUBTOTAL_DERIVED"); }
  if (candidate.iva === null && candidate.subtotal !== null && candidate.total !== null) {
    candidate.iva = roundCents(candidate.total - candidate.subtotal + retention); issues.push("IVA_DERIVED");
  }
  if (candidate.subtotal !== null && candidate.iva !== null && candidate.total !== null &&
    Math.abs(roundCents(candidate.subtotal + candidate.iva - retention) - roundCents(candidate.total)) > MONEY_EPSILON) issues.push("TOTALS_INCONSISTENT");
  if (candidate.subtotal !== null && linesSum !== null && Math.abs(linesSum - roundCents(candidate.subtotal)) > Math.max(0.01, items.length * 0.005) + 1e-9) issues.push("LINES_DO_NOT_MATCH_SUBTOTAL");
  if (candidate.subtotal && candidate.iva !== null) {
    const rate = candidate.iva / candidate.subtotal;
    if (![0, 0.08, 0.16].some(expected => Math.abs(rate - expected) <= 0.002 + 0.02 / Math.max(1, candidate.subtotal!))) issues.push("IVA_RATE_UNUSUAL");
  }
  const registered = normalizeRfc(context.registeredClientRfc);
  const company = normalizeRfc(context.companyRfc);
  if (!candidate.clientRfc) issues.push("RFC_NOT_FOUND");
  else if (!isValidRfcShape(candidate.clientRfc)) issues.push("RFC_INVALID_FORMAT");
  const foreignRfcs = candidate.rfcs.filter(rfc => rfc !== company);
  if (registered && foreignRfcs.length && !foreignRfcs.includes(registered)) issues.push("CLIENT_RFC_MISMATCH");
  const solicitudTotal = Number(context.solicitudTotal);
  if (!(Number.isFinite(solicitudTotal) && solicitudTotal > 0)) issues.push("SOLICITUD_TOTAL_UNKNOWN");
  else if (candidate.total !== null && Math.abs(roundCents(candidate.total) - roundCents(solicitudTotal)) > MONEY_EPSILON) issues.push("TOTAL_DIFFERS_FROM_SOLICITUD");
  if (!candidate.number) issues.push("OC_NUMBER_NOT_FOUND");
  if (!candidate.date) issues.push("DATE_NOT_FOUND");
  const unique = Array.from(new Set(issues));
  const blocking = unique.some(issue => OC_BLOCKING_ISSUES.has(issue));
  const confidence = Math.max(0, Math.round((1 - unique.reduce((sum, issue) => sum + (OC_BLOCKING_ISSUES.has(issue) ? 0.3 : PENALTIES[issue] || 0), 0)) * 100) / 100);
  const unreadable = !items.length && candidate.total === null;
  const status: OcRecognitionStatus = unreadable ? "UNREADABLE" : !blocking && confidence >= minConfidence ? "ACCEPTED" : "REVIEW_REQUIRED";
  return { candidate, issues: unique, confidence, status };
}

// ---- Entry points ----------------------------------------------------------

/** Tolerant recognition over grid rows (XLSX sheets or CSV). */
export function recognizeOcFromRows(rows: string[][], format: OcSourceFormat, context: OcValidationContext = {}): OcRecognitionResult {
  const clean = rows.map(row => (row || []).map(cellText)).filter(row => row.some(Boolean));
  const header = detectHeader(clean);
  const baseIssues: string[] = [];
  let items = header ? itemsFromGrid(clean, header) : [];
  if (!header || !items.length) {
    const textItems = itemsFromTextLines(clean.map(row => row.filter(Boolean).join(" ")));
    if (textItems.length) { items = textItems; baseIssues.push("TEXT_LINE_ITEMS"); }
    if (!header) baseIssues.push("TABLE_HEADER_NOT_FOUND");
  }
  return finish(clean, items, format, "TOLERANT", context, baseIssues);
}

/** Tolerant recognition over free text (PDF text layer, pasted or OCR-like text). */
export function recognizeOcFromText(text: string, format: OcSourceFormat, context: OcValidationContext = {}): OcRecognitionResult {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map(line => line.replace(/\t/g, "  ").trim()).filter(Boolean);
  // Columns in text layers are separated by runs of spaces, tabs or pipes.
  const rows = lines.map(line => line.split(/\s{2,}|\s*\|\s*/).map(cellText).filter(Boolean));
  const header = detectHeader(rows);
  let items = header ? itemsFromGrid(rows, header).filter(item => item.amount !== null && item.description) : [];
  const baseIssues: string[] = [];
  if (!items.length || items.some(item => item.amount === null)) {
    items = itemsFromTextLines(lines);
    baseIssues.push("TEXT_LINE_ITEMS");
  }
  if (!header) baseIssues.push("TABLE_HEADER_NOT_FOUND");
  // Labels and values in text often share a line: "Subtotal: $1,000.00".
  const labelRows = lines.map(line => {
    const inline = line.match(/^(.*?[A-Za-zÁÉÍÓÚÑáéíóúñ.%)])\s*[:=]?\s*(\(?-?\$?\s?\d[\d.,' ]*\)?(?:\s?(?:MXN|M\.N\.|USD))?)$/);
    return inline ? [inline[1], inline[2]] : line.split(/\s{2,}|\s*\|\s*|:\s+/).map(cellText).filter(Boolean);
  });
  return finish([...rows, ...labelRows], items, format, "TOLERANT", context, baseIssues);
}

function finish(rows: string[][], items: OcCandidateItem[], format: OcSourceFormat, layer: OcRecognitionLayer, context: OcValidationContext, baseIssues: string[]): OcRecognitionResult {
  const fields = extractFields(rows, context);
  // Header rows carry "Total"/"Subtotal" as column names; they are never totals.
  const totalsRows = rows.filter(row => row.filter(cell => headerRole(cell)).length < 2 && !NOT_A_MONEY_TOTAL.test(normalizeOcLabel(row[0])));
  const currency = detectCurrency(fields.fullText);
  const candidate: OcCandidate = {
    items,
    subtotal: findLabelledAmount(totalsRows, SUBTOTAL_LABEL),
    iva: findLabelledAmount(totalsRows, IVA_LABEL),
    retention: (() => { const value = findLabelledAmount(totalsRows, RETENTION_LABEL); return value === null ? null : Math.abs(value); })(),
    total: findLabelledAmount(totalsRows, TOTAL_LABEL),
    currency: currency.currency, clientName: fields.clientName, clientRfc: fields.clientRfc, rfcs: fields.rfcs,
    number: fields.number, date: fields.date, paymentMethod: fields.paymentMethod,
  };
  const validated = validateOcCandidate(candidate, context, [...baseIssues, ...currency.issues]);
  return { status: validated.status, layer, format, confidence: validated.confidence, issues: validated.issues, candidate: validated.candidate };
}

/** Minimal RFC 4180 CSV/TSV reader (quoted fields, embedded delimiters and newlines). */
export function parseDelimitedText(text: string): string[][] {
  const source = String(text || "").replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = [";", "\t", ",", "|"].map(d => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
    if (rows.length > 10_000) break;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** True when the bytes look like text a person could have typed (CSV/TXT), not binary. */
export function decodeTextDocument(buffer: Buffer): string | null {
  if (!buffer.length) return null;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { text = buffer.toString("latin1"); }
  const sample = text.slice(0, 20_000);
  const control = (sample.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g) || []).length;
  return control > sample.length * 0.01 ? null : text;
}

/** Converts an accepted candidate into the shape stored by the upload flow. */
export function candidateToCommercialMetadata(candidate: OcCandidate) {
  const first = candidate.items.find(item => item.productCode && item.unit) || candidate.items[0];
  return {
    productCode: first?.productCode || "", unitCode: first?.unit || "", description: first?.description || "", quantity: first?.quantity || 1,
    clientName: candidate.clientName, clientRfc: candidate.clientRfc, clientAddress: "",
    cfdiUse: "", fiscalRegime: "", postalCode: "", paymentMethod: candidate.paymentMethod, paymentForm: "",
    currency: candidate.currency, deliveryLocation: "",
    items: candidate.items.map(item => ({ ...item, amount: item.amount === null ? null : roundCents(item.amount) })),
    subtotal: candidate.subtotal ?? undefined, iva: candidate.iva ?? undefined, total: candidate.total ?? undefined,
    date: candidate.date, number: candidate.number,
  };
}

/** Log line: reason codes and counts only, never names, RFCs or amounts. */
export function recognitionLogEntry(result: OcRecognitionResult) {
  return { status: result.status, layer: result.layer, format: result.format, confidence: result.confidence, issues: result.issues, items: result.candidate?.items.length ?? 0 };
}

/** Review record stored on the solicitud: reason codes and figures, no names or RFCs. */
export function recognitionSummary(result: OcRecognitionResult) {
  return {
    status: result.status, layer: result.layer, format: result.format, confidence: result.confidence, issues: result.issues,
    items: result.candidate?.items.length ?? 0,
    subtotal: result.candidate?.subtotal ?? null, iva: result.candidate?.iva ?? null, total: result.candidate?.total ?? null,
  };
}
