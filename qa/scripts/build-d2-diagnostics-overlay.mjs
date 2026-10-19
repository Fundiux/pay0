// Local-only D2 closure over the exact diagnostics base. No installs or cloud calls.
// Args: exactBaseZip typescriptModule NEW-private-output-directory
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
assert.equal(args.length, 3, 'BASE_COMPILER_NEW_OUTPUT_REQUIRED');
const [baseZip, compiler, out] = args.map(value => path.resolve(value));
assert(out.startsWith(path.join(repo, '.firebase', 'modular-release') + path.sep) && !fs.existsSync(out), 'NEW_PRIVATE_OUTPUT_REQUIRED');
for (let ancestor = path.dirname(out); ancestor !== repo; ancestor = path.dirname(ancestor)) {
  assert(ancestor.startsWith(repo + path.sep), 'OUTPUT_ANCESTOR_SCOPE');
  if (fs.existsSync(ancestor)) assert(!fs.lstatSync(ancestor).isSymbolicLink(), 'OUTPUT_ANCESTOR_LINK');
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseSha = 'c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f';
const sourceCommit = 'f0fc69fbe761cdf1dded4b67a0550e2d237074af';
assert.equal(sha(fs.readFileSync(baseZip)), baseSha, 'BASE_CHANGED');
const ts = createRequire(import.meta.url)(compiler);
const JSZip = createRequire(path.join(repo, 'functions/package.json'))('jszip');
const before = await JSZip.loadAsync(fs.readFileSync(baseZip));
const source = path.join(out, 'source'), runtime = path.join(out, 'runtime');
fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(runtime);
for (const [name, entry] of Object.entries(before.files)) {
  assert(!/[\\:\x00]/.test(name) && !name.split('/').includes('..') && !path.isAbsolute(name), 'ARCHIVE_PATH');
  if (entry.dir) continue;
  const bytes = await entry.async('nodebuffer');
  const target = path.join(runtime, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  if (name.startsWith('src/') || ['package.json', 'package-lock.json', 'tsconfig.json'].includes(name)) {
    const targetSource = path.join(source, name); fs.mkdirSync(path.dirname(targetSource), { recursive: true }); fs.writeFileSync(targetSource, bytes);
  }
}
const fromCommit = relative => execFileSync('git', ['show', `${sourceCommit}:functions/${relative}`], { cwd: repo });
const callables = 'src/modules/agent007/callables.ts';
const baseCallables = fs.readFileSync(path.join(source, callables), 'utf8');
const currentCallables = fromCommit(callables).toString('utf8');
function declaration(text, name) {
  const ast = ts.createSourceFile('callables.ts', text, ts.ScriptTarget.Latest, true);
  const nodes = ast.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === name));
  assert.equal(nodes.length, 1, 'ONE_HANDLER_REQUIRED');
  const node = nodes[0]; return { start: node.getStart(ast), end: node.end, text: text.slice(node.getStart(ast), node.end) };
}
const oldHandler = declaration(baseCallables, 'listAgent007LearningDiagnostics');
const newHandler = declaration(currentCallables, 'listAgent007LearningDiagnostics');
assert(!baseCallables.includes('firestoreHugoLearningRuleStore'), 'BASE_ALREADY_HAS_RULE_STORE');
const patchedCallables = 'import { FirestoreHugoLearningRuleStore } from "./firestoreHugoLearningRuleStore";\n' +
  baseCallables.slice(0, oldHandler.start) + newHandler.text + baseCallables.slice(oldHandler.end);
