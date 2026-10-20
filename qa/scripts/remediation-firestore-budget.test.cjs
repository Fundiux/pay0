"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..'),source=path.resolve(process.env.PAY0_RULES_SOURCE_ROOT||root);
const baseHash='03cca1237bd47a9e5670c4c1411e114383788a56c7763d6e0779cd7602601dc3';
const candidateHash='7863811b85a57ff7dde6e9d3c5925253a90371dfdf4c63fc3a60bebf5ed31876';
assert.equal(process.env.GCLOUD_PROJECT,'demo-pay0-restriction-boundaries');
for(const k of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])assert.match(process.env[k]||'',/^127\.0\.0\.1:\d+$/);
const hash=createHash('sha256').update(fs.readFileSync(path.join(source,'firestore.rules'),'utf8').replace(/\r\n/g,'\n')).digest('hex');
const expected=process.argv.includes('--baseline')?baseHash:candidateHash;
assert.equal(hash,expected,'Candidate changed: review and repin, never accept an arbitrary hash');
const integration=path.join(root,'.worktrees/pay0-remediation-integration-20261009');
const block=s=>s.match(/\/\/ AUTHORIZATION_POLICY_GENERATED_START[\s\S]+?\/\/ AUTHORIZATION_POLICY_GENERATED_END[^\n]*/)[0];
assert.equal(block(fs.readFileSync(path.join(source,'firestore.rules'),'utf8')).replace(/\r\n/g,'\n'),block(fs.readFileSync(path.join(integration,'firestore.rules'),'utf8')).replace(/\r\n/g,'\n'));
const temp=fs.mkdtempSync(path.join(root,'.firebase/remediation-temp/budget-suites-'));
let exhausted=0;
for(const [filename,project]of [['remediation-firestore-release-queries.test.mjs','demo-pay0-firestore-release'],['remediation-restriction-boundaries.test.mjs','demo-pay0-restriction-boundaries'],['remediation-firestore-budget-aliases.test.mjs','demo-pay0-restriction-boundaries']]){
 if(process.argv.includes('--boundary-only') && !filename.includes('restriction-boundaries'))continue;
 if(process.argv.includes('--query-only') && filename.includes('restriction-boundaries'))continue;
 let code=fs.readFileSync(path.join(__dirname,filename),'utf8');
 if(filename.includes('release-queries')){assert.equal(code.split(baseHash).length,2);code=code.replace(baseHash,expected);}
 else{code=code.replace("'../../scripts/lib/authorization-policy-generator.mjs'",JSON.stringify(pathToFileURL(path.join(root,'scripts/lib/authorization-policy-generator.mjs')).href));}
 assert.equal(code.split('assertFails(p)').length,2,'Expected exact deny assertion instrumentation');
 code=code.replace('assertFails(p)',`assertFails(p.catch(error=>{if(/maximum of 1000 expressions|maximum.*expression.*reached|too many.*(?:get|exists).*calls/i.test(String(error.message||'')))console.error('EVALUATOR_BUDGET_EXHAUSTED '+JSON.stringify({case:typeof currentCase==='undefined'?'query-or-alias':currentCase,check:typeof checks==='undefined'?null:checks,code:error.code,detail:String(error.message||'').match(/.{0,60}(?:maximum of 1000 expressions|maximum.*expression.*reached|too many.*(?:get|exists).*calls).{0,60}/i)?.[0]?.slice(0,240)}));throw error;}))`);
 const script=path.join(temp,filename);fs.writeFileSync(script,code);
 const out=spawnSync(process.execPath,[script],{cwd:source,encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024,env:{...process.env,GCLOUD_PROJECT:project,PAY0_RULES_SOURCE_ROOT:source,PAY0_RESTRICTION_RULES_MODE:'actual'}});
 const output=(out.stdout||'')+(out.stderr||'');
 exhausted+=(output.match(/EVALUATOR_BUDGET_EXHAUSTED|maximum of 1000 expressions|maximum.*expression.*reached|too many.*(?:get|exists).*calls/gi)||[]).length;
 process.stdout.write(out.stdout||'');process.stderr.write(out.stderr||'');
 assert.equal(out.error,undefined,'Child failed to finish');assert.equal(out.status,0,'Existing suite must pass without weakened assertions');
}
console.log(JSON.stringify({mode:'FIRESTORE_EXPRESSION_BUDGET',rulesHash:hash,expressionExhaustionDiagnostics:exhausted,cloudEffects:false}));
assert.equal(exhausted,0,'Authorization denial caused by evaluator exhaustion is not a clean budget gate');
