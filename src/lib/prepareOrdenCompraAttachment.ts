import type { DataValidation, Worksheet } from "exceljs";
import { isNewIqOrdenCompraLayout } from "./ordenCompraParser";
import { normalizeOrdenCompraSheetKey } from "./ordenCompraTotalResolver";
import { loadSpreadsheetWorkbook } from "./spreadsheetReader";

const IQ_CATALOGS = new Set(["CP", "REGIMEN", "USO", "CLAVEUNIDAD", "CLAVEPRODSERV", "DESCRIPCIONES", "IVA"]);
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function cellContents(sheet: Worksheet) {
  const cells: unknown[][] = [];
  sheet.eachRow((row) => row.eachCell((cell) => {
    cells.push([cell.address, cell.value, cell.numFmt, cell.note]);
  }));
  return JSON.stringify(cells);
}

export async function prepareOrdenCompraAttachment(file: File, maxBytes: number): Promise<File> {
  if (file.size <= maxBytes) return file;
  if (!/\.xlsx$/i.test(file.name)) throw new Error("El archivo excede el límite de 1 MB.");

  const { workbook, hiddenSheetNames } = await loadSpreadsheetWorkbook(file, { visibleOnly: true });
  const [sheet] = workbook.worksheets;
  if (!sheet || !isNewIqOrdenCompraLayout((address) => sheet.getCell(address).value)) {
    throw new Error("La OC excede 1 MB. Solo se puede reducir automáticamente la nueva plantilla de IQ.");
  }
  if (
    workbook.worksheets.length !== 1 ||
    hiddenSheetNames.length === 0 ||
    hiddenSheetNames.some((name) => !IQ_CATALOGS.has(normalizeOrdenCompraSheetKey(name)))
  ) {
    throw new Error("La OC contiene hojas adicionales que PAY0 no puede quitar con seguridad.");
  }
  if (sheet.rowCount > 50000 || sheet.columnCount > 256) {
    throw new Error("La hoja de la OC excede el límite de 50,000 filas o 256 columnas.");
  }

  const catalogNames = new Set([
    ...hiddenSheetNames,
    ...workbook.definedNames.model.map(({ name }) => name),
  ].map((name) => name.toUpperCase()));
  const usesCatalog = (formula: string) => {
    if (/^"[^"]*"$/.test(formula)) return false;
    const tokens = formula.toUpperCase().match(/[\p{L}_][\p{L}\d_.]*/gu) ?? [];
    return /[!\[]/.test(formula) || tokens.some((token) => catalogNames.has(token));
  };
  sheet.eachRow((row) => row.eachCell((cell) => {
    const formula = cell.formula;
    if (cell.master !== cell || !formula) return;
    if (!usesCatalog(formula) && !/^TODAY\(\)$/i.test(formula)) return;

    const savedValue = cell.result;
    if (savedValue == null || (typeof savedValue === "object" && "error" in savedValue)) {
      throw new Error(`La celda ${cell.address} necesita un resultado guardado en Excel antes de reducir la OC.`);
    }
    cell.value = savedValue;
  }));
  workbook.definedNames.model = [];
  // ExcelJS exposes the worksheet-wide validation map without declaring it in its types.
  const validations = (sheet as Worksheet & { dataValidations: { model: Record<string, DataValidation> } }).dataValidations.model;
  for (const [cell, rule] of Object.entries(validations)) {
    if (rule.formulae?.some((value) => typeof value === "string" && usesCatalog(value))) delete validations[cell];
  }

  const expected = cellContents(sheet);
  const expectedMerges = [...sheet.model.merges].sort().join(",");
  const bytes = await workbook.xlsx.writeBuffer();
  if (bytes.byteLength > maxBytes) {
    throw new Error("La copia de la OC todavía excede el límite de 1 MB.");
  }

  const attachment = new File([bytes as ArrayBuffer], file.name, { type: XLSX_TYPE, lastModified: file.lastModified });
  const { workbook: verifiedWorkbook } = await loadSpreadsheetWorkbook(attachment);
  const [verified] = verifiedWorkbook.worksheets;
  if (
    !verified ||
    verified.name !== sheet.name ||
    cellContents(verified) !== expected ||
    [...verified.model.merges].sort().join(",") !== expectedMerges
  ) {
    throw new Error("PAY0 no pudo verificar que la copia conserve los datos y las partidas de la OC.");
  }

  return attachment;
}
