import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const qaDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(qaDir, "..", "..");
const require = createRequire(import.meta.url);
const ts = require(path.join(projectRoot, "functions", "node_modules", "typescript"));
const tsconfigPath = path.join(projectRoot, "functions", "tsconfig.json");
const sourcePath = path.join(projectRoot, "functions", "src", "modules", "iq", "browserSession.ts");

const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
if (config.error) {
  throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
}

const parsed = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  path.dirname(tsconfigPath),
);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const source = program.getSourceFile(sourcePath);

if (!source) {
  throw new Error(`No se pudo cargar ${sourcePath}`);
}

const isNonVariableIdentifier = (node) => {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node)
  );
};

const isInsideTypeNode = (node, boundary) => {
  let current = node.parent;
  while (current && current !== boundary) {
    if (ts.isTypeNode(current)) return true;
    current = current.parent;
  }
  return false;
};

const closureCaptures = [];
let evaluateCallbacks = 0;

const inspectEvaluateCallback = (callback) => {
  evaluateCallbacks += 1;
  const callbackStart = callback.getStart(source);
  const callbackEnd = callback.getEnd();

  const visitCallbackNode = (node) => {
    if (
      ts.isIdentifier(node) &&
      !isNonVariableIdentifier(node) &&
      !isInsideTypeNode(node, callback)
    ) {
      const symbol = checker.getSymbolAtLocation(node);
      const declarations = symbol?.declarations ?? [];
      const sameFileDeclarations = declarations.filter(
        (declaration) => declaration.getSourceFile() === source,
      );
      const captured = sameFileDeclarations.some(
        (declaration) =>
          declaration.getStart(source) < callbackStart ||
          declaration.getEnd() > callbackEnd,
      );

      if (captured) {
        const location = source.getLineAndCharacterOfPosition(node.getStart(source));
        closureCaptures.push({
          name: node.text,
          line: location.line + 1,
          column: location.character + 1,
        });
      }
    }
    ts.forEachChild(node, visitCallbackNode);
  };

  ts.forEachChild(callback, visitCallbackNode);
};

const visit = (node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "evaluate"
  ) {
    const callback = node.arguments[0];
    if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
      inspectEvaluateCallback(callback);
    }
  }
  ts.forEachChild(node, visit);
};

visit(source);

const uniqueCaptures = Array.from(
  new Map(
    closureCaptures.map((capture) => [
      `${capture.name}:${capture.line}:${capture.column}`,
      capture,
    ]),
  ).values(),
);

if (uniqueCaptures.length) {
  const details = uniqueCaptures
    .map((capture) => `${capture.name}@${capture.line}:${capture.column}`)
    .join(", ");
  throw new Error(
    `page.evaluate contiene referencias al contexto Node que no se serializan: ${details}`,
  );
}

const compiledPath = path.join(
  projectRoot,
  "functions",
  "lib",
  "modules",
  "iq",
  "browserSession.js",
);
const compiled = fs.readFileSync(compiledPath, "utf8");

for (const forbidden of [
  "const apiOrigin = config_1.DEFAULT_IQ_ERP_URL",
  "let apiOrigin = config_1.DEFAULT_IQ_ERP_URL",
]) {
  if (compiled.includes(forbidden)) {
    throw new Error(`El compilado conserva una captura invalida: ${forbidden}`);
  }
}

console.log(
  `PASS ${evaluateCallbacks} callbacks page.evaluate sin capturas del contexto Node`,
);
console.log("PASS URL IQ recibida como dato serializable en las cuatro rutas de Depositos");