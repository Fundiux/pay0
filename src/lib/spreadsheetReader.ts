export type SpreadsheetSheet = {
  name: string;
  rows: unknown[][];
  cell: (address: string) => unknown;
};

const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;
const MAX_SPREADSHEET_ROWS = 50000;
const MAX_SPREADSHEET_COLUMNS = 256;

function assertSheetSize(rowCount: number, columnCount: number) {
  if (rowCount > MAX_SPREADSHEET_ROWS || columnCount > MAX_SPREADSHEET_COLUMNS) {
    throw new Error("El archivo excede el límite de 50,000 filas o 256 columnas por hoja.");
  }
}

function normalizeCellValue(value: any): unknown {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return value;
  if ("formula" in value || "sharedFormula" in value) {
    // Conserva formula y cache. ExcelJS no calcula formulas cuando el libro
    // fue generado sin cache, y el parser puede evaluarla de forma segura.
    const formula = value.formula || value.sharedFormula || "";
    return value.result !== undefined
      ? normalizeCellValue(value.result)
      : { formula: String(formula), result: null };
  }
  if ("error" in value) return "";
  if (Array.isArray(value.richText)) return value.richText.map((part: any) => part.text || "").join("");
  if ("text" in value) return value.text || "";
  return value;
}

function csvSheet(data: ArrayBuffer): SpreadsheetSheet {
  const bytes = new Uint8Array(data);
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe
    ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  let source: string;
  try {
    source = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("El CSV no tiene una codificación válida. Guárdalo como CSV UTF-8.");
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(source)) {
    throw new Error("El CSV contiene datos binarios o caracteres inválidos.");
  }

  // Excel may include a separator hint; otherwise inspect the first logical row.
  const hint = /^sep=([,;\t])\r?\n/i.exec(source);
  let delimiter = hint?.[1] || ",";
  if (hint) {
    source = source.slice(hint[0].length);
  } else {
    const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
    let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted) {
        if (char === "\r" || char === "\n") break;
        if (counts.has(char)) counts.set(char, counts.get(char)! + 1);
      }
    }
    delimiter = [...counts].sort((left, right) => right[1] - left[1])[0][0];
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let quoteClosed = false;
  const pushCell = () => {
    row.push(value);
    assertSheetSize(rows.length + 1, row.length);
    value = "";
    quoteClosed = false;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') value += char;
      else if (source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = false;
        quoteClosed = true;
      }
    } else if (char === delimiter) {
      pushCell();
    } else if (char === "\r" || char === "\n") {
      pushCell();
      rows.push(row);
      row = [];
      if (char === "\r" && source[index + 1] === "\n") index += 1;
    } else if (char === '"' && value === "" && !quoteClosed) {
      quoted = true;
    } else {
      if (quoteClosed || char === '"') {
        throw new Error("El CSV contiene comillas mal formadas.");
      }
      value += char;
    }
  }
  if (quoted) throw new Error("El CSV contiene un campo con comillas sin cerrar.");
  if (value !== "" || row.length > 0 || quoteClosed) {
    pushCell();
    rows.push(row);
  }
  // Keep CSV identifiers as text: numeric coercion loses leading zeroes and CLABE precision.
  return {
    name: "Hoja1",
    rows,
    cell: (address) => {
      const match = /^([A-Z]+)([1-9]\d*)$/i.exec(address);
      if (!match) return "";
      const column = [...match[1].toUpperCase()].reduce((result, char) => result * 26 + char.charCodeAt(0) - 64, 0);
      return rows[Number(match[2]) - 1]?.[column - 1] ?? "";
    },
  };
}

export async function readSpreadsheetFile(file: File): Promise<SpreadsheetSheet[]> {
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "csv" && extension !== "xlsx") {
    throw new Error("Solo se admiten archivos .xlsx o .csv.");
  }
  if (file.size > MAX_SPREADSHEET_BYTES) {
    throw new Error("El archivo excede el límite de lectura de 10 MB.");
  }
  const data = await file.arrayBuffer();
  if (data.byteLength > MAX_SPREADSHEET_BYTES) {
    throw new Error("El archivo excede el límite de lectura de 10 MB.");
  }
  if (extension === "csv") return [csvSheet(data)];

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data);
  } catch {
    throw new Error("No se pudo leer el archivo XLSX. Está dañado, protegido o no es un libro válido.");
  }

  return workbook.worksheets.map((worksheet) => {
    assertSheetSize(worksheet.rowCount, worksheet.columnCount);
    const rows: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows[rowNumber - 1] = Array.from(values, normalizeCellValue);
    });

    return {
      name: worksheet.name,
      rows,
      cell: (address: string) => normalizeCellValue(worksheet.getCell(address).value),
    };
  });
}

export async function downloadSpreadsheetFile(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[],
  columnWidths?: number[],
): Promise<void> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31));
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));

  worksheet.columns = columns.map((key, index) => ({
    header: key,
    key,
    width: columnWidths?.[index] || 18,
  }));
  rows.forEach((row) => worksheet.addRow(row));

  const data = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
