// Exact c50 memory overlay. Separate reader/reviewer and producer entry wrappers.
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import { createHash } from 'node:crypto'; import { createRequire } from 'node:module'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.argv.slice(2).length, 4, 'BASE_COMPILER_NEW_OUTPUT_MODE_REQUIRED');
const [baseArg, compilerArg, outArg, mode] = process.argv.slice(2), baseZip = path.resolve(baseArg), compiler = path.resolve(compilerArg), out = path.resolve(outArg);
assert(['readers', 'producer'].includes(mode), 'EXACT_MODE_REQUIRED');
assert(out.startsWith(path.join(repo, '.firebase/modular-release') + path.sep) && !fs.existsSync(out), 'NEW_PRIVATE_OUTPUT_REQUIRED');
for (let p = path.dirname(out); p !== repo; p = path.dirname(p)) { assert(p.startsWith(repo + path.sep)); if (fs.existsSync(p)) assert(!fs.lstatSync(p).isSymbolicLink(), 'OUTPUT_LINK'); }
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), baseSha = 'c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f';
assert.equal(sha(fs.readFileSync(baseZip)), baseSha, 'BASE_CHANGED');
const commit = '0382fcc97a42ed6064e3528c8d99faaca9f753f3', ts = createRequire(import.meta.url)(compiler), Zip = createRequire(path.join(repo, 'functions/package.json'))('jszip');
const zip = await Zip.loadAsync(fs.readFileSync(baseZip)), source = path.join(out, 'source'), runtime = path.join(out, 'runtime');
fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(runtime);
for (const [name, entry] of Object.entries(zip.files)) {
  assert(!/[\\:\x00]/.test(name) && !name.split('/').includes('..') && !path.isAbsolute(name), 'ARCHIVE_PATH'); if (entry.dir) continue;
  const bytes = await entry.async('nodebuffer'), target = path.join(runtime, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  if (name.startsWith('src/') || ['package.json', 'package-lock.json', 'tsconfig.json'].includes(name)) { const file = path.join(source, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
}
const config = ts.readConfigFile(path.join(source, 'tsconfig.json'), ts.sys.readFile), options = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, source).options;
const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const normal = (node, sf) => printer.printNode(ts.EmitHint.Unspecified, node, sf);
const get = (revision, file) => execFileSync('git', ['show', `${revision}:functions/${file}`], { cwd: repo, maxBuffer: 8 * 1024 * 1024 }).toString('utf8');
const prefix = 'src/modules/agent007/', existing = [prefix + 'callables.ts', prefix + 'firestoreHugoDataStore.ts', prefix + 'hugoCore/memoryContract.ts'];
const emit = (file, text, overrides = {}) => { const out = ts.transpileModule(text, { compilerOptions: { ...options, ...overrides }, fileName: file, reportDiagnostics: true }); assert(!out.diagnostics?.some(row => row.category === ts.DiagnosticCategory.Error)); return out; };
for (const file of existing) assert.equal(emit(file, fs.readFileSync(path.join(source, file), 'utf8')).outputText, await zip.file(file.replace(/^src\//, 'lib/').replace(/\.ts$/, '.js')).async('string'), 'BASE_EMIT_MISMATCH:' + file);
const handlers = ['createAgent007MemoryCandidate', 'listAgent007MemoryDiagnostics', 'reviewAgent007MemoryCandidate'];
const methods = ['listMemoryDiagnostics', 'reviewMemoryCandidate'];
const variable = (sf, name) => sf.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(row => row.name.getText(sf) === name));
const klass = sf => sf.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FirestoreHugoDataStore');
for (const [file, classMode] of [[existing[0], false], [existing[1], true]]) {
  const text = fs.readFileSync(path.join(source, file), 'utf8'), old = parse(file, text), current = parse(file, get(commit, file)), previous = parse(file, get(commit + '^', file));
  const names = classMode ? methods : handlers, find = (sf, name) => classMode ? klass(sf).members.find(node => node.name?.getText(sf) === name) : variable(sf, name);
  const edits = names.map(name => { const a = find(old, name), b = find(current, name), p = find(previous, name); assert(a && b && p); assert.equal(normal(a, old), normal(p, previous), 'MEMBER_BASE_MISMATCH:' + name); return { start: a.getStart(old), end: a.end, text: b.getText(current) }; });
  if (classMode) {
    assert(!find(old, 'correctResponse')); edits.push({ start: klass(old).end - 1, end: klass(old).end - 1, text: '\n' + find(current, 'correctResponse').getText(current) + '\n' });
    const imports = current.statements.filter(node => ts.isImportDeclaration(node) && ['./conversationCorrections', '../../utils/authGuard'].includes(node.moduleSpecifier.text)); assert.equal(imports.length, 2);
    const at = old.statements.filter(ts.isImportDeclaration).at(-1).end;
    // The loader is chat-only; its type import is harmless and no loader implementation is copied.
    edits.push({ start: at, end: at, text: '\n' + imports.map(node => node.getText(current)).join('\n') });
  }
  let result = text; for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  const next = parse(file, result);
  if (classMode) for (const node of klass(old).members.filter(node => !methods.includes(node.name?.getText(old)))) {
    const match = klass(next).members.find(row => row.name?.getText(next) === node.name?.getText(old)); assert(match && normal(node, old) === normal(match, next), 'UNRELATED_STORE_CHANGED');
  } else for (const node of old.statements.filter(node => !handlers.some(name => variable(old, name) === node))) assert(next.statements.some(row => normal(node, old) === normal(row, next)), 'UNRELATED_CALLABLE_CHANGED');
  fs.writeFileSync(path.join(source, file), result);
}
const memoryFile = existing[2], memoryOld = parse(memoryFile, fs.readFileSync(path.join(source, memoryFile), 'utf8')), memoryPrevious = parse(memoryFile, get(commit + '^', memoryFile));
assert.equal(printer.printFile(memoryOld), printer.printFile(memoryPrevious), 'MEMORY_CONTRACT_BASE_MISMATCH');
fs.writeFileSync(path.join(source, memoryFile), get(commit, memoryFile));
const helper = prefix + 'conversationCorrections.ts'; fs.writeFileSync(path.join(source, helper), get(commit, helper));
const targets = mode === 'readers' ? ['listAgent007MemoryDiagnostics', 'reviewAgent007MemoryCandidate'] : ['createAgent007MemoryCandidate'];
const entryFile = 'src/conversationCorrectionEntry.ts';
const entry = `const original = require("./conversation-correction-baseline-index");\nconst patched = require("./modules/agent007/callables");\nconst descriptors = Object.getOwnPropertyDescriptors(original);\nfor (const name of ${JSON.stringify(targets)}) {\n  if (!Object.prototype.hasOwnProperty.call(descriptors, name) || typeof patched[name] !== "function") throw Error("CORRECTION_EXPORT_CONTRACT");\n  descriptors[name] = { enumerable: descriptors[name].enumerable, configurable: descriptors[name].configurable, writable: false, value: patched[name] };\n}\nmodule.exports = Object.defineProperties({}, descriptors);\n`;
fs.writeFileSync(path.join(source, entryFile), entry);
const sourceFiles = [...existing, helper, entryFile], changed = new Set(), added = new Set();
for (const file of sourceFiles) {
  const text = fs.readFileSync(path.join(source, file), 'utf8'), original = zip.file(file);
  fs.mkdirSync(path.dirname(path.join(runtime, file)), { recursive: true }); fs.writeFileSync(path.join(runtime, file), text);
  if (!original) added.add(file); else if (!(await original.async('nodebuffer')).equals(Buffer.from(text))) changed.add(file);
  if (file === entryFile) continue;
  const emitted = emit(file, text), name = file.replace(/^src\//, 'lib/').replace(/\.ts$/, '.js');
  for (const [target, content] of [[name, emitted.outputText], [name + '.map', emitted.sourceMapText]]) {
    assert.equal(typeof content, 'string'); const old = zip.file(target), bytes = Buffer.from(content);
    if (!old || !(await old.async('nodebuffer')).equals(bytes)) { fs.mkdirSync(path.dirname(path.join(runtime, target)), { recursive: true }); fs.writeFileSync(path.join(runtime, target), bytes); (old ? changed : added).add(target); }
  }
}
const originalEntry = await zip.file('lib/index.js').async('nodebuffer');
assert(!zip.file('lib/conversation-correction-baseline-index.js')); fs.writeFileSync(path.join(runtime, 'lib/conversation-correction-baseline-index.js'), originalEntry); added.add('lib/conversation-correction-baseline-index.js');
fs.writeFileSync(path.join(runtime, 'lib/index.js'), emit(entryFile, entry, { sourceMap: false }).outputText); changed.add('lib/index.js');
const archive = path.join(out, `conversation-corrections-memory-${mode}.zip`);
execFileSync('python', ['-c', `import pathlib,sys,zipfile,json
base,runtime,out,changed,added=sys.argv[1:];changed=set(json.loads(changed));added=json.loads(added)
with zipfile.ZipFile(base) as before,zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as after:
 for entry in before.infolist(): after.writestr(entry,(pathlib.Path(runtime)/entry.filename).read_bytes() if entry.filename in changed else before.read(entry.filename))
 for name in sorted(added):
  entry=zipfile.ZipInfo(name,(2000,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;after.writestr(entry,(pathlib.Path(runtime)/name).read_bytes())
`, baseZip, runtime, archive, JSON.stringify([...changed]), JSON.stringify([...added])], { windowsHide: true });
const removedEntries = Object.keys(zip.files).filter(name => !zip.files[name].dir && name.split('/').at(-1).startsWith('.env'));
// Deployment artifacts must never carry dotenv files, including inherited opaque files.
const sanitized = await Zip.loadAsync(fs.readFileSync(archive));
for (const name of removedEntries) { sanitized.remove(name); fs.unlinkSync(path.join(runtime, name)); }
if (removedEntries.length) fs.writeFileSync(archive, await sanitized.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
const after = await Zip.loadAsync(fs.readFileSync(archive)); let preserved = 0;
assert.deepEqual(Object.keys(after.files).sort(), [...Object.keys(zip.files).filter(name => !removedEntries.includes(name)), ...added].sort());
for (const [name, value] of Object.entries(zip.files)) if (!value.dir && !removedEntries.includes(name)) { const equal = (await value.async('nodebuffer')).equals(await after.file(name).async('nodebuffer')); assert.equal(equal, !changed.has(name), 'UNEXPECTED_DELTA:' + name); if (equal) preserved++; }
const patchBefore = path.join(out, 'patch-before'), patchAfter = path.join(out, 'patch-after'), verify = path.join(out, 'patch-verified');
for (const file of sourceFiles) {
  for (const folder of [patchBefore, patchAfter, verify]) fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
  if (zip.file(file)) { const bytes = await zip.file(file).async('nodebuffer'); fs.writeFileSync(path.join(patchBefore, file), bytes); fs.writeFileSync(path.join(verify, file), bytes); }
  fs.copyFileSync(path.join(source, file), path.join(patchAfter, file));
}
const attributes = path.join(out, 'binary.attributes'); fs.writeFileSync(attributes, '*.ts binary\n'); let patch;
try { execFileSync('git', ['-c', `core.attributesFile=${attributes}`, 'diff', '--no-index', '--binary', path.relative(repo, patchBefore).split(path.sep).join('/'), path.relative(repo, patchAfter).split(path.sep).join('/')], { cwd: repo, maxBuffer: 16 * 1024 * 1024 }); assert.fail('EMPTY_PATCH'); }
catch (error) { assert.equal(error.status, 1); patch = error.stdout.toString('utf8'); }
for (const side of ['a', 'b']) for (const folder of [patchBefore, patchAfter]) patch = patch.replaceAll(`${side}/${path.relative(repo, folder).split(path.sep).join('/')}/`, `${side}/`);
assert(!patch.includes('.env') && !patch.includes('.firebase/') && !patch.includes('C:\\'), 'PATCH_SCOPE');
const patchFile = path.join(out, 'source-only.patch'); fs.writeFileSync(patchFile, patch);
const apply = ['-c', 'core.autocrlf=false', 'apply', '--directory=' + path.relative(repo, verify).split(path.sep).join('/')];
execFileSync('git', [...apply, '--check', patchFile], { cwd: repo, stdio: 'pipe', windowsHide: true });
execFileSync('git', [...apply, patchFile], { cwd: repo, stdio: 'pipe', windowsHide: true });
for (const file of sourceFiles) assert.deepEqual(fs.readFileSync(path.join(verify, file)), fs.readFileSync(path.join(source, file)), 'PATCH_RESULT_MISMATCH');
const manifest = { status: 'LOCAL_CANDIDATE_UNTESTED', sourceCommit: commit, sourceTree: null, mode, baseArchiveSha256: baseSha, archiveSha256: sha(fs.readFileSync(archive)), patchSha256: sha(Buffer.from(patch)), baselineIndexSha256: sha(originalEntry), sourceFiles, targets, changedEntries: [...changed], addedEntries: [...added], removedEntries, preservedFiles: preserved, entries: Object.keys(after.files).length, productionWrites: 0 };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest));
