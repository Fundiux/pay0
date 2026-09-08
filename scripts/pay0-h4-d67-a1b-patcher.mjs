import fs from "node:fs";
import ts from "../functions/node_modules/typescript/lib/typescript.js";

const pagePath = "src/app/pagos/page.tsx";
let source = fs.readFileSync(pagePath, "utf8");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function tagName(node, file) {
  if (ts.isJsxElement(node)) {
    return node.openingElement.tagName.getText(file);
  }

  if (ts.isJsxSelfClosingElement(node)) {
    return node.tagName.getText(file);
  }

  return "";
}

function directTdChildren(node, file) {
  if (!ts.isJsxElement(node)) return [];

  return node.children.filter(
    (child) =>
      ts.isJsxElement(child) &&
      tagName(child, file).toLowerCase() === "td",
  );
}

function addStaticAlignment(openingSource, alignment) {
  const match = openingSource.match(/className="([^"]*)"/);

  if (!match) {
    fail(
      `Celda sin className estatico; no se modifica: ${openingSource}`,
    );
  }

  const classes = match[1]
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (token) =>
        token !== "text-left" &&
        token !== "text-center" &&
        token !== "text-right",
    );

  classes.push(alignment);

  return openingSource.replace(
    match[0],
    `className="${classes.join(" ")}"`,
  );
}

const importLine =
  'import { PaymentRelationIndicator } from "@/components/PaymentRelationIndicator";';

if (!source.includes(importLine)) {
  const imports = Array.from(source.matchAll(/^import .*?;$/gm));

  if (!imports.length) {
    fail("No se encontraron imports.");
  }

  const lastImport = imports[imports.length - 1];
  const insertAt = lastImport.index + lastImport[0].length;

  source =
    source.slice(0, insertAt) +
    `\n${importLine} // H4-D67-A1B_RELATION_COLUMN` +
    source.slice(insertAt);
}

const relationHeaderObject =
  '{ label: "Relacion", key: "totalAplicado" }';

if (!source.includes(relationHeaderObject)) {
  const headerPattern =
    /(\{\s*label:\s*"Folio IQ",\s*key:\s*"iqDepositFolio"\s*\},)(\s*)(\{\s*label:\s*"Estado IQ",\s*key:\s*"iqDepositReconciliationStatus"\s*\},)/;

  if (!headerPattern.test(source)) {
    fail("No se encontro el par Folio IQ / Estado IQ en el arreglo.");
  }

  source = source.replace(
    headerPattern,
    `$1$2${relationHeaderObject},$2$3`,
  );
}

const oldCenterPattern =
  /\[\s*"Monto"\s*,\s*"Aplicado"\s*,\s*"Disponible"\s*,\s*"Folio IQ"\s*,\s*"Estado IQ"\s*\]\.includes\(h\.label\)\s*\?\s*"text-center"\s*:\s*""/g;

const oldJustifyPattern =
  /\[\s*"Monto"\s*,\s*"Aplicado"\s*,\s*"Disponible"\s*,\s*"Folio IQ"\s*,\s*"Estado IQ"\s*\]\.includes\(h\.label\)\s*\?\s*"justify-center"\s*:\s*""/g;

const newTextAlignment =
  '["Folio", "Cliente", "Empresa"].includes(h.label) ? "text-left" : "text-center"';

const newFlexAlignment =
  '["Folio", "Cliente", "Empresa"].includes(h.label) ? "justify-start" : "justify-center"';

let textAlignmentChanges = 0;
let flexAlignmentChanges = 0;

source = source.replace(oldCenterPattern, () => {
  textAlignmentChanges += 1;
  return newTextAlignment;
});

source = source.replace(oldJustifyPattern, () => {
  flexAlignmentChanges += 1;
  return newFlexAlignment;
});

if (
  !source.includes(newTextAlignment) ||
  !source.includes(newFlexAlignment)
) {
  fail(
    `No se actualizaron alineaciones de encabezado. text=${textAlignmentChanges}, flex=${flexAlignmentChanges}`,
  );
}

