import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildCreatePlan, validateScope, validateExecutionRequest, executePlan, rollbackPlan, privatePath, acquireActiveExecutor, validateReviewedInput, validateArtifactProofs, readProofs, REVIEWED_ARCHIVE_SHA256, NAMES } from '../../scripts/create-supervised-learning-review.mjs';
const input = { group: 'supervised-learning-review-new', functions: [...NAMES], gateMode: 'OFF', startupProofSha256:'1'.repeat(64),behaviorProofSha256:'2'.repeat(64), sourceTree: null, sourceCommit: 'a'.repeat(40), archiveSha256: 'b'.repeat(64), sourceIdentity: { mode: 'D1_REVIEW_NEW_FROM_REVIEWED_ARCHIVE_V1', baseArchiveSha256:'c'.repeat(64),patchSha256:'d'.repeat(64) } };
const fixture = () => ({ project: 'pay-0-system', absent: Object.fromEntries(NAMES.map(n => [n, true])), functions: { getControlCenterEngineering: { resource: { name:'projects/pay-0-system/locations/us-central1/functions/getControlCenterEngineering', state: 'ACTIVE', buildConfig: { runtime: 'nodejs22', entryPoint: 'getControlCenterEngineering', environmentVariables: { FUNCTION_TARGET: 'getControlCenterEngineering', GOOGLE_NODE_RUN_SCRIPTS: '' }, source: { storageSource: { bucket: 'old' } } }, serviceConfig: { service:'projects/pay-0-system/locations/us-central1/services/getcontrolcenterengineering', uri: 'old-uri', revision: 'old-revision', serviceAccountEmail: 'existing-account', environmentVariables: { FUNCTION_TARGET: 'getControlCenterEngineering', EXISTING_VALUE: 'synthetic-private' }, secretEnvironmentVariables: [], availableMemory: '256Mi', timeoutSeconds: 60 } }, service: {terminalCondition:{state:'CONDITION_SUCCEEDED'}}, iam: { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }, { role: 'roles/owner', members: ['user:never-copy@example.invalid'] }] } } } });
test('plan adds only one named resource and requires explicit approval', () => { const p = buildCreatePlan(input, fixture()); assert.deepEqual(p.functions.map(f => f.functionId), NAMES); assert.equal(p.productionWrites, 0); assert.equal(p.functions[0].iamProposal.approved, false); assert.equal(p.rollbackProposal.dataDeletion, false); });
test('runtime and closed gate preserved, identity renamed, outputs omitted', () => { const f = buildCreatePlan(input, fixture()).functions[0]; assert.equal(f.resourceTemplate.serviceConfig.environmentVariables.FUNCTION_TARGET, NAMES[0]); assert.equal(f.resourceTemplate.buildConfig.environmentVariables.FUNCTION_TARGET, NAMES[0]); assert.deepEqual(f.resourceTemplate.serviceConfig.secretEnvironmentVariables, []); assert.equal(f.resourceTemplate.serviceConfig.environmentVariables.HUGO_SUPERVISED_RULES_ENABLED, 'false'); assert.equal(f.resourceTemplate.serviceConfig.uri, undefined); assert.equal(f.resourceTemplate.serviceConfig.revision, undefined); assert.equal(f.resourceTemplate.buildConfig.source, undefined); assert.equal(f.resourceTemplate.serviceConfig.timeoutSeconds, 30); });
test('IAM proposal never copies owners or unrelated members', () => { const p = buildCreatePlan(input, fixture()); assert.deepEqual(p.functions[0].iamProposal.bindings, [{ role: 'roles/run.invoker', members: ['allUsers'] }]); });
test('existing target is rejected', () => { const b = fixture(); b.absent[NAMES[0]] = false; assert.throws(() => buildCreatePlan(input, b), /FUNCTION_ALREADY_EXISTS/); });
test('wrong scope, duplicates and missing function rejected', () => { for (const s of [[], ['sendAgent007Message'], [...NAMES, 'other'], [NAMES[0], NAMES[0]]]) assert.throws(() => validateScope(s), /EXACT_ONE_FUNCTION_SCOPE_REQUIRED/); });
test('parent public invocation cannot be assumed', () => { const b = fixture(); b.functions.getControlCenterEngineering.iam.bindings = []; assert.throws(() => buildCreatePlan(input, b), /PUBLIC_INVOCATION/); });
test('execution requires hashes, exact scope and explicit approval flag', () => { const bytes = Buffer.from('synthetic'), hash = crypto.createHash('sha256').update(bytes).digest('hex'); assert.throws(() => validateExecutionRequest(['--execute'], bytes), /EXECUTE_INPUT_HASH_REQUIRED/); assert.throws(() => validateExecutionRequest(['--execute', '--input-sha256', hash], bytes), /EXECUTE_SCOPE_REQUIRED/); const args=['--execute','--input-sha256',hash,'--scope',NAMES.join(',')]; assert.throws(() => validateExecutionRequest(args,bytes),/EXECUTE_PLAN_HASH_REQUIRED/); assert.throws(()=>validateExecutionRequest([...args,'--plan-sha256','x'],bytes),/EXPLICIT_CREATE_AND_IAM_APPROVAL_REQUIRED/); });
test('default mode never authorizes execution', () => { assert.equal(validateExecutionRequest([], Buffer.from('fixture')), undefined); });

