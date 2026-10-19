import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertOwnership, tagRequest, assertVersionFiles, resumeContract, ownedFile, assertV1Metadata } from '../../scripts/resume-modular-hosting.mjs';
import { digest } from '../../scripts/capture-production-baseline.mjs';
import { sha } from '../../scripts/deploy-modular-hosting.mjs';
import { tagRequest as originalTagRequest } from '../../scripts/deploy-modular-hosting-execute.mjs';

const clone = value => structuredClone(value);
const version = 'sites/pay-0-system/versions/abcdef12';
function v1() { return { apiVersion: 'serving.knative.dev/v1', kind: 'Service', metadata: { name: 'ssrpay0system', namespace: '751158244178', resourceVersion: '123', annotations: { preserved: 'yes' } }, spec: { template: { metadata: { name: 'ssrpay0system-new' }, spec: { containers: [{ image: 'same', env: [{ name: 'FIXTURE', value: 'same' }] }] } }, traffic: [{ latestRevision: true, percent: 100 }] }, status: { latestReadyRevisionName: 'ssrpay0system-new', latestCreatedRevisionName: 'ssrpay0system-new' } }; }
test('V1 request preserves complete metadata and spec, only removes status and adds zero-allocation tag', () => {
  const before = v1(), body = tagRequest(before, 'ssrpay0system-new', 'fh-abcdef12');
  const expected = clone(before); delete expected.status; expected.spec.traffic.push({ revisionName: 'ssrpay0system-new', tag: 'fh-abcdef12' });
  assert.deepEqual(body, expected); assert.deepEqual(before, v1());
  for (const mutate of [s => s.metadata.name = 'another', s => s.metadata.namespace = 'other', s => delete s.metadata.resourceVersion, s => s.status.latestReadyRevisionName = 'other']) {
    const changed = v1(); mutate(changed); assert.throws(() => tagRequest(changed, 'ssrpay0system-new', 'fh-abcdef12'));
  }
});
test('opaque resource versions preserve exact bytes, identity and the original request contract', () => {
  const before = v1();
  assert.deepEqual(tagRequest(before, 'ssrpay0system-new', 'fh-abcdef12'), originalTagRequest(before, 'ssrpay0system-new', 'fh-abcdef12'));
  for (const token of ['synthetic/version+token==', ' leading and trailing ', 'x'.repeat(1024)]) {
    const source = v1(); source.metadata.resourceVersion = token;
    source.metadata.uid = 'synthetic-uid'; source.metadata.labels = { fixture: 'preserved' };
    const original = clone(source), body = tagRequest(source, 'ssrpay0system-new', 'fh-abcdef12');
    assert.equal(body.metadata.resourceVersion, token);
    assert.deepEqual(body.metadata, source.metadata);
    assert.deepEqual(body.spec.template, source.spec.template);
    assert.deepEqual(source, original);
    const expected = clone(source); delete expected.status;
    expected.spec.traffic.push({ revisionName: 'ssrpay0system-new', tag: 'fh-abcdef12' });
    assert.deepEqual(body, expected);
  }
});
test('opaque resource versions reject empty, non-string, oversized and control-character tokens', () => {
  for (const token of ['', undefined, null, 123, {}, 'x'.repeat(1025), 'a\u0000b', 'a\nb', 'a\rb', 'a\tb', 'a\u007fb', 'a\u0085b']) {
    const before = v1(); before.metadata.resourceVersion = token;
    assert.throws(() => tagRequest(before, 'ssrpay0system-new', 'fh-abcdef12'), /V1_RESOURCE_VERSION/);
  }
});
test('opaque resource versions retain all service, readiness and tag restrictions', () => {
  for (const mutate of [s => s.apiVersion = 'other', s => s.kind = 'other', s => s.metadata.name = 'other', s => s.metadata.namespace = 'other', s => s.status.latestReadyRevisionName = 'other', s => s.status.latestCreatedRevisionName = 'other', s => s.spec.traffic.push({ tag: 'fh-abcdef12' })]) {
    const before = v1(); before.metadata.resourceVersion = 'synthetic/version+token=='; mutate(before);
    assert.throws(() => tagRequest(before, 'ssrpay0system-new', 'fh-abcdef12'));
  }
  const before = v1(); before.metadata.resourceVersion = 'synthetic/version+token==';
  assert.throws(() => tagRequest(before, 'ssrpay0system-new', 'invalid-tag'));
});
test('ownership requires matching original lock, verified checkpoint and unadvanced journal', () => {
  const args = { own: { state: 'SSR_VERIFIED', version, inputSha256: 'a' }, lock: { state: 'SSR_VERIFIED', mode: 'execute', version, inputSha256: 'a', inputFile: 'fixture' }, journal: [{ state: 'VERSION_CREATED' }, { state: 'SSR_VERIFIED' }, { state: 'MUTATION_DISPATCHING' }], inputFile: 'fixture', inputSha256: 'a' };
  assertOwnership(args);
  for (const mutate of [a => a.lock.inputSha256 = 'other', a => a.own.version = 'other', a => a.lock.state = 'RELEASE_DISPATCHING', a => a.journal.push({ state: 'SSR_TAG_VERIFIED' })]) { const changed = clone(args); mutate(changed); assert.throws(() => assertOwnership(changed)); }
});
test('only observed V1 bookkeeping changes are allowed, with exact expected modifier', () => {
  const before = v1(), after = clone(before);
  after.metadata.annotations['serving.knative.dev/lastModifier'] = 'synthetic@example.invalid';
  after.metadata.annotations['run.googleapis.com/operation-id'] = '12345678-abcd-abcd-abcd-123456789abc';
  assertV1Metadata(before, after, 'synthetic@example.invalid');
  assert.throws(() => assertV1Metadata(before, after, 'other@example.invalid'), /V1_MODIFIER_CHANGED/);
  after.metadata.annotations.preserved = 'changed'; assert.throws(() => assertV1Metadata(before, after, 'synthetic@example.invalid'), /V1_ANNOTATIONS_CHANGED/);
  after.metadata.annotations.preserved = 'yes'; after.metadata.annotations['run.googleapis.com/operation-id'] = 'arbitrary';
  assert.throws(() => assertV1Metadata(before, after, 'synthetic@example.invalid'), /V1_OPERATION_ID/);
});
test('version inventory rejects missing, extra, duplicate, inactive or changed file', () => {
  const expected = [{ path: '/app.js', hash: 'a' }, { path: '/__/firebase/init.js', hash: 'b' }];
  const files = expected.map(f => ({ ...f, status: 'ACTIVE' })); assertVersionFiles(files, expected);
  for (const changed of [files.slice(1), [...files, files[0]], [files[0], files[0]], files.map(f => ({ ...f, status: 'EXPECTED' })), files.map(f => ({ ...f, hash: 'other' }))]) assert.throws(() => assertVersionFiles(changed, expected));
});
test('replaced lock cannot be overwritten or removed; own writes advance the expected digest', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pay0-resume-lock-'));
  try {
    const file = path.join(directory, 'lock'); fs.writeFileSync(file, 'original');
    const lock = ownedFile(file); lock.write('own-next'); lock.verify();
    fs.writeFileSync(file, 'foreign');
    assert.throws(() => lock.write('overwrite'), /OWNED_FILE_REPLACED/);
    assert.throws(() => lock.remove(), /OWNED_FILE_REPLACED/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'foreign');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

function fixture() {
  const before = { functions: { ssrpay0system: {
    resource: { name: 'projects/pay-0-system/locations/us-central1/functions/ssrpay0system', state: 'ACTIVE', labels: { 'firebase-functions-codebase': 'firebase-frameworks-pay-0-system' }, buildConfig: { runtime: 'nodejs22', entryPoint: 'ssrpay0system', source: { storageSource: { bucket: 'fixture', object: 'fixture', generation: '1' } } }, serviceConfig: { availableMemory: '256Mi', availableCpu: '1', maxInstanceRequestConcurrency: 80, timeoutSeconds: 60, maxInstanceCount: 20, ingressSettings: 'ALLOW_ALL', serviceAccountEmail: 'synthetic', revision: 'ssrpay0system-old', environmentVariables: { FUNCTION_TARGET: 'ssrpay0system', LOG_EXECUTION_ID: 'true' } } },
    service: { terminalCondition: { state: 'CONDITION_SUCCEEDED' }, template: { fixed: true }, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }], trafficStatuses: [{ revision: 'ssrpay0system-old', percent: 100 }] }, iam: { bindings: [] },
  } }, hosting: { releases: [{ version: { name: 'sites/pay-0-system/versions/12345678', status: 'FINALIZED', config: { rewrites: [{ glob: '**', run: { serviceId: 'ssrpay0system', region: 'us-central1', tag: 'fh-12345678' } }] } } }] } };
  const input = { sourceCommit: 'a'.repeat(40), archiveSha256: 'b'.repeat(64), hostingFiles: [] };
  Object.assign(before.functions.ssrpay0system.service, { name: 'projects/pay-0-system/locations/us-central1/services/ssrpay0system', template: { containers: [] } });
  let state = clone(before), serviceV1 = v1();
  const row = state.functions.ssrpay0system;
  row.resource.buildConfig.source.storageSource.generation = '2';
  row.resource.labels = { ...row.resource.labels, 'pay0-source-commit': input.sourceCommit, 'firebase-functions-hash': input.archiveSha256.slice(0, 40) };
  row.resource.serviceConfig.revision = 'ssrpay0system-new'; row.service.trafficStatuses[0].revision = 'ssrpay0system-new';
  row.service.latestReadyRevision = row.service.name + '/revisions/ssrpay0system-new'; row.service.latestCreatedRevision = row.service.latestReadyRevision;
  const own = { state: 'SSR_VERIFIED', version, snapshot: clone(state) }, calls = [];
  const proof = { schema: 'PAY0-MODULAR-HOSTING-RUNTIME@1', status: 'PASS', sourceCommit: input.sourceCommit, archiveSha256: input.archiveSha256, hostingManifestSha256: digest(input.hostingFiles), runtimeHttpPassed: true, criticalBrowserPassed: true, verifierSha256: sha(fs.readFileSync('qa/scripts/verify-modular-hosting-runtime.mjs')) };
  Object.assign(proof, { runtimeRealpathsPassed: true, runtimeRealpathsSha256: sha(fs.readFileSync('qa/scripts/verify-runtime-realpaths.cjs')), dependencyClosureVerifierSha256: sha(fs.readFileSync('qa/scripts/verify-runtime-dependency-closure.cjs')) });
  let finalConfig;
  const api = {
    async read() { return clone(state); }, async sourceHash() { return input.archiveSha256; }, async assertOwnedVersion() { calls.push('owned'); }, async readV1() { return clone(serviceV1); },
    async putTag(body) { calls.push('tag'); serviceV1.spec = clone(body.spec); state.functions.ssrpay0system.service.traffic.push({ revision: 'ssrpay0system-new', tag: 'fh-abcdef12' }); state.functions.ssrpay0system.service.trafficStatuses.push({ revision: 'ssrpay0system-new', tag: 'fh-abcdef12' }); },
    async waitTag() { return clone(state); }, async finalize(name, config) { calls.push('finalize'); finalConfig = config; }, async assertFinalized() {},
    async release() { calls.push('release'); state.hosting.releases[0].version = { name: version, status: 'FINALIZED', config: finalConfig }; },
  };
  return { input, baseline: before, proof, own, api, calls, state };
}
test('resume publishes only after verified tag and exact file/config checks', async () => {
  const f = fixture(), checkpoints = [];
  assert.equal((await resumeContract({ ...f, checkpoint: async s => checkpoints.push(s) })).status, 'RELEASE_VERIFIED');
  assert.deepEqual(f.calls, ['owned', 'tag', 'owned', 'finalize', 'release']);
  assert.equal(checkpoints.at(-1), 'RELEASE_VERIFIED');
});

