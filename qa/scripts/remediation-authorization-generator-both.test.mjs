import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {renderBackendAuthorizationPolicy} from '../../scripts/lib/backend-authorization-policy-generator.mjs';
import {replaceRulesPolicyBlock} from '../../scripts/lib/authorization-policy-generator.mjs';

const root=process.cwd(), cli=path.join(root,'scripts/generate-authorization-policy.mjs');
const backend='functions/src/modules/users/authorizationPolicy.generated.ts';
const policy=JSON.parse(fs.readFileSync('config/authorization-policy.json','utf8'));
const rules=fs.readFileSync('firestore.rules','utf8');
const rendered=renderBackendAuthorizationPolicy(policy);
assert.equal(renderBackendAuthorizationPolicy(structuredClone(policy)),rendered);
const defaults=text=>JSON.parse(text.match(/export const ROLE_DEFAULT_MODULES = (\{[\s\S]*\}) as const;/)[1]);
assert.deepEqual(defaults(rendered),policy.roleDefaults);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pay0-policy-both-'));
assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'pay0-policy-both-'));
const file=name=>path.join(dir,name);
const run=(args=[],code=0)=>{const result=spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});assert.equal(result.status,code,result.stderr);return result.stdout?JSON.parse(result.stdout):null;};
try {
 fs.mkdirSync(file('config'),{recursive:true});fs.mkdirSync(path.dirname(file(backend)),{recursive:true});
 const next=structuredClone(policy);next.roleDefaults.admin.dashboard.view=false;
 fs.writeFileSync(file('config/authorization-policy.json'),JSON.stringify(next));fs.writeFileSync(file('firestore.rules'),rules);fs.writeFileSync(file(backend),rendered);
 const before=[fs.readFileSync(file('firestore.rules'),'utf8'),fs.readFileSync(file(backend),'utf8')];
 const preview=run();assert.equal(preview.written,false);assert.equal(preview.changed,true);assert.equal(preview.outputs.length,2);run(['--check'],1);
 assert.deepEqual([fs.readFileSync(file('firestore.rules'),'utf8'),fs.readFileSync(file(backend),'utf8')],before,'preview/check must not write either file');
 const written=run(['--write']);assert.equal(written.written,true);assert.deepEqual(defaults(fs.readFileSync(file(backend),'utf8')),next.roleDefaults);assert.equal(fs.readFileSync(file('firestore.rules'),'utf8'),replaceRulesPolicyBlock(rules,next));
 assert.equal(run(['--check']).changed,false);assert.equal(run(['--write']).written,false);
 const changedRules=fs.readFileSync(file('firestore.rules'),'utf8');fs.writeFileSync(file(backend),rendered);assert.equal(run(['--check'],1).outputs.find(row=>row.file===backend).changed,true);assert.equal(fs.readFileSync(file('firestore.rules'),'utf8'),changedRules);
 run(['--write']);const after=[fs.readFileSync(file('firestore.rules'),'utf8'),fs.readFileSync(file(backend),'utf8')];
 fs.writeFileSync(file('config/authorization-policy.json'),JSON.stringify({...next,schemaVersion:2}));run(['--write'],1);assert.deepEqual([fs.readFileSync(file('firestore.rules'),'utf8'),fs.readFileSync(file(backend),'utf8')],after,'invalid policy fails before either artifact write');
 console.log(JSON.stringify({ok:true,backendPolicyCoherent:true,deterministic:true,previewAndCheckReadOnly:true,writeBoth:true,idempotentWrite:true,backendDriftDetected:true,invalidPolicyNoWrites:true,repositoryArtifactsChanged:false}));
} finally {fs.rmSync(dir,{recursive:true});}
