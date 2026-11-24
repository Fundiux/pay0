import {
  normalizeOrdenCompraSheetKey,
  resolveOrdenCompraTotalsFromSheets,
  type ResolvedOrdenCompraTotal,
} from "./ordenCompraTotalResolver"; // H4_D83_A1_SEMANTIC_TOTAL_IMPORT
import { readSpreadsheetFile, type SpreadsheetSheet } from "./spreadsheetReader";
export type OrdenCompraTipoFactura = "PUE" | "PPD" | "";

export interface ParsedOrdenCompra {
  ok: boolean;
  sourceFileName: string;
  sheetName: string;
  clienteNombre: string;
  proveedorNombre: string;
  rfc: string;
  metodoPago: string;
  tipoFactura: OrdenCompraTipoFactura;
  moneda: string;
  formaPago: string;
  usoCfdi: string;
  subtotal: number;
  iva: number;
  total: number;
  montoSolicitud: number;
  conceptoPrincipal: string;
  referencia: string;
  operationTypeName: "Factura subtotal";
  warnings: string[];
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }

  const raw = String(value || "").trim();
  if (!raw) return 0;

  const clean = raw.replace(/[^0-9,.-]/g, "");
  if (!clean) return 0;

  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");

  const normalized =
    comma > dot
      ? clean.replace(/\./g, "").replace(",", ".")
      : clean.replace(/,/g, "");

  const n = Number(normalized);
  if (!Number.isFinite(n)) return 0;

  return Math.round(n * 100) / 100;
}

function cellValue(sheet: any, address: string) {
  if (typeof sheet?.cell === "function") return sheet.cell(address);
  const cell = sheet?.[address];
  if (!cell) return "";
  return cell.v ?? cell.w ?? "";
}

function findValueByLabel(rows: any[][], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeText);

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    for (let index = 0; index < row.length; index++) {
      const key = normalizeText(row[index]);
      if (!key) continue;

      const matched = normalizedAliases.some((alias) => key === alias || key.includes(alias));
      if (!matched) continue;

      for (let next = index + 1; next < row.length; next++) {
        const value = row[next];
        if (cleanText(value)) return value;
      }
    }
  }

  return "";
}

function normalizeLabel(value: unknown) {
  return normalizeText(value)
    .replace(/[:：]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findNumberRightOfLabel(rows: any[][], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeLabel);

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    for (let index = 0; index < row.length; index++) {
      const key = normalizeLabel(row[index]);
      if (!key) continue;

      const matched = normalizedAliases.some((alias) => key === alias);
      if (!matched) continue;

      for (let next = row.length - 1; next > index; next--) {
        const amount = toNumber(row[next]);
        if (amount > 0) return amount;
      }
    }
  }

  return 0;
}

function detectTipoFactura(metodoPago: string): OrdenCompraTipoFactura {
  const value = normalizeText(metodoPago);

  if (value.includes("ppd") || value.includes("parcialidades") || value.includes("diferido")) {
    return "PPD";
  }

  if (value.includes("pue") || value.includes("una sola exhibicion")) {
    return "PUE";
  }

  return "";
}

