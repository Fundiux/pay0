const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const ts = require('typescript');

// Execute the exact candidate bytes. The in-memory suffix only exposes existing
// CommonJS factories to QA; it never changes their bodies or persists a hook.
function loadBundle({artifact, dependencyRoot, externalMocks = {}, fetch = async () => {throw Error('EXTERNAL_NETWORK_FORBIDDEN');}}) {
  const filename = path.resolve(artifact, 'lib/index.js');
  const bytes = fs.readFileSync(filename), code = bytes.toString('utf8');
  const provenance = JSON.parse(fs.readFileSync(path.resolve(artifact, '../provenance.json'), 'utf8'));
  const expected = provenance.outputs.find(x => x.file === 'lib/index.js')?.sha256;
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (!expected || actual !== expected) throw Error('BUNDLE_HASH_MISMATCH');
  const ast = ts.createSourceFile('index.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const factories = new Map();
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!ts.isIdentifier(declaration.name) || !call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== '__commonJS') continue;
      const object = call.arguments[0];
      if (!object || !ts.isObjectLiteralExpression(object) || object.properties.length !== 1 || !ts.isMethodDeclaration(object.properties[0]) || !ts.isStringLiteral(object.properties[0].name)) throw Error('FACTORY_AST_CHANGED');
      const key = object.properties[0].name.text;
      if (path.isAbsolute(key) || key.split(/[\\/]/).includes('..') || factories.has(key)) throw Error('FACTORY_SCOPE');
      factories.set(key, declaration.name.text);
    }
  }
  if (factories.size < 200) throw Error('FACTORIES_MISSING');
  const literal = [...factories].map(([key, identifier]) => `${JSON.stringify(key)}:${identifier}`).join(',');
  const suffix = `\n;return {api:module.exports, factories:{${literal}}};`;
  const nativeRequire = createRequire(path.resolve(dependencyRoot, 'package.json'));
  const requireExternal = name => {
    if (Object.hasOwn(externalMocks, name)) return externalMocks[name];
    if (name.startsWith('.') || path.isAbsolute(name)) throw Error('UNBUNDLED_INTERNAL_REQUIRE');
    return nativeRequire(name);
  };
  requireExternal.resolve = name => {
    if (name.startsWith('.') || path.isAbsolute(name)) throw Error('INTERNAL_REQUIRE_RESOLVE');
    return nativeRequire.resolve(name);
  };
  const module = {exports: {}};
  const execute = new Function('exports', 'require', 'module', '__filename', '__dirname', 'process', 'Buffer', 'fetch', code + suffix);
  const result = execute(module.exports, requireExternal, module, filename, path.dirname(filename), process, Buffer, fetch);
  return {
    api: result.api, sha256: actual,
    loadInternal(key) {
      const loader = result.factories[key];
      if (typeof loader !== 'function') throw Error('BUNDLE_MODULE_NOT_FOUND');
      return loader();
    },
  };
}
module.exports = {loadBundle};
