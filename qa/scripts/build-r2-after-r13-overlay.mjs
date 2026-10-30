// Reproduce the reviewed R2 comparison overlay after R1.3 without reading integrated Functions sources.
// Arguments: verified R1.3 source directory, exact R1.3 ZIP, TypeScript module, NEW output directory.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.length !== 4) throw Error('Expected baseSource baseZip typescriptModule newOutputDirectory');
const [base, zip, typescript, out] = args.map(value => path.resolve(value));
const within = value => value.startsWith(repo + path.sep);
if (!within(out) || fs.existsSync(out)) throw Error('Output must be a new directory inside the workspace');
const sha = value => createHash('sha256').update(value).digest('hex');
const expectedBase = 'a33ed9badb033a48a061a38ddb8295fd20f0aa5dedb567b37e423e7c37d68496';
const expectedArtifact = '83baf34e6e7c3f52c90d820ef18a555da8d2aba854bbb8dc552b72be44c36bfe';
const patch = path.join(repo, 'qa/patches/r2-after-r13-report.patch');
if (sha(fs.readFileSync(zip)) !== expectedBase) throw Error('Unexpected base ZIP');
if (sha(fs.readFileSync(patch)) !== '174fadf544ef8a203b0517a7b1c5e56a029b4c1bfea8f062e67adf9b4bb82575') throw Error('Unexpected source patch');
const source = path.join(out, 'source'), runtime = path.join(out, 'runtime');
fs.mkdirSync(source, { recursive: true });
fs.cpSync(path.join(base, 'src'), path.join(source, 'src'), { recursive: true });
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) fs.copyFileSync(path.join(base, file), path.join(source, file));
execFileSync('git', ['apply', '--directory=' + path.relative(repo, source).split(path.sep).join('/'), patch], { cwd: repo, stdio: 'pipe' });
execFileSync('python', ['-c', 'import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, runtime], { stdio: 'pipe' });
const ts = createRequire(import.meta.url)(typescript);
const config = ts.readConfigFile(path.join(source, 'tsconfig.json'), ts.sys.readFile);
const options = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, '.').options;
const files = ['hugoCore/reportSemantics','hugoCore/contextBuilderV2','hugoCore/conversationState','hugoCore/toolRouter','reportConnector'];
for (const file of files) {
  const input = `src/modules/agent007/${file}.ts`, output = `lib/modules/agent007/${file}.js`;
  const original = ts.transpileModule(fs.readFileSync(path.join(base, input), 'utf8'), { compilerOptions: options, fileName: input });
  if (original.outputText !== fs.readFileSync(path.join(runtime, output), 'utf8')) throw Error(`Baseline emit mismatch: ${file}`);
  const content = fs.readFileSync(path.join(source, input), 'utf8');
  if (/resolveSupervisedRule|reviewAgent007LearningRule/.test(content)) throw Error(`Excluded capability found: ${file}`);
  const result = ts.transpileModule(content, { compilerOptions: options, fileName: input });
  fs.writeFileSync(path.join(runtime, output), result.outputText);
  const map = JSON.parse(result.sourceMapText);
  map.sources = JSON.parse(fs.readFileSync(path.join(runtime, output + '.map'), 'utf8')).sources;
  fs.writeFileSync(path.join(runtime, output + '.map'), JSON.stringify(map));
}
const archive = path.join(out, 'sendAgent007Message-r2-after-r13.zip');
execFileSync('python', ['-c', `import zipfile,pathlib,sys
base,runtime,out=sys.argv[1:]
with zipfile.ZipFile(base) as before,zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as after:
 for entry in before.infolist():
  old=before.read(entry.filename);local=pathlib.Path(runtime)/entry.filename
  data=local.read_bytes() if local.is_file() and entry.filename.startswith('lib/modules/agent007/') else old
  after.writestr(entry,data)
`, zip, runtime, archive], { stdio: 'pipe' });
const artifactSha256 = sha(fs.readFileSync(archive));
if (artifactSha256 !== expectedArtifact) throw Error(`Artifact mismatch: ${artifactSha256}`);
console.log(JSON.stringify({ status: 'PASS', baseSha256: expectedBase, artifactSha256 }));
