import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  artifactManifest, packageSsr, validateBaseline, assertFreshBaseline,
  assertRoutePreservation, assertRuntimeSourceCompatible, assertSsrUpdatePlan,
  assertSsrApiPreserved, assertHostingConfigPreserved, rollbackPlan,
} from '../../scripts/deploy-modular-hosting.mjs';
import { digest } from '../../scripts/capture-production-baseline.mjs';
import { executeContract, rollbackContract, assertSource, pinRevisionV1 } from '../../scripts/deploy-modular-hosting-execute.mjs';
const require = createRequire(import.meta.url);
const JSZip = require('../../functions/node_modules/jszip');
const clone = value => structuredClone(value);
test('source buckets accept observed regional upload namespace and reject another project or region', () => {
  for (const bucket of ['gcf-v2-sources-751158244178-us-central1', 'gcf-v2-uploads-751158244178.us-central1.cloudfunctions.appspot.com'])
    assertSource({ bucket, object: 'source.zip', generation: '7' });
  for (const bucket of ['gcf-v2-sources-1-us-central1', 'gcf-v2-uploads-751158244178.europe-west1.cloudfunctions.appspot.com', 'gcf-v2-uploads-751158244178.us-central1.cloudfunctions.appspot.com.evil.invalid'])
    assert.throws(() => assertSource({ bucket, object: 'source.zip', generation: '7' }));
});
function baseline() {
  return { functions: { ssrpay0system: {
    resource: { name: 'projects/pay-0-system/locations/us-central1/functions/ssrpay0system', state: 'ACTIVE',
      labels: { 'firebase-functions-codebase': 'firebase-frameworks-pay-0-system' },
      buildConfig: { runtime: 'nodejs22', entryPoint: 'ssrpay0system', source: { storageSource: { bucket: 'fixture', object: 'source', generation: '1' } } },
      serviceConfig: { availableMemory: '256Mi', availableCpu: '1', maxInstanceRequestConcurrency: 80, timeoutSeconds: 60,
        maxInstanceCount: 20, ingressSettings: 'ALLOW_ALL', serviceAccountEmail: 'synthetic', revision: 'ssrpay0system-old',
        environmentVariables: { FUNCTION_TARGET: 'ssrpay0system', LOG_EXECUTION_ID: 'true', FIXTURE: 'preserved' } } },
    service: { terminalCondition: { state: 'CONDITION_SUCCEEDED' }, template: { fixed: true } },
    iam: { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] },
  } }, hosting: { releases: [{ name: 'release-old', version: { name: 'sites/pay-0-system/versions/old', status: 'FINALIZED',
    config: { headers: [{ glob: '**', headers: { 'X-Fixture': 'preserved' } }], cleanUrls: true,
      rewrites: [{ glob: '**', run: { serviceId: 'ssrpay0system', region: 'us-central1', tag: 'fh-12345678' } }] } } }] } };
}

test('baseline and concurrent drift fail closed for every protected remote surface', () => {
  const b = baseline(); validateBaseline(b); assertFreshBaseline(b, clone(b));
  for (const key of ['resource', 'service', 'iam']) {
    const changed = clone(b); changed.functions.ssrpay0system[key].unexpected = true;
    assert.throws(() => assertFreshBaseline(b, changed), /CONCURRENT_/);
  }
  const changed = clone(b); changed.hosting.releases[0].name = 'someone-else-release';
  assert.throws(() => assertFreshBaseline(b, changed), /CONCURRENT_HOSTING/);
  assert.throws(() => validateBaseline({ ...b, operations: { operations: [{ done: false }] } }), /ACTIVE_OPERATION/);
});

