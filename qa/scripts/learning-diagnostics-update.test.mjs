import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { TARGET, BASE_SHA, ARCHIVE_SHA, PATCH_SHA, PATCH_COMMIT, validateInput, buildPlan, runUpdate, assertFunctionPreserved, assertRunPreserved, mayReleaseLock, readResumeState } from '../../scripts/update-learning-diagnostics.mjs';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
function scenario(options = {}) {
  const archive = Buffer.from('synthetic-reviewed'), previousArchive = Buffer.from('synthetic-before');
  const input = { functions: [TARGET], group: 'learning-diagnostics-source-only', sourceTree: null, sourceCommit: PATCH_COMMIT,
    archiveSha256: sha(archive), previousArchiveSha256: sha(previousArchive), sourceIdentity: { mode: 'PRODUCTION_OVERLAY_V1', baseArchiveSha256: sha(previousArchive), patchCommit: PATCH_COMMIT, patchSha256: PATCH_SHA } };
  const serviceName = `projects/pay-0-system/locations/us-central1/services/${TARGET.toLowerCase()}`;
  const oldSource = { bucket: 'gcf-v2-sources-751158244178-us-central1', object: 'original/function-source.zip', generation: '1' };
  const resource = { name: `projects/pay-0-system/locations/us-central1/functions/${TARGET}`, environment: 'GEN_2', state: 'ACTIVE', labels: { retained: 'yes' },
    buildConfig: { runtime: 'nodejs22', entryPoint: TARGET, environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: '' }, source: { storageSource: oldSource }, sourceProvenance: { resolvedStorageSource: oldSource }, dockerRepository: 'original-repository' },
    serviceConfig: { service: serviceName, revision: 'old', environmentVariables: { HUGO_SUPERVISED_RULES_ENABLED: 'false', SYNTHETIC: 'unchanged' }, availableMemory: '256Mi' } };
  const service = { name: serviceName, labels: { retained: 'yes' }, template: { labels: { retained: 'yes' }, containers: [{ image: 'old-image', env: [{ name: 'SYNTHETIC', value: 'unchanged' }] }] }, buildConfig: { functionTarget: TARGET }, terminalCondition: { state: 'CONDITION_SUCCEEDED' } };
  const iam = { etag: 'original', bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] };
  const baseline = { project: 'pay-0-system', operations: [], functions: { [TARGET]: { resource, service, iam } } };
  let current = copy(baseline.functions[TARGET]), sequence = 1, uploadCount = 0;
  const sources = new Map([[JSON.stringify(oldSource), previousArchive]]), calls = [], persisted = [], operations = new Map();
  const journal = {}, plan = { ...buildPlan(input, baseline), inputSha256: 'fixture-input' };
  const io = {
    persist(value) { persisted.push(copy(value)); }, sleep: async () => {},
    async read(url) {
      calls.push({ method: 'GET', url });
      if (url.includes('/operations?')) return { operations: options.active ? [{ done: false }] : [] };
      if (url.includes('/operations/')) return copy(operations.get(url.split('/').at(-1)));
      if (url.includes('/functions/')) return copy(current.resource);
      if (url.endsWith(':getIamPolicy')) return copy(current.iam);
      if (url.includes('/services/')) return copy(current.service);
      throw Error('Unexpected GET');
    },
    async readSource(source) { return sources.get(JSON.stringify(source)) || Buffer.from('unapproved'); },
    async upload(url, bytes) { sources.set(JSON.stringify({ bucket: oldSource.bucket, object: `upload${uploadCount}/function-source.zip`, generation: String(sequence + 1) }), bytes); return String(sequence + 1); },
    async mutate(url, body, method) {
      calls.push({ method, url, body: copy(body) });
      if (url.endsWith(':generateUploadUrl')) { uploadCount++; return { uploadUrl: 'https://storage.googleapis.com/synthetic', storageSource: { bucket: oldSource.bucket, object: `upload${uploadCount}/function-source.zip` } }; }
      assert.equal(method, 'PATCH'); assert(url.endsWith(`/${TARGET}?updateMask=buildConfig.source,labels`));
      sequence++;
      current.resource.buildConfig.source = copy(body.buildConfig.source); current.resource.buildConfig.sourceProvenance = { resolvedStorageSource: copy(body.buildConfig.source.storageSource) };
      current.resource.labels = copy(body.labels); current.resource.serviceConfig.revision = `new${sequence}`;
      current.service.labels = copy(body.labels); current.service.template.labels = copy(body.labels); current.service.template.containers[0].image = `new${sequence}`;
      const operation = { name: `projects/pay-0-system/locations/us-central1/operations/op${sequence}`, done: true, response: copy(current.resource) };
      operations.set(`op${sequence}`, operation);
      if (options.unknown) throw Error('UNKNOWN_NETWORK_OUTCOME');
      return operation;
    },
  };
  return { input, baseline, plan, archive, previousArchive, journal, io, calls, persisted, get current() { return current; }, options };
}
const mutations = s => s.calls.filter(c => c.method !== 'GET');
test('mock source-only update and exact owned rollback preserve configuration and IAM', async () => {
  const s = scenario(); await runUpdate(s); assert.equal(s.journal.update.phase, 'VERIFIED');
  await runUpdate({ ...s, rollback: true }); assert.equal(s.journal.rollback.phase, 'VERIFIED');
  assert.deepEqual(s.current.resource.labels, s.baseline.functions[TARGET].resource.labels);
  assert.equal(mutations(s).filter(c => c.method === 'PATCH').length, 2);
  for (const call of mutations(s).filter(c => c.method === 'PATCH')) assert.deepEqual(Object.keys(call.body).sort(), ['buildConfig', 'labels', 'name']);
});
test('CLI pins exact source identity and refuses other targets', () => {
  const input = { ...scenario().input, archiveSha256: ARCHIVE_SHA, previousArchiveSha256: BASE_SHA,
    sourceIdentity: { mode: 'PRODUCTION_OVERLAY_V1', baseArchiveSha256: BASE_SHA, patchCommit: PATCH_COMMIT, patchSha256: PATCH_SHA } };
  for (const key of ['startup', 'behavior', 'regression']) { input[`${key}ProofSha256`] = 'a'.repeat(64); input[`${key}ProofFile`] = `${process.cwd()}/.firebase/modular-release/synthetic/${key}.json`; }
  assert.doesNotThrow(() => validateInput(input));
  for (const change of [{ functions: ['sendAgent007Message'] }, { archiveSha256: 'a'.repeat(64) }, { sourceCommit: 'a'.repeat(40) }, { sourceTree: 'not-null' }]) assert.throws(() => validateInput({ ...input, ...change }));
});
test('wrong target and changed plan reject before IO', async () => {
  const s = scenario(); s.input.functions = ['sendAgent007Message']; await assert.rejects(runUpdate(s), /EXACT_DIAGNOSTICS/); assert.equal(s.calls.length, 0);
  const other = scenario(); other.plan.updateMask = 'serviceConfig'; await assert.rejects(runUpdate(other), /PLAN_CHANGED/); assert.equal(other.calls.length, 0);
});
test('baseline config, IAM or source drift prevents all writes', async () => {
  for (const kind of ['config', 'iam', 'source']) {
    const s = scenario();
    if (kind === 'config') s.current.resource.serviceConfig.environmentVariables.EXTRA = 'unapproved';
    if (kind === 'iam') s.current.iam.bindings = [];
    if (kind === 'source') s.io.readSource = async () => Buffer.from('different');
    await assert.rejects(runUpdate(s), /BASELINE_DRIFT|LIVE_SOURCE_DRIFT/); assert.equal(mutations(s).length, 0);
  }
});
test('active remote operation blocks upload and PATCH', async () => { const s = scenario({ active: true }); await assert.rejects(runUpdate(s), /ACTIVE_OPERATION/); assert.equal(mutations(s).length, 0); });
test('unknown PATCH outcome remains durable and is never replayed', async () => {
  const s = scenario({ unknown: true }); await assert.rejects(runUpdate(s), /UNKNOWN_NETWORK/);
  assert.equal(s.journal.update.phase, 'DISPATCHING'); assert.equal(s.journal.networkMutationStarted, true);
  await assert.rejects(runUpdate(s), /UNKNOWN_OPERATION/); assert.equal(mutations(s).filter(c => c.method === 'PATCH').length, 1);
});
test('resumed uploaded source bytes are checked before PATCH', async () => {
  const s = scenario(); s.journal.updateUploadedSource = { bucket: 'gcf-v2-sources-751158244178-us-central1', object: 'foreign/function-source.zip', generation: '2' };
  await assert.rejects(runUpdate(s), /UPLOADED_SOURCE_MISMATCH/); assert.equal(mutations(s).length, 0);
});
test('foreign operation in journal is never polled', async () => {
  const s = scenario(); s.journal.update = { phase: 'ACCEPTED', operation: 'projects/foreign/locations/us-central1/operations/other' };
  await assert.rejects(runUpdate(s), /OPERATION_SCOPE/); assert.equal(s.calls.length, 0);
});
test('rollback refuses current state drift', async () => {
  for (const field of ['resource', 'service', 'iam']) { const s = scenario(); await runUpdate(s); s.current[field].extra = 'drift'; const count = mutations(s).length; await assert.rejects(runUpdate({ ...s, rollback: true }), /ROLLBACK_OWNED_STATE_DRIFT/); assert.equal(mutations(s).length, count); }
});
test('postflight compares build repository, gates, IAM and service environment', async () => {
  const s = scenario(); await runUpdate(s); const before = s.baseline.functions[TARGET];
  const changed = copy(s.current.resource); changed.buildConfig.dockerRepository = 'other'; assert.throws(() => assertFunctionPreserved(before.resource, changed, s.current.resource.labels), /CONFIGURATION_DRIFT/);
  const service = copy(s.current.service); service.template.containers[0].env[0].value = 'other'; assert.throws(() => assertRunPreserved(before.service, service, s.current.resource.labels), /RUN_CONFIGURATION_DRIFT/);
});
test('source-generation strings remain exact and repeat verification causes no writes', async () => {
  const s = scenario(); await runUpdate(s); const count = mutations(s).length; await runUpdate(s); assert.equal(mutations(s).length, count); assert.equal(typeof s.current.resource.buildConfig.source.storageSource.generation, 'string');
});

