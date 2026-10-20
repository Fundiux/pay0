import path from "node:path";

// Work on TypeScript's lexical bindings, not text replacement. The caller pins
// the compiler version and supplies compiled CommonJS, never dependencies.
export function preserveModuleContext(ts, text, modulePath) {
  if (path.isAbsolute(modulePath) || modulePath.split(/[\\/]/).includes("..")) throw Error("MODULE_PATH_SCOPE");
  const file = modulePath.replaceAll("\\", "/");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const options = { allowJs: true, noLib: true, noResolve: true, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => name === file ? source : undefined;
  host.fileExists = name => name === file;
  host.readFile = name => name === file ? text : undefined;
  const program = ts.createProgram([file], options, host), checker = program.getTypeChecker();
  const reserved = new Set(["__pay0BundledModuleDir", "__pay0BundledModuleFile"]);
  const local = node => checker.getSymbolAtLocation(node)?.declarations?.some(d => d.getSourceFile() === source);
  let needsDir = false, needsFile = false;
  function inspect(node) {
    if (ts.isIdentifier(node) && reserved.has(node.text)) throw Error("CONTEXT_NAME_COLLISION");
    if (ts.isIdentifier(node) && !local(node) && !isNameOnly(node)) {
      if (node.text === "require" && !((ts.isCallExpression(node.parent) && node.parent.expression === node) ||
          (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node))) throw Error("REQUIRE_ALIAS_UNREVIEWED");
      if (node.text === "module" && !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)) throw Error("MODULE_ALIAS_UNREVIEWED");
    }
    if (ts.isMetaProperty(node)) throw Error("META_PROPERTY_UNREVIEWED");
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && !local(node.expression)) {
      const name = node.expression.text;
      if (name === "eval" || name === "Function") throw Error("DYNAMIC_SCOPE_UNREVIEWED");
      if (name === "require" && (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0]))) throw Error("DYNAMIC_REQUIRE_UNREVIEWED");
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function" && !local(node.expression)) throw Error("DYNAMIC_SCOPE_UNREVIEWED");
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && !local(node.expression)) {
      if (node.expression.text === "module" && node.name.text !== "exports") throw Error("MODULE_METADATA_UNREVIEWED");
      if (node.expression.text === "require") {
        if (node.name.text !== "resolve" || !ts.isCallExpression(node.parent)) throw Error("REQUIRE_METADATA_UNREVIEWED");
        const arg = node.parent.arguments[0];
        const staticExternal = !!arg && ts.isStringLiteral(arg) && !arg.text.startsWith(".") && !path.isAbsolute(arg.text);
        const sqlWasm = !!arg && ts.isTemplateExpression(arg) && arg.head.text === "sql.js/dist/" && arg.templateSpans.length === 1 && arg.templateSpans[0].literal.text === "";
        if (node.parent.arguments.length !== 1 || (!staticExternal && !sqlWasm)) throw Error("REQUIRE_RESOLVE_UNREVIEWED");
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  function isNameOnly(node) {
    const parent = node.parent;
    return (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node) ||
      (ts.isMethodDeclaration(parent) && parent.name === node) ||
      (ts.isLabeledStatement(parent) && parent.label === node) ||
      ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node);
  }
  const transformed = ts.transform(source, [context => {
    const visit = node => {
      if (ts.isIdentifier(node) && ["__dirname", "__filename"].includes(node.text) && !local(node) && !isNameOnly(node)) {
        needsDir = true; needsFile ||= node.text === "__filename";
        return ts.factory.createIdentifier(node.text === "__dirname" ? "__pay0BundledModuleDir" : "__pay0BundledModuleFile");
      }
      if (ts.isShorthandPropertyAssignment(node) && ["__dirname", "__filename"].includes(node.name.text)) {
        const symbol = checker.getShorthandAssignmentValueSymbol(node);
        if (!symbol?.declarations?.some(d => d.getSourceFile() === source)) {
          needsDir = true; needsFile ||= node.name.text === "__filename";
          return ts.factory.createPropertyAssignment(node.name.text, ts.factory.createIdentifier(node.name.text === "__dirname" ? "__pay0BundledModuleDir" : "__pay0BundledModuleFile"));
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return root => ts.visitNode(root, visit);
  }]);
  try {
    if (!needsDir) return { code: text, adjusted: false };
    const prefix = `const __pay0BundledModuleDir = require("node:path").join(__dirname, ${JSON.stringify(path.posix.dirname(file))});\n` +
      (needsFile ? `const __pay0BundledModuleFile = require("node:path").join(__pay0BundledModuleDir, ${JSON.stringify(path.posix.basename(file))});\n` : "");
    const printed = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0]);
    const printedAst = ts.createSourceFile(file, printed, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let directiveEnd = 0;
    for (const statement of printedAst.statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
      directiveEnd = statement.end;
    }
    // Keep the original directive prologue effective after adding module paths.
    return { code: printed.slice(0, directiveEnd) + "\n" + prefix + printed.slice(directiveEnd), adjusted: true };
  } finally { transformed.dispose(); }
}