test('existing strict SSR guard forbids other functions, creation, deletion and runtime changes', () => {
  const endpoint = { id: 'ssrpay0system', project: 'pay-0-system', region: 'us-central1', platform: 'gcfv2', codebase: 'firebase-frameworks-pay-0-system', httpsTrigger: {} };
  const plan = { region: { endpointsToCreate: [], endpointsToDelete: [], endpointsToSkip: [], endpointsToUpdate: [{ endpoint }] } };
  assertSsrUpdatePlan(plan);
  for (const key of ['endpointsToCreate', 'endpointsToDelete', 'endpointsToSkip']) {
    const altered = clone(plan); altered.region[key].push({ endpoint });
    assert.throws(() => assertSsrUpdatePlan(altered), /UPDATE_ONLY/);
  }
  const altered = clone(plan); altered.region.endpointsToUpdate[0].endpoint.id = 'anotherFunction';
  assert.throws(() => assertSsrUpdatePlan(altered), /UPDATE_SCOPE/);
  const b = baseline(), input = clone(b.functions.ssrpay0system.resource);
  assertSsrApiPreserved(input, b);
  for (const key of ['timeoutSeconds', 'availableMemory', 'maxInstanceCount', 'serviceAccountEmail']) {
    const changed = clone(input); changed.serviceConfig[key] = 'changed'; assert.throws(() => assertSsrApiPreserved(changed, b), /API_CONFIG/);
  }
  input.serviceConfig.environmentVariables.FIXTURE = 'lost';
  assert.throws(() => assertSsrApiPreserved(input, b), /API_ENV_EXACT/);
});

test('routing preserves all headers, redirects and existing routes with only the SSR tag changing', () => {
  const original = baseline().hosting.releases[0].version.config, next = clone(original);
  next.rewrites[0].run.tag = 'fh-abcdef12'; assertHostingConfigPreserved(original, next, 'fh-abcdef12');
  next.headers = []; assert.throws(() => assertHostingConfigPreserved(original, next, 'fh-abcdef12'), /HOSTING_CONFIGURATION/);
  assertRoutePreservation({ a: '/pagos', b: '/solicitudes' }, { a: '/pagos', b: '/solicitudes', c: '/new' });
  assert.throws(() => assertRoutePreservation({ a: '/pagos' }, {}), /ROUTE_REMOVED/);
});

test('runtime package reuse requires identical dependency/configuration contracts', () => {
  const value = { package: { dependencies: { next: '15.5.27' } }, lock: 'same', config: 'same' };
  assertRuntimeSourceCompatible(value, clone(value));
  for (const key of ['lock', 'config']) { const changed = clone(value); changed[key] = 'changed'; assert.throws(() => assertRuntimeSourceCompatible(value, changed), /CHANGED/); }
  const changed = clone(value); changed.package.dependencies.next = 'different';
  assert.throws(() => assertRuntimeSourceCompatible(value, changed), /RUNTIME_SOURCE_CHANGED/);
});

