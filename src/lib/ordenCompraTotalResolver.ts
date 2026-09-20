import { readSpreadsheetFile } from "./spreadsheetReader";

export type OrdenCompraTotalConfidence = "ALTA" | "MEDIA" | "NINGUNA";

export type ResolvedOrdenCompraTotal = {
  ok: boolean;
  sheetName: string;
  total: number;
  subtotal: number | null;
  iva: number | null;
  arithmeticExpected: number | null;
  arithmeticDelta: number | null;
  arithmeticValid: boolean;
  confidence: OrdenCompraTotalConfidence;
  label: string;
  labelCell: string;
  valueCell: string;
  error: string;
};

type AmountHit = {
  amount: number;
  rowIndex: number;
  columnIndex: number;
  distance: number;
};

type LabelHit = {
  kind: "TOTAL" | "SUBTOTAL" | "TAX" | "DISCOUNT" | "RETENTION";
  label: string;
  labelCell: string;
  rowIndex: number;
  columnIndex: number;
  amount: number;
  valueCell: string;
  amountRowIndex: number;
  amountColumnIndex: number;
  distance: number;
  priority: number;
};

const TOTAL_LABEL_PRIORITY = new Map<string, number>([
  ["TOTAL A PAGAR", 140],
  ["GRAN TOTAL", 135],
  ["TOTAL GENERAL", 132],
  ["IMPORTE TOTAL", 130],
  ["MONTO TOTAL", 128],
  ["TOTAL NETO", 125],
  ["TOTAL", 120],
]);

const FORBIDDEN_TOTAL_LABELS = [
  /^SUB TOTAL$/,
  /^SUBTOTAL$/,
  /^TOTAL EN LETRA(?:S)?$/,
  /^TOTAL DE PARTIDAS$/,
  /^TOTAL PARTIDAS$/,
  /^TOTAL DE CONCEPTOS$/,
  /^TOTAL CONCEPTOS$/,
  /^TOTAL IVA$/,
  /^IVA TOTAL$/,
];

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLabel(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[$:;,.()[\]{}%_\/-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bI V A\b/g, "IVA")
    .trim();
}

export function normalizeOrdenCompraSheetKey(value: unknown) {
  return normalizeLabel(value);
}

function parseMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return roundMoney(value);
  }

  if (value instanceof Date) return null;

  if (value && typeof value === "object" && "v" in value) {
    return parseMoney((value as { v?: unknown }).v);
  }

  let text = cleanText(value);
  if (!text) return null;

  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);

  text = text
    .replace(/[()]/g, "")
    .replace(/\$/g, "")
    .replace(/\bMXN\b/gi, "")
    .replace(/\bM\.?N\.?\b/gi, "")
    .replace(/\s/g, "");

  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, "");
  } else if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    // Número normal.
  } else if (/^-?\d+(?:,\d+)?$/.test(text)) {
    text = text.replace(",", ".");
  } else {
    const embedded = text.match(/-?\d[\d,]*(?:\.\d+)?/);
    if (!embedded) return null;
    text = embedded[0].replace(/,/g, "");
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;

  const signed = negative && parsed > 0 ? -parsed : parsed;
  return roundMoney(signed);
}