test('resume preserves opaque concurrency token through expected-V1 check and PUT', async () => {
  const f = fixture(), readV1 = f.api.readV1, putTag = f.api.putTag;
  const token = 'synthetic/version+token=='; let sent;
  f.api.readV1 = async () => {
    const value = await readV1(); value.metadata.resourceVersion = token; return value;
  };
  f.api.putTag = async body => { sent = clone(body); await putTag(body); };
  const expectedV1 = await f.api.readV1();
  assert.equal((await resumeContract({ ...f, expectedV1 })).status, 'RELEASE_VERIFIED');
  assert.equal(sent.metadata.resourceVersion, token);
  assert.deepEqual(sent.metadata, expectedV1.metadata);
  assert.deepEqual(f.calls, ['owned', 'tag', 'owned', 'finalize', 'release']);
});

test('resume rejects stale dependency and realpath helper proofs before publication', async () => {
  for (const field of ['runtimeRealpathsSha256', 'dependencyClosureVerifierSha256']) {
    const f = fixture(); f.proof[field] = 'stale';
    await assert.rejects(resumeContract({ input: f.input, baseline: f.baseline, proof: f.proof, own: f.own, api: f.api }), /HELPER_CHANGED/);
    assert.deepEqual(f.calls, []);
  }
});
test('drift, wrong proof, inventory failure and tag failure cannot publish or overwrite SSR', async () => {
  for (const mode of ['drift', 'proof', 'files', 'tag', 'spec', 'source', 'traffic', 'metadata', 'config']) {
    const f = fixture();
    if (mode === 'drift') f.state.functions.ssrpay0system.iam = { changed: true };
    if (mode === 'proof') f.proof.archiveSha256 = 'wrong';
    if (mode === 'files') f.api.assertOwnedVersion = async () => { throw Error('files'); };
    if (mode === 'tag') f.api.putTag = async () => { throw Error('tag'); };
    if (mode === 'source') f.api.sourceHash = async () => 'wrong';
    if (mode === 'config') f.state.hosting.releases[0].version.config.headers = [];
    if (mode === 'traffic') { const put = f.api.putTag; f.api.putTag = async body => { await put(body); f.state.functions.ssrpay0system.service.traffic[0].percent = 90; }; }
    if (mode === 'spec') { const read = f.api.readV1; let n = 0; f.api.readV1 = async () => { const value = await read(); if (++n === 3) value.spec.template.spec.containers[0].image = 'changed'; return value; }; }
    if (mode === 'metadata') { const read = f.api.readV1; let n = 0; f.api.readV1 = async () => { const value = await read(); if (++n === 3) value.metadata.annotations = {}; return value; }; }
    await assert.rejects(resumeContract(f)); assert.ok(!f.calls.includes('release')); assert.ok(!f.calls.includes('finalize'));
  }
});