test('SSR package uses new immutable assets and exact old runtime without cache or dotenv', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay0-hosting-'));
  // Cleanup is restricted to this freshly created test directory.
  try {
    fs.mkdirSync(path.join(dir, '.next/cache'), { recursive: true }); fs.mkdirSync(path.join(dir, 'public'));
    fs.writeFileSync(path.join(dir, '.next/BUILD_ID'), 'new-build');
    fs.writeFileSync(path.join(dir, '.next/cache/private-cache'), 'exclude');
    fs.writeFileSync(path.join(dir, 'public/asset.txt'), 'new-asset');
    const receipt = { cwd: dir, next: artifactManifest(path.join(dir, '.next')), public: artifactManifest(path.join(dir, 'public')) };
    const previous = new JSZip();
    for (const name of ['next.config.mjs', 'package.json', 'package-lock.json', 'server.js']) previous.file(name, `exact-${name}`);
    previous.file('.next/BUILD_ID', 'old-build'); previous.file('.env', 'MUST_NOT_COPY');
    const bytes = await previous.generateAsync({ type: 'nodebuffer' });
    const output = await JSZip.loadAsync(await packageSsr(receipt, bytes));
    assert.equal(await output.file('.next/BUILD_ID').async('string'), 'new-build');
    assert.equal(await output.file('server.js').async('string'), 'exact-server.js');
    assert.equal(output.file('.env'), null); assert.equal(output.file('.next/cache/private-cache'), null);
    const unsafe = clone(receipt); unsafe.next[0].file = '../outside';
    await assert.rejects(packageSsr(unsafe, bytes), /UNSAFE_ARTIFACT_PATH/);
    fs.writeFileSync(path.join(dir, '.next/BUILD_ID'), 'changed');
    await assert.rejects(packageSsr(receipt, bytes), /ARTIFACT_CHANGED/);
    fs.writeFileSync(path.join(dir, 'public/.env'), 'never');
    assert.throws(() => artifactManifest(path.join(dir, 'public')), /PRIVATE_FILE/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rollback plan is bound to the exact new release and requires restoring both surfaces', () => {
  const before = baseline(), after = clone(before); after.functions.ssrpay0system.resource.serviceConfig.revision = 'ssrpay0system-new';
  const plan = rollbackPlan(before, after); assert.equal(plan.restoreHostingAndSsrTogether, true); assert.equal(plan.executionImplemented, true);
  assert.match(plan.expectedCurrentSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => rollbackPlan(before, before), /ROLLBACK_RELEASE_REQUIRED/);
});

function deploymentFixture() {
  const before = baseline(), serviceName = 'projects/pay-0-system/locations/us-central1/services/ssrpay0system';
  before.functions.ssrpay0system.resource.buildConfig.source.storageSource = { bucket: 'gcf-v2-sources-751158244178-us-central1', object: 'ssrpay0system/function-source.zip', generation: '1' };
  const svc = before.functions.ssrpay0system.service;
  Object.assign(svc, { name: serviceName, etag: 'fixture-etag', latestReadyRevision: `${serviceName}/revisions/ssrpay0system-old`, latestCreatedRevision: `${serviceName}/revisions/ssrpay0system-old`,
    traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }, { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'ssrpay0system-old', tag: 'fh-12345678', percent: 0 }],
    trafficStatuses: [{ revision: 'ssrpay0system-old', percent: 100 }, { revision: 'ssrpay0system-old', tag: 'fh-12345678', percent: 0 }],
    template: { containers: [{ resources: { cpu: '1' }, env: [{ name: 'FIXTURE', value: 'preserved' }] }] } });
  let state = clone(before), stagedConfig, serial = 0;
  const calls = [], input = { sourceCommit: 'a'.repeat(40), archiveSha256: 'b'.repeat(64), previousSha256: 'c'.repeat(64), hostingFiles: [] };
  const proof = { schema: 'PAY0-MODULAR-HOSTING-RUNTIME@1', status: 'PASS', sourceCommit: input.sourceCommit, archiveSha256: input.archiveSha256,
    verifierSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.resolve('qa/scripts/verify-modular-hosting-runtime.mjs'))).digest('hex'),
    runtimeRealpathsPassed: true,
    runtimeRealpathsSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.resolve('qa/scripts/verify-runtime-realpaths.cjs'))).digest('hex'),
    dependencyClosureVerifierSha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.resolve('qa/scripts/verify-runtime-dependency-closure.cjs'))).digest('hex'),
    hostingManifestSha256: digest(input.hostingFiles), runtimeHttpPassed: true, criticalBrowserPassed: true };
  const api = {
    async read() { return clone(state); },
    async sourceHash(resource) { return resource.buildConfig.source.storageSource.generation === '1' ? input.previousSha256 : input.archiveSha256; },
    async createVersion() { calls.push('create'); return 'sites/pay-0-system/versions/abcdef12'; },
    async uploadHosting() { calls.push('files'); },
    async uploadSource() { calls.push('upload'); return { bucket: 'gcf-v2-uploads-751158244178.us-central1.cloudfunctions.appspot.com', object: 'uploaded.zip', generation: '2' }; },
    async updateSsr(source, labels) {
      calls.push('ssr'); const row = state.functions.ssrpay0system, revision = `ssrpay0system-new${++serial}`;
      row.resource.buildConfig.source.storageSource = clone(source); row.resource.labels = clone(labels); row.resource.serviceConfig.revision = revision;
      row.service.latestReadyRevision = `${serviceName}/revisions/${revision}`; row.service.latestCreatedRevision = row.service.latestReadyRevision;
      row.service.trafficStatuses[0].revision = revision;
    },
    async pinRevision(current, tag) {
      calls.push('tag'); const revision = current.functions.ssrpay0system.resource.serviceConfig.revision;
      state.functions.ssrpay0system.service.traffic.push({ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision, tag, percent: 0 });
      state.functions.ssrpay0system.service.trafficStatuses.push({ revision, tag, percent: 0 });
    },
    async finalizeVersion(version, config) { calls.push('finalize'); stagedConfig = clone(config); },
    async release(version) { calls.push('release'); state.hosting.releases = [{ name: `release-${version}`, version: { name: version, status: 'FINALIZED', config: version === before.hosting.releases[0].version.name ? clone(before.hosting.releases[0].version.config) : stagedConfig } }]; },
  };
  return { before, input, proof, api, calls, get state() { return state; } };
}

