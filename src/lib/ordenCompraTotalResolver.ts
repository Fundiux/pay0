import * as XLSX from "xlsx";

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

function cellAddress(rowIndex: number, columnIndex: number) {
  return XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
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

function resolveSheet(
  sheetName: string,
  worksheet: XLSX.WorkSheet,
): ResolvedOrdenCompraTotal {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  }) as unknown[][];

  const allHits = scanLabels(rows);
  const totals = allHits.filter((hit) => hit.kind === "TOTAL");

  if (totals.length === 0) {
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
    total: roundMoney(best.total.amount),
    subtotal: best.context.subtotal
      ? roundMoney(best.context.subtotal.amount)
      : null,
    iva:
      best.context.taxes > 0
        ? roundMoney(best.context.taxes)
        : null,
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
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, {
    type: "array",
    cellFormula: true,
    cellDates: true,
    cellNF: true,
    cellText: true,
  });

  const result = new Map<string, ResolvedOrdenCompraTotal>();

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    result.set(
      normalizeOrdenCompraSheetKey(sheetName),
      resolveSheet(sheetName, worksheet),
    );
  }

  return result;
}
