import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { cliRoot } from './helpers/functions-upload-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const require=createRequire(path.join(cliRoot(),'package.json'));
const {readdirRecursive}=require('./lib/fsAsync');
const policy=JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8')).functions.ignore;
test('real CLI fsAsync exclusions preserve owned maps/debug and default ignores',async()=>{
 const dir=path.join(root,'.firebase/upload-filter-tests',randomUUID());
 const kept=['lib/index.js','lib/index.js.map','lib/nested/index.js','.debug/compiled/index.js','.debug/compiled/lib/asset.json','src/index.ts','package.json','.env.demo','unknown.js'];
 const dropped=['lib/old.js.map','lib/modules/a.js.map','lib/modules/deep/index.js.map','.bundle-provenance.json','.eslintrc.cjs','.gcloudignore','.gitignore','scripts/a.mjs','test/a.cjs','node_modules/a.js','.git/config'];
 for(const name of [...kept,...dropped]){const dest=path.join(dir,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,'synthetic');}
 const rows=await readdirRecursive({path:dir,ignore:policy});
 const names=rows.map(row=>path.relative(dir,row.name).replaceAll('\\','/')).sort();
 assert.deepEqual(names,kept.sort());
 // Firebase ORs minimatch predicates. Negation is not a reinclude operation.
 const negated=await readdirRecursive({path:dir,ignore:['!**/lib/index.js.map']});
 assert(!negated.some(row=>row.name.endsWith('unknown.js')));
 assert(dropped.every(name=>fs.existsSync(path.join(dir,name))));
});
test('cloud build has no package lifecycle dependency on excluded tooling',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'functions/package.json'),'utf8'));
 assert.equal(pkg.main,'lib/index.js');
 for(const key of ['gcp-build','preinstall','install','postinstall','prepare'])assert.equal(pkg.scripts[key],undefined);
});