test('malformed or missing resumed journal never releases an existing lock',()=>{assert.equal(mayReleaseLock(false,undefined,true),false);assert.equal(mayReleaseLock(false,{networkMutationStarted:false},true),false);assert.equal(mayReleaseLock(false,{networkMutationStarted:true},false),false);assert.equal(mayReleaseLock(true,{},true),true);});

test('malformed/missing/foreign resumed journal preserves existing lock bytes without IO',()=>{
 const root=path.resolve('.firebase/modular-release');fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'diagnostics-lock-test-'));const lock=path.join(dir,'deployment.lock'),journal=path.join(dir,'journal.json');
 const bytes=JSON.stringify({kind:'LEARNING_DIAGNOSTICS_SOURCE_ONLY',inputSha256:'input',planSha256:'plan',nonce:'nonce',ownerPid:123});fs.writeFileSync(lock,bytes);
 try {
  assert.throws(()=>readResumeState(lock,journal,'input','plan'));
  fs.writeFileSync(journal,'{broken');assert.throws(()=>readResumeState(lock,journal,'input','plan'));
  fs.writeFileSync(journal,JSON.stringify({inputSha256:'foreign',planSha256:'plan',nonce:'nonce'}));assert.throws(()=>readResumeState(lock,journal,'input','plan'),/JOURNAL_INPUT/);
  assert.equal(fs.readFileSync(lock,'utf8'),bytes);
 }finally{fs.rmSync(journal,{force:true});fs.unlinkSync(lock);fs.rmdirSync(dir);}
});
test('forged rollback journal cannot authorize changed configuration',async()=>{const s=scenario();await runUpdate(s);s.journal.update.after.resource.serviceConfig.availableMemory='512Mi';s.current.resource.serviceConfig.availableMemory='512Mi';const count=mutations(s).length;await assert.rejects(runUpdate({...s,rollback:true}),/CONFIGURATION_DRIFT/);assert.equal(mutations(s).length,count);});
