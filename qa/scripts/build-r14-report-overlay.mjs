// Local-only R1.4 overlay. Args: verifiedR2Source exactR2Zip typescriptModule NEW-private-output.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.argv.slice(2).length, 4, 'FOUR_ARGUMENTS_REQUIRED');
const [baseSource, baseZip, compiler, out] = process.argv.slice(2).map(value => path.resolve(value));
assert(out.startsWith(path.join(repo, '.firebase', 'modular-release') + path.sep) && !fs.existsSync(out), 'NEW_PRIVATE_OUTPUT_REQUIRED');
for (let current = path.dirname(out); current !== repo; current = path.dirname(current)) {
  assert(current.startsWith(repo + path.sep), 'OUTPUT_SCOPE');
  if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'OUTPUT_LINK');
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseSha = '83baf34e6e7c3f52c90d820ef18a555da8d2aba854bbb8dc552b72be44c36bfe';
const patchSha = '6784975e087cb788f835ac637b97a60f48df5d0cda0197fad746a645d957ee20';
const patch = path.join(repo, 'qa/patches/r14-report-natural.patch');
assert.equal(sha(fs.readFileSync(baseZip)), baseSha, 'BASE_CHANGED');
assert.equal(sha(fs.readFileSync(patch)), patchSha, 'PATCH_CHANGED');
const source = path.join(out, 'source'), runtime = path.join(out, 'runtime');
fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(runtime);
fs.cpSync(path.join(baseSource, 'src'), path.join(source, 'src'), { recursive: true });
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) fs.copyFileSync(path.join(baseSource, file), path.join(source, file));
execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', '--directory=' + path.relative(repo, source).split(path.sep).join('/'), patch], { cwd: repo, stdio: 'pipe' });
const JSZip = createRequire(path.join(repo, 'functions/package.json'))('jszip');
const before = await JSZip.loadAsync(fs.readFileSync(baseZip));
for (const [name, entry] of Object.entries(before.files)) {
  assert(!/[\\:\x00]/.test(name) && !name.split('/').includes('..') && !path.isAbsolute(name), 'ARCHIVE_PATH');
  if (entry.dir) continue;
  const target = path.join(runtime, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, await entry.async('nodebuffer'));
}
const ts = createRequire(import.meta.url)(compiler);
const config = ts.readConfigFile(path.join(source, 'tsconfig.json'), ts.sys.readFile);
const options = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, source).options;
const modules = ['reportSemantics', 'contextBuilderV2'];
const changedEntries = [];
for (const name of modules) {
  const input = `src/modules/agent007/hugoCore/${name}.ts`, output = `lib/modules/agent007/hugoCore/${name}.js`;
  const original = ts.transpileModule(fs.readFileSync(path.join(baseSource, input), 'utf8'), { compilerOptions: options, fileName: input });
  assert.equal(original.outputText, fs.readFileSync(path.join(runtime, output), 'utf8'), 'BASELINE_EMIT_CHANGED');
  const result = ts.transpileModule(fs.readFileSync(path.join(source, input), 'utf8'), { compilerOptions: options, fileName: input });
  const map = JSON.parse(result.sourceMapText); map.sources = JSON.parse(fs.readFileSync(path.join(runtime, output + '.map'), 'utf8')).sources;
  fs.writeFileSync(path.join(runtime, output), result.outputText); fs.writeFileSync(path.join(runtime, output + '.map'), JSON.stringify(map));
  changedEntries.push(output, output + '.map');
}
const archive = path.join(out, 'chat-r14.zip');
execFileSync('python', ['-c', `import pathlib,sys,zipfile,json
base,runtime,out,names=sys.argv[1:];names=set(json.loads(names))
with zipfile.ZipFile(base) as before,zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as after:
 for entry in before.infolist():
  data=(pathlib.Path(runtime)/entry.filename).read_bytes() if entry.filename in names else before.read(entry.filename)
  after.writestr(entry,data)
`, baseZip, runtime, archive, JSON.stringify(changedEntries)], { stdio: 'pipe' });
const after = await JSZip.loadAsync(fs.readFileSync(archive));
assert.equal(sha(fs.readFileSync(archive)), '21922d596a664b2916fa459c5c51b165388db5a5b4af897995f3bb85d89b06f9', 'ARTIFACT_BYTES_CHANGED');
assert.deepEqual(Object.keys(after.files), Object.keys(before.files), 'ARCHIVE_INVENTORY_CHANGED');
let preserved = 0;
for (const name of Object.keys(before.files)) {
  if (before.files[name].dir) continue;
  const equal = (await before.file(name).async('nodebuffer')).equals(await after.file(name).async('nodebuffer'));
  if (!changedEntries.includes(name)) { assert(equal, 'UNRELATED_BYTES_CHANGED'); preserved++; }
  else assert(!equal, 'EXPECTED_CHANGE_MISSING');
}
const manifest = { status: 'CANDIDATE_PENDING_EXACT_TESTS', sourceCommit: null, patchCommit: null, sourceTree: null,
  baseArchiveSha256: baseSha, archiveSha256: sha(fs.readFileSync(archive)), patchSha256: patchSha,
  target: 'sendAgent007Message', sources: modules.map(name => `src/modules/agent007/hugoCore/${name}.ts`),
  changedEntries, preservedEntries: preserved, entries: Object.keys(after.files).length, productionWrites: 0 };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
