import type { Pay0MassiveRawRow } from "@/lib/pay0MassiveLayout";

type CanonicalMassiveHeader =
  | "NOMBRE"
  | "MONTO"
  | "BANCO"
  | "CLABE"
  | "CUENTA"
  | "NUMERO DE TARJETA";

export type ReadPay0MassiveRowsOptions = {
  preferredSheetNames?: string[];
  requiredHeaders?: CanonicalMassiveHeader[];
  maxHeaderScanRows?: number;
};

const HEADER_ALIASES: Record<CanonicalMassiveHeader, string[]> = {
  NOMBRE: [
    "NOMBRE",
    "BENEFICIARIO",
    "NOMBRE BENEFICIARIO",
    "NOMBRE DEL BENEFICIARIO",
    "NOMBRE COMPLETO",
    "TITULAR",
    "DESTINATARIO",
  ],
  MONTO: [
    "MONTO",
    "IMPORTE",
    "CANTIDAD",
    "TOTAL",
    "MONTO A DISPERSAR",
    "IMPORTE A DISPERSAR",
  ],
  BANCO: [
    "BANCO",
    "BANCO DESTINO",
    "INSTITUCION",
    "INSTITUCION BANCARIA",
    "BANCO BENEFICIARIO",
  ],
  CLABE: [
    "CLABE",
    "CUENTA CLABE",
    "CLABE INTERBANCARIA",
  ],
  CUENTA: [
    "CUENTA",
    "NO CUENTA",
    "NUMERO DE CUENTA",
    "CUENTA / TARJETA",
    "CUENTA/TARJETA",
  ],
  "NUMERO DE TARJETA": [
    "NUMERO DE TARJETA",
    "TARJETA",
    "NO TARJETA",
    "NUM TARJETA",
    "NUMERO TARJETA",
    "TARJETA BENEFICIARIO",
    "CUENTA O TARJETA",
    "CUENTA/TARJETA",
  ],
};

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeSheetName(value: unknown) {
  return normalizeHeader(value);
}

function isEmptyCell(value: unknown) {
  return String(value ?? "").trim() === "";
}

function isEmptyRow(row: unknown[]) {
  return row.every(isEmptyCell);
}

function resolveCanonicalHeader(value: unknown): CanonicalMassiveHeader | "" {
  const normalized = normalizeHeader(value);

  if (!normalized) return "";

  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES) as Array<[CanonicalMassiveHeader, string[]]>) {
    if (aliases.some((alias) => normalizeHeader(alias) === normalized)) {
      return canonical;
    }
  }

  return "";
}

function scoreHeaderRow(row: unknown[], requiredHeaders: CanonicalMassiveHeader[]) {
  const found = new Set<CanonicalMassiveHeader>();

  row.forEach((cell) => {
    const canonical = resolveCanonicalHeader(cell);
    if (canonical) found.add(canonical);
  });

  const requiredCount = requiredHeaders.filter((header) => found.has(header)).length;

  return {
    found,
    requiredCount,
    totalScore: found.size + requiredCount * 2,
  };
}

function selectSheet(workbook: any, preferredSheetNames: string[]) {
  const sheetNames: string[] = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];

  if (sheetNames.length === 0) {
    throw new Error("El archivo no tiene hojas.");
  }

  const preferred = preferredSheetNames
    .map((name) => sheetNames.find((sheetName) => normalizeSheetName(sheetName) === normalizeSheetName(name)))
    .find(Boolean);

  return preferred || sheetNames[0];
}

export async function readPay0MassiveRowsFromFile(
  file: File,
  options: ReadPay0MassiveRowsOptions = {}
): Promise<Pay0MassiveRawRow[]> {
  const XLSX: any = await import("xlsx");

  const preferredSheetNames = options.preferredSheetNames || ["ADMON"];
  const requiredHeaders = options.requiredHeaders || ["NOMBRE"];
  const maxHeaderScanRows = Math.max(1, Number(options.maxHeaderScanRows || 30));

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = selectSheet(workbook, preferredSheetNames);
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error("No se pudo leer la hoja del archivo.");
  }

  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  }) as unknown[][];

  if (!Array.isArray(matrix) || matrix.length === 0) {
    return [];
  }

  let bestHeaderIndex = -1;
  let bestScore = -1;
  let bestFound = new Set<CanonicalMassiveHeader>();

  const scanLimit = Math.min(matrix.length, maxHeaderScanRows);

  for (let i = 0; i < scanLimit; i += 1) {
    const row = Array.isArray(matrix[i]) ? matrix[i] : [];

    if (isEmptyRow(row)) continue;

    const scored = scoreHeaderRow(row, requiredHeaders);
    const hasRequired = requiredHeaders.every((header) => scored.found.has(header));

    if (hasRequired && scored.totalScore > bestScore) {
      bestHeaderIndex = i;
      bestScore = scored.totalScore;
      bestFound = scored.found;
    }
  }

  if (bestHeaderIndex < 0) {
    throw new Error(
      `No se encontro encabezado valido. Requeridos: ${requiredHeaders.join(", ")}. Usa columnas como NOMBRE, MONTO, BANCO, CLABE o NUMERO DE TARJETA.`
    );
  }

  const headerRow = Array.isArray(matrix[bestHeaderIndex]) ? matrix[bestHeaderIndex] : [];
  const canonicalByIndex = headerRow.map(resolveCanonicalHeader);

  const rows: Pay0MassiveRawRow[] = [];

  for (let i = bestHeaderIndex + 1; i < matrix.length; i += 1) {
    const row = Array.isArray(matrix[i]) ? matrix[i] : [];

    if (isEmptyRow(row)) continue;

    const out: Pay0MassiveRawRow = {};

    canonicalByIndex.forEach((canonical, index) => {
      if (!canonical) return;

      const currentValue = row[index];

      if (out[canonical] === undefined || isEmptyCell(out[canonical])) {
        out[canonical] = currentValue ?? "";
      }
    });

    if (!isEmptyRow(Object.values(out))) {
      rows.push(out);
    }
  }

  if (rows.length === 0 && bestFound.size > 0) {
    return [];
  }

  return rows;
}