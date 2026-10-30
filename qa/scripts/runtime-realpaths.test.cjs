const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { inspectRuntimeRealpaths, assertRuntimeRealpaths } = require('./verify-runtime-realpaths.cjs');
const base = path.resolve('output/runtime-realpaths-tests'); fs.mkdirSync(base, { recursive: true });
function fixture() { const parent = fs.mkdtempSync(path.join(base, 'fixture-')); const runtime = path.join(parent, 'runtime'); fs.mkdirSync(runtime); return { parent, runtime }; }
test('legitimate internal directory links and ordinary files remain confined', () => {
  const { runtime } = fixture(), target = path.join(runtime, 'package'); fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'index.js'), 'export const ok=true;');
  fs.symlinkSync(target, path.join(runtime, 'internal'), 'junction');
  assert.equal(assertRuntimeRealpaths(runtime).status, 'PASS');
});
test('node_modules ancestor junction escaping runtime is rejected', () => {
  const { parent, runtime } = fixture(), outside = path.join(parent, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(runtime, 'node_modules'), 'junction');
  const result = inspectRuntimeRealpaths(runtime);
  assert.equal(result.status, 'FAIL'); assert.ok(result.issues.some(x => x.code === 'LINK_ESCAPES_RUNTIME'));
});
test('ESM can bypass a CommonJS resolver guard; tree check rejects its escaping junction', () => {
  const { parent, runtime } = fixture(), outside = path.join(parent, 'outside'); fs.mkdirSync(outside);
  fs.mkdirSync(path.join(runtime, 'node_modules'));
  fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({name:'fixture-esm',version:'1.0.0',type:'module',main:'index.js'}));
  fs.writeFileSync(path.join(outside, 'index.js'), "export const marker='OUTSIDE_RUNTIME';");
  fs.symlinkSync(outside,path.join(runtime,'node_modules/fixture-esm'),'junction');
  const probe = "const M=require('node:module'),p=require('node:path'),o=M._resolveFilename;M._resolveFilename=function(...a){const r=o.apply(this,a);if(p.isAbsolute(r)&&!r.startsWith(process.cwd()+p.sep))throw Error('OUTSIDE_ARTIFACT_MODULE');return r};import('fixture-esm').then(x=>console.log(x.marker));";
  const run=spawnSync(process.execPath,['-e',probe],{cwd:runtime,encoding:'utf8',timeout:15000});
  assert.equal(run.status,0);assert.equal(run.stdout.trim(),'OUTSIDE_RUNTIME');
  assert.equal(inspectRuntimeRealpaths(runtime).status,'FAIL');
});
test('a directory cycle is rejected without recursion overflow', () => {
  const { runtime }=fixture();fs.mkdirSync(path.join(runtime,'child'));
  fs.symlinkSync(runtime,path.join(runtime,'child/back'),'junction');
  const result=inspectRuntimeRealpaths(runtime);assert.equal(result.status,'FAIL');
  assert.ok(result.issues.some(x=>x.code==='DIRECTORY_CYCLE'));
});
test('an escaping file link and dangling link fail closed', t => {
  const { parent,runtime }=fixture(),outside=path.join(parent,'outside.txt');fs.writeFileSync(outside,'synthetic');
  const link=path.join(runtime,'file-link');let filesystem=fs;
  try { fs.symlinkSync(outside,link,'file'); }
  catch(error) {
    if(error.code!=='EPERM')throw error;
    // Windows file symlinks need an OS privilege, unlike real junctions above.
    // Exercise the same branch through the filesystem seam instead of skipping it.
    t.diagnostic('File-link branch uses a filesystem fixture because Windows denied symlink creation.');
    fs.writeFileSync(link,'fixture');
    filesystem={...fs,lstatSync:file=>file===link?{isSymbolicLink:()=>true}:fs.lstatSync(file),realpathSync:file=>file===link?outside:fs.realpathSync(file)};
  }
  fs.symlinkSync(path.join(parent,'absent'),path.join(runtime,'dangling'),'junction');
  const result=inspectRuntimeRealpaths(runtime,{filesystem});assert.equal(result.status,'FAIL');
  assert.ok(result.issues.some(x=>x.code==='LINK_ESCAPES_RUNTIME'));
  assert.ok(result.issues.some(x=>x.code==='ENTRY_UNREADABLE'));
});
test('runtime-root junction and traversal budget fail closed', () => {
  const { parent,runtime }=fixture();fs.symlinkSync(runtime,path.join(parent,'alias'),'junction');
  assert.equal(inspectRuntimeRealpaths(path.join(parent,'alias')).status,'FAIL');
  fs.writeFileSync(path.join(runtime,'one'),'x');assert.equal(inspectRuntimeRealpaths(runtime,{maxEntries:0}).status,'FAIL');
});
