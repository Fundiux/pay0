// Local source-only overlay on the published personal-learning chat. No cloud IO.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.argv.slice(2).length, 5, 'BASE_SOURCE_ZIP_COMPILER_NEW_OUTPUT_SOURCE_COMMIT_REQUIRED');
const [sourceArg, zipArg, compilerArg, outputArg, sourceCommit] = process.argv.slice(2);
assert.match(sourceCommit, /^[a-f0-9]{40}$/, 'EXACT_SOURCE_COMMIT_REQUIRED');
const [baseSource, baseZip, compiler, out] = [sourceArg, zipArg, compilerArg, outputArg].map(value => path.resolve(value));
assert(out.startsWith(path.join(repo, '.firebase/modular-release') + path.sep) && !fs.existsSync(out), 'NEW_PRIVATE_OUTPUT_REQUIRED');
for (let current = path.dirname(out); current !== repo; current = path.dirname(current)) {
  assert(current.startsWith(repo + path.sep), 'OUTPUT_SCOPE');
  if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'OUTPUT_LINK');
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseSha = '22cbdbd9ca1426afb654b0830934b3e491b4dbbc7b909050ebe616811caa5588';
const parentCommit = '40bf096fcdd81c0a40e33c5574444a8f8c672e1e';
assert.equal(sha(fs.readFileSync(baseZip)), baseSha, 'BASE_ARCHIVE_CHANGED');
assert.equal(execFileSync('git', ['rev-parse', sourceCommit + '^{commit}'], { cwd: repo }).toString().trim(), sourceCommit);
const ts = createRequire(import.meta.url)(compiler), Zip = createRequire(path.join(repo, 'functions/package.json'))('jszip');
const before = await Zip.loadAsync(fs.readFileSync(baseZip));
const source = path.join(out, 'source'), runtime = path.join(out, 'runtime');
function copyTree(from, to) {
  assert(!fs.lstatSync(from).isSymbolicLink(), 'SOURCE_LINK'); fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    assert(!item.isSymbolicLink(), 'SOURCE_LINK');
    const a = path.join(from, item.name), b = path.join(to, item.name);
    if (item.isDirectory()) copyTree(a, b); else fs.copyFileSync(a, b);
  }
}
copyTree(path.join(baseSource, 'src'), path.join(source, 'src')); fs.mkdirSync(runtime);
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) fs.copyFileSync(path.join(baseSource, file), path.join(source, file));
for (const [name, entry] of Object.entries(before.files)) {
  assert(!/[\\:\x00-\x1f]/.test(name) && !name.split('/').includes('..') && !path.isAbsolute(name), 'ARCHIVE_PATH');
  assert(!name.split('/').at(-1).startsWith('.env'), 'DOTENV_ARCHIVE_REJECTED');
  if (entry.dir) continue;
  const target = path.join(runtime, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, await entry.async('nodebuffer'));
}
for (const file of ['package.json', 'package-lock.json']) assert.deepEqual(fs.readFileSync(path.join(source, file)), fs.readFileSync(path.join(runtime, file)), 'DEPENDENCIES_CHANGED');
const config = ts.readConfigFile(path.join(source, 'tsconfig.json'), ts.sys.readFile); assert(!config.error, 'TSCONFIG_INVALID');
const converted = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, source); assert.equal(converted.errors.length, 0);
const options = converted.options, printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const files = ['pay0Connector.ts', 'hugoCore/conversationCore.ts', 'hugoCore/contextBuilderV2.ts', 'hugoCore/conversationState.ts', 'hugoCore/interactionSemantics.ts', 'hugoCore/hugoV2Prompt.ts'].map(file => 'src/modules/agent007/' + file);
const get = (commit, file) => execFileSync('git', ['show', commit + ':functions/' + file], { cwd: repo, maxBuffer: 8 * 1024 * 1024 }).toString('utf8');
const ast = (file, text) => printer.printFile(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
const emit = (file, text) => { const result = ts.transpileModule(text, { compilerOptions: options, fileName: file, reportDiagnostics: true }); assert(!result.diagnostics?.some(row => row.category === ts.DiagnosticCategory.Error), 'TRANSPILE_FAILED'); return result; };
function receiptParts(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const statement = sf.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(sf) === 'pagoView'));
  const declaration = statement?.declarationList.declarations.find(decl => decl.name.getText(sf) === 'pagoView');
  assert(declaration && ts.isArrowFunction(declaration.initializer) && ts.isBlock(declaration.initializer.body), 'PAYMENT_VIEW_AST');
  const block = declaration.initializer.body;
  const semantic = block.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl => decl.name.getText(sf) === 'semanticReceipt'));
  const returned = block.statements.find(ts.isReturnStatement), object = returned?.expression;
  assert(object && ts.isObjectLiteralExpression(object), 'PAYMENT_VIEW_RETURN_AST');
  const property = object.properties.find(node => node.name?.getText(sf) === 'comprobante');
  return { sf, semantic, returned, object, property };
}
function withoutReceipt(file, text) {
  const parts = receiptParts(file, text); assert(parts.semantic && parts.property, 'BASE_RECEIPT_CAPABILITY_REQUIRED');
  const properties = parts.object.properties, index = properties.indexOf(parts.property);
  assert(index > 0 && index === properties.length - 1, 'BASE_RECEIPT_PROPERTY_SHAPE');
  const edits = [{ start: properties[index - 1].end, end: parts.property.end }, { start: parts.semantic.getStart(parts.sf), end: parts.semantic.end }];
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + text.slice(edit.end);
  return text;
}
function preserveReceipt(file, old, next) {
  const base = receiptParts(file, old), current = receiptParts(file, next);
  assert(base.semantic && base.property, 'BASE_RECEIPT_CAPABILITY_REQUIRED');
  const printed = (node, sf) => printer.printNode(ts.EmitHint.Unspecified, node, sf);
  if (current.semantic || current.property) {
    assert(current.semantic && current.property, 'PARTIAL_RECEIPT_RECONCILIATION');
    assert.equal(printed(current.semantic, current.sf), printed(base.semantic, base.sf), 'COMMITTED_RECEIPT_DECLARATION_CHANGED');
    assert.equal(printed(current.property, current.sf), printed(base.property, base.sf), 'COMMITTED_RECEIPT_PROPERTY_CHANGED');
    return next;
  }
  const edits = [{ start: current.returned.getStart(current.sf), text: base.semantic.getText(base.sf) + '\n' },
    { start: current.object.properties.at(-1).end, text: ',\n' + base.property.getText(base.sf) }];
  let result = next;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.start);
  assert.equal(ast(file, withoutReceipt(file, result)), ast(file, next), 'UNRELATED_CONNECTOR_ADAPTATION');
  const adapted = receiptParts(file, result);
  assert.equal(printer.printNode(ts.EmitHint.Unspecified, adapted.property, adapted.sf), printer.printNode(ts.EmitHint.Unspecified, base.property, base.sf), 'RECEIPT_PROPERTY_CHANGED');
  return result;
}
const changedEntries = [], sourceHashes = [];
for (const file of files) {
  const old = fs.readFileSync(path.join(source, file), 'utf8'), committed = get(sourceCommit, file), js = file.replace(/^src\//, 'lib/').replace(/\.ts$/, '.js');
  const connector = file.endsWith('/pay0Connector.ts');
  assert.equal(ast(file, connector ? withoutReceipt(file, old) : old), ast(file, get(parentCommit, file)), 'PARENT_AST_MISMATCH:' + file);
  const next = connector ? preserveReceipt(file, old, committed) : committed;
  assert.equal(emit(file, old).outputText, await before.file(js).async('string'), 'BASE_EMIT_MISMATCH:' + file);
  fs.writeFileSync(path.join(source, file), next); sourceHashes.push({ file, beforeSha256: sha(Buffer.from(old)), afterSha256: sha(Buffer.from(next)) });
  const result = emit(file, next);
  for (const [name, content] of [[js, result.outputText], [js + '.map', result.sourceMapText]]) {
    assert.equal(typeof content, 'string', 'SOURCE_MAP_REQUIRED'); const bytes = Buffer.from(content);
    const previous = before.file(name); assert(previous, 'NO_NEW_RUNTIME_ENTRIES');
    if (!bytes.equals(await previous.async('nodebuffer'))) { fs.writeFileSync(path.join(runtime, name), bytes); changedEntries.push(name); }
  }
}
const archive = path.join(out, 'operational-dialogue-chat.zip');
execFileSync('python', ['-c', `import pathlib,sys,zipfile,json
base,runtime,out,changes=sys.argv[1:];changes=set(json.loads(changes))
with zipfile.ZipFile(base) as before,zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as after:
 for entry in before.infolist(): after.writestr(entry,(pathlib.Path(runtime)/entry.filename).read_bytes() if entry.filename in changes else before.read(entry.filename))
`, baseZip, runtime, archive, JSON.stringify(changedEntries)], { windowsHide: true });
const after = await Zip.loadAsync(fs.readFileSync(archive)); let preserved = 0;
assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort(), 'ENTRY_SET_CHANGED');
for (const [name, entry] of Object.entries(before.files)) if (!entry.dir) { const equal = (await entry.async('nodebuffer')).equals(await after.file(name).async('nodebuffer')); assert.equal(equal, !changedEntries.includes(name), 'UNEXPECTED_RUNTIME_DELTA:' + name); if (equal) preserved++; }
const patchBefore = path.join(out, 'patch-before'), patchAfter = path.join(out, 'patch-after');
for (const file of files) { for (const folder of [patchBefore, patchAfter]) fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); fs.copyFileSync(path.join(baseSource, file), path.join(patchBefore, file)); fs.copyFileSync(path.join(source, file), path.join(patchAfter, file)); }
const attributes = path.join(out, 'binary.attributes'); fs.writeFileSync(attributes, '*.ts binary\n'); let patch;
try { execFileSync('git', ['-c', 'core.attributesFile=' + attributes, 'diff', '--no-index', '--binary', path.relative(repo, patchBefore).replaceAll('\\', '/'), path.relative(repo, patchAfter).replaceAll('\\', '/')], { cwd: repo, maxBuffer: 16 * 1024 * 1024 }); assert.fail('SOURCE_PATCH_EMPTY'); }
catch (error) { assert.equal(error.status, 1, 'SOURCE_DIFF_FAILED'); patch = error.stdout.toString(); }
for (const side of ['a', 'b']) for (const folder of [patchBefore, patchAfter]) patch = patch.replaceAll(side + '/' + path.relative(repo, folder).replaceAll('\\', '/') + '/', side + '/');
assert(!patch.includes('.env') && !patch.includes('.firebase/') && !patch.includes('C:\\'), 'PATCH_SCOPE');
const patchFile = path.join(out, 'source-only.patch'); fs.writeFileSync(patchFile, patch);
const verify = path.join(out, 'patch-verified'); copyTree(patchBefore, verify);
const apply = ['-c', 'core.autocrlf=false', 'apply', '--directory=' + path.relative(repo, verify).replaceAll('\\', '/')];
execFileSync('git', [...apply, '--check', patchFile], { cwd: repo, windowsHide: true, stdio: 'pipe' }); execFileSync('git', [...apply, patchFile], { cwd: repo, windowsHide: true, stdio: 'pipe' });
for (const file of files) assert.deepEqual(fs.readFileSync(path.join(verify, file)), fs.readFileSync(path.join(source, file)), 'PATCH_RESULT_MISMATCH');
const manifest = { status: 'LOCAL_CANDIDATE_UNTESTED', buildMode: 'NORMAL', sourceCommit, sourceTree: null, parentCommit, baseArchiveSha256: baseSha, archiveSha256: sha(fs.readFileSync(archive)), patchSha256: sha(Buffer.from(patch)), targets: ['sendAgent007Message'], sourceFiles: files, sourceHashes, adaptations: ['pay0Connector.pagoView retains the exact published semanticReceipt declaration and comprobante property; remaining AST equals the committed fix.'], changedEntries, addedEntries: [], removedEntries: [], entries: Object.keys(after.files).length, preservedFiles: preserved, productionWrites: 0 };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest));
