import fs from "node:fs";
import ts from "../functions/node_modules/typescript/lib/typescript.js";

const pagePath = "src/app/pagos/page.tsx";
const source = fs.readFileSync(pagePath, "utf8");

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

function getStaticClassName(openingElement, file) {
  const attribute = openingElement.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) &&
      property.name.getText(file) === "className",
  );

  if (
    !attribute ||
    !ts.isJsxAttribute(attribute) ||
    !attribute.initializer ||
    !ts.isStringLiteral(attribute.initializer)
  ) {
    return "";
  }

  return attribute.initializer.text;
}

const file = ts.createSourceFile(
  pagePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const candidates = [];

function visit(node) {
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
    if (
      rowSource.includes(
        "<PaymentRelationIndicator payment={p} />",
      )
    ) {
      score += 8;
    }
    if (cells.length === 15) score += 8;

    if (score >= 25) {
      candidates.push({
        node,
        cells,
        rowSource,
        score,
      });
    }
  }

  ts.forEachChild(node, visit);
}

visit(file);

candidates.sort((left, right) => right.score - left.score);

if (candidates.length !== 1) {
  fail(
    `Se esperaba una fila principal de Pagos; encontradas ${candidates.length}.`,
  );
}

const row = candidates[0];

if (row.cells.length !== 15) {
  fail(
    `La fila principal debe tener 15 celdas; tiene ${row.cells.length}.`,
  );
}

const expectedAlignment = [
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

const names = [
  "FOLIO",
  "FOLIO IQ",
  "RELACION",
  "ESTADO IQ",
  "FECHA",
  "CLIENTE",
  "EMPRESA",
  "MONTO",
  "APLICADO",
  "DISPONIBLE",
  "PENDIENTES",
  "DOCS",
  "NOTAS",
  "ESTATUS",
  "ACCIONES",
];

for (let index = 0; index < row.cells.length; index += 1) {
  const className = getStaticClassName(
    row.cells[index].openingElement,
    file,
  );

  if (!className) {
    fail(`La celda ${names[index]} no tiene className estatico.`);
  }

  const expected = expectedAlignment[index];
  const forbidden =
    expected === "text-left" ? "text-center" : "text-left";

  if (!className.split(/\s+/).includes(expected)) {
    fail(
      `Alineacion incorrecta en ${names[index]}: falta ${expected}. Clase: ${className}`,
    );
  }

  if (className.split(/\s+/).includes(forbidden)) {
    fail(
      `Alineacion contradictoria en ${names[index]}: contiene ${forbidden}.`,
    );
  }
}

const relationCellSource = source.slice(
  row.cells[2].getStart(file),
  row.cells[2].getEnd(),
);

if (
  !relationCellSource.includes(
    "<PaymentRelationIndicator payment={p} />",
  )
) {
  fail("RELACION no esta en la tercera celda.");
}

const headerTextRule =
  '["Folio", "Cliente", "Empresa"].includes(h.label) ? "text-left" : "text-center"';

const headerFlexRule =
  '["Folio", "Cliente", "Empresa"].includes(h.label) ? "justify-start" : "justify-center"';

if (!source.includes(headerTextRule)) {
  fail("Falta regla de alineacion de texto del encabezado.");
}

if (!source.includes(headerFlexRule)) {
  fail("Falta regla flex del encabezado.");
}

console.log("H4-D67-A1B TABLE STRUCTURE OK");
console.log("15 columnas verificadas.");
console.log(
  "Izquierda: FOLIO, CLIENTE, EMPRESA. Centradas: las demas.",
);