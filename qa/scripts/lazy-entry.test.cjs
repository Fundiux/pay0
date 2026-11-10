const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const lib = path.join(root, 'functions/lib');
let checks = 0;
const ok = (value, label) => { assert.ok(value, label); checks++; };
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };

// The committed map must match the re-exports of index.ts (fails when an export is added without regenerating).
const fresh = spawnSync(process.execPath, [path.join(root, 'scripts/generate-lazy-function-map.mjs'), '--check'], {encoding: 'utf8'});
eq(fresh.status, 0, 'lazy map is fresh: ' + (fresh.stderr || ''));

const {LAZY_MODULES} = require(path.join(lib, 'lazyModules.generated.js'));
const full = require(path.join(lib, 'index.js'));
eq(Object.keys(LAZY_MODULES).sort(), Object.keys(full).sort(), 'the map covers exactly the exports of index');

// Without FUNCTION_TARGET the entry exports the same set (discovery sees every endpoint).
const entryNames = (target) => JSON.parse(spawnSync(process.execPath, ['-e', `const m=require(${JSON.stringify(path.join(lib, 'lazyEntry.js'))});console.log(JSON.stringify(Object.keys(m).sort()))`], {env: {...process.env, FUNCTION_TARGET: target || ''}, encoding: 'utf8'}).stdout);
eq(entryNames(''), Object.keys(full).sort(), 'no FUNCTION_TARGET exports everything');
eq(entryNames('notAFunction'), Object.keys(full).sort(), 'an unknown target falls back to everything');

// With FUNCTION_TARGET only that export loads, and its endpoint definition is identical to the full index.
const sample = ['listUsers', 'getBusinessIndicators', 'createPago', 'listPagos', 'createSolicitud', 'processIqCreateQueue', 'initPagoDocumentUpload', 'applyWarmCapacityWindow'];
for (const name of sample) {
  ok(full[name] && full[name].__endpoint, `${name} is a function in the full index`);
  const out = JSON.parse(spawnSync(process.execPath, ['-e', `const m=require(${JSON.stringify(path.join(lib, 'lazyEntry.js'))});console.log(JSON.stringify({keys:Object.keys(m),endpoint:m[${JSON.stringify(name)}].__endpoint}))`], {env: {...process.env, FUNCTION_TARGET: name}, encoding: 'utf8'}).stdout);
  eq(out.keys, [name], `${name}: only the target is exported`);
  eq(out.endpoint, JSON.parse(JSON.stringify(full[name].__endpoint)), `${name}: same endpoint definition as the full index`);
}
console.log('LAZY ENTRY OK', checks);