test('injected release and rollback preserve runtime and restore previous Hosting and source', async () => {
  const f = deploymentFixture(), checkpoints = [];
  const result = await executeContract({ input: f.input, baseline: f.before, proof: f.proof, api: f.api, checkpoint: async state => checkpoints.push(state) });
  assert.equal(result.status, 'RELEASE_VERIFIED');
  assert.deepEqual(f.calls, ['create', 'files', 'upload', 'ssr', 'tag', 'finalize', 'release']);
  assert.ok(checkpoints.indexOf('SSR_VERIFIED') < checkpoints.indexOf('RELEASE_DISPATCHING'));
  const restored = await rollbackContract({ input: f.input, baseline: f.before, expected: clone(f.state), api: f.api });
  assert.equal(restored.status, 'ROLLBACK_VERIFIED');
  assert.equal(f.state.hosting.releases[0].version.name, f.before.hosting.releases[0].version.name);
  assert.equal(f.state.functions.ssrpay0system.resource.buildConfig.source.storageSource.generation, '1');
});

test('no release on wrong runtime evidence, source bytes, prior traffic mutation or concurrent drift', async () => {
  let f = deploymentFixture(); f.proof.verifierSha256 = 'wrong';
  await assert.rejects(executeContract({ input: f.input, baseline: f.before, proof: f.proof, api: f.api }), /RUNTIME_VERIFIER_CHANGED/);
  assert.deepEqual(f.calls, []);
  f = deploymentFixture(); f.proof.archiveSha256 = 'wrong';
  await assert.rejects(executeContract({ input: f.input, baseline: f.before, proof: f.proof, api: f.api }), /RUNTIME_PROOF_ARCHIVE/);
  assert.deepEqual(f.calls, []);
  f = deploymentFixture(); const sourceHash = f.api.sourceHash;
  f.api.sourceHash = resource => resource.buildConfig.source.storageSource.generation === '1' ? sourceHash(resource) : 'wrong';
  await assert.rejects(executeContract({ input: f.input, baseline: f.before, proof: f.proof, api: f.api }), /DEPLOYED_SOURCE_CHANGED/);
  assert.ok(!f.calls.includes('release'));
  f = deploymentFixture(); const pin = f.api.pinRevision;
  f.api.pinRevision = async (...args) => { await pin(...args); f.state.functions.ssrpay0system.service.traffic[1].tag = 'changed'; };
  await assert.rejects(executeContract({ input: f.input, baseline: f.before, proof: f.proof, api: f.api }), /PRIOR_TRAFFIC_CHANGED/);
  assert.ok(!f.calls.includes('release'));
  f = deploymentFixture(); const finalize = f.api.finalizeVersion;
  f.api.finalizeVersion = async (...args) => { await finalize(...args); f.state.functions.ssrpay0system.service.concurrent = true; };
  await assert.rejects(executeContract({ input: f.input, baseline: f.before, proof: f.proof, api: f.api }), /CONCURRENT_SERVICE_CHANGE/);
  assert.ok(!f.calls.includes('release'));
});

test('runtime proofs require successful realpath inspection and current helper hashes', async () => {
  for (const [field, value, reason] of [
    ['runtimeRealpathsPassed', false, /RUNTIME_REALPATHS_REQUIRED/],
    ['runtimeRealpathsSha256', 'stale', /RUNTIME_REALPATHS_HELPER_CHANGED/],
    ['dependencyClosureVerifierSha256', 'stale', /DEPENDENCY_CLOSURE_HELPER_CHANGED/],
  ]) {
    const f = deploymentFixture(); f.proof[field] = value;
    await assert.rejects(executeContract({ input: f.input, baseline: f.before, proof: f.proof, api: f.api }), reason);
    assert.deepEqual(f.calls, []);
  }
});

