'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const guard = require('../../scripts/lib/dispersion-notes-update-only.cjs');
const NAME = 'listClientDispersionNotes';
const SERVICE = 'projects/pay-0-system/locations/us-central1/services/listclientdispersionnotes';
const OP = 'projects/pay-0-system/locations/us-central1/operations/synthetic';
function baseline() {
  return {
    name: 'projects/pay-0-system/locations/us-central1/functions/' + NAME,
    state: 'ACTIVE', labels: { 'deployment-callable': 'true', 'firebase-functions-codebase': 'default' },
    buildConfig: { runtime: 'nodejs22', entryPoint: NAME, source: { storageSource: { bucket: 'synthetic', object: NAME + '/function-source.zip', generation: '1' } } },
    serviceConfig: { revision: 'listclientdispersionnotes-00001-old', availableMemory: '256Mi', availableCpu: '1', timeoutSeconds: 60, maxInstanceRequestConcurrency: 1,
      serviceAccountEmail: '751158244178-compute@developer.gserviceaccount.com', ingressSettings: 'ALLOW_ALL',
      environmentVariables: { PAY0_FIREBASE_WEB_API_KEY: 'synthetic_key_not_a_secret_1234', GCLOUD_PROJECT: 'pay-0-system', FIREBASE_CONFIG: '{}', FUNCTION_TARGET: NAME, LOG_EXECUTION_ID: 'true' } },
  };
}
function plan() { return { region: { endpointsToCreate: [], endpointsToDelete: [], endpointsToSkip: [], endpointsToUpdate: [{ endpoint: { id: NAME, project: 'pay-0-system', region: 'us-central1', platform: 'gcfv2', codebase: 'default', callableTrigger: {} } }] } }; }
function fixture({ reject = false, before = async () => {} } = {}) {
  const b = baseline(), result = structuredClone(b), events = [];
  result.serviceConfig.revision = 'listclientdispersionnotes-00002-new'; result.buildConfig.source.storageSource.generation = '2';
  let updates = 0, iamReads = 0;
  class Fabricator { async applyPlan() { return true; } }
  const v1 = { createFunction() {}, deleteFunction() {}, updateFunction() {} };
  const v2 = { ...v1, updateFunction: async () => { updates++; if (reject) throw Error('UNCERTAIN'); return { name: OP }; } };
  const run = { setInvokerCreate() {}, setInvokerUpdate() {}, setIamPolicy() {}, updateService() {}, replaceService() {}, getIamPolicy: async () => { iamReads++; return { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] }; } };
  const poller = { pollOperation: async () => result };
  const state = guard.installGuard({ Fabricator, v1, v2, run, poller, baseline: b, beforeUpdate: before, assertUploadSource: source => assert.deepEqual(source, b.buildConfig.source.storageSource), emit: (state, data = {}) => events.push({ state, ...data }) });
  return { b, result, Fabricator, v1, v2, run, poller, events, state, counts: () => ({ updates, iamReads }) };
}
test('only exact callable update completes and observes existing IAM without mutation', async () => {
  const f = fixture(); await new f.Fabricator().applyPlan(plan()); await f.v2.updateFunction(f.b);
  await f.poller.pollOperation({ operationResourceName: OP });
  assert.deepEqual(f.counts(), { updates: 1, iamReads: 1 });
  assert.deepEqual(f.events.map(x => x.state), ['GUARD_ACTIVE', 'PLAN_UPDATE_ONLY', 'INVOKER_UNCHANGED', 'UPDATE_DISPATCHED', 'UPDATE_ACCEPTED', 'UPDATE_COMPLETED']);
  assert.equal(f.events[5].source.generation, '2');
});
test('reject create delete skip recreate other scope and noncallable plans', () => {
  for (const mutate of [p => p.region.endpointsToCreate.push({}), p => p.region.endpointsToDelete.push({}), p => p.region.endpointsToSkip.push({}), p => p.region.endpointsToUpdate.push(p.region.endpointsToUpdate[0]), p => p.region.endpointsToUpdate[0].deleteAndRecreate = true, p => p.region.endpointsToUpdate[0].endpoint.id = 'other', p => p.region.endpointsToUpdate[0].endpoint.codebase = 'other', p => p.region.endpointsToUpdate[0].endpoint.httpsTrigger = {}]) {
    const p = plan(); mutate(p); assert.throws(() => guard.assertPlan(p));
  }
});
test('configuration and env drift fail before dispatch', async () => {
  for (const mutate of [s => s.maxInstanceCount = 20, s => s.minInstanceCount = 1, s => s.availableMemory = '512Mi', s => s.maxInstanceRequestConcurrency = 80, s => s.environmentVariables.EXTRA = 'synthetic', s => s.environmentVariables.PAY0_FIREBASE_WEB_API_KEY += 'changed', s => s.environmentVariables.FUNCTION_TARGET = 'other', s => s.environmentVariables.LOG_EXECUTION_ID = 'false', s => s.secretEnvironmentVariables = [{ key: 'SECRET' }]]) {
    const f = fixture(), input = structuredClone(f.b); mutate(input.serviceConfig);
    await new f.Fabricator().applyPlan(plan()); await assert.rejects(f.v2.updateFunction(input)); assert.equal(f.counts().updates, 0);
  }
});
test('only deterministic CLI-managed omissions normalize', () => {
  const b = baseline(), input = structuredClone(b); delete input.serviceConfig.environmentVariables.FUNCTION_TARGET; delete input.serviceConfig.environmentVariables.LOG_EXECUTION_ID;
  guard.assertApi(input, b); delete input.serviceConfig.environmentVariables.GCLOUD_PROJECT; assert.throws(() => guard.assertApi(input, b));
});
test('unverified upload identity fails before GCF dispatch or IAM reads', async () => {
  const f = fixture(), input = structuredClone(f.b); input.buildConfig.source.storageSource.generation = '999';
  await new f.Fabricator().applyPlan(plan()); await assert.rejects(f.v2.updateFunction(input));
  assert.deepEqual(f.counts(), { updates: 0, iamReads: 0 });
});
test('uncertain and concurrent dispatch cannot repeat', async () => {
  const uncertain = fixture({ reject: true }); await new uncertain.Fabricator().applyPlan(plan());
  await assert.rejects(uncertain.v2.updateFunction(uncertain.b), /UNCERTAIN/); await assert.rejects(uncertain.v2.updateFunction(uncertain.b)); assert.equal(uncertain.counts().updates, 1);
  let release; const wait = new Promise(r => release = r), f = fixture({ before: () => wait });
  await new f.Fabricator().applyPlan(plan()); const first = f.v2.updateFunction(f.b); await assert.rejects(f.v2.updateFunction(f.b)); release(); await first; assert.equal(f.counts().updates, 1);
});
test('all other GCF and Run mutations denied', () => {
  const f = fixture(); for (const owner of [f.v1, f.v2]) for (const key of ['createFunction', 'deleteFunction']) assert.throws(() => owner[key]({}));
  assert.throws(() => f.v1.updateFunction({})); for (const key of ['setInvokerCreate', 'setInvokerUpdate', 'setIamPolicy', 'updateService', 'replaceService']) assert.throws(() => f.run[key]({}));
});
test('poller binds operation revision and source, not any completed request', async () => {
  const f = fixture(); await new f.Fabricator().applyPlan(plan()); await f.v2.updateFunction(f.b);
  await f.poller.pollOperation({ operationResourceName: OP + '-other' }); assert.equal(f.state.status().completed, null);
  f.result.buildConfig.source.storageSource.generation = '1'; await assert.rejects(f.poller.pollOperation({ operationResourceName: OP })); assert.equal(f.state.status().completed, null);
});
test('changed IAM binding prevents update and all IAM setters remain blocked', async () => {
  const f = fixture(); await new f.Fabricator().applyPlan(plan());
  f.run.getIamPolicy = async () => ({ bindings: [{ role: 'roles/run.invoker', members: ['allUsers'], condition: { expression: 'true' } }] });
  await assert.rejects(f.v2.updateFunction(f.b)); assert.equal(f.counts().updates, 0);
  assert.throws(() => f.run.setInvokerUpdate('pay-0-system', SERVICE, ['public']));
});

