import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '../..');
const [baseArg, outputArg] = process.argv.slice(2);
assert.ok(baseArg && outputArg, 'Usage: node build-recovery-outcome-overlay.mjs BASE_ZIP NEW_PRIVATE_DIRECTORY');
const base = path.resolve(baseArg), output = path.resolve(outputArg);
assert.ok(output.startsWith(path.join(root, '.firebase/modular-release') + path.sep), 'PRIVATE_OUTPUT_REQUIRED');
assert.ok(!fs.existsSync(output), 'OUTPUT_ALREADY_EXISTS');
const load = createRequire(path.join(root, 'functions/package.json')), ts = load('typescript');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const baseSha = '741a0025088645a7b66ab84dc1c3b071536c37d8000e0596b2290b43c6f7953b';
assert.equal(sha(fs.readFileSync(base)), baseSha, 'BASE_ARCHIVE_DRIFT');
const parent = '5b0db917bd70e76c160339e506f7c7d4467376b7';
const commit = '16a762a';
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, 'GIT_READ_FAILED'); return result.stdout;
}
const sourceCommit = git(['rev-parse', `${commit}^{commit}`]).trim();
const catalogPath = 'functions/src/modules/activityLog/eventCatalog.ts';
const recoveryPath = 'functions/src/modules/controlCenter/recovery.ts';
const originalCatalog = git(['show', `${parent}:${catalogPath}`]);
const sourceCatalog = git(['show', `${sourceCommit}:${catalogPath}`]);
const newEntry = sourceCatalog.split('\n').filter(line => line.includes('OPERACION_RECUPERACION_OMITIDA: eventEntry'));
assert.equal(newEntry.length, 1);
assert.ok(!originalCatalog.includes('OPERACION_RECUPERACION_OMITIDA'));
const anchor = originalCatalog.split('\n').find(line => line.includes('OPERACION_RECUPERACION_FALLIDA: eventEntry'));
assert.ok(anchor);
const patchedCatalog = originalCatalog.replace(anchor, `${anchor}\n${newEntry[0]}`);
const inputs = [
  { name: 'recovery', folder: 'controlCenter', before: git(['show', `${parent}:${recoveryPath}`]), after: git(['show', `${sourceCommit}:${recoveryPath}`]), expected: '13d61680f7ef6d89b8ea57dd15d3b02e1a5cb14a222109c9cd0171df46f5775b' },
  { name: 'eventCatalog', folder: 'activityLog', before: originalCatalog, after: patchedCatalog, expected: '249b0d8315787e850eefadb33b726ffcf3a051816bfe99f8070f46b6fa7a9e2a' },
];
const files = {}, baselineEmitters = {}, sourceProof = [];
for (const input of inputs) {
  const fileName = `src/modules/${input.folder}/${input.name}.ts`;
  const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true, sourceMap: true };
  const baseline = ts.transpileModule(input.before, { fileName, compilerOptions: options });
  assert.equal(sha(baseline.outputText), input.expected, 'BASELINE_EMITTER_MISMATCH');
  const emitted = ts.transpileModule(input.after, { fileName, compilerOptions: { ...options, inlineSources: true } });
  const js = `lib/modules/${input.folder}/${input.name}.js`;
  files[js] = Buffer.from(emitted.outputText).toString('base64');
  files[`${js}.map`] = Buffer.from(emitted.sourceMapText).toString('base64');
  baselineEmitters[js] = input.expected;
  sourceProof.push({ path: fileName, beforeSha256: sha(input.before), afterSha256: sha(input.after), baselineEmitterSha256: input.expected, emittedSha256: sha(emitted.outputText), inlineSourceMapSha256: sha(emitted.sourceMapText) });
}
// Retain unchanged ZIP local records and central metadata; only four exact
// entries receive new compressed payloads. No extraction or source-tree copy.
const python = String.raw`
import sys,json,base64,zipfile,io,copy,struct,hashlib
p=json.load(sys.stdin); original=open(p['base'],'rb').read(); z=zipfile.ZipFile(io.BytesIO(original)); infos=z.infolist()
names=z.namelist(); assert len(names)==len(set(names))
assert all(not n.startswith('/') and '\\' not in n and ':' not in n and '..' not in n.split('/') for n in names)
assert all(not any(x.startswith('.env') for x in n.split('/')) for n in names)
files={n:base64.b64decode(v) for n,v in p['files'].items()}; assert set(files)<=set(names)
for n,h in p['baseline'].items(): assert hashlib.sha256(z.read(n)).hexdigest()==h
changes={}
for n,b in files.items():
 t=io.BytesIO()
 with zipfile.ZipFile(t,'w') as one: one.writestr(copy.copy(z.getinfo(n)),b)
 raw=t.getvalue(); one=zipfile.ZipFile(io.BytesIO(raw)); changes[n]=(raw[:one.start_dir],raw[one.start_dir:raw.rfind(b'PK\x05\x06')])
ordered=sorted(infos,key=lambda i:i.header_offset); output=bytearray(original[:ordered[0].header_offset]); offsets={}
for i,info in enumerate(ordered):
 offsets[info.filename]=len(output);end=ordered[i+1].header_offset if i+1<len(ordered) else z.start_dir
 output.extend(changes[info.filename][0] if info.filename in changes else original[info.header_offset:end])
start=len(output);pos=z.start_dir
for info in infos:
 assert original[pos:pos+4]==b'PK\x01\x02'
 n,e,c=struct.unpack_from('<HHH',original,pos+28);length=46+n+e+c
 record=bytearray(changes[info.filename][1] if info.filename in changes else original[pos:pos+length]);struct.pack_into('<I',record,42,offsets[info.filename]);output.extend(record);pos+=length
size=len(output)-start;assert original[pos:pos+4]==b'PK\x05\x06';tail=bytearray(original[pos:]);struct.pack_into('<II',tail,12,size,start);output.extend(tail)
result=bytes(output);verified=zipfile.ZipFile(io.BytesIO(result));assert verified.namelist()==names
for n in names: assert verified.read(n)==files.get(n,z.read(n))
open(p['archive'],'xb').write(result)
print(json.dumps({'archiveSha256':hashlib.sha256(result).hexdigest(),'entries':len(names),'files':sum(not i.is_dir() for i in infos),'changed':sorted(files),'preservedEntries':len(names)-len(files),'removed':0,'added':0,'entryOrderPreserved':True,'unchangedLocalRecordsPreserved':True}))
`;
fs.mkdirSync(output);
const archive = path.join(output, 'recovery-outcome.zip');
const result = spawnSync('python', ['-c', python], { input: JSON.stringify({ base, files, baseline: baselineEmitters, archive }), encoding: 'utf8', maxBuffer: 1024 * 1024 });
assert.equal(result.status, 0, `ZIP_BUILD_FAILED: ${result.stderr}`);
const preservation = JSON.parse(result.stdout);
const manifest = { schemaVersion: 1, status: 'EXACT_ARCHIVE_UNTESTED', sourceCommit, sourceTree: null, baseArchiveSha256: baseSha, baselineSourceCommit: parent,
  targets: ['queueOperationRecovery', 'reconcileOperationRecovery'], archive, ...preservation, sourceProof,
  sourceIdentity: 'Composite production overlay: recovery source from reviewed commit; original catalog source plus its single reviewed event entry. Maps embed the actual adapted TypeScript. No full-tree identity claimed.',
  rollback: 'Restore preserved base archive for these two Functions only. Do not delete jobs, sources or audit records; no data rollback.' };
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
console.log(JSON.stringify(manifest));
