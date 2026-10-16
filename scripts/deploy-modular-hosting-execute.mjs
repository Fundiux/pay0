// Narrow SSR + Hosting release adapter. No Firebase CLI deployment or IAM mutation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PROJECT, REGION, digest, getMetadata, tokenInMemory } from './capture-production-baseline.mjs';
import { assertRuntimePreserved } from './deploy-scoped-functions.mjs';
import { check, livePreflight, privateFile, sha, validateBaseline, assertFreshBaseline, assertHostingConfigPreserved, assertSsrApiPreserved } from './deploy-modular-hosting.mjs';

const require = createRequire(import.meta.url), legacy = require('./lib/notes-hosting-ssr-update-only.cjs');
const NAME = 'ssrpay0system', RESOURCE = `projects/${PROJECT}/locations/${REGION}/functions/${NAME}`;
const FN = `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}`;
const HOSTING = `https://firebasehosting.googleapis.com/v1beta1/sites/${PROJECT}`;
const RUN = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${NAME}`;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const row = state => state.functions[NAME];
const versionName = state => state.hosting.releases[0].version.name;
const config = state => state.hosting.releases[0].version.config;

export function assertRuntimeProof(proof, input) {
  assert.equal(proof?.schema, 'PAY0-MODULAR-HOSTING-RUNTIME@1', 'RUNTIME_PROOF_SCHEMA');
  assert.equal(proof.status, 'PASS', 'RUNTIME_PROOF_REQUIRED');
  assert.equal(proof.sourceCommit, input.sourceCommit, 'RUNTIME_PROOF_COMMIT');
  assert.equal(proof.archiveSha256, input.archiveSha256, 'RUNTIME_PROOF_ARCHIVE');
  assert.equal(proof.hostingManifestSha256, digest(input.hostingFiles), 'RUNTIME_PROOF_HOSTING');
  assert.equal(proof.runtimeHttpPassed, true, 'RUNTIME_HTTP_REQUIRED');
  assert.equal(proof.criticalBrowserPassed, true, 'CRITICAL_BROWSER_REQUIRED');
  assert.equal(proof.verifierSha256, sha(fs.readFileSync(path.resolve(import.meta.dirname, '../qa/scripts/verify-modular-hosting-runtime.mjs'))), 'RUNTIME_VERIFIER_CHANGED');
}
export function assertSource(source) {
  assert.match(source?.bucket || '', /^(?:gcf-v2-sources-751158244178-us-central1|gcf-v2-uploads-751158244178\.us-central1\.cloudfunctions\.appspot\.com)$/);
  assert.ok(typeof source.object === 'string' && source.object.length > 0 && !source.object.includes('..'), 'SOURCE_OBJECT');
  assert.match(source.generation || '', /^[1-9][0-9]*$/);
}
export function assertSsrReady(before, current, labels) {
  const old = row(before), now = row(current);
  assertRuntimePreserved(old.resource, now.resource);
  assertSsrApiPreserved(now.resource, before);
  assert.equal(digest(now.iam), digest(old.iam), 'IAM_CHANGED');
  assert.deepEqual(now.resource.labels, labels, 'SSR_LABELS_CHANGED');
  legacy.assertReady({ function: now.resource, service: now.service }, { schema: 'PAY0-NOTES-HOSTING-BASELINE@1', function: old.resource, service: old.service });
}
export function releaseConfig(baseline, tag) {
  const next = structuredClone(config(baseline));
  for (const rule of next.rewrites || []) if (rule.run?.serviceId === NAME && rule.run.region === REGION) rule.run.tag = tag;
  assertHostingConfigPreserved(config(baseline), next, tag); return next;
}
export function assertTagPresent(state, tag) {
  const service = row(state).service, revision = row(state).resource.serviceConfig.revision;
  assert.ok((service.trafficStatuses || []).some(target => target.tag === tag && [revision, `${service.name}/revisions/${revision}`].includes(target.revision)), 'SSR_TAG_NOT_READY');
}
export function assertOnlyTagAdded(before, after, tag) {
  const oldTraffic = row(before).service.traffic || [], next = row(after).service.traffic || [];
  assert.equal(next.length, oldTraffic.length + 1, 'TRAFFIC_COUNT_CHANGED');
  const normalize = item => ({ ...item, percent: item.percent || 0 });
  for (const target of oldTraffic) assert.ok(next.some(item => digest(normalize(item)) === digest(normalize(target))), 'PRIOR_TRAFFIC_CHANGED');
  const extra = next.find(item => item.tag === tag);
  assert.equal(extra?.percent || 0, 0, 'TAG_CHANGED_TRAFFIC');
  assert.equal(extra?.revision, row(after).resource.serviceConfig.revision, 'TAG_WRONG_REVISION');
}

// Tests inject an in-memory API. Production callers use the fixed adapter below.
export async function executeContract({ input, baseline, proof, api, checkpoint = async () => {}, verifyLocal = async () => {} }) {
  assertRuntimeProof(proof, input); validateBaseline(baseline); await verifyLocal();
  assertFreshBaseline(baseline, await api.read());
  assert.equal(await api.sourceHash(row(baseline).resource), input.previousSha256, 'PREVIOUS_SOURCE_CHANGED');
  const version = await api.createVersion(config(baseline));
  assert.match(version, /^sites\/pay-0-system\/versions\/[a-f0-9]{8,64}$/);
  const tag = `fh-${version.split('/').at(-1)}`;
  await checkpoint('VERSION_CREATED', { version });
  await api.uploadHosting(version, input.hosting, input.hostingFiles);
  const uploaded = await api.uploadSource(input.archive); assertSource(uploaded);
  await verifyLocal(); assertFreshBaseline(baseline, await api.read());
  const labels = { ...row(baseline).resource.labels, 'pay0-source-commit': input.sourceCommit, 'firebase-functions-hash': input.archiveSha256.slice(0, 40) };
  const proposed = structuredClone(row(baseline).resource); proposed.buildConfig.source = { storageSource: uploaded }; proposed.labels = labels;
  assertSsrApiPreserved(proposed, baseline);
  await checkpoint('SSR_DISPATCHING', { version });
  await api.updateSsr(uploaded, labels);
  let current = await api.read();
  assert.equal(versionName(current), versionName(baseline), 'HOSTING_CHANGED_BEFORE_RELEASE');
  assertSsrReady(baseline, current, labels);
  assert.equal(await api.sourceHash(row(current).resource), input.archiveSha256, 'DEPLOYED_SOURCE_CHANGED');
  await checkpoint('SSR_VERIFIED', { version, snapshot: current });
  await verifyLocal(); assertFreshBaseline(current, await api.read());
  const beforeTag = current;
  await api.pinRevision(current, tag);
  current = await api.read(); assertSsrReady(baseline, current, labels); assertTagPresent(current, tag); assertOnlyTagAdded(beforeTag, current, tag);
  assert.equal(versionName(current), versionName(baseline), 'HOSTING_CHANGED_BEFORE_RELEASE');
  await checkpoint('SSR_TAG_VERIFIED', { version, snapshot: current });
  const nextConfig = releaseConfig(baseline, tag);
  await api.finalizeVersion(version, nextConfig);
  await verifyLocal(); assertFreshBaseline(current, await api.read());
  await checkpoint('RELEASE_DISPATCHING', { version, snapshot: current });
  await api.release(version);
  const after = await api.read();
  assert.equal(versionName(after), version, 'POSTFLIGHT_HOSTING_VERSION');
  assertHostingConfigPreserved(config(baseline), config(after), tag);
  assertSsrReady(baseline, after, labels); assertTagPresent(after, tag);
  assert.equal(await api.sourceHash(row(after).resource), input.archiveSha256, 'POSTFLIGHT_SOURCE_CHANGED');
  await checkpoint('RELEASE_VERIFIED', { version, snapshot: after });
  return { status: 'RELEASE_VERIFIED', version, revision: row(after).resource.serviceConfig.revision };
}

export async function rollbackContract({ input, baseline, expected, api, checkpoint = async () => {}, verifyLocal = async () => {} }) {
  await verifyLocal(); assertFreshBaseline(expected, await api.read());
  assert.equal(row(expected).resource.labels?.['pay0-source-commit'], input.sourceCommit, 'ROLLBACK_NOT_OWN_RELEASE');
  assert.equal(await api.sourceHash(row(expected).resource), input.archiveSha256, 'ROLLBACK_NOT_OWN_SOURCE');
  // The previous Hosting version is pinned to its previous revision: restore it first.
  const previousConfig = config(baseline);
  for (const rule of previousConfig.rewrites || []) if (rule.run?.serviceId === NAME) {
    assert.ok(rule.run.tag, 'PREVIOUS_VERSION_NOT_PINNED');
    const oldRevision = row(baseline).resource.serviceConfig.revision;
    assert.ok((row(expected).service.trafficStatuses || []).some(target => target.tag === rule.run.tag && [oldRevision, `${row(expected).service.name}/revisions/${oldRevision}`].includes(target.revision)), 'PREVIOUS_PIN_NO_LONGER_AVAILABLE');
  }
  if (versionName(expected) !== versionName(baseline)) await api.release(versionName(baseline));
  let current = await api.read();
  assert.equal(versionName(current), versionName(baseline), 'ROLLBACK_HOSTING_VERSION');
  assert.deepEqual(config(current), config(baseline), 'ROLLBACK_HOSTING_CONFIG');
  assert.equal(digest(row(current)), digest(row(expected)), 'SSR_CHANGED_DURING_ROLLBACK');
  await checkpoint('ROLLBACK_HOSTING_VERIFIED', { snapshot: current });
  await verifyLocal(); assertFreshBaseline(current, await api.read());
  const oldSource = row(baseline).resource.buildConfig.sourceProvenance?.resolvedStorageSource || row(baseline).resource.buildConfig.source.storageSource;
  assertSource(oldSource);
  await api.updateSsr(oldSource, row(baseline).resource.labels);
  current = await api.read();
  assert.equal(versionName(current), versionName(baseline), 'ROLLBACK_HOSTING_CHANGED');
  assertSsrReady(expected, current, row(baseline).resource.labels);
  assert.equal(await api.sourceHash(row(current).resource), input.previousSha256, 'ROLLBACK_SOURCE_CHANGED');
  await checkpoint('ROLLBACK_VERIFIED', { snapshot: current });
  return { status: 'ROLLBACK_VERIFIED', version: versionName(current), revision: row(current).resource.serviceConfig.revision };
}

export function createApi(token, emit = () => {}) {
  const allowedVersions = new Set();
  async function request(url, method, body) {
    const allowed = url === `${FN}/functions:generateUploadUrl`
      || url === `${FN}/functions/${NAME}?updateMask=buildConfig.source,labels`
      || url === `${RUN}?updateMask=traffic`
      || url === `${HOSTING}/versions`
      || [...allowedVersions].some(version => url === `https://firebasehosting.googleapis.com/v1beta1/${version}:populateFiles`
        || url === `https://firebasehosting.googleapis.com/v1beta1/${version}?updateMask=status,config`
        || url === `${HOSTING}/releases?versionName=${encodeURIComponent(version)}`);
    assert.ok(allowed, 'MUTATION_ENDPOINT_FORBIDDEN');
    emit({ state: 'MUTATION_DISPATCHING' });
    const response = await fetch(url, { method, redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    assert.ok(response.ok, `MUTATION_HTTP_${response.status}`); return response.json();
  }
  async function wait(operation, origin) {
    assert.match(operation.name || '', /^projects\/[^/]+\/locations\/us-central1\/operations\/[^/]+$/);
    for (let attempt = 0; attempt < 180; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10_000));
      const result = await getMetadata(`${origin}/${operation.name}`, token);
      if (result.done) { assert.ok(!result.error, 'CLOUD_OPERATION_FAILED'); return result.response; }
      if (attempt % 3 === 0) emit({ state: 'CLOUD_OPERATION_PENDING' });
    }
    throw Error('CLOUD_OPERATION_TIMEOUT');
  }
  async function sourceBytes(resource) {
    const source = resource.buildConfig.sourceProvenance?.resolvedStorageSource || resource.buildConfig.source.storageSource; assertSource(source);
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${source.bucket}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`,
      { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
    assert.equal(response.status, 200, 'SOURCE_READ_FAILED'); return Buffer.from(await response.arrayBuffer());
  }
  return {
    async read() {
      const resource = await getMetadata(`${FN}/functions/${NAME}`, token);
      const [service, iam, hosting, operations] = await Promise.all([
        getMetadata(RUN, token), getMetadata(`${RUN}:getIamPolicy`, token),
        getMetadata(`${HOSTING}/releases?pageSize=1`, token), getMetadata(`${FN}/operations?pageSize=100&filter=done%3Dfalse`, token) ]);
      return { functions: { [NAME]: { resource, service, iam } }, hosting, operations };
    },
    async sourceHash(resource) { return sha(await sourceBytes(resource)); },
    async createVersion(config) {
      const result = await request(`${HOSTING}/versions`, 'POST', { config });
      assert.match(result.name || '', /^sites\/pay-0-system\/versions\/[a-f0-9]{8,64}$/); allowedVersions.add(result.name); return result.name;
    },
    async uploadSource(file) {
      const generated = await request(`${FN}/functions:generateUploadUrl`, 'POST', {}), url = new URL(generated.uploadUrl);
      assert.ok(url.protocol === 'https:' && (url.hostname === 'storage.googleapis.com' || url.hostname.endsWith('.storage.googleapis.com')), 'UPLOAD_HOST');
      const response = await fetch(url, { method: 'PUT', redirect: 'error', body: fs.readFileSync(privateFile(file)), headers: { 'Content-Type': 'application/zip' }, signal: AbortSignal.timeout(120_000) });
      assert.ok(response.ok, 'SOURCE_UPLOAD_FAILED');
      const source = { ...generated.storageSource, generation: response.headers.get('x-goog-generation') }; assertSource(source); return source;
    },
    async uploadHosting(version, directory, rows) {
      assert.ok(allowedVersions.has(version), 'VERSION_NOT_OWNED');
      const files = {}, compressed = new Map();
      for (const item of rows) {
        const bytes = fs.readFileSync(privateFile(path.join(directory, item.file))); assert.equal(sha(bytes), item.sha256, 'HOSTING_FILE_CHANGED');
        const zip = gzipSync(bytes, { level: 9 }), hash = sha(zip); files[`/${item.file}`] = hash; compressed.set(hash, zip);
      }
      assert.ok(rows.length <= 1000, 'HOSTING_BATCH_REVIEW_REQUIRED');
      const response = await request(`https://firebasehosting.googleapis.com/v1beta1/${version}:populateFiles`, 'POST', { files });
      const url = new URL(response.uploadUrl);
      assert.ok(url.protocol === 'https:' && url.hostname === 'upload-firebasehosting.googleapis.com', 'HOSTING_UPLOAD_HOST');
      for (const hash of response.uploadRequiredHashes || []) {
        assert.ok(compressed.has(hash), 'UNKNOWN_HOSTING_HASH');
        const result = await fetch(`${url.href.replace(/\/$/, '')}/${hash}`, { method: 'POST', redirect: 'error', body: compressed.get(hash), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.timeout(60_000) });
        assert.ok(result.ok, 'HOSTING_UPLOAD_FAILED');
      }
    },
    async updateSsr(source, labels) {
      assertSource(source);
      const operation = await request(`${FN}/functions/${NAME}?updateMask=buildConfig.source,labels`, 'PATCH', { name: RESOURCE, buildConfig: { source: { storageSource: source } }, labels });
      emit({ state: 'SSR_OPERATION_ACCEPTED', operation: operation.name });
      await wait(operation, 'https://cloudfunctions.googleapis.com/v2');
    },
    async pinRevision(state, tag) {
      assert.match(tag, /^fh-[a-f0-9]{8,64}$/);
      const before = row(state).service, revision = row(state).resource.serviceConfig.revision;
      assert.ok(typeof before.etag === 'string' && before.etag.length > 0, 'RUN_ETAG_REQUIRED');
      assert.ok(!(before.traffic || []).some(target => target.tag === tag), 'TAG_ALREADY_EXISTS');
      const traffic = [...(before.traffic || []), { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision, tag, percent: 0 }];
      const operation = await request(`${RUN}?updateMask=traffic`, 'PATCH', { name: before.name, etag: before.etag, traffic });
      emit({ state: 'TAG_OPERATION_ACCEPTED', operation: operation.name });
      await wait(operation, 'https://run.googleapis.com/v2');
    },
    async finalizeVersion(version, config) {
      assert.ok(allowedVersions.has(version), 'VERSION_NOT_OWNED');
      const result = await request(`https://firebasehosting.googleapis.com/v1beta1/${version}?updateMask=status,config`, 'PATCH', { status: 'FINALIZED', config });
      assert.equal(result.status, 'FINALIZED', 'VERSION_NOT_FINALIZED'); assert.deepEqual(result.config, config, 'FINALIZED_CONFIG_CHANGED');
    },
    async release(version) {
      assert.match(version, /^sites\/pay-0-system\/versions\/[a-f0-9]{8,64}$/);
      // A rollback may release only the pinned version supplied by its validated contract.
      allowedVersions.add(version);
      const result = await request(`${HOSTING}/releases?versionName=${encodeURIComponent(version)}`, 'POST', {});
      assert.equal(result.version?.name, version, 'RELEASE_RESPONSE_VERSION');
    },
  };
}

