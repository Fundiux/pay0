// Reproduce D1 on the reviewed R2 source/ZIP; no integrated sources or private paths.
// Args: verified R2 source directory, exact R2 ZIP, TypeScript module, NEW output directory.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.argv.length, 6, 'Expected baseSource baseZip typescriptModule newOutputDirectory');
const [base, zip, typescript, out] = process.argv.slice(2).map(value => path.resolve(value));
assert(out.startsWith(repo + path.sep) && !fs.existsSync(out), 'New workspace output directory required');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedBase = '83baf34e6e7c3f52c90d820ef18a555da8d2aba854bbb8dc552b72be44c36bfe';
const expectedPatch = '744e16e5f5166acd3fbeb5a60d674a59245f4287db7cf01d318a17856418e9ae';
const expectedArtifact = '55c5c45aaab2a1603499a058605f4f38522e5092d2159957097566ac9b6dd077';
const patch = path.join(repo, 'qa/patches/d1-after-r2-learning.patch');
assert.equal(sha(fs.readFileSync(zip)), expectedBase, 'Unexpected R2 ZIP');
assert.equal(sha(fs.readFileSync(patch)), expectedPatch, 'Unexpected D1 patch');
const source = path.join(out, 'source'), runtime = path.join(out, 'runtime');
fs.mkdirSync(source, { recursive: true });
fs.cpSync(path.join(base, 'src'), path.join(source, 'src'), { recursive: true });
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) fs.copyFileSync(path.join(base, file), path.join(source, file));
const directory = path.relative(repo, source).split(path.sep).join('/');
execFileSync('git', ['apply', '--check', '--directory=' + directory, patch], { cwd: repo, stdio: 'pipe' });
execFileSync('git', ['apply', '--directory=' + directory, patch], { cwd: repo, stdio: 'pipe' });
execFileSync('python', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, runtime], { stdio: 'pipe' });
const ts = createRequire(import.meta.url)(typescript);
const config = ts.readConfigFile(path.join(source, 'tsconfig.json'), ts.sys.readFile);
const options = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, '.').options;
const files = ['index', 'modules/agent007/callables', 'modules/agent007/firestoreHugoLearningRuleStore', 'modules/agent007/firestoreHugoLearningStore',
  'modules/agent007/hugoCore/conversationCore', 'modules/agent007/hugoCore/learningContract', 'modules/agent007/hugoCore/learningStore',
  'modules/agent007/observationEvidence', 'modules/agent007/hugoCore/evidenceIdentity', 'modules/agent007/hugoCore/experienceBuilder', 'modules/agent007/hugoCore/learningGovernance'];
for (const file of files) {
  const input = `src/${file}.ts`, output = `lib/${file}.js`;
  if (fs.existsSync(path.join(base, input))) {
    const original = ts.transpileModule(fs.readFileSync(path.join(base, input), 'utf8'), { compilerOptions: options, fileName: input });
    assert.equal(original.outputText, fs.readFileSync(path.join(runtime, output), 'utf8'), `Baseline emit mismatch: ${file}`);
  } else assert(!fs.existsSync(path.join(runtime, output)), `Unexpected existing module: ${file}`);
  const result = ts.transpileModule(fs.readFileSync(path.join(source, input), 'utf8'), { compilerOptions: options, fileName: input, reportDiagnostics: true });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, `Transpile failed: ${file}`);
  const map = JSON.parse(result.sourceMapText), oldMap = path.join(runtime, output + '.map');
  map.sources = fs.existsSync(oldMap) ? JSON.parse(fs.readFileSync(oldMap, 'utf8')).sources : [path.posix.relative(path.posix.dirname(output), input)];
  fs.mkdirSync(path.dirname(path.join(runtime, output)), { recursive: true });
  fs.writeFileSync(path.join(runtime, output), result.outputText);
  fs.writeFileSync(oldMap, JSON.stringify(map));
}
const archive = path.join(out, 'd1-after-r2.zip');
// New-entry metadata is fixed to the reviewed D1-v6 artifact; no timestamps vary by run.
execFileSync('python', ['-c', `import zipfile,pathlib,sys,json
base,runtime,out,names=sys.argv[1:]
allowed=set(json.loads(names))
with zipfile.ZipFile(base) as before,zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as after:
 existing=set(before.namelist())
 for entry in before.infolist():
  data=(pathlib.Path(runtime)/entry.filename).read_bytes() if entry.filename in allowed else before.read(entry.filename)
  after.writestr(entry,data)
 for name in sorted(allowed-existing):
  entry=zipfile.ZipInfo(name,date_time=(2026,10,19,14,42,36))
  entry.compress_type=zipfile.ZIP_DEFLATED;entry.create_system=0;entry.external_attr=25165824
  after.writestr(entry,(pathlib.Path(runtime)/name).read_bytes())
`, zip, runtime, archive, JSON.stringify(files.flatMap(file => [`lib/${file}.js`, `lib/${file}.js.map`]))], { stdio: 'pipe' });
const artifactSha256 = sha(fs.readFileSync(archive));
assert.equal(artifactSha256, expectedArtifact, 'Composed artifact mismatch');
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
  status: 'LOCAL_CANDIDATE_NOT_DEPLOY_READY', baseArchiveSha256: expectedBase,
  archiveSha256: artifactSha256, patchSha256: expectedPatch, sourceTree: null,
  sourceFiles: files.map(file => `src/${file}.ts`),
  targets: ['sendAgent007Message', 'reviewAgent007LearningRule'], gate: 'UNSET_OFF',
}, null, 2));
console.log(JSON.stringify({ status: 'PASS', baseSha256: expectedBase, patchSha256: expectedPatch, artifactSha256 }));
