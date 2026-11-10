// Local measurement: module load time and RSS of the full index versus the lazy entry for typical functions.
// Run after `npm run build` in functions/. Local numbers only; production cold start is not measured here.
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const lib = path.join(__dirname, '../../functions/lib');
const probe = (file, target) => {
  const code = `const t=process.hrtime.bigint();const m=require(${JSON.stringify(file)});console.log(JSON.stringify({ms:Number(process.hrtime.bigint()-t)/1e6|0,rss:process.memoryUsage().rss/1048576|0}))`;
  const out = spawnSync(process.execPath, ['-e', code], {env: {...process.env, FUNCTION_TARGET: target || ''}, encoding: 'utf8'});
  return JSON.parse(out.stdout.trim().split('\n').pop());
};
const median = list => list.map(x => x.ms).sort((a, b) => a - b)[Math.floor(list.length / 2)];
const runs = (file, target) => Array.from({length: 5}, () => probe(file, target));
const rows = [];
const full = runs(path.join(lib, 'index.js'));
rows.push({function: '(full index)', ms: median(full), rssMB: full[0].rss});
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['listUsers', 'getHugoDashboard', 'createPago', 'listPagos', 'processIqCreateQueue', 'createSolicitud']) {
  const lazy = runs(path.join(lib, 'lazyEntry.js'), name);
  rows.push({function: name, ms: median(lazy), rssMB: lazy[0].rss});
}
console.table(rows);
