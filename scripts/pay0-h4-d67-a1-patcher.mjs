import fs from "node:fs";
import ts from "../functions/node_modules/typescript/lib/typescript.js";

const pagePath = "src/app/pagos/page.tsx";
let source = fs.readFileSync(pagePath, "utf8");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function tagName(node) {
  if (ts.isJsxElement(node)) {
    return node.openingElement.tagName.getText(file);
  }

  if (ts.isJsxSelfClosingElement(node)) {
    return node.tagName.getText(file);
  }

  return "";
}

function textContent(node) {
  let value = "";

  function walk(current) {
    if (ts.isJsxText(current)) {
      value += ` ${current.getText(file)}`;
      return;
    }

    if (
      ts.isStringLiteral(current) ||
      ts.isNoSubstitutionTemplateLiteral(current)
    ) {
      value += ` ${current.text}`;
    }

    ts.forEachChild(current, walk);
  }

  walk(node);
  return normalize(value);
}

function directJsxChildren(node) {
  if (!ts.isJsxElement(node)) return [];

  return node.children.filter(
    (child) =>
      ts.isJsxElement(child) ||
      ts.isJsxSelfClosingElement(child),
  );
}

function nearestArrow(node) {
  let current = node.parent;

  while (current) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current)
    ) {
      return current;
    }

    current = current.parent;
  }

  return null;
}

function getRowVariable(arrow) {
  if (!arrow || arrow.parameters.length < 1) {
    return "";
  }

  const parameter = arrow.parameters[0].name;

  if (ts.isIdentifier(parameter)) {
    return parameter.text;
  }

  return "";
}

const importLine =
  'import { PaymentRelationIndicator } from "@/components/PaymentRelationIndicator";';

if (!source.includes(importLine)) {
  const importMatches = Array.from(source.matchAll(/^import .*?;$/gm));

  if (!importMatches.length) {
    fail("No se encontraron imports en Pagos.");
  }

  const lastImport = importMatches[importMatches.length - 1];
  const insertAt = lastImport.index + lastImport[0].length;

  source =
    source.slice(0, insertAt) +
    `\n${importLine} // H4-D67-A1_RELATION_COLUMN` +
    source.slice(insertAt);
}

if (
  source.includes("<PaymentRelationIndicator") &&
  source.includes("RELACION")
) {
  console.log("A1 ya estaba integrado.");
  fs.writeFileSync(pagePath, source, "utf8");
  process.exit(0);
}

const file = ts.createSourceFile(
  pagePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const jsxElements = [];

function collect(node) {
  if (ts.isJsxElement(node)) {
    jsxElements.push(node);
  }

  ts.forEachChild(node, collect);
}

collect(file);

const headerRows = jsxElements
  .map((node) => {
    const text = textContent(node);
    const children = directJsxChildren(node);

    return {
      node,
      text,
      children,
      score:
        (text.includes("FOLIO IQ") ? 5 : 0) +
        (text.includes("ESTADO IQ") ? 5 : 0) +
        (text.includes("MONTO") ? 2 : 0) +
        (text.includes("FOLIO") ? 1 : 0) +
        (children.length >= 8 ? 2 : 0),
    };
  })
  .filter(
    (candidate) =>
      candidate.score >= 12 &&
      candidate.children.length >= 8,
  )
  .sort(
    (left, right) =>
      right.score - left.score ||
      left.node.getWidth(file) - right.node.getWidth(file),
  );

if (!headerRows.length) {
  fail(
    "No se identifico con seguridad la fila de encabezados de Pagos.",
  );
}

const headerRow = headerRows[0];
const headerChildren = headerRow.children;

let iqStateIndex = headerChildren.findIndex((child) =>
  textContent(child).includes("ESTADO IQ"),
);

if (iqStateIndex < 0) {
  fail("No se identifico la celda ESTADO IQ.");
}

const headerCell = headerChildren[iqStateIndex];

if (!ts.isJsxElement(headerCell)) {
  fail("La celda ESTADO IQ no es un elemento JSX editable.");
}

const headerCellSource = source.slice(
  headerCell.getStart(file),
  headerCell.getEnd(),
);

const openEnd =
  headerCell.openingElement.getEnd() - headerCell.getStart(file);
const closeStart =
  headerCell.closingElement.getStart(file) - headerCell.getStart(file);

const relationHeader =
  headerCellSource.slice(0, openEnd) +
  "RELACION" +
  headerCellSource.slice(closeStart);

const dataCandidates = jsxElements
  .map((node) => {
    const arrow = nearestArrow(node);
    const variable = getRowVariable(arrow);
    const children = directJsxChildren(node);
    const nodeSource = source.slice(
      node.getStart(file),
      node.getEnd(),
    );

    let score = 0;

    if (variable) score += 4;
    if (children.length >= headerChildren.length - 2) score += 3;
    if (children.length <= headerChildren.length + 2) score += 2;
    if (nodeSource.includes(variable ? `${variable}.` : "__NONE__")) {
      score += 5;
    }
    if (node.getStart(file) > headerRow.node.getEnd()) score += 2;
    if (
      normalize(nodeSource).includes("FOLIO IQ") ||
      normalize(nodeSource).includes("ESTADO IQ")
    ) {
      score -= 10;
    }

    return {
      node,
      variable,
      children,
      score,
      distance: Math.abs(
        node.getStart(file) - headerRow.node.getEnd(),
      ),
    };
  })
  .filter(
    (candidate) =>
      candidate.variable &&
      candidate.score >= 11 &&
      candidate.children.length > iqStateIndex,
  )
  .sort(
    (left, right) =>
      right.score - left.score ||
      left.distance - right.distance,
  );

if (!dataCandidates.length) {
  fail(
    "No se identifico con seguridad la fila de datos de Pagos.",
  );
}

const dataRow = dataCandidates[0];
const dataCell = dataRow.children[iqStateIndex];

if (!ts.isJsxElement(dataCell)) {
  fail("La celda de datos correspondiente no es editable.");
}

const dataCellSource = source.slice(
  dataCell.getStart(file),
  dataCell.getEnd(),
);

const dataOpenEnd =
  dataCell.openingElement.getEnd() - dataCell.getStart(file);
const dataCloseStart =
  dataCell.closingElement.getStart(file) - dataCell.getStart(file);

const relationDataCell =
  dataCellSource.slice(0, dataOpenEnd) +
  `<PaymentRelationIndicator payment={${dataRow.variable}} />` +
  dataCellSource.slice(dataCloseStart);

const insertions = [
  {
    position: headerCell.getEnd(),
    text: `\n${relationHeader}`,
  },
  {
    position: dataCell.getEnd(),
    text: `\n${relationDataCell}`,
  },
].sort((left, right) => right.position - left.position);

for (const insertion of insertions) {
  source =
    source.slice(0, insertion.position) +
    insertion.text +
    source.slice(insertion.position);
}

fs.writeFileSync(pagePath, source, "utf8");

console.log("PATCH_OK H4-D67-A1");
console.log(
  JSON.stringify(
    {
      headerText: headerRow.text,
      iqStateIndex,
      dataVariable: dataRow.variable,
      headerChildren: headerChildren.length,
      dataChildren: dataRow.children.length,
    },
    null,
    2,
  ),
);