function columnNumber(column: string) {
  return [...column.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}
function columnName(index: number) { let n = index + 1; let out = ""; while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; }

function evaluateFormula(formula: string, rows: unknown[][], stack = new Set<string>()): number | null {
  let expression = String(formula || "").trim().replace(/^=/, "").replace(/^\+/, "");
  const ref = (address: string): number => {
    const match = /^([A-Z]+)(\d+)$/i.exec(address.trim()); if (!match) return 0;
    const key = match[0].toUpperCase(); if (stack.has(key)) return 0; const next = new Set(stack); next.add(key);
    const raw: any = rows[Number(match[2]) - 1]?.[columnNumber(match[1])];
    if (raw && typeof raw === "object" && raw.formula) return evaluateFormula(raw.formula, rows, next) || 0;
    return parseMoney(raw) || 0;
  };
  expression = expression.replace(/SUM\(\s*([A-Z]+\d+)\s*:\s*([A-Z]+\d+)\s*\)/gi, (_m, start, end) => {
    const a = /^([A-Z]+)(\d+)$/i.exec(start); const b = /^([A-Z]+)(\d+)$/i.exec(end); if (!a || !b) return "0";
    let sum = 0; for (let row = Number(a[2]); row <= Number(b[2]); row += 1) for (let col = columnNumber(a[1]); col <= columnNumber(b[1]); col += 1) sum += ref(`${columnName(col)}${row}`); return String(sum);
  });
  expression = expression.replace(/([A-Z]+\d+)/gi, (_m, address) => String(ref(address)));
  if (!/^[\d\s+*/().-]+$/.test(expression)) return null;
  try { const value = Function(`"use strict"; return (${expression})`)(); return Number.isFinite(value) ? roundMoney(value) : null; } catch { return null; }
}

function evaluateRows(rows: unknown[][]) {
  return rows.map((row) => row.map((value) => value && typeof value === "object" && "formula" in value ? evaluateFormula(String((value as any).formula), rows) ?? value : value));
}

function formulaComponents(rows: unknown[][], total: LabelHit) {
  let subtotal: number | null = null;
  let iva: number | null = null;
  let totalFromFormula: number | null = null;
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c += 1) {
      const value: any = row[c];
      if (!value || typeof value !== "object" || !value.formula) continue;
      const formula = String(value.formula).toUpperCase().replace(/\s+/g, "");
      const calculated = evaluateFormula(String(value.formula), rows);
      if (calculated === null) continue;
      if (/^=?\+?SUM\([A-Z]+\d+:[A-Z]+\d+\)$/.test(formula)) subtotal = calculated;
      else if (/\*0\.16(?:$|[+\-*/)])/.test(formula)) iva = calculated;
      else if (/^=?\+?[A-Z]+\d+(?:\+[A-Z]+\d+)+$/.test(formula) && r <= total.amountRowIndex + 2) totalFromFormula = calculated;
    }
  }
  return { subtotal, iva, totalFromFormula };
}

function cellAddress(rowIndex: number, columnIndex: number) {
  let column = columnIndex + 1;
  let label = "";
  while (column > 0) {
    const remainder = (column - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    column = Math.floor((column - 1) / 26);
  }
  return `${label}${rowIndex + 1}`;
}

function classifyLabel(label: string): LabelHit["kind"] | null {
  if (/^SUB TOTAL$|^SUBTOTAL$/.test(label)) return "SUBTOTAL";

  if (
    /^IVA(?: \d+(?: \d+)?)?$/.test(label) ||
    /^IMPUESTO(?:S)?$/.test(label)
  ) {
    return "TAX";
  }

  if (/^DESCUENTO(?:S)?(?: .*)?$/.test(label)) return "DISCOUNT";

  if (
    /^RETENCION(?:ES)?(?: .*)?$/.test(label) ||
    /^(?:IVA|ISR) RETENIDO(?: .*)?$/.test(label)
  ) {
    return "RETENTION";
  }

  if (FORBIDDEN_TOTAL_LABELS.some((regex) => regex.test(label))) {
    return null;
  }

  return TOTAL_LABEL_PRIORITY.has(label) ? "TOTAL" : null;
}

function findAmountsNear(
  rows: unknown[][],
  rowIndex: number,
  columnIndex: number,
): AmountHit[] {
  const hits: AmountHit[] = [];
  const row = rows[rowIndex] || [];

  const sameCellText = cleanText(row[columnIndex]);
  const embedded =
    sameCellText.match(
      /(?:\$|:\s*)(-?\d[\d,]*(?:\.\d+)?)\s*$/,
    ) ||
    sameCellText.match(
      /\b(?:TOTAL|SUBTOTAL)\s+(-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|-?\d+\.\d{1,2})\s*$/i,
    );

  if (embedded) {
    const amount = parseMoney(embedded[1]);
    if (amount !== null) {
      hits.push({
        amount,
        rowIndex,
        columnIndex,
        distance: 0,
      });
    }
  }

  for (let offset = 1; offset <= 10; offset += 1) {
    const amount = parseMoney(row[columnIndex + offset]);
    if (amount === null) continue;

    hits.push({
      amount,
      rowIndex,
      columnIndex: columnIndex + offset,
      distance: offset,
    });
  }

  for (let rowOffset = 1; rowOffset <= 2; rowOffset += 1) {
    const nearbyRow = rows[rowIndex + rowOffset] || [];

    for (let columnOffset = 0; columnOffset <= 4; columnOffset += 1) {
      const amount = parseMoney(nearbyRow[columnIndex + columnOffset]);
      if (amount === null) continue;

      hits.push({
        amount,
        rowIndex: rowIndex + rowOffset,
        columnIndex: columnIndex + columnOffset,
        distance: 20 + rowOffset * 5 + columnOffset,
      });
    }
  }

  return hits.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.columnIndex - right.columnIndex,
  );
}

