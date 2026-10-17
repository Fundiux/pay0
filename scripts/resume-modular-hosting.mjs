// Resume only a verified SSR update whose Hosting release has not been published.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { PROJECT, digest, getMetadata, tokenInMemory } from './capture-production-baseline.mjs';
import { check, privateFile, sha, validateBaseline, assertFreshBaseline, assertHostingConfigPreserved } from './deploy-modular-hosting.mjs';
import { createApi, assertRuntimeProof, assertSsrReady, assertOnlyTagAdded, assertTagPresent, releaseConfig, tagRequest, assertV1Metadata } from './deploy-modular-hosting-execute.mjs';

export { tagRequest, assertV1Metadata };

const NAME = 'ssrpay0system';
const RUN = 'https://run.googleapis.com/v1/projects/pay-0-system/locations/us-central1/services/ssrpay0system';
const HOSTING = 'https://firebasehosting.googleapis.com/v1beta1/';
const row = state => state.functions[NAME];
const latest = state => state.hosting.releases[0].version;
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function durableWrite(file, value, flags = 'w') {
  const descriptor = fs.openSync(file, flags, 0o600);
  try { fs.writeFileSync(descriptor, value); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
export function ownedFile(file) {
  let expected = sha(fs.readFileSync(file));
  const verify = () => assert.equal(sha(fs.readFileSync(file)), expected, 'OWNED_FILE_REPLACED');
  return { verify, write(value) { verify(); durableWrite(file, value); expected = sha(fs.readFileSync(file)); }, remove() { verify(); fs.unlinkSync(file); } };
}

export function assertOwnership({ own, lock, journal, inputFile, inputSha256 }) {
  assert.equal(own.state, 'SSR_VERIFIED', 'RESUME_STATE_NOT_SUPPORTED');
  assert.equal(lock.state, 'SSR_VERIFIED', 'LOCK_STATE_NOT_SUPPORTED');
  assert.equal(lock.mode, 'execute', 'LOCK_MODE');
  assert.equal(path.resolve(lock.inputFile), path.resolve(inputFile), 'LOCK_OTHER_INPUT');
  assert.equal(lock.inputSha256, inputSha256, 'LOCK_OTHER_DIGEST');
  assert.equal(own.inputSha256, inputSha256, 'STATE_OTHER_DIGEST');
  assert.equal(lock.version, own.version, 'LOCK_OTHER_VERSION');
  assert.match(own.version, /^sites\/pay-0-system\/versions\/[a-f0-9]{8,64}$/);
  const states = journal.map(item => item.state);
  assert.equal(states.filter(s => s === 'VERSION_CREATED').length, 1, 'JOURNAL_VERSION');
  assert.equal(states.filter(s => s === 'SSR_VERIFIED').length, 1, 'JOURNAL_SSR');
  assert.ok(states.indexOf('VERSION_CREATED') < states.indexOf('SSR_VERIFIED'), 'JOURNAL_ORDER');
  assert.ok(states.slice(states.indexOf('SSR_VERIFIED') + 1).every(s => s === 'MUTATION_DISPATCHING'), 'JOURNAL_ADVANCED');
}

export function assertVersionFiles(files, expected) {
  assert.equal(files.length, expected.length, 'VERSION_FILE_COUNT');
  const map = new Map();
  for (const file of files) {
    assert.equal(file.status, 'ACTIVE', 'VERSION_FILE_NOT_ACTIVE');
    assert.ok(!map.has(file.path), 'DUPLICATE_VERSION_FILE');
    map.set(file.path, file.hash);
  }
  for (const file of expected) assert.equal(map.get(file.path), file.hash, 'VERSION_FILE_CHANGED');
}

export async function resumeContract({ input, baseline, proof, own, api, expectedV1, expectedModifier, verifyLocal = async () => {}, checkpoint = async () => {} }) {
  assert.equal(own.state, 'SSR_VERIFIED', 'RESUME_STATE_NOT_SUPPORTED');
  assertRuntimeProof(proof, input); validateBaseline(baseline); await verifyLocal();
  let current = await api.read(); assertFreshBaseline(own.snapshot, current);
  const version = own.version, tag = `fh-${version.split('/').at(-1)}`;
  assert.equal(latest(current).name, latest(baseline).name, 'PUBLIC_RELEASE_CHANGED');
  const labels = { ...row(baseline).resource.labels, 'pay0-source-commit': input.sourceCommit, 'firebase-functions-hash': input.archiveSha256.slice(0, 40) };
  assertSsrReady(baseline, current, labels);
  assert.equal(await api.sourceHash(row(current).resource), input.archiveSha256, 'SOURCE_CHANGED');
  await api.assertOwnedVersion(version, latest(baseline).config);
  const v1 = await api.readV1();
  if (expectedV1) assert.deepEqual(v1, expectedV1, 'V1_DRYRUN_BASE_CHANGED');
  const body = tagRequest(v1, row(current).resource.serviceConfig.revision, tag);
  await verifyLocal(); assertFreshBaseline(current, await api.read());
  assert.equal(digest(await api.readV1()), digest(v1), 'V1_CHANGED_BEFORE_TAG');
  await checkpoint('TAG_V1_DISPATCHING', { version });
  await api.putTag(body);
  const beforeTag = current; current = await api.waitTag(tag);
  const afterV1 = await api.readV1();
  const beforeSpec = structuredClone(v1.spec), afterSpec = structuredClone(afterV1.spec);
  delete beforeSpec.traffic; delete afterSpec.traffic;
  assert.deepEqual(afterSpec, beforeSpec, 'V1_SPEC_CHANGED');
  assertV1Metadata(v1, afterV1, expectedModifier);
  assertSsrReady(baseline, current, labels); assertOnlyTagAdded(beforeTag, current, tag); assertTagPresent(current, tag);
  assert.equal(latest(current).name, latest(baseline).name, 'PUBLIC_RELEASE_CHANGED');
  await checkpoint('SSR_TAG_VERIFIED', { version, snapshot: current });
  await api.assertOwnedVersion(version, latest(baseline).config);
  await verifyLocal(); assertFreshBaseline(current, await api.read());
  const nextConfig = releaseConfig(baseline, tag);
  await checkpoint('FINALIZE_DISPATCHING', { version });
  await api.finalize(version, nextConfig);
  await verifyLocal(); assertFreshBaseline(current, await api.read());
  await api.assertFinalized(version, nextConfig);
  await checkpoint('RELEASE_DISPATCHING', { version, snapshot: current });
  await api.release(version);
  const after = await api.read();
  assert.equal(latest(after).name, version, 'RELEASE_VERSION');
  assertHostingConfigPreserved(latest(baseline).config, latest(after).config, tag);
  assertSsrReady(baseline, after, labels); assertTagPresent(after, tag);
  assert.equal(digest(row(after)), digest(row(current)), 'SSR_CHANGED_DURING_RELEASE');
  assert.equal(await api.sourceHash(row(after).resource), input.archiveSha256, 'SOURCE_CHANGED');
  await checkpoint('RELEASE_VERIFIED', { version, snapshot: after });
  return { status: 'RELEASE_VERIFIED', version, revision: row(after).resource.serviceConfig.revision };
}

export function createResumeApi(token, version, expectedFiles, emit = () => {}, baselineVersion) {
  assert.match(version, /^sites\/pay-0-system\/versions\/[a-f0-9]{8,64}$/);
  assert.match(baselineVersion || '', /^sites\/pay-0-system\/versions\/[a-f0-9]{8,64}$/);
  const readApi = createApi(token), url = `${HOSTING}${version}`;
  const request = async (target, method, body) => {
    assert.ok((target === RUN && method === 'PUT') || (target === `${url}?updateMask=status,config` && method === 'PATCH')
      || (target === `${HOSTING}sites/${PROJECT}/releases?versionName=${encodeURIComponent(version)}` && method === 'POST'), 'ENDPOINT_FORBIDDEN');
    emit({ state: 'MUTATION_DISPATCHING' });
    const response = await fetch(target, { method, redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    assert.ok(response.ok, `MUTATION_HTTP_${response.status}`); return response.json();
  };
  const listFiles = async (target, limit) => {
    const result = [], seen = new Set(); let pageToken = '';
    do {
      const page = await getMetadata(`${HOSTING}${target}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, token);
      result.push(...(page.files || [])); pageToken = page.nextPageToken || '';
      assert.ok(!pageToken || !seen.has(pageToken), 'REPEATED_PAGE'); seen.add(pageToken);
      assert.ok(result.length <= limit, 'EXTRA_VERSION_FILES');
    } while (pageToken);
    return result;
  };
  const files = async () => {
    const previous = await listFiles(baselineVersion, 10000);
    const reserved = ['/__/firebase/init.js', '/__/firebase/init.json'].map(name => {
      const matches = previous.filter(file => file.path === name);
      assert.equal(matches.length, 1, 'BASELINE_RESERVED_FILE_REQUIRED');
      assert.equal(matches[0].status, 'ACTIVE', 'BASELINE_RESERVED_FILE_INACTIVE');
      assert.match(matches[0].hash, /^[a-f0-9]{64}$/);
      return matches[0];
    });
    assert.ok(!expectedFiles.some(file => reserved.some(r => r.path === file.path)), 'RESERVED_FILE_OVERRIDE');
    assertVersionFiles(await listFiles(version, expectedFiles.length + 2), [...expectedFiles, ...reserved]);
  };
  return {
    read: readApi.read, sourceHash: readApi.sourceHash,
    readV1: () => getMetadata(RUN, token),
    async assertOwnedVersion(name, config) { assert.equal(name, version); const value = await getMetadata(url, token); assert.equal(value.name, version); assert.equal(value.status, 'CREATED', 'VERSION_ALREADY_FINALIZED'); assert.deepEqual(value.config, config, 'VERSION_CONFIG_CHANGED'); await files(); },
    putTag: body => request(RUN, 'PUT', body),
    async waitTag(tag) {
      for (let i = 0; i < 90; i++) {
        const state = await readApi.read();
        if (row(state).service.terminalCondition?.state === 'CONDITION_SUCCEEDED' && (row(state).service.trafficStatuses || []).some(t => t.tag === tag)) return state;
        if (i % 3 === 0) emit({ state: 'TAG_PENDING' });
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      throw Error('TAG_TIMEOUT');
    },
    async finalize(name, config) { assert.equal(name, version); const result = await request(`${url}?updateMask=status,config`, 'PATCH', { status: 'FINALIZED', config }); assert.equal(result.status, 'FINALIZED'); assert.deepEqual(result.config, config); },
    async assertFinalized(name, config) { assert.equal(name, version); const result = await getMetadata(url, token); assert.equal(result.status, 'FINALIZED'); assert.deepEqual(result.config, config); await files(); },
    async release(name) { assert.equal(name, version); const result = await request(`${HOSTING}sites/${PROJECT}/releases?versionName=${encodeURIComponent(version)}`, 'POST', {}); assert.equal(result.version?.name, version); },
  };
}

export async function run(inputFile, inputSha256, proofFile, proofSha256) {
  const input = check(inputFile, inputSha256), directory = path.dirname(inputFile);
  const lockFile = privateFile(path.join(directory, '..', 'deployment.lock'));
  const ownFile = privateFile(path.join(directory, 'latest-own-state.json'));
  const own = json(ownFile), lock = json(lockFile);
  const journalFile = privateFile(path.join(directory, 'execute.jsonl'));
  const journalBytes = fs.readFileSync(journalFile);
  const journal = journalBytes.toString('utf8').trim().split('\n').map(JSON.parse);
  assertOwnership({ own, lock, journal, inputFile, inputSha256 });
  const active = privateFile(path.join(directory, '..', 'hosting-resume-active.lock'));
  const fd = fs.openSync(active, 'wx', 0o600); let resolved = false;
  const log = privateFile(path.join(directory, 'resume-v1.jsonl'));
  try {
    // A previous interrupted resume must be reconciled explicitly, never replayed.
    durableWrite(log, '', 'wx');
    fs.writeFileSync(fd, JSON.stringify({ inputSha256, pid: process.pid }));
    fs.fsyncSync(fd);
    const ownedLock = ownedFile(lockFile), ownedState = ownedFile(ownFile);
    assert.deepEqual(json(lockFile), lock, 'LOCK_CHANGED_BEFORE_ACQUIRE');
    assert.deepEqual(json(ownFile), own, 'STATE_CHANGED_BEFORE_ACQUIRE');
    const v1File = privateFile(path.join(directory, 'v1-before-tag.json'));
    const dryFile = privateFile(path.join(directory, 'tag-v1-validation-response.json'));
    const expectedV1 = json(v1File), dryRun = json(dryFile);
    const v1Sha = sha(fs.readFileSync(v1File)), drySha = sha(fs.readFileSync(dryFile));
    const expectedModifier = dryRun.metadata?.annotations?.['serving.knative.dev/lastModifier'];
    assert.ok(typeof expectedModifier === 'string' && expectedModifier.length > 0, 'DRYRUN_MODIFIER_REQUIRED');
    assert.deepEqual(dryRun.spec, tagRequest(expectedV1, row(own.snapshot).resource.serviceConfig.revision, `fh-${own.version.split('/').at(-1)}`).spec, 'DRYRUN_SPEC_CHANGED');
    assertV1Metadata(expectedV1, dryRun, expectedModifier);
    const emit = event => { durableWrite(log, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', 'a'); console.log(JSON.stringify({ state: event.state })); };
    emit({ state: 'RESUME_INTENT', inputSha256, proofSha256, v1BeforeSha256: v1Sha, v1DryRunSha256: drySha, originalJournalSha256: sha(journalBytes), originalStateSha256: sha(fs.readFileSync(ownFile)), helperSha256: sha(fs.readFileSync(import.meta.filename)) });
    const verifyLocal = async () => { ownedLock.verify(); ownedState.verify(); assert.equal(sha(fs.readFileSync(v1File)), v1Sha, 'V1_EVIDENCE_CHANGED'); assert.equal(sha(fs.readFileSync(dryFile)), drySha, 'DRYRUN_EVIDENCE_CHANGED'); assert.equal(sha(fs.readFileSync(journalFile)), sha(journalBytes), 'ORIGINAL_JOURNAL_CHANGED'); check(inputFile, inputSha256); assert.equal(sha(fs.readFileSync(privateFile(proofFile))), proofSha256, 'PROOF_CHANGED'); };
    await verifyLocal();
    const expectedFiles = input.hostingFiles.map(file => ({ path: `/${file.file}`, hash: sha(gzipSync(fs.readFileSync(privateFile(path.join(input.hosting, file.file))), { level: 9 })) }));
    const api = createResumeApi(tokenInMemory(), own.version, expectedFiles, emit, latest(json(input.baselineFile)).name);
    const checkpoint = async (state, data) => {
      ownedLock.verify(); ownedState.verify();
      if (data.snapshot) ownedState.write(JSON.stringify({ inputSha256, state, ...data }));
      ownedLock.write(JSON.stringify({ mode: 'execute', inputFile, inputSha256, state, version: own.version })); emit({ state });
    };
    const result = await resumeContract({ input, baseline: json(input.baselineFile), proof: json(proofFile), own, api, expectedV1, expectedModifier, verifyLocal, checkpoint });
    ownedLock.remove(); resolved = true; return result;
  } finally { fs.closeSync(fd); if (resolved) fs.unlinkSync(active); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await run(...process.argv.slice(2)))); }
  catch (error) { const first = String(error?.message || '').split('\n')[0]; console.error(JSON.stringify({ status: 'BLOCKED', reason: /^[A-Z][A-Z0-9_]+$/.test(first) ? first : 'DETAILS_REDACTED', unresolvedLockRequiresReconciliation: true })); process.exitCode = 1; }
}
