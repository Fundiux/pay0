import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RELEASE,RULES_SHA,GROUPS,CONCURRENCY,READERS,assertRelease,assertSameRelease,assertDependencies,validatePlan,executeContract,rollbackContract,api } from '../../scripts/deploy-certified-firestore.mjs';
const source=fs.readFileSync('firestore.rules','utf8').replace(/\r\n/g,'\n');
const commit='a'.repeat(40),archive='b'.repeat(64);
const previous={name:RELEASE,rulesetName:'projects/pay-0-system/rulesets/old',createTime:'2026-01-01T00:00:00Z',updateTime:'2026-01-01T00:00:00Z'};
const own={...previous,rulesetName:'projects/pay-0-system/rulesets/new',updateTime:'2026-02-01T00:00:00Z'};
const oldRules={name:previous.rulesetName,source:{files:[{name:'firestore.rules',content:'old restrictive rules'}]}};
const dependencies={schema:'PAY0-FIRESTORE-READFLOW-DEPENDENCIES@1',sourceCommit:commit,
 readers:READERS.map(name=>({name,archiveSha256:archive,configurationVerified:true,resource:{name:`projects/pay-0-system/locations/us-central1/functions/${name}`,state:'ACTIVE',labels:{'pay0-source-commit':commit,'firebase-functions-hash':archive.slice(0,40)}}})),
 hosting:{configurationVerified:true,release:{name:'sites/pay-0-system/releases/release',version:{status:'FINALIZED'}},ssrResource:{name:'projects/pay-0-system/locations/us-central1/functions/ssrpay0system',state:'ACTIVE',labels:{'pay0-source-commit':commit,'firebase-functions-hash':archive.slice(0,40)}},runtimeProof:{schema:'PAY0-MODULAR-HOSTING-RUNTIME@1',sourceCommit:commit,status:'PASS',runtimeHttpPassed:true,criticalBrowserPassed:true,archiveSha256:archive}}};
const plan={schema:'PAY0-CERTIFIED-FIRESTORE@1',group:'firestore',sourceFile:'firestore.rules',rulesSha256:RULES_SHA,concurrencyGuarantee:CONCURRENCY,sourceCommit:commit,previousRelease:previous,previousRuleset:oldRules};
function fake(){let current=structuredClone(previous), calls=[],events=[];return {calls,events,set(value){current=value;},remote:{async dependencies(){calls.push('dependencies');},async release(){calls.push('get');return current;},async create(value){calls.push('create');assert.equal(value,source);return{name:own.rulesetName};},async ruleset(name){return name===previous.rulesetName?oldRules:{name:own.rulesetName,source:{files:[{name:'firestore.rules',content:source,fingerprint:'optional'}]}};},async patch(name){calls.push('patch');current={...own,rulesetName:name};return current;}},emit:e=>events.push(e),verifyLocal:async()=>calls.push('local')};}
test('fixed Firestore scope, certified hash and eleven deployed dependencies required',()=>{
 validatePlan(plan,dependencies);
 assert.throws(()=>assertRelease({...previous,name:RELEASE.replace('cloud.firestore','firebase.storage')}));
 assert.throws(()=>validatePlan({...plan,rulesSha256:'c'.repeat(64)},dependencies));
 assert.throws(()=>assertDependencies({...dependencies,readers:dependencies.readers.slice(1)},commit));
 for(const mutate of [d=>d.readers[0].resource.state='DEPLOYING',d=>d.readers[0].resource.labels['pay0-source-commit']='old',d=>d.readers[0].configurationVerified=false,d=>d.hosting.configurationVerified=false,d=>d.hosting.runtimeProof.criticalBrowserPassed=false,d=>d.hosting.ssrResource.labels['firebase-functions-hash']='old']){
  const value=structuredClone(dependencies);mutate(value);assert.throws(()=>assertDependencies(value,commit));
 }
 assert.throws(()=>assertSameRelease(previous,{...previous,updateTime:'different'}));
});
test('execute creates only reviewed source then patches exact release with pre/post verification',async()=>{
 const f=fake();assert.deepEqual(await executeContract({plan,dependencies,source,...f}),own);
 assert.equal(f.calls.filter(x=>x==='create').length,1);assert.equal(f.calls.filter(x=>x==='patch').length,1);
 assert.equal(f.calls.filter(x=>x==='dependencies').length,3);
 assert.equal(f.events.at(-1).concurrencyGuarantee,CONCURRENCY);
});
test('concurrent release stops before create or before patch; wrong source fails closed',async()=>{
 const a=fake();a.set(own);await assert.rejects(executeContract({plan,dependencies,source,...a}));assert(!a.calls.includes('create'));
 const b=fake();const create=b.remote.create;b.remote.create=async value=>{const result=await create(value);b.set(own);return result;};
 await assert.rejects(executeContract({plan,dependencies,source,...b}));assert(!b.calls.includes('patch'));
 const c=fake();await assert.rejects(executeContract({plan,dependencies,source:source+' ',...c}));assert(!c.calls.includes('create'));
});
test('rollback accepts only own exact release, verifies old source, never deletes a ruleset',async()=>{
 const f=fake();f.set(own);const result=await rollbackContract({plan,own,...f});assert.equal(result.rulesetName,previous.rulesetName);assert.equal(f.calls.filter(x=>x==='patch').length,1);assert(!f.calls.includes('create'));
 const changed=fake();changed.set({...own,updateTime:'newer'});await assert.rejects(rollbackContract({plan,own,...changed}));assert(!changed.calls.includes('patch'));
 const bad=fake();bad.set(own);bad.remote.ruleset=async()=>({source:{files:[]}});await assert.rejects(rollbackContract({plan,own,...bad}));assert(!bad.calls.includes('patch'));
});