function scanLabels(rows: unknown[][]): LabelHit[] {
  const hits: LabelHit[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const raw = row[columnIndex];

      if (typeof raw !== "string" && typeof raw !== "number") continue;

      const label = normalizeLabel(raw);
      if (!label) continue;

      const kind = classifyLabel(label);
      if (!kind) continue;

      const amounts = findAmountsNear(rows, rowIndex, columnIndex);
      const selected = amounts.find((item) => item.amount >= 0);
      if (!selected) continue;

      hits.push({
        kind,
        label,
        labelCell: cellAddress(rowIndex, columnIndex),
        rowIndex,
        columnIndex,
        amount: selected.amount,
        valueCell: cellAddress(selected.rowIndex, selected.columnIndex),
        amountRowIndex: selected.rowIndex,
        amountColumnIndex: selected.columnIndex,
        distance: selected.distance,
        priority:
          kind === "TOTAL"
            ? TOTAL_LABEL_PRIORITY.get(label) || 0
            : 0,
      });
    }
  }

  return hits;
}

function fallbackFromLineItems(sheetName: string, rows: unknown[][]): ResolvedOrdenCompraTotal | null {
  const headerTerms = /^(IMPORTE|IMPORTE TOTAL|PRECIO|PRECIO UNITARIO|VALOR|SUBTOTAL)$/;
  let bestColumn = -1;
  let bestValues: number[] = [];
  for (let c = 0; c < Math.max(...rows.map((row) => row?.length || 0), 0); c += 1) {
    const hasHeader = rows.slice(0, 15).some((row) => headerTerms.test(normalizeLabel(row?.[c])));
    if (!hasHeader) continue;
    const values = rows.slice(1).map((row) => parseMoney(row?.[c])).filter((value): value is number => value !== null && value > 0);
    if (values.length > bestValues.length) { bestColumn = c; bestValues = values; }
  }
  if (bestColumn < 0 || bestValues.length === 0) return null;
  const subtotal = roundMoney(bestValues.reduce((sum, value) => sum + value, 0));
  const iva = roundMoney(subtotal * 0.16);
  const total = roundMoney(subtotal + iva);
  console.info("[OC_XLSX_TOTAL_DIAGNOSTIC] line-item fallback", { sheetName, amountColumn: columnName(bestColumn), subtotal, iva, total });
  return { ok: true, sheetName, total, subtotal, iva, arithmeticExpected: total, arithmeticDelta: 0, arithmeticValid: true, confidence: "MEDIA", label: "TOTAL (FALLBACK PARTIDAS)", labelCell: "", valueCell: "", error: "" };
}

