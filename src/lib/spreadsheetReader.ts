export type SpreadsheetSheet = {
  name: string;
  rows: unknown[][];
  cell: (address: string) => unknown;
};

function normalizeCellValue(value: any): unknown {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return value;
  if ("result" in value && value.result !== undefined) return value.result;
  if (Array.isArray(value.richText)) return value.richText.map((part: any) => part.text || "").join("");
  if ("text" in value) return value.text || "";
  return value;
}

function isCsvFile(file: File) {
  return file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
}

export async function readSpreadsheetFile(file: File): Promise<SpreadsheetSheet[]> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const data = await file.arrayBuffer();

  if (isCsvFile(file)) {
    await (workbook.csv as any).load(data);
  } else if (file.name.toLowerCase().endsWith(".xlsx")) {
    await workbook.xlsx.load(data);
  } else {
    throw new Error("Solo se admiten archivos .xlsx o .csv.");
  }

  return workbook.worksheets.map((worksheet) => {
    const rows: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows[rowNumber - 1] = values.map(normalizeCellValue);
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