export async function run(mode, inputFile, inputSha256, proofFile, proofSha256) {
  assert.ok(['execute', 'rollback'].includes(mode), 'MODE');
  const input = check(inputFile, inputSha256), baseline = readJson(input.baselineFile), directory = path.dirname(inputFile);
  const lockFile = privateFile(path.join(directory, '..', 'deployment.lock'));
  const log = privateFile(path.join(directory, `${mode}.jsonl`));
  assert.ok(!fs.existsSync(log), 'REPLAY_FORBIDDEN');
  // Never steal an unresolved deployment lock; reconcile it against cloud state first.
  const lock = fs.openSync(lockFile, 'wx', 0o600); let resolved = false, mutationDispatched = false;
  const emit = event => {
    if (event.state === 'MUTATION_DISPATCHING') mutationDispatched = true;
    fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ state: event.state }));
  };
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ mode, inputFile, inputSha256, state: 'STARTED' }));
    const api = createApi(tokenInMemory(), emit);
    const checkpoint = async (state, data) => {
      if (data.snapshot) fs.writeFileSync(privateFile(path.join(directory, 'latest-own-state.json')), JSON.stringify({ inputSha256, state, ...data }), { mode: 0o600 });
      fs.writeFileSync(lockFile, JSON.stringify({ mode, inputFile, inputSha256, state, version: data.version })); emit({ state });
    };
    const verifyLocal = async () => {
      check(inputFile, inputSha256);
      if (mode === 'execute') assert.equal(sha(fs.readFileSync(privateFile(proofFile))), proofSha256, 'RUNTIME_PROOF_CHANGED');
    };
    let result;
    if (mode === 'execute') {
      assert.match(proofSha256 || '', /^[a-f0-9]{64}$/);
      assert.equal(sha(fs.readFileSync(privateFile(proofFile))), proofSha256, 'RUNTIME_PROOF_CHANGED');
      await livePreflight(inputFile, inputSha256);
      result = await executeContract({ input, baseline, proof: readJson(proofFile), api, checkpoint, verifyLocal });
    } else {
      const own = readJson(privateFile(path.join(directory, 'latest-own-state.json')));
      assert.equal(own.inputSha256, inputSha256, 'ROLLBACK_OTHER_INPUT');
      result = await rollbackContract({ input, baseline, expected: own.snapshot, api, checkpoint, verifyLocal });
    }
    resolved = true; return result;
  } finally { fs.closeSync(lock); if (resolved || !mutationDispatched) fs.unlinkSync(lockFile); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await run(...process.argv.slice(2)))); }
  catch { console.error(JSON.stringify({ status: 'BLOCKED', detailsRedacted: true, unresolvedLockMayRequireReconciliation: true })); process.exitCode = 1; }
}