function componentContext(total: LabelHit, allHits: LabelHit[]) {
  const components = allHits.filter((hit) => {
    if (hit.kind === "TOTAL") return false;

    const rowDelta = total.rowIndex - hit.rowIndex;
    const columnDelta = Math.abs(
      total.amountColumnIndex - hit.amountColumnIndex,
    );

    return rowDelta >= -2 && rowDelta <= 12 && columnDelta <= 8;
  });

  const subtotalCandidates = components
    .filter((hit) => hit.kind === "SUBTOTAL")
    .sort(
      (left, right) =>
        Math.abs(total.rowIndex - left.rowIndex) -
          Math.abs(total.rowIndex - right.rowIndex) ||
        left.distance - right.distance,
    );

  const subtotal = subtotalCandidates[0] || null;

  const dedupe = new Map<string, LabelHit>();

  for (const hit of components) {
    if (hit.kind === "SUBTOTAL") continue;
    dedupe.set(`${hit.kind}:${hit.labelCell}`, hit);
  }

  const other = [...dedupe.values()];
  const taxes = other
    .filter((hit) => hit.kind === "TAX")
    .reduce((sum, hit) => sum + hit.amount, 0);
  const discounts = other
    .filter((hit) => hit.kind === "DISCOUNT")
    .reduce((sum, hit) => sum + hit.amount, 0);
  const retentions = other
    .filter((hit) => hit.kind === "RETENTION")
    .reduce((sum, hit) => sum + hit.amount, 0);

  const arithmeticExpected = subtotal
    ? roundMoney(subtotal.amount + taxes - discounts - retentions)
    : null;

  const arithmeticDelta =
    arithmeticExpected === null
      ? null
      : roundMoney(Math.abs(total.amount - arithmeticExpected));

  return {
    subtotal,
    taxes: roundMoney(taxes),
    discounts: roundMoney(discounts),
    retentions: roundMoney(retentions),
    arithmeticExpected,
    arithmeticDelta,
    arithmeticValid:
      arithmeticDelta !== null && arithmeticDelta <= 0.01,
  };
}