test('actual CLI planner converter and Fabricator update callable without invoking an IAM setter', async () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const cli = require('../../scripts/lib/dispersion-notes-create-only.cjs').cliInfo().root;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pay0-notes-update-fake-'));
  const oldXdg = process.env.XDG_CONFIG_HOME; process.env.XDG_CONFIG_HOME = temp;
  const transport = [], saved = []; let logger, silent;
  try {
    for (const [owner, key] of [[require('node:net').Socket.prototype, 'connect'], [require('node:http'), 'request'], [require('node:https'), 'request'], [global, 'fetch']]) {
      transport.push([owner, key, owner[key]]); owner[key] = () => { throw Error('NETWORK_FORBIDDEN'); };
    }
    const v2 = require(path.join(cli, 'lib/gcp/cloudfunctionsv2.js')), v1 = require(path.join(cli, 'lib/gcp/cloudfunctions.js'));
    const run = require(path.join(cli, 'lib/gcp/run.js')), poller = require(path.join(cli, 'lib/operation-poller.js'));
    const backend = require(path.join(cli, 'lib/deploy/functions/backend.js')), planner = require(path.join(cli, 'lib/deploy/functions/release/planner.js'));
    const Fabricator = require(path.join(cli, 'lib/deploy/functions/release/fabricator.js')).Fabricator;
    logger = require(path.join(cli, 'lib/logger.js')).logger; silent = logger.silent; logger.silent = true;
    for (const owner of [v1, v2, run, poller, Fabricator.prototype]) saved.push([owner, Object.getOwnPropertyDescriptors(owner)]);
    const b = baseline(); b.serviceConfig.service = SERVICE;
    const endpoint = v2.endpointFromFunction(b); endpoint.codebase = 'default';
    assert.ok(endpoint.callableTrigger); assert.equal(endpoint.httpsTrigger, undefined);
    const want = backend.of(structuredClone(endpoint)), have = backend.of(structuredClone(endpoint));
    const planned = planner.createDeploymentPlan({ wantBackend: want, haveBackend: have, codebase: 'default', filters: [{ codebase: 'default', idChunks: [NAME] }], deleteAll: false });
    guard.assertPlan(planned);
    const storage = { bucket: 'synthetic-upload', object: 'source.zip', generation: '123' };
    guard.assertApi(v2.functionFromEndpoint({ ...endpoint, source: { storageSource: storage } }), b);
    let updates = 0, reads = 0; const events = [], result = structuredClone(b);
    result.serviceConfig.revision = 'listclientdispersionnotes-00002-new'; result.buildConfig.source.storageSource.generation = '2';
    v2.updateFunction = async input => { guard.assertApi(input, b); updates++; return { name: OP }; };
    poller.pollOperation = async () => result;
    run.getIamPolicy = async name => { assert.equal(name, SERVICE); reads++; return { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] }; };
    guard.installGuard({ Fabricator, v1, v2, run, poller, baseline: b, beforeUpdate: async () => {}, assertUploadSource: source => assert.deepEqual(source, storage), emit: state => events.push(state) });
    const executor = { run: fn => fn() }, fab = new Fabricator({ executor, functionExecutor: executor, sources: { default: { storage } }, projectNumber: '751158244178' });
    const completed = await fab.applyPlan(planned);
    assert.equal(completed.results.length, 1); assert.ok(!completed.results[0].error, 'CLI_FAKE_UPDATE_FAILED');
    assert.equal(updates, 1); assert.equal(reads, 1); assert.ok(events.includes('UPDATE_COMPLETED')); assert.ok(!events.includes('MUTATION_BLOCKED'));
  } finally {
    for (const [owner, descriptors] of saved) Object.defineProperties(owner, descriptors);
    if (logger) logger.silent = silent;
    for (const [owner, key, value] of transport) owner[key] = value;
    if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