function parseSingleSheet(params: {
  sourceFileName: string;
  sheetName: string;
  sheet: any;
  rows: any[][];
}): ParsedOrdenCompra {
  const { sourceFileName, sheetName, sheet, rows } = params;
  const isNewIqLayout =
    normalizeText(cellValue(sheet, "A1")) === "orden de compra" &&
    normalizeText(cellValue(sheet, "A3")).replace(/[\s:]/g, "") === "proveedor" &&
    normalizeText(cellValue(sheet, "A6")).replace(/[\s:]/g, "") === "cliente" &&
    normalizeText(cellValue(sheet, "M9")) === "metodo de pago";

  const proveedorNombre = isNewIqLayout ? cleanText(cellValue(sheet, "C4")) :
    cleanText(cellValue(sheet, "D4")) ||
    cleanText(findValueByLabel(rows, ["proveedor", "proveedor:", "empresa proveedor"]));

  const clienteNombre = isNewIqLayout ? cleanText(cellValue(sheet, "C7")) :
    cleanText(cellValue(sheet, "D8")) ||
    cleanText(findValueByLabel(rows, ["razon social", "razon social:", "cliente", "nombre cliente"]));

  const rfc = isNewIqLayout ? cleanText(cellValue(sheet, "K7")) :
    cleanText(cellValue(sheet, "D9")) ||
    cleanText(findValueByLabel(rows, ["rfc", "rfc:"]));

  const metodoPago = isNewIqLayout ? cleanText(cellValue(sheet, "N9")) :
    cleanText(cellValue(sheet, "D17")) ||
    cleanText(findValueByLabel(rows, ["metodo de pago", "metodo pago"]));

  const moneda = isNewIqLayout ? cleanText(cellValue(sheet, "N27")) :
    cleanText(cellValue(sheet, "D18")) ||
    cleanText(findValueByLabel(rows, ["moneda"]));

  const formaPago = isNewIqLayout ? cleanText(cellValue(sheet, "N10")) :
    cleanText(cellValue(sheet, "D19")) ||
    cleanText(findValueByLabel(rows, ["forma de pago", "forma pago"]));

  const usoCfdi = isNewIqLayout ? cleanText(cellValue(sheet, "N8")) :
    cleanText(cellValue(sheet, "D20")) ||
    cleanText(findValueByLabel(rows, ["uso de cfdi", "uso cfdi"]));

  const conceptoPrincipal = isNewIqLayout ? cleanText(cellValue(sheet, "H13")) :
    cleanText(cellValue(sheet, "E23")) ||
    cleanText(findValueByLabel(rows, ["concepto", "descripcion", "servicio"]));

  // Los importes se resuelven por estructura semántica, no por coordenadas.
  // El resolver posterior busca TOTAL/SUBTOTAL/IVA y sus valores cercanos,
  // incluyendo celdas con fórmulas. Estas búsquedas solo mantienen datos
  // preliminares para el preview si el resolver aún no ha terminado.
  const subtotal = findNumberRightOfLabel(rows, ["subtotal", "sub total", "sub-total"]);
  const iva = findNumberRightOfLabel(rows, ["iva", "iva 16", "impuesto", "impuestos"]);
  const total = findNumberRightOfLabel(rows, ["total", "total factura", "total oc", "total a pagar", "gran total", "importe total"]);

  const tipoFactura = detectTipoFactura(metodoPago);

  const warnings: string[] = [];

  if (!clienteNombre) warnings.push("Cliente no detectado.");
  if (!proveedorNombre) warnings.push("Proveedor/empresa no detectado.");
  if (!total) warnings.push("Total no detectado.");
  if (!tipoFactura) warnings.push("Tipo factura PUE/PPD no detectado.");

  return {
    ok: warnings.length === 0,
    sourceFileName,
    sheetName,
    clienteNombre,
    proveedorNombre,
    rfc,
    metodoPago,
    tipoFactura,
    moneda,
    formaPago,
    usoCfdi,
    subtotal,
    iva,
    total,
    montoSolicitud: total,
    conceptoPrincipal,
    referencia: [sourceFileName, rfc ? `RFC ${rfc}` : "", total ? `Total OC ${total}` : ""]
      .filter(Boolean)
      .join(" | "),
    operationTypeName: "Factura subtotal",
    warnings,
  };
}

function parseOrdenCompraWorkbookFileLegacyH4D83A1(file: File, sheets: SpreadsheetSheet[]): ParsedOrdenCompra[] {

  const results: ParsedOrdenCompra[] = [];

  for (const sheet of sheets) {
    const sheetName = sheet.name;
    const rows = sheet.rows;

    const parsed = parseSingleSheet({
      sourceFileName: file.name,
      sheetName,
      sheet,
      rows,
    });

    if (
      parsed.clienteNombre ||
      parsed.proveedorNombre ||
      parsed.total ||
      parsed.subtotal ||
      parsed.conceptoPrincipal
    ) {
      results.push(parsed);
    }
  }

  return results;
}

