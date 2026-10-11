import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sha256 } from '../../scripts/lib/functions-bundle-integrity.mjs';
import { cliRoot, verifyCloudBuildContract } from './helpers/functions-upload-contract.mjs';

const workspace = path.resolve(import.meta.dirname, '../..');
const root = path.join(workspace, '.firebase/bundle-packer-tests', randomUUID());
const put = (file, text) => { const dest=path.join(root,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text); };
const files = { 'package.json': '{"name":"fixture","main":"lib/index.js"}', 'package-lock.json': '{}', 'lib/index.js': 'exports.fixture=true;\n//# sourceMappingURL=index.js.map\n', 'lib/index.js.map': '{}', '.debug/compiled/index.js': 'exports.fixture=true', 'lib/assets/fixture.txt': 'synthetic asset', 'src/index.ts': 'export const fixture=true;', '.env.demo-bundle': 'SYNTHETIC_ONLY=NEVER_PRINT_THIS_FIXTURE_VALUE\n' };
for(const [name,text] of Object.entries(files))put(`functions/${name}`,text);
put('functions/node_modules/excluded.txt','excluded');
const temp=path.join(root,'tmp');fs.mkdirSync(temp);
const expected=Object.entries(files).map(([file,text])=>({file,sha256:sha256(text)}));
const toolsRoot=cliRoot();
assert.equal((await verifyCloudBuildContract(toolsRoot)).fakeRequests,2);
function run(config) {
 const request=path.join(root,'request.json');fs.writeFileSync(request,JSON.stringify({repositoryRoot:root,expected,config,toolsRoot}));
 return spawnSync(process.execPath,[path.join(workspace,'qa/scripts/verify-functions-upload-artifact.mjs'),'--worker',request],{cwd:root,env:{...process.env,DEBUG:'',TEMP:temp,TMP:temp,TMPDIR:temp},encoding:'utf8',timeout:30000,maxBuffer:65536,windowsHide:true});
}
const good=run({});assert.equal(good.status,0,good.stderr);assert.equal(JSON.parse(good.stdout).filesVerified,8);
assert(!good.stdout.includes('NEVER_PRINT_THIS_FIXTURE_VALUE'));assert(!good.stderr.includes('NEVER_PRINT_THIS_FIXTURE_VALUE'));
const ignored=run({ignore:['node_modules','.debug']});assert.equal(ignored.status,1);assert.equal(JSON.parse(ignored.stderr).code,'ZIP_FILESET_MISMATCH');
assert(!ignored.stderr.includes('NEVER_PRINT_THIS_FIXTURE_VALUE'));
const policy=JSON.parse(fs.readFileSync(path.join(workspace,'firebase.json'),'utf8')).functions.ignore;
const extras=['.bundle-provenance.json','.eslintrc.cjs','.gcloudignore','.gitignore','scripts/fixture.mjs','test/fixture.cjs','lib/old.js.map','lib/modules/old.js.map','lib/modules/nested/index.js.map','.git/config'];
for(const name of extras)put('functions/'+name,'synthetic retained local artifact');
const leaked=run({});assert.equal(leaked.status,1);assert.equal(JSON.parse(leaked.stderr).code,'ZIP_FILESET_MISMATCH');
const exact=run({ignore:policy});assert.equal(exact.status,0,exact.stderr);assert.equal(JSON.parse(exact.stdout).exactFileSet,true);assert.equal(JSON.parse(exact.stdout).archiveFiles,8);
for(const name of extras)assert(fs.existsSync(path.join(root,'functions',name)));
put('functions/unreviewed.js','exports.unreviewed=true');
const rogue=run({ignore:policy});assert.equal(rogue.status,1);assert.equal(JSON.parse(rogue.stderr).code,'ZIP_FILESET_MISMATCH');
fs.unlinkSync(path.join(root,'functions/unreviewed.js'));
put('functions/lib/index.js','exports.tampered=true');
const tampered=run({ignore:policy});assert.equal(tampered.status,1);assert.equal(JSON.parse(tampered.stderr).code,'ZIP_CONTENT_MISMATCH');
// The real launcher must propagate only process state into a fake CLI. No
// deploy runs: APPDATA resolves to this explicitly constructed local fixture.
const appdata=path.join(root,'fake-appdata');
put('fake-appdata/npm/node_modules/firebase-tools/lib/bin/firebase.js',"if(process.env.PAY0_FUNCTIONS_BUILD_MODE!=='BUNDLED_V1'||process.env.DEBUG)process.exit(3);console.log(JSON.stringify({selectorInherited:true,cloudCalls:0}));");
const launcher=spawnSync(process.execPath,[path.join(workspace,'scripts/run-firebase-clean-env.mjs'),'deploy','--only','functions','--project','demo-bundle'],{cwd:root,env:{...process.env,APPDATA:appdata,PAY0_FUNCTIONS_BUILD_MODE:'BUNDLED_V1',DEBUG:'synthetic'},encoding:'utf8',timeout:10000,windowsHide:true});
assert.equal(launcher.status,0,launcher.stderr);assert.equal(JSON.parse(launcher.stdout).selectorInherited,true);
console.log(JSON.stringify({result:'PASS',realLocalPackerCalls:6,fakeApiRequests:2,cloudCalls:0,syntheticEnvOnly:true}));
