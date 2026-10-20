// Two certified release groups only; no arbitrary resource paths. Firebase Rules has no server-side compare-and-swap.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { PROJECT, REGION, digest, getMetadata, tokenInMemory } from './capture-production-baseline.mjs';
import { inspectSource } from './prepare-release-candidate.mjs';
import { privateFile, sha } from './deploy-modular-hosting.mjs';
export const RELEASE = `projects/${PROJECT}/releases/cloud.firestore`;
export const RULES_SHA = 'a8295beda9d62ee6c13270682f8ff4e73b6b7eaa1841e4c671aaa361a0aa41b7';
export const GROUPS = Object.freeze({
  firestore: Object.freeze({release:RELEASE,file:'firestore.rules',hash:RULES_SHA}),
  storage: Object.freeze({release:'projects/pay-0-system/releases/firebase.storage/pay-0-system.firebasestorage.app',file:'storage.rules',hash:'f74c37cfc073603f3170b590aea2b702ee90ceba9658f7f30eb0cba64a484d06'}),
});
function group(name='firestore') { assert.ok(Object.hasOwn(GROUPS,name),'CERTIFIED_GROUP_REQUIRED'); return GROUPS[name]; }
export const CONCURRENCY = 'preflight-postflight-no-server-CAS';
export const READERS = ['listClientsCanonical','getClientCanonical','listPagos','listSolicitudes','listScopedClientDispersions','listPagoNotes','listSolicitudNotes','listClientDispersionNotes','getAuthorizedDocumentDownloadUrl','getAuthorizedOperationalRecord','listAuthorizedRelatedRecords'];
const API = 'https://firebaserules.googleapis.com/v1/';
const ROOT = path.resolve(import.meta.dirname, '..');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const content = (name='firestore') => fs.readFileSync(path.join(ROOT, group(name).file), 'utf8').replace(/\r\n/g, '\n');
const pins = () => Object.fromEntries(['deploy-certified-firestore.mjs','capture-production-baseline.mjs','deploy-modular-hosting.mjs','prepare-release-candidate.mjs'].map(file => [file,sha(fs.readFileSync(path.join(import.meta.dirname,file)))]));
export function assertRelease(value, name='firestore') {
  assert.equal(value?.name, group(name).release, 'RELEASE_SCOPE');
  assert.match(value.rulesetName || '', /^projects\/pay-0-system\/rulesets\/[A-Za-z0-9_-]+$/, 'RULESET_SCOPE');
  assert.ok(value.updateTime && value.createTime, 'RELEASE_TIMESTAMPS');
}
export function assertSameRelease(expected, actual, name='firestore') { assertRelease(expected,name); assertRelease(actual,name); assert.equal(digest(actual), digest(expected), 'CONCURRENT_RELEASE_CHANGE'); }
export function assertDependencies(value, commit) {
  assert.equal(value?.schema, 'PAY0-FIRESTORE-READFLOW-DEPENDENCIES@1');
  assert.equal(value.sourceCommit, commit, 'DEPENDENCY_COMMIT');
  assert.deepEqual(value.readers.map(row => row.name).sort(), [...READERS].sort(), 'ALL_ELEVEN_READERS_REQUIRED');
  for (const row of value.readers) {
    assert.equal(row.resource?.name, `projects/${PROJECT}/locations/${REGION}/functions/${row.name}`, 'READER_SCOPE');
    assert.equal(row.resource.state, 'ACTIVE', 'READER_NOT_ACTIVE');
    assert.equal(row.resource.labels?.['pay0-source-commit'], commit, 'READER_SOURCE_COMMIT');
    assert.match(row.archiveSha256 || '', /^[a-f0-9]{64}$/, 'READER_ARCHIVE');
    assert.equal(row.resource.labels?.['firebase-functions-hash'], row.archiveSha256.slice(0,40), 'READER_ARCHIVE_LABEL');
    assert.equal(row.configurationVerified, true, 'READER_POSTFLIGHT_REQUIRED');
  }
  const hosting = value.hosting;
  assert.equal(hosting?.configurationVerified, true, 'HOSTING_POSTFLIGHT_REQUIRED');
  assert.match(hosting?.release?.name || '', /^sites\/pay-0-system\/releases\/[A-Za-z0-9_-]+$/, 'HOSTING_SCOPE');
  assert.equal(hosting.release.version?.status, 'FINALIZED', 'HOSTING_NOT_FINALIZED');
  assert.equal(hosting.ssrResource?.name, `projects/${PROJECT}/locations/${REGION}/functions/ssrpay0system`, 'SSR_SCOPE');
  assert.equal(hosting.ssrResource.state, 'ACTIVE');
  assert.equal(hosting.ssrResource.labels?.['pay0-source-commit'], commit, 'SSR_SOURCE_COMMIT');
  assert.equal(hosting.runtimeProof?.schema, 'PAY0-MODULAR-HOSTING-RUNTIME@1');
  assert.equal(hosting.runtimeProof.sourceCommit, commit, 'HOSTING_SOURCE_COMMIT');
  assert.equal(hosting.runtimeProof.status, 'PASS');
  assert.equal(hosting.runtimeProof.runtimeHttpPassed, true);
  assert.equal(hosting.runtimeProof.criticalBrowserPassed, true);
  assert.equal(hosting.ssrResource.labels?.['firebase-functions-hash'], hosting.runtimeProof.archiveSha256?.slice(0,40), 'SSR_ARCHIVE_LABEL');
}
export function validatePlan(plan, dependencies) {
  assert.equal(plan.schema, 'PAY0-CERTIFIED-FIRESTORE@1');
  assert.ok(['firestore','storage'].includes(plan.group),'EXPLICIT_GROUP_REQUIRED');
  const target=group(plan.group);
  assert.equal(plan.sourceFile,target.file,'RULES_SOURCE_FILE');
  assert.equal(plan.rulesSha256, target.hash, 'CERTIFIED_RULES_HASH');
  assert.equal(plan.concurrencyGuarantee, CONCURRENCY);
  assertRelease(plan.previousRelease,plan.group);
  assert.equal(plan.previousRuleset.name, plan.previousRelease.rulesetName);
  assert.ok(plan.previousRuleset.source?.files?.length, 'ROLLBACK_SOURCE_REQUIRED');
  assertDependencies(dependencies, plan.sourceCommit);
}
function readPinned(file, hash) { const bytes=fs.readFileSync(privateFile(file)); assert.equal(sha(bytes),hash,'PIN_CHANGED'); return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')); }
function check(file, hash) {
  const plan=readPinned(file,hash), dependencies=readPinned(plan.dependenciesFile,plan.dependenciesSha256);
  validatePlan(plan,dependencies); assert.equal(sha(content(plan.group)),group(plan.group).hash,'LOCAL_RULES_CHANGED');
  assert.equal(inspectSource(ROOT).sourceCommit,plan.sourceCommit,'SOURCE_CHANGED');
  assert.deepEqual(plan.helperPins,pins(),'HELPER_CHANGED'); return {plan,dependencies};
}
export function api(token, emit=()=>{}, name='firestore') {
  const target=group(name);
  const read=url=>getMetadata(url,token);
  return {
    release:()=>read(API+target.release), ruleset:name=>{ assert.match(name,/^projects\/pay-0-system\/rulesets\/[A-Za-z0-9_-]+$/); return read(API+name); },
    async dependencies(expected) {
      for(const row of expected.readers) assert.equal(digest(await read(`https://cloudfunctions.googleapis.com/v2/${row.resource.name}`)),digest(row.resource),'READER_CHANGED');
      assert.equal(digest(await read(`https://cloudfunctions.googleapis.com/v2/${expected.hosting.ssrResource.name}`)),digest(expected.hosting.ssrResource),'SSR_CHANGED');
      const releases=await read(`https://firebasehosting.googleapis.com/v1beta1/sites/${PROJECT}/releases?pageSize=1`);
      assert.equal(digest(releases.releases?.[0]),digest(expected.hosting.release),'HOSTING_CHANGED');
    },
    async create(source) {
      return mutate(API+`projects/${PROJECT}/rulesets`,'POST',{source:{files:[{name:target.file,content:source}]}},token,emit);
    },
    async patch(rulesetName) {
      assert.match(rulesetName,/^projects\/pay-0-system\/rulesets\/[A-Za-z0-9_-]+$/);
      return mutate(API+target.release,'PATCH',{release:{name:target.release,rulesetName},updateMask:'rulesetName'},token,emit);
    },
  };
}
async function mutate(url, method, body, token, emit) {
  emit({state:'MUTATION_INTENT',method,url});
  const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
  assert.ok(response.ok,`RULES_HTTP_${response.status}`); return response.json();
}
export async function executeContract({plan,dependencies,remote,source,emit,verifyLocal}) {
  validatePlan(plan,dependencies); const target=group(plan.group); assert.equal(sha(source),target.hash,'CERTIFIED_RULES_HASH');
  await verifyLocal(); await remote.dependencies(dependencies); assertSameRelease(plan.previousRelease,await remote.release(),plan.group);
  // An orphan ruleset does not change enforcement; only the release PATCH does.
  const created=await remote.create(source); assert.match(created.name || '',/^projects\/pay-0-system\/rulesets\/[A-Za-z0-9_-]+$/);
  emit({state:'RULESET_CREATED',rulesetName:created.name});
  const stored=await remote.ruleset(created.name);
  assert.deepEqual(stored.source?.files?.map(({name,content})=>({name,content})),[{name:target.file,content:source}],'CREATED_SOURCE_CHANGED');
  await verifyLocal(); await remote.dependencies(dependencies); assertSameRelease(plan.previousRelease,await remote.release(),plan.group);
  const response=await remote.patch(created.name); assertRelease(response,plan.group); assert.equal(response.rulesetName,created.name);
  emit({state:'OWN_RELEASE',release:response});
  assertSameRelease(response,await remote.release(),plan.group);
  await remote.dependencies(dependencies);
  emit({state:'VERIFIED',concurrencyGuarantee:CONCURRENCY}); return response;
}
export async function rollbackContract({plan,own,remote,emit,verifyLocal}) {
  assertRelease(own,plan.group); assert.notEqual(own.rulesetName,plan.previousRelease.rulesetName,'NOT_OWN_UPDATE');
  await verifyLocal(); assertSameRelease(own,await remote.release(),plan.group);
  const currentSource=await remote.ruleset(own.rulesetName);
  assert.deepEqual(currentSource.source?.files?.map(({name,content})=>({name,content})),[{name:group(plan.group).file,content:content(plan.group)}],'ROLLBACK_NOT_CERTIFIED_OWN_RULESET');
  assert.equal(digest(await remote.ruleset(plan.previousRelease.rulesetName)),digest(plan.previousRuleset),'ROLLBACK_SOURCE_CHANGED');
  assertSameRelease(own,await remote.release(),plan.group);
  const response=await remote.patch(plan.previousRelease.rulesetName); assertRelease(response,plan.group); assert.equal(response.rulesetName,plan.previousRelease.rulesetName);
  assertSameRelease(response,await remote.release(),plan.group); emit({state:'ROLLED_BACK',release:response,concurrencyGuarantee:CONCURRENCY}); return response;
}
export async function run(mode, file, hash, dependenciesFile, dependenciesHash, requestedGroup='firestore') {
  if(mode==='prepare') {
    const sourceCommit=inspectSource(ROOT).sourceCommit, dependencies=readPinned(dependenciesFile,dependenciesHash);
    const target=group(requestedGroup);
    assert.equal(sha(content(requestedGroup)),target.hash); assertDependencies(dependencies,sourceCommit);
    const remote=api(tokenInMemory(),undefined,requestedGroup); await remote.dependencies(dependencies);
    const previousRelease=await remote.release(); assertRelease(previousRelease,requestedGroup);
    const previousRuleset=await remote.ruleset(previousRelease.rulesetName);
    const plan={schema:'PAY0-CERTIFIED-FIRESTORE@1',sourceCommit,group:requestedGroup,sourceFile:target.file,rulesSha256:target.hash,concurrencyGuarantee:CONCURRENCY,helperPins:pins(),dependenciesFile:privateFile(dependenciesFile),dependenciesSha256:dependenciesHash,previousRelease,previousRuleset};
    validatePlan(plan,dependencies); fs.writeFileSync(privateFile(file),JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});
    return {file,sha256:sha(fs.readFileSync(file)),concurrencyGuarantee:CONCURRENCY};
  }
  assert.ok(['preflight','execute','rollback'].includes(mode),'MODE');
  const {plan,dependencies}=check(file,hash);
  if(mode==='preflight') {const remote=api(tokenInMemory(),undefined,plan.group); await remote.dependencies(dependencies); assertSameRelease(plan.previousRelease,await remote.release(),plan.group); return {status:'PASS',concurrencyGuarantee:CONCURRENCY};}
  const directory=path.dirname(privateFile(file)), lockFile=privateFile(path.join(ROOT,'.firebase/modular-release/deployment.lock'));
  const journal=privateFile(path.join(directory,`${mode}-${plan.group}.jsonl`));
  assert.ok(!fs.existsSync(journal),'REPLAY_FORBIDDEN');
  const lock=fs.openSync(lockFile,'wx',0o600);
  let dispatched=false,resolved=false; const fd=fs.openSync(journal,'wx',0o600);
  const emit=event=>{if(event.state==='MUTATION_INTENT')dispatched=true;fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),inputSha256:hash,...event})+'\n');fs.fsyncSync(fd);};
  try {
    const remote=api(tokenInMemory(),emit,plan.group), verifyLocal=async()=>check(file,hash); let result;
    if(mode==='execute') result=await executeContract({plan,dependencies,remote,source:content(plan.group),emit,verifyLocal});
    else {
      const rows=fs.readFileSync(privateFile(path.join(directory,`execute-${plan.group}.jsonl`)),'utf8').trim().split('\n').map(JSON.parse);
      assert.ok(rows.every(row=>row.inputSha256===hash),'OTHER_EXECUTION');
      const owned=rows.filter(row=>row.state==='OWN_RELEASE'); assert.equal(owned.length,1,'OWN_RELEASE_REQUIRED');
      assert.equal(rows.filter(row=>row.state==='RULESET_CREATED'&&row.rulesetName===owned[0].release.rulesetName).length,1,'OWN_CREATED_RULESET_REQUIRED');
      result=await rollbackContract({plan,own:owned[0].release,remote,emit,verifyLocal});
    }
    resolved=true; return {status:'PASS',release:result,concurrencyGuarantee:CONCURRENCY};
  } finally {fs.closeSync(fd);fs.closeSync(lock);if(resolved||!dispatched)fs.unlinkSync(lockFile);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  run(...process.argv.slice(2)).then(value=>console.log(JSON.stringify(value))).catch(()=>{console.error(JSON.stringify({status:'BLOCKED',detailsRedacted:true,unresolvedLockMayRequireReconciliation:true}));process.exitCode=1;});
}
