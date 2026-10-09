import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const base = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('core-manifest.json', base), 'utf8'));
if (manifest.schema !== 'PAY0-SENTINEL-CORE-BUILD@1') throw new Error('INVALID_CORE_MANIFEST');
await mkdir(new URL('.build/core/', base), { recursive: true });
for (const [name, expected] of Object.entries(manifest.files)) {
  if (!/^(schema|policy|detector|store|transactionalStore|ingress)\.ts$/.test(name)) throw new Error('INVALID_CORE_FILE');
  const source = (await readFile(new URL(`../../functions/src/modules/sentinel/${name}`, base), 'utf8')).replace(/\r\n/g, '\n');
  if (createHash('sha256').update(source).digest('hex') !== expected) throw new Error(`CORE_CHANGED_REVIEW_REQUIRED:${name}`);
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.ES2022, true);
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && !/^\.\/(schema|policy|detector|store|transactionalStore|ingress)$|^node:crypto$/.test(statement.moduleSpecifier.text)) throw new Error('NON_ISOLATED_CORE_IMPORT');
  }
  const result = ts.transpileModule(source, { fileName: name, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true } });
  if (result.diagnostics?.length) throw new Error('CORE_TRANSPILE_FAILED');
  await writeFile(new URL(`.build/core/${name.replace(/\.ts$/, '.js')}`, base), result.outputText);
}
console.log(JSON.stringify({ built: 'PAY0-SENTINEL-CORE-BUILD@1', files: Object.keys(manifest.files).length }));
