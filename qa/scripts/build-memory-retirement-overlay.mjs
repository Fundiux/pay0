// Reproduce the single-method D3 ACK overlay on its captured, env-free runtime.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.argv.length, 5, 'BASE_ZIP_COMPILER_NEW_OUTPUT_REQUIRED');
const [baseArg, compilerArg, outputArg] = process.argv.slice(2);
const base = path.resolve(baseArg), out = path.resolve(outputArg);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseSha = 'f0787837136d9a279321810f8195a8c5d31ccc9eea0d99190fea6a41c4a3fcb6';
const commit = '65ca03305e6862aa1f420a26bf95c3e1eb16155a';
assert.equal(sha(fs.readFileSync(base)), baseSha, 'BASE_SHA');
assert(out.startsWith(path.join(repo, '.firebase/modular-release') + path.sep) && !fs.existsSync(out), 'NEW_PRIVATE_OUTPUT');
for (let ancestor = path.dirname(out); ancestor !== repo; ancestor = path.dirname(ancestor)) {
  assert(ancestor.startsWith(repo + path.sep), 'OUTPUT_SCOPE');
  if (fs.existsSync(ancestor)) assert(!fs.lstatSync(ancestor).isSymbolicLink(), 'OUTPUT_ANCESTOR_LINK');
}
const load = createRequire(path.join(repo, 'functions/package.json'));
const Zip = load('jszip'), ts = load(path.resolve(compilerArg));
const zip = await Zip.loadAsync(fs.readFileSync(base));
const file = 'src/modules/agent007/firestoreHugoDataStore.ts';
const js = file.replace(/^src\//, 'lib/').replace(/\.ts$/, '.js');
const text = await zip.file(file).async('string');
const config = JSON.parse(await zip.file('tsconfig.json').async('string'));
const options = ts.convertCompilerOptionsFromJson(config.compilerOptions, '.').options;
const emit = source => ts.transpileModule(source, { fileName: file, compilerOptions: options, reportDiagnostics: true });
const oldEmit = emit(text);
assert.equal(oldEmit.outputText, await zip.file(js).async('string'), 'BASE_SOURCE_EMIT');
const oldMap = JSON.parse(await zip.file(js + '.map').async('string'));
const reproducedMap = JSON.parse(oldEmit.sourceMapText);
// The inherited map used an incorrect relative source path. Require identical
// mappings and metadata; give the new map its actual runtime-relative TS path.
assert.deepEqual(oldMap.sources, [file], 'BASE_MAP_SOURCE_IDENTITY');
assert.deepEqual({ ...oldMap, sources: [] }, { ...reproducedMap, sources: [] }, 'BASE_SOURCE_MAP_MAPPINGS');
const git = revision => execFileSync('git', ['show', `${revision}:functions/${file}`], { cwd: repo, encoding: 'utf8', windowsHide: true });
const parse = value => ts.createSourceFile(file, value, ts.ScriptTarget.Latest, true);
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const signature = (node, source) => printer.printNode(ts.EmitHint.Unspecified, node, source);
const klass = source => source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FirestoreHugoDataStore');
const method = source => klass(source).members.find(node => node.name?.getText(source) === 'reviewMemoryCandidate');
const original = parse(text), parent = parse(git(commit + '^')), current = parse(git(commit));
assert.equal(signature(method(original), original), signature(method(parent), parent), 'METHOD_PARENT');
const oldMethod = method(original);
const result = text.slice(0, oldMethod.getStart(original)) + method(current).getText(current) + text.slice(oldMethod.end);
const next = parse(result);
for (const member of klass(original).members.filter(node => node !== oldMethod)) {
  const match = klass(next).members.find(node => node.name?.getText(next) === member.name?.getText(original));
  assert(match && signature(member, original) === signature(match, next), 'OTHER_METHOD_CHANGED');
}
for (const node of original.statements.filter(node => node !== klass(original))) {
  assert(next.statements.some(candidate => signature(node, original) === signature(candidate, next)), 'OTHER_STATEMENT_CHANGED');
}
assert.equal(signature(method(next), next), signature(method(current), current), 'METHOD_FINAL');
const emitted = emit(result);
assert(!emitted.diagnostics?.some(row => row.category === ts.DiagnosticCategory.Error), 'TRANSPILE_ERROR');
const nextMap = JSON.parse(emitted.sourceMapText);
nextMap.sources = [path.posix.relative(path.posix.dirname(js), file)];
const replacements = new Map([[file, Buffer.from(result)], [js, Buffer.from(emitted.outputText)], [js + '.map', Buffer.from(JSON.stringify(nextMap))]]);
fs.mkdirSync(out, { recursive: false });
const runtime = path.join(out, 'runtime'), source = path.join(out, 'source');
fs.mkdirSync(runtime); fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
fs.writeFileSync(path.join(source, file), result);
let preserved = 0;
for (const [name, entry] of Object.entries(zip.files)) {
  assert(!/[\\:\x00-\x1f]/.test(name) && !name.split('/').includes('..') && !path.isAbsolute(name), 'ARCHIVE_PATH');
  assert(!name.split('/').at(-1).startsWith('.env'), 'DOTENV_FORBIDDEN');
  if (entry.dir) continue;
  const bytes = await entry.async('nodebuffer'), replacement = replacements.get(name);
  const target = path.join(runtime, name); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, replacement || bytes);
  if (replacement) { assert(!bytes.equals(replacement), 'UNCHANGED_REPLACEMENT'); zip.file(name, replacement, { date: entry.date, createFolders: false }); }
  else preserved++;
}
const archive = path.join(out, 'memory-retirement.zip');
fs.writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
const after = await Zip.loadAsync(fs.readFileSync(archive));
const before = await Zip.loadAsync(fs.readFileSync(base));
assert.deepEqual(Object.keys(after.files), Object.keys(before.files), 'ARCHIVE_ENTRY_SET');
for (const [name, entry] of Object.entries(before.files)) if (!entry.dir) assert.equal((await entry.async('nodebuffer')).equals(await after.file(name).async('nodebuffer')), !replacements.has(name), 'UNEXPECTED_ENTRY_CHANGE');
const patchBefore = path.join(out, 'patch-before'), patchAfter = path.join(out, 'patch-after');
for (const [folder, bytes] of [[patchBefore, Buffer.from(text)], [patchAfter, Buffer.from(result)]]) {
  fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); fs.writeFileSync(path.join(folder, file), bytes);
}
const attributes = path.join(out, 'binary.attributes'); fs.writeFileSync(attributes, '*.ts binary\n');
let patch;
try { execFileSync('git', ['-c', `core.attributesFile=${attributes}`, 'diff', '--no-index', '--binary', path.relative(repo, patchBefore).split(path.sep).join('/'), path.relative(repo, patchAfter).split(path.sep).join('/')], { cwd: repo, maxBuffer: 8 * 1024 * 1024, windowsHide: true }); assert.fail('EMPTY_PATCH'); }
catch (error) { assert.equal(error.status, 1); patch = error.stdout.toString('utf8'); }
for (const side of ['a', 'b']) for (const folder of [patchBefore, patchAfter]) patch = patch.replaceAll(`${side}/${path.relative(repo, folder).split(path.sep).join('/')}/`, `${side}/`);
assert(!patch.includes('.env') && !patch.includes('.firebase/'), 'PATCH_SCOPE');
const patchFile = path.join(out, 'source-only.patch'); fs.writeFileSync(patchFile, patch);
const manifest = { status: 'LOCAL_CANDIDATE_UNTESTED_NOT_DEPLOY_READY', sourceCommit: commit, sourceTree: null,
  baseArchiveSha256: baseSha, archiveSha256: sha(fs.readFileSync(archive)), archive: path.relative(repo, archive),
  target: 'reviewAgent007MemoryCandidate', buildMode: 'NORMAL', entries: Object.keys(after.files).length,
  preservedFiles: preserved, changedEntries: [...replacements.keys()], addedEntries: [], removedEntries: [],
  sourceEmitBaselineMatches: true, baselineMapMappingsMatch: true, unrelatedMethodsAndStatementsPreserved: true, mapPolicy: 'REGENERATED_FROM_EXACT_ADAPTED_TS_WITH_RUNTIME_RELATIVE_SOURCE_PATH',
  originalEntrySha256: sha(await before.file('lib/index.js').async('nodebuffer')),
  sourceSha256: sha(Buffer.from(result)), patchSha256: sha(Buffer.from(patch)), scriptSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))), productionWrites: 0 };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
