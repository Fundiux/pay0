// Spike measurement: module load time and RSS of the full index versus the lazy entry for one function.
// Run after `npm run build` in functions/. Local numbers only; production cold start is not measured here.
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const lib = path.join(__dirname, '../../functions/lib');
const probe = (file, target) => {
  const code = `const t=process.hrtime.bigint();const m=require(${JSON.stringify(file)});console.log(JSON.stringify({ms:Number(process.hrtime.bigint()-t)/1e6|0,rss:process.memoryUsage().rss/1048576|0,exports:Object.keys(m).length}))`;
  const out = spawnSync(process.execPath, ['-e', code], {env: {...process.env, ...(target ? {FUNCTION_TARGET: target} : {})}, encoding: 'utf8'});
  return JSON.parse(out.stdout.trim().split('\n').pop());
};
const runs = (file, target) => Array.from({length: 3}, () => probe(file, target));
const assert = require('node:assert/strict');
const full = runs(path.join(lib, 'index.js'));
const lazy = runs(path.join(lib, 'lazyEntry.js'), 'getBusinessIndicators');
const discovery = probe(path.join(lib, 'lazyEntry.js'));
assert.equal(lazy[0].exports, 1, 'with FUNCTION_TARGET only that function is exported');
assert.equal(discovery.exports, full[0].exports, 'without FUNCTION_TARGET discovery sees every export');
console.log(JSON.stringify({full, lazy, discoveryExports: discovery.exports}));