test('rollback rejects a release changed by another operator before any mutation', async () => {
  const f = deploymentFixture();
  await executeContract({ input: f.input, baseline: f.before, proof: f.proof, api: f.api });
  const expected = clone(f.state), count = f.calls.length;
  f.state.hosting.releases[0].name = 'another-operator';
  await assert.rejects(rollbackContract({ input: f.input, baseline: f.before, expected, api: f.api }), /CONCURRENT_HOSTING_CHANGE/);
  assert.equal(f.calls.length, count);
});


function tagV1Fixture(mode = '', resourceVersion = 'opaque-123') {
  const f = deploymentFixture(), state = clone(f.state), calls = [];
  const revision = state.functions.ssrpay0system.resource.serviceConfig.revision;
  let v1 = { apiVersion: 'serving.knative.dev/v1', kind: 'Service',
    metadata: { name: 'ssrpay0system', namespace: '751158244178', resourceVersion, labels: { preserved: 'yes' }, annotations: { 'serving.knative.dev/lastModifier': 'old@example.test' } },
    spec: { template: { spec: { containers: [{ image: 'same-image' }] } }, traffic: [{ latestRevision: true, percent: 100 }] },
    status: { latestReadyRevisionName: revision, latestCreatedRevisionName: revision } };
  const initial = clone(v1);
  return { calls, initial, args: { state, tag: 'fh-abcdef12', read: f.api.read,
    readV1: async () => clone(v1), delay: async () => {},
    put: async (body, dryRun) => {
      calls.push(dryRun ? 'dry-run' : 'put');
      assert.equal(body.metadata.resourceVersion, initial.metadata.resourceVersion);
      const result = clone(body);
      result.metadata.annotations['serving.knative.dev/lastModifier'] = 'operator@example.test';
      if (dryRun) {
        if (mode === 'dry-identity') result.metadata.name = 'other-service';
        if (mode === 'dry-spec') result.spec.template.spec.containers[0].image = 'other';
        if (mode === 'dry-metadata') result.metadata.annotations['run.googleapis.com/ingress'] = 'all';
        if (mode === 'concurrent') v1.metadata.resourceVersion = 'changed';
        if (mode === 'iam-before') f.state.functions.ssrpay0system.iam = { changed: true };
        return result;
      }
      if (mode === 'conflict') throw Error('HTTP_409');
      v1 = result;
      await f.api.pinRevision(state, 'fh-abcdef12');
      if (mode === 'runtime') v1.spec.template.spec.containers[0].image = 'changed';
      if (mode === 'metadata') v1.metadata.annotations.extra = 'changed';
      if (mode === 'modifier') v1.metadata.annotations['serving.knative.dev/lastModifier'] = 'unexpected@example.test';
      if (mode === 'iam-after') f.state.functions.ssrpay0system.iam = { changed: true };
      if (mode === 'traffic') f.state.functions.ssrpay0system.service.traffic[0].percent = 99;
      if (mode === 'pending') f.state.functions.ssrpay0system.service.terminalCondition.state = 'CONDITION_PENDING';
      return result;
    } } };
}
test('primary Hosting tags through V1 dry-run and resourceVersion without changing old traffic', async () => {
  const f = tagV1Fixture();
  await pinRevisionV1(f.args);
  assert.deepEqual(f.calls, ['dry-run', 'put']);
});
test('primary Hosting preserves opaque slash and base64 versions in dry-run and PUT', async () => {
  const f = tagV1Fixture('', 'synthetic/version+token==');
  await pinRevisionV1(f.args);
  assert.deepEqual(f.calls, ['dry-run', 'put']);
});

test('V1 tag rejects dry-run drift, concurrent changes and server CAS conflict', async () => {
  for (const mode of ['dry-identity', 'dry-spec', 'dry-metadata', 'concurrent', 'iam-before', 'conflict']) {
    const f = tagV1Fixture(mode);
    await assert.rejects(pinRevisionV1(f.args));
    assert.deepEqual(f.calls, mode === 'conflict' ? ['dry-run', 'put'] : ['dry-run']);
  }
});
test('V1 tag refuses unexpected runtime, metadata, IAM, traffic and incomplete reconciliation', async () => {
  for (const mode of ['runtime', 'metadata', 'modifier', 'iam-after', 'traffic', 'pending']) {
    const f = tagV1Fixture(mode);
    await assert.rejects(pinRevisionV1(f.args));
  }
});
