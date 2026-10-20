import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseUniqueJson } from './verify-technology-baseline.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const parse = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const exported = node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);

// Count canonical handler registrations, not matching prose or similar code.
// Aliasing a handler into a second deployed endpoint is a duplication too.
export function inspectCapabilityRegistrations(root, manifest) {
  const entryPath = path.resolve(root, manifest.entrypoint);
  const entry = parse(entryPath, fs.readFileSync(entryPath, 'utf8'));
  const registrations = [];
  for (const statement of entry.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly || statement.isTypeOnly) continue;
      registrations.push({ module: statement.moduleSpecifier.text, symbol: (element.propertyName || element.name).text, endpoint: element.name.text });
    }
  }
  const failures = [];
  for (const contract of manifest.contracts) {
    const matches = registrations.filter(item => item.module === contract.module && item.symbol === contract.symbol);
    if (matches.length !== 1 || matches[0].endpoint !== contract.symbol) {
      failures.push({ capability: contract.capability, code: matches.length > 1 ? 'DUPLICATE_HANDLER_REGISTRATION' : 'CANONICAL_ENDPOINT_MISSING', registrations: matches });
    }
    const collisions = registrations.filter(item => item.endpoint === contract.symbol);
    if (collisions.length !== 1) failures.push({ capability: contract.capability, code: 'ENDPOINT_NAME_COLLISION', count: collisions.length });
    const modulePath = path.resolve(path.dirname(entryPath), contract.module + '.ts');
    if (!fs.existsSync(modulePath)) {
      failures.push({ capability: contract.capability, code: 'HANDLER_MODULE_MISSING' });
      continue;
    }
    const module = parse(modulePath, fs.readFileSync(modulePath, 'utf8'));
    const onCallNames = new Set();
    for (const statement of module.statements) {
      if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'firebase-functions/v2/https') continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
        if ((element.propertyName || element.name).text === 'onCall') onCallNames.add(element.name.text);
      }
    }
    const definitions = module.statements.filter(statement => ts.isVariableStatement(statement) && exported(statement))
      .flatMap(statement => [...statement.declarationList.declarations])
      .filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === contract.symbol);
    const initializer = definitions[0]?.initializer;
    if (definitions.length !== 1 || !initializer || !ts.isCallExpression(initializer) ||
        !ts.isIdentifier(initializer.expression) || !onCallNames.has(initializer.expression.text)) {
      failures.push({ capability: contract.capability, code: 'CALLABLE_DEFINITION_MISSING_OR_REPLACED' });
    }
  }
  return { schemaVersion: 1, scope: 'canonical-callable-registration', status: failures.length ? 'FAILED' : 'PASSED', checked: manifest.contracts.length, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.cwd();
  const baseline = spawnSync(process.execPath, ['qa/scripts/verify-release-baseline.mjs'], { cwd: root, stdio: 'inherit' });
  if (baseline.status !== 0) process.exitCode = 1;
  else {
    const manifest = parseUniqueJson(fs.readFileSync(path.join(root, 'config/evolution-capability-contracts.json'), 'utf8'));
    const result = inspectCapabilityRegistrations(root, manifest);
    console.log(JSON.stringify(result, null, 2));
    if (result.failures.length) process.exitCode = 1;
  }
}
