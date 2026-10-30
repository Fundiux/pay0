// Local-only TEXT composition: exact D1 chat source+ZIP, pinned TEXT commit, no cloud IO.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.argv.slice(2).length, 4, 'BASE_SOURCE_ZIP_COMPILER_NEW_OUTPUT_REQUIRED');
const [baseSource, baseZip, compiler, out] = process.argv.slice(2).map(value => path.resolve(value));
assert(out.startsWith(path.join(repo, '.firebase/modular-release') + path.sep) && !fs.existsSync(out), 'NEW_PRIVATE_OUTPUT_REQUIRED');
for (let current = path.dirname(out); current !== repo; current = path.dirname(current)) {
  assert(current.startsWith(repo + path.sep), 'OUTPUT_SCOPE');
  if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'OUTPUT_LINK');
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseSha = '763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62';
const sourceCommit = '40bf096fcdd81c0a40e33c5574444a8f8c672e1e';
const beforeTextCommit = '175699b0ca81511055aed5895e8b81095b0e1d7e';
assert.equal(sha(fs.readFileSync(baseZip)), baseSha, 'BASE_ARCHIVE_CHANGED');
const ts = createRequire(import.meta.url)(compiler);
const JSZip = createRequire(path.join(repo, 'functions/package.json'))('jszip');
const before = await JSZip.loadAsync(fs.readFileSync(baseZip));
const source = path.join(out, 'source'), runtime = path.join(out, 'runtime');
fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(runtime);
function copyTree(from, to) {
  assert(!fs.lstatSync(from).isSymbolicLink(), 'SOURCE_LINK');
  fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    assert(!item.isSymbolicLink(), 'SOURCE_LINK');
    const a = path.join(from, item.name), b = path.join(to, item.name);
    if (item.isDirectory()) copyTree(a, b); else fs.copyFileSync(a, b);
  }
}
copyTree(path.join(baseSource, 'src'), path.join(source, 'src'));
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) fs.copyFileSync(path.join(baseSource, file), path.join(source, file));
for (const [name, entry] of Object.entries(before.files)) {
  assert(!/[\\:\x00]/.test(name) && !name.split('/').includes('..') && !path.isAbsolute(name), 'ARCHIVE_PATH');
  if (entry.dir) continue;
  const target = path.join(runtime, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, await entry.async('nodebuffer'));
}
for (const file of ['package.json', 'package-lock.json']) assert.deepEqual(fs.readFileSync(path.join(source, file)), fs.readFileSync(path.join(runtime, file)), 'DEPENDENCIES_CHANGED');
const config = ts.readConfigFile(path.join(source, 'tsconfig.json'), ts.sys.readFile);
const options = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, source).options;
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const normalized = (node, sf) => printer.printNode(ts.EmitHint.Unspecified, node, sf);
const get = (commit, file) => execFileSync('git', ['show', `${commit}:functions/${file}`], { cwd: repo, maxBuffer: 8 * 1024 * 1024 }).toString('utf8');
const prefix = 'src/modules/agent007/';
const full = ['hugoCore/conversationCore.ts', 'hugoCore/dataStoreContract.ts', 'hugoCore/hugoV2Prompt.ts', 'hugoCore/memoryContract.ts', 'hugoCore/modelContract.ts'];
const existing = ['callables.ts', 'firestoreHugoDataStore.ts', ...full].map(file => prefix + file);
const files = [...existing, prefix + 'conversationCorrections.ts'];
function emit(file, text) {
  const result = ts.transpileModule(text, { compilerOptions: options, fileName: file, reportDiagnostics: true });
  assert(!result.diagnostics?.some(row => row.category === ts.DiagnosticCategory.Error), 'TRANSPILE_FAILED');
  return result;
}
for (const file of existing) {
  const expected = await before.file(file.replace(/^src\//, 'lib/').replace(/\.ts$/, '.js')).async('string');
  assert.equal(emit(file, fs.readFileSync(path.join(source, file), 'utf8')).outputText, expected, `BASE_EMIT_MISMATCH:${file}`);
}
for (const file of full.map(file => prefix + file)) {
  const base = parse(file, fs.readFileSync(path.join(source, file), 'utf8')), parent = parse(file, get(beforeTextCommit, file));
  assert.equal(printer.printFile(base), printer.printFile(parent), `FULL_FILE_BASE_MISMATCH:${file}`);
  fs.writeFileSync(path.join(source, file), get(sourceCommit, file));
}
const handlerNames = ['sendAgent007Message', 'createAgent007MemoryCandidate', 'listAgent007MemoryDiagnostics', 'reviewAgent007MemoryCandidate'];
const methodNames = ['loadConversationState', 'saveTurn', 'retrieveMemory', 'listMemoryDiagnostics', 'reviewMemoryCandidate'];
const newMethods = ['correctResponse', 'loadTopicCorrections'];
function variable(sf, name) { return sf.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(sf) === name)); }
function klass(sf) { return sf.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FirestoreHugoDataStore'); }
function replaceNodes(file, classMode) {
  const oldText = fs.readFileSync(path.join(source, file), 'utf8'), sf = parse(file, oldText), next = parse(file, get(sourceCommit, file)), parent = parse(file, get(beforeTextCommit, file));
  const names = classMode ? methodNames : handlerNames;
  const find = (tree, name) => classMode ? klass(tree).members.find(node => node.name?.getText(tree) === name) : variable(tree, name);
  const edits = names.map(name => {
    const a = find(sf, name), b = find(next, name), previous = find(parent, name);
    assert(a && b && previous, `AST_MEMBER_MISSING:${name}`);
    assert.equal(normalized(a, sf), normalized(previous, parent), `MEMBER_BASE_MISMATCH:${name}`);
    return { start: a.getStart(sf), end: a.end, text: b.getText(next) };
  });
  if (classMode) {
    for (const name of newMethods) assert(!find(sf, name) && find(next, name), `NEW_METHOD_CONTRACT:${name}`);
    edits.push({ start: klass(sf).end - 1, end: klass(sf).end - 1, text: '\n' + newMethods.map(name => find(next, name).getText(next)).join('\n') + '\n' });
    const imports = next.statements.filter(node => ts.isImportDeclaration(node) && ['./conversationCorrections', '../../utils/authGuard'].includes(node.moduleSpecifier.text));
    assert.equal(imports.length, 2, 'IMPORT_CONTRACT');
    const at = sf.statements.filter(ts.isImportDeclaration).at(-1).end;
    edits.push({ start: at, end: at, text: '\n' + imports.map(node => node.getText(next)).join('\n') });
  }
  let text = oldText;
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  const changed = parse(file, text);
  if (classMode) {
    for (const node of klass(sf).members.filter(node => !methodNames.includes(node.name?.getText(sf)))) {
      const match = klass(changed).members.find(candidate => candidate.name?.getText(changed) === node.name?.getText(sf));
      assert(match && normalized(node, sf) === normalized(match, changed), 'UNRELATED_STORE_MEMBER_CHANGED');
    }
  } else for (const node of sf.statements.filter(node => !handlerNames.some(name => variable(sf, name) === node))) {
    assert(changed.statements.some(other => normalized(node, sf) === normalized(other, changed)), 'UNRELATED_CALLABLE_CHANGED');
  }
  fs.writeFileSync(path.join(source, file), text);
}
replaceNodes(prefix + 'callables.ts', false); replaceNodes(prefix + 'firestoreHugoDataStore.ts', true);
fs.writeFileSync(path.join(source, prefix + 'conversationCorrections.ts'), get(sourceCommit, prefix + 'conversationCorrections.ts'));
const changedEntries = [], addedEntries = [];
for (const file of files) {
  const result = emit(file, fs.readFileSync(path.join(source, file), 'utf8'));
  const js = file.replace(/^src\//, 'lib/').replace(/\.ts$/, '.js');
  for (const [name, content] of [[js, result.outputText], [js + '.map', result.sourceMapText]]) {
    assert.equal(typeof content, 'string', 'SOURCE_MAP_REQUIRED');
    const bytes = Buffer.from(content), previous = before.file(name);
    if (!previous || !bytes.equals(await previous.async('nodebuffer'))) { fs.mkdirSync(path.dirname(path.join(runtime, name)), { recursive: true }); fs.writeFileSync(path.join(runtime, name), bytes); (previous ? changedEntries : addedEntries).push(name); }
  }
}
const archive = path.join(out, 'conversation-corrections-chat.zip');
execFileSync('python', ['-c', `import pathlib,sys,zipfile,json
base,runtime,out,changes,added=sys.argv[1:];changes=set(json.loads(changes));added=json.loads(added)
with zipfile.ZipFile(base) as before,zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as after:
 for entry in before.infolist(): after.writestr(entry,(pathlib.Path(runtime)/entry.filename).read_bytes() if entry.filename in changes else before.read(entry.filename))
 for name in sorted(added):
  entry=zipfile.ZipInfo(name,(2000,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;after.writestr(entry,(pathlib.Path(runtime)/name).read_bytes())
`, baseZip, runtime, archive, JSON.stringify(changedEntries), JSON.stringify(addedEntries)], { windowsHide: true });
const after = await JSZip.loadAsync(fs.readFileSync(archive)); let preserved = 0;
for (const [name, entry] of Object.entries(before.files)) if (!entry.dir) {
  const same = (await entry.async('nodebuffer')).equals(await after.file(name).async('nodebuffer'));
  assert.equal(same, !changedEntries.includes(name), 'UNEXPECTED_RUNTIME_DELTA'); if (same) preserved++;
}
assert.deepEqual(Object.keys(after.files).sort(), [...Object.keys(before.files), ...addedEntries].sort(), 'ENTRY_SET_CHANGED');
const patchBefore = path.join(out, 'patch-before'), patchAfter = path.join(out, 'patch-after');
for (const file of files) {
  const a = path.join(patchBefore, file), b = path.join(patchAfter, file);
  fs.mkdirSync(path.dirname(a), { recursive: true }); fs.mkdirSync(path.dirname(b), { recursive: true });
  if (existing.includes(file)) fs.copyFileSync(path.join(baseSource, file), a);
  fs.copyFileSync(path.join(source, file), b);
}
const attributes = path.join(out, 'binary.attributes'); fs.writeFileSync(attributes, '*.ts binary\n');
let patch;
try { execFileSync('git', ['-c', `core.attributesFile=${attributes}`, 'diff', '--no-index', '--binary', path.relative(repo, patchBefore).split(path.sep).join('/'), path.relative(repo, patchAfter).split(path.sep).join('/')], { cwd: repo, maxBuffer: 16 * 1024 * 1024 }); assert.fail('SOURCE_PATCH_EMPTY'); }
catch (error) { assert.equal(error.status, 1, 'SOURCE_DIFF_FAILED'); patch = error.stdout.toString('utf8'); }
for (const side of ['a', 'b']) for (const folder of [patchBefore, patchAfter]) patch = patch.replaceAll(`${side}/${path.relative(repo, folder).split(path.sep).join('/')}/`, `${side}/`);
assert(!patch.includes('.env') && !patch.includes('.firebase/') && !patch.includes('C:\\'), 'PATCH_SCOPE');
fs.writeFileSync(path.join(out, 'source-only.patch'), patch);
const verify = path.join(out, 'patch-verified'); copyTree(patchBefore, verify);
const applyArgs = ['-c', 'core.autocrlf=false', 'apply', '--directory=' + path.relative(repo, verify).split(path.sep).join('/')];
execFileSync('git', [...applyArgs, '--check', path.join(out, 'source-only.patch')], { cwd: repo, stdio: 'pipe', windowsHide: true });
execFileSync('git', [...applyArgs, path.join(out, 'source-only.patch')], { cwd: repo, stdio: 'pipe', windowsHide: true });
for (const file of files) assert.deepEqual(fs.readFileSync(path.join(verify, file)), fs.readFileSync(path.join(source, file)), 'SOURCE_PATCH_RESULT_MISMATCH');
const manifest = { status: 'LOCAL_CANDIDATE_UNTESTED', sourceCommit, sourceTree: null, baseArchiveSha256: baseSha, archiveSha256: sha(fs.readFileSync(archive)), patchSha256: sha(Buffer.from(patch)), sourceFiles: files, targets: ['sendAgent007Message'], handlerChanges: handlerNames, storeMethodChanges: [...methodNames, ...newMethods], changedEntries, addedEntries, preservedFiles: preserved, entries: Object.keys(after.files).length, productionWrites: 0 };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest));