export async function parseOrdenCompraFile(file: File): Promise<ParsedOrdenCompra> {
  const parsedSheets = await parseOrdenCompraWorkbookFile(file);

  if (parsedSheets.length === 0) {
    return {
      ok: false,
      sourceFileName: file.name,
      sheetName: "",
      clienteNombre: "",
      proveedorNombre: "",
      rfc: "",
      metodoPago: "",
      tipoFactura: "",
      moneda: "",
      formaPago: "",
      usoCfdi: "",
      subtotal: 0,
      iva: 0,
      total: 0,
      montoSolicitud: 0,
      conceptoPrincipal: "",
      referencia: file.name,
      operationTypeName: "Factura subtotal",
      warnings: ["No se pudo leer la Orden de Compra."],
    };
  }

  return parsedSheets[0];
}

// H4_D83_A1_SEMANTIC_TOTAL_WRAPPER_BEGIN
function semanticTotalFailureH4D83A1(
  parsed: ParsedOrdenCompra,
  error: string,
): ParsedOrdenCompra {
  const warnings = Array.from(
    new Set([
      ...(Array.isArray(parsed.warnings) ? parsed.warnings : []),
      error ||
        "No se pudo identificar de manera segura el total de la Orden de Compra.",
    ].filter(Boolean)),
  );

  return {
    ...parsed,
    ok: false,
    total: 0,
    montoSolicitud: 0,
    warnings,
  };
}

function applySemanticTotalH4D83A1(
  parsed: ParsedOrdenCompra,
  semanticBySheet: Map<string, ResolvedOrdenCompraTotal>,
  resolverError = "",
): ParsedOrdenCompra {
  const key = normalizeOrdenCompraSheetKey(parsed.sheetName);
  const onlyResult =
    semanticBySheet.size === 1
      ? Array.from(semanticBySheet.values())[0]
      : null;
  const semantic =
    semanticBySheet.get(key) ||
    onlyResult;

  if (!semantic || semantic.ok !== true || semantic.total <= 0) {
    return semanticTotalFailureH4D83A1(
      parsed,
      resolverError ||
        semantic?.error ||
        "No se pudo identificar de manera segura el total de la Orden de Compra.",
    );
  }

  const warnings = (Array.isArray(parsed.warnings)
    ? parsed.warnings
    : []
  ).filter(
    (warning) =>
      !/total.{0,40}(?:no detectado|sin detectar|no encontrado)/i.test(
        String(warning || ""),
      ),
  );

  return {
    ...parsed,
    subtotal:
      semantic.subtotal ??
      Number(parsed.subtotal || 0),
    iva:
      semantic.iva ??
      Number(parsed.iva || 0),
    total: semantic.total,
    montoSolicitud: semantic.total,
    ok: warnings.length === 0,
    warnings,
  };
}

export async function parseOrdenCompraWorkbookFile(
  file: File,
): Promise<ParsedOrdenCompra[]> {
  const sheets = await readSpreadsheetFile(file, { visibleOnly: true });
  const parsedLegacy = parseOrdenCompraWorkbookFileLegacyH4D83A1(file, sheets);

  let semanticBySheet =
    new Map<string, ResolvedOrdenCompraTotal>();
  let resolverError = "";

  try {
    semanticBySheet = resolveOrdenCompraTotalsFromSheets(sheets);
  } catch (error) {
    resolverError =
      error instanceof Error
        ? error.message
        : String(error);
  }

  return parsedLegacy.map((parsed) =>
    applySemanticTotalH4D83A1(
      parsed,
      semanticBySheet,
      resolverError,
    ),
  );
}
// H4_D83_A1_SEMANTIC_TOTAL_WRAPPER_END