test('REST mutation adapter cannot target Storage or another project',async()=>{
 const original=globalThis.fetch, calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(own),{status:200});};
 try {
  const remote=api('synthetic-token');
  await remote.patch(own.rulesetName);
  assert.equal(calls[0].url,'https://firebaserules.googleapis.com/v1/'+RELEASE);
  assert.equal(calls[0].options.method,'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body),{release:{name:RELEASE,rulesetName:own.rulesetName},updateMask:'rulesetName'});
  await assert.rejects(remote.patch('projects/other/rulesets/not-allowed'));
  assert.equal(calls.length,1);
 } finally {globalThis.fetch=original;}
});

test('Storage group pins exact bucket, source hash and independent journal target',async()=>{
 const target=GROUPS.storage, storageSource=fs.readFileSync('storage.rules','utf8').replace(/\r\n/g,'\n');
 const before={...previous,name:target.release},after={...own,name:target.release};
 const storagePlan={...plan,group:'storage',sourceFile:'storage.rules',rulesSha256:target.hash,previousRelease:before};
 validatePlan(storagePlan,dependencies);
 assert.throws(()=>validatePlan({...storagePlan,rulesSha256:RULES_SHA},dependencies));
 assert.throws(()=>validatePlan({...storagePlan,previousRelease:previous},dependencies));
 assert.throws(()=>validatePlan({...storagePlan,group:'arbitrary'},dependencies));
 let current=before,patches=0;
 const remote={async dependencies(){},async release(){return current;},async create(s){assert.equal(s,storageSource);return{name:after.rulesetName};},async ruleset(name){return name===before.rulesetName?oldRules:{name,source:{files:[{name:'storage.rules',content:storageSource}]}};},async patch(name){patches++;current={...after,rulesetName:name};return current;}};
 await executeContract({plan:storagePlan,dependencies,source:storageSource,remote,emit(){},async verifyLocal(){}});
 assert.equal(patches,1);assert.equal(current.name,target.release);
 await rollbackContract({plan:storagePlan,own:after,remote,emit(){},async verifyLocal(){}});
 assert.equal(patches,2);assert.equal(current.rulesetName,before.rulesetName);
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify(after),{status:200});};
 try{const adapter=api('synthetic',()=>{},'storage');await adapter.create(storageSource);await adapter.patch(after.rulesetName);
 assert.equal(calls[0].body.source.files[0].name,'storage.rules');assert.equal(calls[1].url,'https://firebaserules.googleapis.com/v1/'+target.release);
 assert.throws(()=>api('synthetic',()=>{},'firebase.storage/other'));}finally{globalThis.fetch=original;}
});