function resolveSheet(sheetName: string, rows: unknown[][]): ResolvedOrdenCompraTotal {
  const evaluatedRows = evaluateRows(rows);
  const allHits = scanLabels(evaluatedRows);
  console.info("[OC_XLSX_TOTAL_DIAGNOSTIC]", { sheetName, formulaCells: rows.flat().filter((v: any) => v && typeof v === "object" && v.formula).length });
  const totals = allHits.filter((hit) => hit.kind === "TOTAL");

  if (totals.length === 0) {
    const lineItemFallback = fallbackFromLineItems(sheetName, rows);
    if (lineItemFallback) return lineItemFallback;
    return {
      ok: false,
      sheetName,
      total: 0,
      subtotal: null,
      iva: null,
      arithmeticExpected: null,
      arithmeticDelta: null,
      arithmeticValid: false,
      confidence: "NINGUNA",
      label: "",
      labelCell: "",
      valueCell: "",
      error:
        "No se encontró una etiqueta exacta de total autorizada. SUBTOTAL no se usa como respaldo.",
    };
  }

  console.info("[OC_XLSX_TOTAL_DIAGNOSTIC] total candidates", totals.map((hit) => ({ labelCell: hit.labelCell, valueCell: hit.valueCell, raw: rows[hit.amountRowIndex]?.[hit.amountColumnIndex], formula: (rows[hit.amountRowIndex]?.[hit.amountColumnIndex] as any)?.formula || null, calculated: hit.amount })));

  const evaluated = totals.map((total) => {
    const context = componentContext(total, allHits);
    const hasSubtotal = context.subtotal !== null;

    return {
      total,
      context,
      acceptable: hasSubtotal ? context.arithmeticValid : true,
      score:
        total.priority +
        (context.arithmeticValid ? 100 : 0) -
        Math.min(total.distance, 30),
    };
  });

  const acceptable = evaluated
    .filter((item) => item.acceptable)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.total.distance - right.total.distance ||
        left.total.labelCell.localeCompare(right.total.labelCell),
    );

  if (acceptable.length === 0) {
    return {
      ok: false,
      sheetName,
      total: 0,
      subtotal: null,
      iva: null,
      arithmeticExpected: null,
      arithmeticDelta: null,
      arithmeticValid: false,
      confidence: "NINGUNA",
      label: "",
      labelCell: "",
      valueCell: "",
      error:
        "La etiqueta TOTAL existe, pero no coincide con SUBTOTAL + impuestos - descuentos - retenciones.",
    };
  }

  const best = acceptable[0];
  const bestHasArithmetic = best.context.arithmeticExpected !== null;
  const formulas = formulaComponents(rows, best.total);
  const fallbackSubtotal = best.context.subtotal?.amount ?? formulas.subtotal;
  const fallbackIva = best.context.taxes > 0 ? best.context.taxes : formulas.iva;
  const fallbackTotal = formulas.totalFromFormula ?? best.total.amount;
  console.info("[OC_XLSX_TOTAL_DIAGNOSTIC] resolved", {
    sheetName,
    totalLabelCell: best.total.labelCell,
    totalValueCell: best.total.valueCell,
    rawValue: rows[best.total.amountRowIndex]?.[best.total.amountColumnIndex],
    formula: (rows[best.total.amountRowIndex]?.[best.total.amountColumnIndex] as any)?.formula || null,
    calculatedValue: best.total.amount,
    fallbackSubtotal,
    fallbackIva,
    fallbackTotal,
  });

  const comparable = acceptable.filter(
    (item) =>
      item !== best &&
      Math.abs(item.score - best.score) <= 5 &&
      Math.abs(item.total.amount - best.total.amount) > 0.01,
  );

  if (comparable.length > 0) {
    return {
      ok: false,
      sheetName,
      total: 0,
      subtotal: null,
      iva: null,
      arithmeticExpected: null,
      arithmeticDelta: null,
      arithmeticValid: false,
      confidence: "NINGUNA",
      label: "",
      labelCell: "",
      valueCell: "",
      error:
        "Se encontraron totales distintos con confianza equivalente; se bloqueó la creación.",
    };
  }

  if (!bestHasArithmetic) {
    const distinctExactTotals = new Set(
      acceptable.map((item) => item.total.amount.toFixed(2)),
    );

    if (distinctExactTotals.size > 1) {
      return {
        ok: false,
        sheetName,
        total: 0,
        subtotal: null,
        iva: null,
        arithmeticExpected: null,
        arithmeticDelta: null,
        arithmeticValid: false,
        confidence: "NINGUNA",
        label: "",
        labelCell: "",
        valueCell: "",
        error:
          "Hay más de un importe TOTAL y no existe subtotal para validarlos.",
      };
    }
  }

  return {
    ok: true,
    sheetName,
    total: roundMoney(fallbackTotal),
    subtotal: fallbackSubtotal === null || fallbackSubtotal === undefined ? null : roundMoney(fallbackSubtotal),
    iva: fallbackIva === null || fallbackIva === undefined ? null : roundMoney(fallbackIva),
    arithmeticExpected: best.context.arithmeticExpected,
    arithmeticDelta: best.context.arithmeticDelta,
    arithmeticValid: best.context.arithmeticValid,
    confidence: best.context.arithmeticValid ? "ALTA" : "MEDIA",
    label: best.total.label,
    labelCell: best.total.labelCell,
    valueCell: best.total.valueCell,
    error: "",
  };
}

export async function resolveOrdenCompraTotalsFromFile(
  file: File,
): Promise<Map<string, ResolvedOrdenCompraTotal>> {
  const sheets = await readSpreadsheetFile(file);
  console.info("[OC_XLSX_TOTAL_FILE]", { fileName: file.name, sheets: sheets.map((sheet) => sheet.name) });

  const result = new Map<string, ResolvedOrdenCompraTotal>();

  for (const sheet of sheets) {
    result.set(
      normalizeOrdenCompraSheetKey(sheet.name),
      resolveSheet(sheet.name, sheet.rows),
    );
  }

  return result;
}
