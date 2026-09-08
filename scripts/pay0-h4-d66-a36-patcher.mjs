import fs from "node:fs";
import ts from "../functions/node_modules/typescript/lib/typescript.js";

const browserPath =
  "functions/src/modules/paymentApplications/iqBrowser.ts";

let source = fs.readFileSync(browserPath, "utf8");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const importLine =
  'import { resolveIqApplicationIdFromListingA36 } from "./iqPostSubmitApplicationId";';

if (!source.includes(importLine)) {
  const imports = Array.from(
    source.matchAll(/^import .*?;$/gm),
  );

  if (!imports.length) {
    fail("No se encontraron imports.");
  }

  const lastImport = imports[imports.length - 1];
  const insertAt = lastImport.index + lastImport[0].length;

  source =
    source.slice(0, insertAt) +
    `\n${importLine}` +
    source.slice(insertAt);
}

if (source.includes("A36_RESOLVE_EXACT_APPLICATION_ID")) {
  console.log("A36 ya estaba integrado.");
  fs.writeFileSync(browserPath, source, "utf8");
  process.exit(0);
}

const file = ts.createSourceFile(
  browserPath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

let targetStatement = null;
let targetFunction = null;

function visit(node, currentFunction = null) {
  let nextFunction = currentFunction;

  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  ) {
    nextFunction = node;
  }

  if (
    ts.isStringLiteral(node) &&
    node.text === "IQ_PAYMENT_APPLICATION_SUCCEEDED"
  ) {
    let cursor = node;

    while (cursor && !ts.isStatement(cursor)) {
      cursor = cursor.parent;
    }

    targetStatement = cursor;
    targetFunction = nextFunction;
  }

  ts.forEachChild(node, (child) =>
    visit(child, nextFunction),
  );
}

visit(file);

if (!targetStatement || !targetFunction) {
  fail("No se encontro la sentencia de SUCCESS.");
}

const functionText = source.slice(
  targetFunction.getStart(file),
  targetFunction.getEnd(),
);

for (const token of [
  "page",
  "input.pagoIqFolio",
  "items",
  "result",
]) {
  if (!functionText.includes(token)) {
    fail(`La funcion SUCCESS no contiene ${token}.`);
  }
}

const insertion = `
    const exactApplicationIdA36 =
      await resolveIqApplicationIdFromListingA36(
        page,
        {
          depositIqFolio: cleanText(input.pagoIqFolio),
          invoiceIqFolios: items.map((item) =>
            cleanText(item.solicitudIqFolio),
          ),
          expectedAmount: money2(
            items.reduce(
              (total, item) =>
                total + money2(item.amount),
              0,
            ),
          ),
          timeoutMs: 22000,
        },
      ); // A36_RESOLVE_EXACT_APPLICATION_ID

    if (exactApplicationIdA36.ok) {
      result.iqApplicationId =
        exactApplicationIdA36.iqApplicationId;
      result.responseMessage = cleanText(
        [
          result.responseMessage,
          exactApplicationIdA36.message,
        ]
          .filter(Boolean)
          .join(" | "),
      );
    } else if (
      !/^\\d+$/.test(cleanText(result.iqApplicationId))
    ) {
      result.status =
        "IQ_PAYMENT_APPLICATION_UNKNOWN_REVIEW_REQUIRED";
      result.message = exactApplicationIdA36.message;
      result.responseMessage = cleanText(
        [
          result.responseMessage,
          exactApplicationIdA36.message,
        ]
          .filter(Boolean)
          .join(" | "),
      );
      return result;
    }

`;

const insertAt = targetStatement.getStart(file);

source =
  source.slice(0, insertAt) +
  insertion +
  source.slice(insertAt);

fs.writeFileSync(browserPath, source, "utf8");
console.log("PATCH_OK A36 post-submit ID exacto");