let file = ts.createSourceFile(
  pagePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const rowCandidates = [];

function collectRows(node) {
  if (
    ts.isJsxElement(node) &&
    tagName(node, file).toLowerCase() === "tr"
  ) {
    const rowSource = source.slice(
      node.getStart(file),
      node.getEnd(),
    );

    const cells = directTdChildren(node, file);

    let score = 0;

    if (rowSource.includes("getPagoFolio(")) score += 5;
    if (rowSource.includes("getPagoIqFolio(")) score += 5;
    if (rowSource.includes("getPagoIqStatus(")) score += 5;
    if (rowSource.includes("tsToDateText(")) score += 2;
    if (cells.length === 14) score += 5;
    if (cells.length >= 13 && cells.length <= 15) score += 2;

    if (score >= 17) {
      rowCandidates.push({
        node,
        cells,
        rowSource,
        score,
      });
    }
  }

  ts.forEachChild(node, collectRows);
}

collectRows(file);

rowCandidates.sort((left, right) => right.score - left.score);

if (!rowCandidates.length) {
  fail("No se identifico la fila de datos de Pagos.");
}

const row = rowCandidates[0];
const existingRelation =
  row.rowSource.includes("<PaymentRelationIndicator");

if (!existingRelation && row.cells.length !== 14) {
  fail(
    `Se esperaban 14 celdas antes de RELACION; encontradas ${row.cells.length}.`,
  );
}

if (existingRelation && row.cells.length !== 15) {
  fail(
    `RELACION parece existir, pero la fila tiene ${row.cells.length} celdas.`,
  );
}

const oldAlignments = [
  "text-left",   // Folio
  "text-center", // Folio IQ
  "text-center", // Estado IQ
  "text-center", // Fecha
  "text-left",   // Cliente
  "text-left",   // Empresa
  "text-center", // Monto
  "text-center", // Aplicado
  "text-center", // Disponible
  "text-center", // Pendientes
  "text-center", // Docs
  "text-center", // Notas
  "text-center", // Estatus
  "text-center", // Acciones
];

const finalAlignments = [
  "text-left",   // Folio
  "text-center", // Folio IQ
  "text-center", // Relacion
  "text-center", // Estado IQ
  "text-center", // Fecha
  "text-left",   // Cliente
  "text-left",   // Empresa
  "text-center", // Monto
  "text-center", // Aplicado
  "text-center", // Disponible
  "text-center", // Pendientes
  "text-center", // Docs
  "text-center", // Notas
  "text-center", // Estatus
  "text-center", // Acciones
];

const operations = [];

const alignments = existingRelation
  ? finalAlignments
  : oldAlignments;

for (let index = 0; index < row.cells.length; index += 1) {
  const cell = row.cells[index];
  const opening = cell.openingElement;
  const oldOpening = source.slice(
    opening.getStart(file),
    opening.getEnd(),
  );

  const newOpening = addStaticAlignment(
    oldOpening,
    alignments[index],
  );

  if (newOpening !== oldOpening) {
    operations.push({
      start: opening.getStart(file),
      end: opening.getEnd(),
      text: newOpening,
    });
  }
}

if (!existingRelation) {
  const folioIqCell = row.cells[1];
  const relationCell =
    '\n<td className="pay0-td text-center"><PaymentRelationIndicator payment={p} /></td>';

  operations.push({
    start: folioIqCell.getEnd(),
    end: folioIqCell.getEnd(),
    text: relationCell,
  });
}

operations.sort((left, right) => right.start - left.start);

for (const operation of operations) {
  source =
    source.slice(0, operation.start) +
    operation.text +
    source.slice(operation.end);
}

fs.writeFileSync(pagePath, source, "utf8");

file = ts.createSourceFile(
  pagePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const finalSource = source;

const validations = [
  ["import", finalSource.includes(importLine)],
  ["header", finalSource.includes(relationHeaderObject)],
  [
    "row",
    finalSource.includes(
      "<PaymentRelationIndicator payment={p} />",
    ),
  ],
  ["left-header-rule", finalSource.includes(newTextAlignment)],
  ["flex-header-rule", finalSource.includes(newFlexAlignment)],
];

for (const [name, ok] of validations) {
  if (!ok) {
    fail(`Validacion final fallida: ${name}`);
  }
}

console.log("PATCH_OK H4-D67-A1B");
console.log(
  JSON.stringify(
    {
      existingRelation,
      originalCells: row.cells.length,
      textAlignmentChanges,
      flexAlignmentChanges,
      rowOperations: operations.length,
    },
    null,
    2,
  ),
);