fs.writeFileSync(path.join(source, callables), patchedCallables);
const exactFiles = [
  'src/modules/agent007/firestoreHugoLearningRuleStore.ts',
  'src/modules/agent007/observationEvidence.ts',
  'src/modules/agent007/hugoCore/evidenceIdentity.ts',
  'src/modules/agent007/hugoCore/experienceBuilder.ts',
  'src/modules/agent007/firestoreHugoLearningStore.ts',
  'src/modules/agent007/hugoCore/learningContract.ts',
  'src/modules/agent007/hugoCore/learningStore.ts',
];
for (const file of exactFiles) { fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true }); fs.writeFileSync(path.join(source, file), fromCommit(file)); }
const sources = [callables, ...exactFiles];
const config = ts.readConfigFile(path.join(source, 'tsconfig.json'), ts.sys.readFile);
assert(!config.error, 'CONFIG_READ');
const options = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, source).options;
const patchedEntries = [];
for (const file of sources) {
  const output = file.replace(/^src\//, 'lib/').replace(/\.ts$/, '.js');
  if (before.file(file)) {
    const original = ts.transpileModule(await before.file(file).async('string'), { compilerOptions: options, fileName: file });
    assert.equal(original.outputText, await before.file(output).async('string'), `BASELINE_EMIT_MISMATCH:${file}`);
  }
  const result = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), { compilerOptions: options, fileName: file });
  assert(!(result.diagnostics || []).some(item => item.category === ts.DiagnosticCategory.Error), 'TRANSPILE_DIAGNOSTIC');
  const map = JSON.parse(result.sourceMapText);
  map.sources = before.file(output + '.map') ? JSON.parse(await before.file(output + '.map').async('string')).sources : [path.posix.relative(path.posix.dirname(output), file)];
  for (const [name, bytes] of [[file, fs.readFileSync(path.join(source, file))], [output, Buffer.from(result.outputText)], [output + '.map', Buffer.from(JSON.stringify(map))]]) {
    const dest = path.join(runtime, name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes); patchedEntries.push(name);
  }
}
const archive = path.join(out, 'diagnostics-d2.zip');
execFileSync('python', ['-c', `import json,pathlib,sys,zipfile
base,runtime,out,entries=sys.argv[1:]
entries=json.loads(entries)
with zipfile.ZipFile(base) as before, zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as after:
 existing=set(before.namelist())
 for entry in before.infolist():
  data=(pathlib.Path(runtime)/entry.filename).read_bytes() if entry.filename in entries else before.read(entry.filename)
  after.writestr(entry,data)
 for name in sorted(set(entries)-existing):
  info=zipfile.ZipInfo(name,(2026,10,19,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=0;info.external_attr=25165824
  after.writestr(info,(pathlib.Path(runtime)/name).read_bytes())
`, baseZip, runtime, archive, JSON.stringify(patchedEntries)], { stdio: 'pipe' });
const after = await JSZip.loadAsync(fs.readFileSync(archive));
assert.equal(sha(fs.readFileSync(archive)), 'd148d084149f6be8e76ce297d4639c22583ead14e5eee64f6386b3969d353ce8', 'ARTIFACT_BYTES_CHANGED');
const changed = [], added = [], unchanged = [];
for (const [name, entry] of Object.entries(before.files)) {
  assert(after.files[name], 'ENTRY_REMOVED');
  if (entry.dir) continue;
  const equal = (await entry.async('nodebuffer')).equals(await after.file(name).async('nodebuffer'));
  (equal ? unchanged : changed).push(name);
  if (!patchedEntries.includes(name)) assert(equal, 'UNRELATED_ENTRY_CHANGED');
}
for (const name of Object.keys(after.files)) if (!before.files[name]) added.push(name);
assert.equal(await after.file('lib/index.js').async('string'), await before.file('lib/index.js').async('string'), 'INDEX_CHANGED');
assert(!patchedCallables.includes('export const reviewAgent007LearningRule'), 'REVIEW_EXPORT_ADDED');
const manifest = { status: 'CANDIDATE_PENDING_EXACT_ARTIFACT_TESTS', implementationCommit: sourceCommit, sourceCommit: null, patchCommit: null, sourceTree: null,
  baseArchiveSha256: baseSha, archiveSha256: sha(fs.readFileSync(archive)), target: 'listAgent007LearningDiagnostics',
  sources, changed, added, unchangedEntries: unchanged.length, entries: Object.keys(after.files).length,
  deliberatePrerequisites: ['D1 canonical evidence identity in experienceBuilder and existing experience store callers', 'D1 type-only learning contract/store extensions'],
  preserved: ['all other archive entry bytes', 'index and exported endpoint inventory', 'conversation/report modules', 'original learningGovernance'],
  productionWrites: 0 };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ status: manifest.status, archiveSha256: manifest.archiveSha256, changedEntries: changed.length, addedEntries: added.length, unchangedEntries: unchanged.length }));
