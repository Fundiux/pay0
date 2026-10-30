import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildMode, dispatchBuild } from '../../scripts/build-functions.mjs';
import { installCandidate, verifyInstalled, acquireBuildLock, recoverInstallation } from '../../scripts/install-functions-internal-bundle.mjs';
import { sourceSnapshot, sha256, checkedPath } from '../../scripts/lib/functions-bundle-integrity.mjs';

const workspace = path.resolve(import.meta.dirname, '../..');
let checks = 0;
function check(fn) { fn(); checks++; }
function fixture() {
  const root = path.join(workspace, '.firebase/bundle-install-tests', randomUUID());
  const put = (file, content) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
  for (const file of ['functions/src/index.ts', 'functions/package.json', 'functions/package-lock.json', 'functions/tsconfig.json', 'src/canonicos/formatos/fixture.txt', 'scripts/build-functions-internal-bundle.mjs', 'scripts/copy-canonical-assets.mjs', 'scripts/lib/functions-bundle-context.mjs', 'scripts/lib/functions-bundle-integrity.mjs']) put(file, '{}');
  const candidate = '.firebase/internal-bundle-candidates/test';
  const raw = { 'index.js': 'raw entry', 'modules/example.js': 'fresh module' };
  const output = { 'package.json': '{}', '.debug/compiled/index.js': 'compiled entry', 'lib/assets/fixture.txt': 'asset', 'lib/assets/a/one.txt': 'nested', 'lib/assets/a.txt': 'prefix', 'lib/index.js.map': '{}', 'lib/index.js': 'bundled entry' };
  for (const [file, content] of Object.entries(raw)) put(`${candidate}/raw/${file}`, content);
  for (const [file, content] of Object.entries(output)) put(`${candidate}/artifact/${file}`, content);
  const rows = object => Object.entries(object).map(([file, value]) => ({ file, sha256: sha256(value) }));
  put(`${candidate}/provenance.json`, JSON.stringify({ schema: 'PAY0-INTERNAL-BUNDLE-CANDIDATE@1', esbuild: '0.28.2', sourceInputs: sourceSnapshot(root), inputs: rows(raw), outputs: rows(output) }));
  put('functions/lib/index.js', 'prior entry'); put('functions/lib/modules/example.js', 'prior module'); put('functions/lib/unrelated.js.map', 'inert map');
  return { root, put, candidate, install: extra => installCandidate({ repositoryRoot: root, candidate, ...extra }), read: file => fs.readFileSync(path.join(root, file), 'utf8') };
}
check(() => assert.equal(buildMode({}), 'NORMAL'));
check(() => assert.equal(buildMode({ PAY0_FUNCTIONS_BUILD_MODE: 'BUNDLED_V1' }), 'BUNDLED_V1'));
for (const mode of ['', 'BUNDLE', 'normal', ' BUNDLED_V1']) check(() => assert.throws(() => buildMode({ PAY0_FUNCTIONS_BUILD_MODE: mode }), /BUILD_MODE_INVALID/));
let normalCalls = 0, bundledCalls = 0;
const environment = Object.freeze({ PAY0_FUNCTIONS_BUILD_MODE: 'BUNDLED_V1' });
for (let i=0;i<3;i++) await dispatchBuild({ repositoryRoot: workspace, environment, bundled: () => bundledCalls++ });
await dispatchBuild({ repositoryRoot: workspace, environment: {}, normal: () => normalCalls++ });
check(() => assert.equal(bundledCalls, 3)); check(() => assert.equal(normalCalls, 1));
{
 const f = fixture(), order = [], result = f.install({ beforeWrite: ({ file }) => order.push(file) });
 check(() => assert.equal(result.status, 'INSTALLED')); check(() => assert.equal(order.at(-1), 'functions/lib/index.js'));
 check(() => assert.equal(f.read('functions/lib/modules/example.js'), 'fresh module')); check(() => assert.equal(f.read('functions/lib/unrelated.js.map'), 'inert map'));
 check(() => assert.equal(verifyInstalled(f.root).outputs.some(row => row.file.endsWith('unrelated.js.map')), false));
 check(() => assert.equal(fs.existsSync(path.join(f.root, '.firebase/internal-bundle-install.lock')), false));
 f.put('functions/lib/index.js', 'tampered'); check(() => assert.throws(() => verifyInstalled(f.root), /ARTIFACT_DRIFT/));
}
{
 const f = fixture(); check(() => assert.throws(() => f.install({ beforeWrite: ({ file }) => { if(file === 'functions/lib/index.js') throw Error('INJECTED'); } }), /INJECTED/));
 check(() => assert.equal(f.read('functions/lib/index.js'), 'prior entry')); check(() => assert.equal(f.read('functions/lib/modules/example.js'), 'prior module'));
 check(() => assert.equal(fs.existsSync(path.join(f.root, 'functions/.debug/compiled/index.js')), false));
 check(() => assert.equal(fs.existsSync(path.join(f.root, '.firebase/internal-bundle-install.lock')), false));
}
for (const file of ['functions/src/index.ts', 'functions/package-lock.json']) {
 const f = fixture(); f.put(file, 'drift'); check(() => assert.throws(() => f.install(), /SOURCE_DRIFT/));
}
{
 const f = fixture(); f.put(`${f.candidate}/artifact/lib/index.js`, 'drift'); check(() => assert.throws(() => f.install(), /ARTIFACT_DRIFT/));
}
{
 const f = fixture(); f.put(`${f.candidate}/artifact/unexpected`, 'drift'); check(() => assert.throws(() => f.install(), /ARTIFACT_EXTRA_FILES/));
}
{
 const f = fixture(); check(() => assert.throws(() => installCandidate({ repositoryRoot: f.root, candidate: '../outside' }), /CANDIDATE_SCOPE/));
}
{
 const f = fixture(), lock = acquireBuildLock(f.root); check(() => assert.throws(() => f.install(), /EEXIST/)); lock.release();
}
{
 const f = fixture(), outside = path.join(f.root, 'outside');fs.mkdirSync(outside);
 fs.symlinkSync(outside,path.join(f.root,'functions/.debug'),process.platform==='win32'?'junction':'dir');
 check(() => assert.throws(() => f.install(), /PATH_LINK/));
}
{
 const f = fixture();
 fs.symlinkSync(path.join(f.root,'missing-target'),path.join(f.root,'functions/.debug'),process.platform==='win32'?'junction':'dir');
 check(() => assert.equal(fs.existsSync(path.join(f.root,'functions/.debug')),false));
 check(() => assert.throws(() => checkedPath(f.root,'functions/.debug/compiled/index.js'),/PATH_LINK/));
 check(() => assert.throws(() => f.install(),/PATH_LINK/));
}
{
 // Portable dangling-file fake: Windows does not always grant the privilege
 // required to create file symlinks. The real dangling junction above covers
 // filesystem behavior; this asserts the final-component lstat contract too.
 const f=fixture(), target=path.join(f.root,'functions/lib/dangling.js'), original=fs.lstatSync;
 assert.equal(fs.existsSync(target),false);
 try {
   fs.lstatSync=(file,...args)=>file===target?{isSymbolicLink:()=>true}:original(file,...args);
   check(() => assert.throws(() => checkedPath(f.root,'functions/lib/dangling.js'),/PATH_LINK/));
 } finally {fs.lstatSync=original;}
}
{
 const f = fixture(); check(() => assert.throws(() => f.install({ beforeWrite: ({ file }) => { if(file === 'functions/lib/index.js') f.put('functions/package.json', 'concurrent source'); } }), /SOURCE_DRIFT/));
 check(() => assert.equal(f.read('functions/lib/index.js'), 'prior entry')); check(() => assert.equal(f.read('functions/package.json'), 'concurrent source'));
}
{
 const f = fixture(); check(() => assert.throws(() => f.install({ beforeWrite: ({ file }) => { if(file === 'functions/lib/index.js') f.put(file, 'external mutation'); } }), /RECOVERY_REQUIRED/));
 check(() => assert.equal(f.read('functions/lib/index.js'), 'external mutation'));
 const owner = JSON.parse(f.read('.firebase/internal-bundle-install.lock'));
 check(() => assert.throws(() => recoverInstallation(f.root, owner.id), /OWNER_STILL_ALIVE/));
 check(() => assert.equal(fs.existsSync(path.join(f.root, '.firebase/internal-bundle-install.lock')), true));
}
console.log(JSON.stringify({ checks, result: 'PASS', cloudCalls: 0, fixturesPrivate: true }));
