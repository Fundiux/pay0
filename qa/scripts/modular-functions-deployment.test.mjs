import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { NAMES, createPlan, validatePlan, executePlan, verifyRuntimeArchive, assertSource, pinUploadedSource } from '../../scripts/deploy-modular-functions.mjs';

const artifact = { sourceCommit: 'a'.repeat(40), archiveSha256: 'b'.repeat(64), archive: 'private-fixture.zip' };
const baseline = { project: 'pay-0-system', activeOperations: 0, serviceAccountEmail: '123@developer.gserviceaccount.com',
  functions: Object.fromEntries(NAMES.map(name => [name, { resource: null, service: null }])) };
const proof = { names: [...NAMES], archiveSha256: artifact.archiveSha256, result: 'ALL_UNAUTHENTICATED_WITHOUT_NETWORK' };
const plan = () => createPlan(structuredClone(artifact), structuredClone(baseline), structuredClone(proof));
function adapter(p) {
  const calls = [], policies = new Map();
  let created;
  return { calls, verifyArtifact: async () => calls.push('artifact'), assertIdle: async () => calls.push('idle'),
    assertAbsent: async name => calls.push(`absent:${name}`),
    upload: async () => ({ bucket: 'gcf-v2-uploads-751158244178.us-central1.cloudfunctions.appspot.com', object: 'uuid.zip', generation: '1780000000000000' }),
    record: async event => calls.push(event.state),
    create: async (url, body) => { calls.push(`create:${body.buildConfig.entryPoint}`); created = { ...structuredClone(body), state: 'ACTIVE',
      serviceConfig: { ...body.serviceConfig, service: p.requests.find(row => row.url === url).publicInvoker.service } };
      return { name: 'projects/pay-0-system/locations/us-central1/operations/test-operation' }; },
    wait: async () => calls.push('wait'), get: async () => structuredClone(created),
    getService: async name => ({ name, etag: 'service-etag', template: { revision: 'fixture' } }),
    verifyDeployedArchive: async () => calls.push('verified-archive'),
    getIam: async service => policies.get(service) || { etag: 'etag-fixture' },
    setIam: async (service, policy) => { calls.push('set-iam'); policies.set(service, policy); },
    assertAnonymousDenied: async name => calls.push(`denied:${name}`),
  };
}
test('exact six CREATE_ONLY requests: no update, foreign scope, secrets or environment inheritance', () => {
  const p = plan(); validatePlan(p);
  assert.equal(p.requests.length, 6);
  for (const row of p.requests) {
    assert.equal(row.method, 'POST'); assert.ok(row.url.includes('/functions?functionId='));
    assert.equal(row.body.serviceConfig.environmentVariables, undefined);
    assert.equal(row.body.serviceConfig.secretEnvironmentVariables, undefined);
    assert.equal(row.body.buildConfig.runtime, 'nodejs22');
    assert.equal(row.body.labels['firebase-functions-hash'], artifact.archiveSha256.slice(0, 40));
  }
});
test('real dotted upload bucket stays project/region scoped and pins the PUT generation header', () => {
  const source = { bucket: 'gcf-v2-uploads-751158244178.us-central1.cloudfunctions.appspot.com', object: 'uuid.zip' };
  assertSource(source);
  assert.deepEqual(pinUploadedSource(source, '1780000000000000'), { ...source, generation: '1780000000000000' });
  assert.deepEqual(pinUploadedSource({ ...source, generation: '0' }, '1780000000000000'), { ...source, generation: '1780000000000000' });
  assertSource({ ...source, bucket: 'gcf-v2-sources-751158244178-us-central1' });
  for (const bucket of [source.bucket.replace('751158244178', '999999999999'), source.bucket.replace('us-central1', 'europe-west1'),
    `${source.bucket}.evil.invalid`, 'gcf-v2-sources-999999999999-us-central1']) assert.throws(() => assertSource({ ...source, bucket }), /SOURCE_INVALID/);
  for (const generation of [null, undefined, '', '0', '-1', '1.1', 'abc']) assert.throws(() => pinUploadedSource(source, generation), /UPLOAD_GENERATION_REQUIRED/);
  assert.throws(() => pinUploadedSource({ ...source, generation: '123' }, '456'), /UPLOAD_GENERATION_MISMATCH/);
});
for (const field of ['resource', 'service']) test(`existing ${field} never becomes an update`, () => {
  const copy = structuredClone(baseline); copy.functions[NAMES[0]][field] = { name: 'existing' };
  assert.throws(() => createPlan(artifact, copy, proof), /CREATE_ONLY_ALREADY_EXISTS/);
});
test('missing baseline entry, active operations and unbound auth evidence reject', () => {
  const copy = structuredClone(baseline); delete copy.functions[NAMES[1]];
  assert.throws(() => createPlan(artifact, copy, proof), /BASELINE_INCOMPLETE/);
  assert.throws(() => createPlan(artifact, { ...baseline, activeOperations: 1 }, proof), /ACTIVE_OPERATION/);
  assert.throws(() => createPlan(artifact, baseline, { ...proof, archiveSha256: 'c'.repeat(64) }), /AUTH_PROOF_ARTIFACT/);
});
test('plan rejects extra endpoint and changed IAM/configuration', () => {
  for (const mutate of [p => p.requests.push(p.requests[0]), p => p.requests[0].body.serviceConfig.availableCpu = '4',
    p => p.requests[0].publicInvoker.role = 'roles/owner', p => p.requests[0].url = 'https://evil.invalid']) {
    const p = plan(); mutate(p); assert.throws(() => validatePlan(p), /PLAN_CHANGED/);
  }
});
test('full state machine creates six, records intent first, rechecks absence and verifies anonymous denial', async () => {
  const p = plan(), io = adapter(p);
  assert.deepEqual(await executePlan(p, io), NAMES);
  assert.equal(io.calls.filter(row => row.startsWith('absent:')).length, 12);
  assert.equal(io.calls.filter(row => row === 'set-iam').length, 6);
  for (const name of NAMES) {
    const index = io.calls.indexOf(`create:${name}`);
    assert.equal(io.calls[index - 1], 'CREATE_INTENT');
    assert.ok(io.calls.indexOf(`denied:${name}`) > index);
  }
});
test('fresh existence race stops before first create', async () => {
  const p = plan(), io = adapter(p); let reads = 0;
  io.assertAbsent = async () => { if (++reads === 7) throw Error('CREATE_ONLY_ALREADY_EXISTS'); };
  await assert.rejects(executePlan(p, io), /ALREADY_EXISTS/);
  assert.equal(io.calls.some(row => row.startsWith('create:')), false);
});
test('unknown create outcome stops, preserving intent and never opens IAM', async () => {
  const p = plan(), io = adapter(p); io.create = async () => { throw Error('TIMEOUT'); };
  await assert.rejects(executePlan(p, io), /TIMEOUT/);
  assert.ok(io.calls.includes('CREATE_INTENT')); assert.ok(!io.calls.includes('set-iam'));
});
test('foreign operation, bad source artifact and preexisting IAM all block public access', async () => {
  for (const variant of ['operation', 'archive', 'iam']) {
    const p = plan(), io = adapter(p);
    if (variant === 'operation') io.create = async () => ({ name: 'projects/foreign/locations/us-central1/operations/op' });
    if (variant === 'archive') io.verifyDeployedArchive = async () => { throw Error('DEPLOYED_SOURCE_MISMATCH'); };
    if (variant === 'iam') io.getIam = async () => ({ etag: 'etag', bindings: [{ role: 'roles/run.invoker', members: ['user:other@example.invalid'] }] });
    await assert.rejects(executePlan(p, io)); assert.ok(!io.calls.includes('set-iam'));
  }
});
test('anonymous probe failure halts before creating the next endpoint', async () => {
  const p = plan(), io = adapter(p); io.assertAnonymousDenied = async () => { throw Error('ANONYMOUS_NOT_DENIED'); };
  await assert.rejects(executePlan(p, io), /ANONYMOUS_NOT_DENIED/);
  assert.equal(io.calls.filter(row => row.startsWith('create:')).length, 1);
  assert.ok(io.calls.includes('PUBLIC_REVOKED'));
});
test('failed anonymous probe never overwrites concurrent IAM additions', async () => {
  const p = plan(), io = adapter(p), previous = io.getIam;
  io.assertAnonymousDenied = async () => {
    io.getIam = async service => ({ ...await previous(service), bindings: [{ role: 'roles/viewer', members: ['user:concurrent@example.invalid'] }] });
    throw Error('ANONYMOUS_NOT_DENIED');
  };
  await assert.rejects(executePlan(p, io), /IAM_RECOVERY_CONCURRENT_CHANGE/);
  assert.equal(io.calls.filter(row => row === 'set-iam').length, 1);
});
test('changed function after private creation blocks IAM opening', async () => {
  const p = plan(), io = adapter(p), original = io.get; let reads = 0;
  io.get = async () => { const value = await original(); if (++reads === 2) value.labels.changed = 'true'; return value; };
  await assert.rejects(executePlan(p, io), /CONCURRENT_CREATED_CHANGE/); assert.ok(!io.calls.includes('set-iam'));
});
test('direct Cloud Run drift before IAM opening is rejected', async () => {
  const p = plan(), io = adapter(p), original = io.getService; let reads = 0;
  io.getService = async name => { const service = await original(name); if (++reads === 2) service.template.revision = 'foreign'; return service; };
  await assert.rejects(executePlan(p, io), /CONCURRENT_RUN_CHANGE/);
  assert.ok(!io.calls.includes('set-iam'));
});