function scenario(options = {}) {
  const archive = Buffer.from('synthetic-zip');
  const i = { ...input, archiveSha256: crypto.createHash('sha256').update(archive).digest('hex') };
  const baseline = fixture(); baseline.functions.getControlCenterEngineering.service={kind:'parent-service',terminalCondition:{state:'CONDITION_SUCCEEDED'}};
  const plan = buildCreatePlan(i, baseline), calls=[], resources={}, policies={}, journal={functions:{}};
  if(options.existing) resources[NAMES[0]]={foreign:true};
  const io={
    persist() {}, sleep:async()=>{}, readSource:async()=>archive, upload:async()=> '11',
    read:async(url)=>{
      calls.push({method:'GET',url});
      if(url.endsWith('/functions/getControlCenterEngineering'))return baseline.functions.getControlCenterEngineering.resource;
      if(url.endsWith('/services/getcontrolcenterengineering:getIamPolicy'))return baseline.functions.getControlCenterEngineering.iam;
      if(url.endsWith('/services/getcontrolcenterengineering'))return baseline.functions.getControlCenterEngineering.service;
      if(url.includes('/operations?'))return {operations:[]};
      if(url.includes('/operations/'))return {done:true};
      if(url.includes('/functions/'))return resources[url.split('/').at(-1)]||null;
      if(url.endsWith(':getIamPolicy'))return policies[url.split('/').at(-1).split(':')[0]]||{etag:'first',bindings:[]};
      if(url.includes('/services/'))return {terminalCondition:{state:'CONDITION_SUCCEEDED'}};
      throw Error('Unexpected mock read '+url);
    },
    mutate:async(url,body)=>{
      calls.push({method:'POST',url,body:structuredClone(body)});
      if(url.endsWith(':generateUploadUrl'))return {uploadUrl:options.badUpload?'https://evil.invalid/upload':'https://storage.googleapis.com/upload',storageSource:{bucket:'gcf-v2-uploads-751158244178.us-central1.cloudfunctions.appspot.com',object:'approved.zip'}};
      if(url.includes('?functionId=')){
        const name=new URL(url).searchParams.get('functionId');
        resources[name]={...structuredClone(body),state:'ACTIVE',serviceConfig:{...body.serviceConfig,service:`projects/pay-0-system/locations/us-central1/services/${name.toLowerCase()}`}};
        if(options.uncertainCreate)throw Error('NETWORK_UNCERTAIN');
        return {name:`projects/pay-0-system/locations/us-central1/operations/${name}`};
      }
      if(url.endsWith(':setIamPolicy')){const name=url.split('/').at(-1).split(':')[0];policies[name]=body.policy;if(options.uncertainIam){options.uncertainIam=false;throw Error('IAM_UNCERTAIN');}return body.policy;}
      throw Error('Unexpected mock mutation');
    },
  };
  return {input:i,plan,baseline,archive,journal,io,calls,resources};
}
test('HTTP mock creates exactly one, pins source, sets scoped IAM and verifies postflight',async()=>{const s=scenario();await executePlan(s);assert.equal(s.journal.state,'CONFIGURATION_VERIFIED_FUNCTIONAL_CHECK_PENDING');assert.equal(s.calls.filter(c=>c.method==='POST'&&c.url.includes('?functionId=')).length,1);assert.equal(s.calls.filter(c=>c.method==='POST'&&c.url.endsWith(':setIamPolicy')).length,1);for(const c of s.calls.filter(c=>c.body?.buildConfig))assert.equal(c.body.buildConfig.source.storageSource.generation,'11');});
test('preexisting resource prevents all mutation',async()=>{const s=scenario({existing:true});await assert.rejects(executePlan(s),/FUNCTION_ALREADY_EXISTS/);assert.equal(s.calls.filter(c=>c.method==='POST').length,0);});
test('resumed upload must retain approved bytes before any create',async()=>{const s=scenario();s.journal.uploadedSource={bucket:'gcf-v2-uploads-751158244178.us-central1.cloudfunctions.appspot.com',object:'tampered.zip',generation:'99'};s.io.readSource=async()=>Buffer.from('unapproved');await assert.rejects(executePlan(s),/UPLOADED_SOURCE_MISMATCH/);assert.equal(s.calls.filter(c=>c.method==='POST').length,0);});
test('untrusted upload host fails before upload or create',async()=>{const s=scenario({badUpload:true});await assert.rejects(executePlan(s),/UPLOAD_HOST/);assert.equal(s.calls.filter(c=>c.url.includes('?functionId=')).length,0);});
test('unknown create outcome is retained and never retried',async()=>{const s=scenario({uncertainCreate:true});await assert.rejects(executePlan(s),/NETWORK_UNCERTAIN/);await assert.rejects(executePlan(s),/UNCERTAIN_CREATE_REQUIRES_RECONCILIATION/);assert.equal(s.calls.filter(c=>c.url.includes('?functionId=')).length,1);});
test('resume after IAM response loss observes desired policy without repeated create',async()=>{const s=scenario({uncertainIam:true});await assert.rejects(executePlan(s),/IAM_UNCERTAIN/);await executePlan(s);assert.equal(s.calls.filter(c=>c.url.includes('?functionId=')).length,1);assert.equal(s.calls.filter(c=>c.method==='POST'&&c.url.endsWith(':setIamPolicy')).length,1);});
test('parent drift prevents all mutation',async()=>{const s=scenario();const read=s.io.read;s.io.read=async u=>u.endsWith('/functions/getControlCenterEngineering')?{}:read(u);await assert.rejects(executePlan(s),/PARENT_DRIFT/);assert.equal(s.calls.filter(c=>c.method==='POST').length,0);});
test('existing unrelated IAM prevents overwrite',async()=>{const s=scenario();const read=s.io.read;s.io.read=async u=>u.includes('/services/')&&!u.includes('/services/getcontrolcenterengineering')&&u.endsWith(':getIamPolicy')?{bindings:[{role:'roles/owner',members:['user:outside@example.invalid']}]}:read(u);await assert.rejects(executePlan(s),/UNEXPECTED_NEW_SERVICE_IAM/);assert.equal(s.calls.filter(c=>c.url.endsWith(':setIamPolicy')).length,0);});
test('foreign operation in resume journal cannot be polled',async()=>{const s=scenario();s.journal.functions[NAMES[0]]={phase:'CREATE_ACCEPTED',operation:'projects/other/locations/us-central1/operations/foreign'};await assert.rejects(executePlan(s),/OPERATION_SCOPE/);assert.equal(s.calls.filter(c=>c.url.includes('/operations/foreign')).length,0);});
test('rollback removes public invoker on exactly owned service and keeps functions',async()=>{const s=scenario();await executePlan(s);await rollbackPlan(s);assert.equal(s.journal.state,'ROLLED_BACK_PUBLIC_INVOCATION_ONLY');assert.equal(Object.keys(s.resources).length,1);assert.equal(s.calls.filter(c=>c.method==='POST'&&c.url.endsWith(':setIamPolicy')).length,2);for(const c of s.calls.filter(c=>c.method==='POST').slice(-1))assert.deepEqual(c.body.policy.bindings,[]);});
test('rollback rejects concurrent IAM changes before mutating the service',async()=>{const s=scenario();await executePlan(s);const read=s.io.read;s.io.read=async u=>u.endsWith(':getIamPolicy')?{etag:'new',bindings:[{role:'roles/run.invoker',members:['allUsers','user:other@example.invalid']}]}:read(u);const before=s.calls.filter(c=>c.method==='POST').length;await assert.rejects(rollbackPlan(s),/ROLLBACK_IAM_DRIFT/);assert.equal(s.calls.filter(c=>c.method==='POST').length,before);});
test('approved target templates cannot silently change',async()=>{const s=scenario();s.plan.functions[0].resourceTemplate.serviceConfig.environmentVariables.EXTRA='unexpected';await assert.rejects(executePlan(s),/CREATE_PLAN_DRIFT/);assert.equal(s.calls.length,0);});
test('active executor lock excludes a concurrent resume too',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pay0-create-lock-'));const lock=path.join(dir,'active-executor.lock');const release=acquireActiveExecutor(lock);try{assert.throws(()=>acquireActiveExecutor(lock),e=>e.code==='EEXIST');}finally{release();fs.rmdirSync(dir);}});
test('private path rejects a symlink ancestor', t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pay0-create-path-'));const dest=path.join(dir,'real');const link=path.join(dir,'link');fs.mkdirSync(dest);try{try{fs.symlinkSync(dest,link,process.platform==='win32'?'junction':'dir');}catch(e){if(e.code==='EPERM'){t.skip('OS denies test symlink creation');return;}throw e;}assert.throws(()=>privatePath(path.join(link,'new.json'),dir),/PRIVATE_PATH_SYMLINK/);}finally{if(fs.existsSync(link))fs.rmdirSync(link);fs.rmdirSync(dest);fs.rmdirSync(dir);}});

const pinnedInput = () => ({...structuredClone(input), archiveSha256:REVIEWED_ARCHIVE_SHA256,
  sourceCommit:'21eba53611dde560b446b273f3a32562897e587e',
  sourceIdentity:{mode:'D1_REVIEW_NEW_FROM_REVIEWED_ARCHIVE_V1',baseArchiveSha256:'83baf34e6e7c3f52c90d820ef18a555da8d2aba854bbb8dc552b72be44c36bfe',patchSha256:'744e16e5f5166acd3fbeb5a60d674a59245f4287db7cf01d318a17856418e9ae',patchCommit:'21eba53611dde560b446b273f3a32562897e587e'},
  startupProofFile:path.resolve('.firebase/modular-release/future-d1/startup.json'),behaviorProofFile:path.resolve('.firebase/modular-release/future-d1/behavior.json')});
test('CLI accepts only the reviewed D1 identity and exact one target',()=>{
  const valid=pinnedInput();assert.doesNotThrow(()=>validateReviewedInput(valid));
  for(const change of [{archiveSha256:'0'.repeat(64)},{sourceCommit:'0'.repeat(40)},{functions:['sendAgent007Message']},{gateMode:'ON'},{startupProofSha256:''}])assert.throws(()=>validateReviewedInput({...valid,...change}));
  for(const key of ['baseArchiveSha256','patchSha256','patchCommit']){const changed=structuredClone(valid);changed.sourceIdentity[key]='0'.repeat(key==='patchCommit'?40:64);assert.throws(()=>validateReviewedInput(changed));}
});
test('creation alone does not require an R2 live resource',()=>{
  const baseline=fixture();assert.equal(baseline.functions.sendAgent007Message,undefined);
  assert.equal(buildCreatePlan(pinnedInput(),baseline).functions.length,1);
});
test('gate cannot inherit ON or ambiguous values and no secret binding is copied',()=>{
  for(const value of ['true','TRUE','0','']){const b=fixture();b.functions.getControlCenterEngineering.resource.serviceConfig.environmentVariables.HUGO_SUPERVISED_RULES_ENABLED=value;assert.throws(()=>buildCreatePlan(input,b),/PARENT_GATE_NOT_OFF/);}
  for(const field of ['secretEnvironmentVariables','secretVolumes']){const b=fixture();b.functions.getControlCenterEngineering.resource.serviceConfig[field]=[{}];assert.throws(()=>buildCreatePlan(input,b),/UNREVIEWED_SECRET_BINDING/);}
});
test('active operation and unavailable parent reject before a create plan',()=>{
  const b=fixture();b.operations=[{done:false}];assert.throws(()=>buildCreatePlan(input,b),/ACTIVE_OPERATION/);
  const other=fixture();other.functions.getControlCenterEngineering.service.terminalCondition.state='CONDITION_FAILED';assert.throws(()=>buildCreatePlan(input,other),/PARENT_SERVICE_NOT_READY/);
});
test('changed controller or proof pins reject with no network IO',async()=>{
  for(const kind of ['controllerPins','proofPins']){const s=scenario();s.plan[kind]={tampered:true};await assert.rejects(executePlan(s));assert.equal(s.calls.length,0);}
});
test('proof hashes, source identity, confinement and symlinks are enforced before use',()=>{
  const base=path.resolve('.firebase/modular-release');fs.mkdirSync(base,{recursive:true});const dir=fs.mkdtempSync(path.join(base,'qa-d1-proof-'));
  assert(dir.startsWith(base+path.sep));
  try{
    const i=pinnedInput();i.startupProofFile=path.join(dir,'startup.json');i.behaviorProofFile=path.join(dir,'behavior.json');
    const startup={status:'PASS',archiveSha256:i.archiveSha256,productionWrites:0,sourceIdentity:i.sourceIdentity,functions:['sendAgent007Message','reviewAgent007LearningRule'],unauthenticatedDenied:2,endpointsLoaded:343,previousExportsPreserved:342,gate:'OFF',networkBlocked:true};
    const behavior={status:'PASS',archiveSha256:i.archiveSha256,productionWrites:0,sourceIdentity:i.sourceIdentity,emulatorTests:20,emulatorExit:0,regressions:{status:'PASS',total:61},sourceMutations:0};
    const write=()=>{fs.writeFileSync(i.startupProofFile,JSON.stringify(startup));fs.writeFileSync(i.behaviorProofFile,JSON.stringify(behavior));i.startupProofSha256=crypto.createHash('sha256').update(fs.readFileSync(i.startupProofFile)).digest('hex');i.behaviorProofSha256=crypto.createHash('sha256').update(fs.readFileSync(i.behaviorProofFile)).digest('hex');};
    write();assert.doesNotThrow(()=>readProofs(i));
    fs.appendFileSync(i.startupProofFile,' ');assert.throws(()=>readProofs(i),/PROOF_BYTES_CHANGED/);write();
    startup.sourceIdentity={...i.sourceIdentity,patchCommit:'f'.repeat(40)};write();assert.throws(()=>readProofs(i),/PROOF_SOURCE_IDENTITY/);startup.sourceIdentity=i.sourceIdentity;write();
    assert.throws(()=>readProofs({...i,startupProofFile:path.join(os.tmpdir(),'outside.json')}),/PRIVATE_PATH_REQUIRED/);
    const real=path.join(dir,'real'),link=path.join(dir,'linked');fs.mkdirSync(real);fs.writeFileSync(path.join(real,'startup.json'),fs.readFileSync(i.startupProofFile));
    fs.symlinkSync(real,link,process.platform==='win32'?'junction':'dir');assert.throws(()=>readProofs({...i,startupProofFile:path.join(link,'startup.json')}),/PRIVATE_PATH_SYMLINK/);fs.rmdirSync(link);
  }finally{assert(dir.startsWith(base+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});

test('resume marks uncertain create durable even when uploaded journal flag is false',async()=>{const s=scenario({uncertainCreate:true});s.journal.uploadedSource={bucket:'gcf-v2-uploads-751158244178.us-central1.cloudfunctions.appspot.com',object:'approved.zip',generation:'11'};s.journal.networkMutationStarted=false;const persisted=[];s.io.persist=j=>persisted.push(structuredClone(j));await assert.rejects(executePlan(s),/NETWORK_UNCERTAIN/);assert.equal(s.journal.networkMutationStarted,true);assert(persisted.some(j=>j.networkMutationStarted&&Object.values(j.functions).some(f=>f.phase==='CREATE_DISPATCHING')));await assert.rejects(executePlan(s),/UNCERTAIN_CREATE/);assert.equal(s.calls.filter(c=>c.url.includes('?functionId=')).length,1);});