test('runtime probe loads exact extracted ZIP and rejects a dependency omitted from it', async () => {
  const require = createRequire(import.meta.url);
  const JSZip = require('../../functions/node_modules/jszip');
  const parent = path.resolve('.firebase/modular-release');
  fs.mkdirSync(parent, { recursive: true });
  const group = path.join(parent, `modular-test-${crypto.randomUUID()}`);
  fs.mkdirSync(group);
  const zip = new JSZip();
  zip.file('package.json', JSON.stringify({ name: 'synthetic-only', version: '1.0.0', main: 'lib/index.js' }));
  zip.file('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {} }));
  zip.file('lib/index.js', `require('./required.js');for(const name of ${JSON.stringify(NAMES)}) exports[name]={run:async()=>{const error=new Error('auth');error.code='unauthenticated';throw error;}};`);
  // Presence in a neighbouring source snapshot must not repair an incomplete ZIP.
  fs.mkdirSync(path.join(group, 'source/lib'), { recursive: true });
  fs.writeFileSync(path.join(group, 'source/lib/required.js'), 'module.exports=true');
  const noDependencies = async () => {}; // Synthetic fixture imports only a bundled local file.
  try {
    await assert.rejects(verifyRuntimeArchive(await zip.generateAsync({ type: 'nodebuffer' }), path.join(group, 'missing'), noDependencies), /ARTIFACT_AUTH_FAILED/);
    zip.file('lib/required.js', 'module.exports=true');
    zip.file('.debug/compiled/index.js', '// Bundled linked-source-map reference');
    await verifyRuntimeArchive(await zip.generateAsync({ type: 'nodebuffer' }), path.join(group, 'complete'), noDependencies);
    assert.equal(fs.readFileSync(path.join(group, 'complete/.debug/compiled/index.js'), 'utf8'), '// Bundled linked-source-map reference');
    // Even an installed ancestor dependency cannot mask a missing production dependency.
    zip.file('lib/required.js', "require('typescript');module.exports=true");
    await assert.rejects(verifyRuntimeArchive(await zip.generateAsync({ type: 'nodebuffer' }), path.join(group, 'ancestor'), noDependencies), /ARTIFACT_AUTH_FAILED/);
  } finally {
    // Resolved fixed workspace parent + generated direct child, never external paths.
    assert.equal(path.dirname(group), parent);
    fs.rmSync(group, { recursive: true, force: true });
  }
});
