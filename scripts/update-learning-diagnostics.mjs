// Dedicated source-only updater. It does not extend any existing deployment whitelist.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { tokenInMemory, digest } from './capture-production-baseline.mjs';
import { assertUploadSource, assertOperationScope, assertOperationMatchesGet, previousSource } from './deploy-scoped-functions.mjs';

export const TARGET = 'listAgent007LearningDiagnostics';
export const BASE_SHA = 'c50f0d7a95bb24caf156022ae1145503d34f2110f9c39df71921ee52a190db1f';
export const ARCHIVE_SHA = 'd148d084149f6be8e76ce297d4639c22583ead14e5eee64f6386b3969d353ce8';
export const PATCH_COMMIT = 'b5ba93a4b002a0c4dde8711b524840737e7fcd40';
export const PATCH_SHA = '24fe46b530742411fe1d4709a8620173dce60d9b72749a0e7df864445e706f4b';
const ROOT = path.resolve(import.meta.dirname, '..');
const PRIVATE = path.join(ROOT, '.firebase/modular-release');
const BASE_URL = 'https://cloudfunctions.googleapis.com/v2/projects/pay-0-system/locations/us-central1';
const FUNCTION_URL = `${BASE_URL}/functions/${TARGET}`;
const FUNCTION_NAME = `projects/pay-0-system/locations/us-central1/functions/${TARGET}`;
const KIND = 'LEARNING_DIAGNOSTICS_SOURCE_ONLY';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const PROOF_KEYS = ['startup', 'behavior', 'regression'];

export function privatePath(value, root = PRIVATE) {
  const target = path.resolve(value);
  assert(target.startsWith(root + path.sep), 'PRIVATE_PATH_REQUIRED');
  for (let current = target; ; current = path.dirname(current)) {
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'PRIVATE_LINK_FORBIDDEN');
    if (current === path.parse(current).root) break;
  }
  return target;
}
function validateContract(input) {
  assert.deepEqual(input.functions, [TARGET], 'EXACT_DIAGNOSTICS_TARGET_REQUIRED');
  assert.equal(input.group, 'learning-diagnostics-source-only');
  assert.equal(input.sourceTree, null);
  assert.match(input.sourceCommit || '', /^[a-f0-9]{40}$/);
  for (const key of ['archiveSha256', 'previousArchiveSha256']) assert.match(input[key] || '', /^[a-f0-9]{64}$/);
  assert.equal(input.sourceIdentity?.mode, 'PRODUCTION_OVERLAY_V1');
  assert.equal(input.sourceIdentity.patchCommit, input.sourceCommit);
  assert.equal(input.sourceIdentity.baseArchiveSha256, input.previousArchiveSha256);
  assert.match(input.sourceIdentity.patchSha256 || '', /^[a-f0-9]{64}$/);
}
export function validateInput(input) {
  validateContract(input);
  assert.equal(input.sourceCommit, PATCH_COMMIT, 'PATCH_COMMIT_MISMATCH');
  assert.equal(input.archiveSha256, ARCHIVE_SHA, 'ARCHIVE_PIN_MISMATCH');
  assert.equal(input.previousArchiveSha256, BASE_SHA, 'BASE_PIN_MISMATCH');
  assert.deepEqual(input.sourceIdentity, { mode: 'PRODUCTION_OVERLAY_V1', baseArchiveSha256: BASE_SHA, patchCommit: PATCH_COMMIT, patchSha256: PATCH_SHA }, 'SOURCE_IDENTITY_MISMATCH');
  for (const key of PROOF_KEYS) {
    assert.match(input[`${key}ProofSha256`] || '', /^[a-f0-9]{64}$/, 'PROOF_PIN_REQUIRED');
    privatePath(input[`${key}ProofFile`]);
  }
}
export function readPinned(file, expected) {
  assert.match(expected || '', /^[a-f0-9]{64}$/, 'HASH_REQUIRED');
  const bytes = fs.readFileSync(privatePath(file));
  assert.equal(sha(bytes), expected, 'LOCAL_BYTES_CHANGED');
  return bytes;
}
export function readProofs(input) {
  const proofs = Object.fromEntries(PROOF_KEYS.map(key => [key, JSON.parse(readPinned(input[`${key}ProofFile`], input[`${key}ProofSha256`]))]));
  for (const proof of Object.values(proofs)) {
    assert.equal(proof.archiveSha256, ARCHIVE_SHA, 'PROOF_ARCHIVE');
    assert.deepEqual(proof.sourceIdentity, input.sourceIdentity, 'PROOF_IDENTITY');
    assert.equal(proof.productionWrites, 0, 'PROOF_PRODUCTION_WRITES');
  }
  const { startup, behavior, regression } = proofs;
  assert.equal(startup.status, 'PASS');
  assert.equal(startup.exports, 341); assert.equal(startup.previousExportsPreserved, 341);
  assert.equal(startup.reviewExportPresent, false); assert.equal(startup.unauthenticatedDenied, 2);
  assert.equal(startup.networkBlocked, true);
  assert.equal(behavior.status, 'PASS'); assert.equal(behavior.tests, 7); assert.equal(behavior.exitCode, 0);
  assert.equal(behavior.runtimeBytesPreserved, true);
  assert.equal(regression.status, 'BASELINE_COMPARISON');
  assert.deepEqual(regression.base, { passed: 25, total: 26 });
  assert.deepEqual(regression.candidate, regression.base);
  assert.equal(regression.newFailures, 0);
  assert.equal(regression.knownFailure, 'cached-training-grant-after-revocation');
  return proofs;
}
function controllerPins() {
  return Object.fromEntries(['update-learning-diagnostics.mjs', 'capture-production-baseline.mjs', 'deploy-scoped-functions.mjs'].map(name => [name, sha(fs.readFileSync(path.join(import.meta.dirname, name)))]));
}
export function assertBaseline(baseline) {
  assert.equal(baseline.project, 'pay-0-system');
  assert.equal((baseline.operations || []).filter(op => !op.done).length, 0, 'ACTIVE_OPERATION');
  const before = baseline.functions?.[TARGET];
  assert(before?.resource && before.service && before.iam, 'COMPLETE_BASELINE_REQUIRED');
  assert.equal(before.resource.name, FUNCTION_NAME, 'WRONG_TARGET');
  assert.equal(before.resource.state, 'ACTIVE');
  assert.equal(before.resource.environment, 'GEN_2');
  assert.equal(before.resource.buildConfig.runtime, 'nodejs22');
  assert.equal(before.resource.buildConfig.entryPoint, TARGET);
  assert.equal(before.resource.buildConfig.environmentVariables?.GOOGLE_NODE_RUN_SCRIPTS, '');
  assert(!before.resource.eventTrigger, 'CALLABLE_ONLY');
  assert.match(before.resource.serviceConfig.service, /^projects\/(pay-0-system|751158244178)\/locations\/us-central1\/services\/listagent007learningdiagnostics$/);
  assert.equal(before.service.name, before.resource.serviceConfig.service, 'SERVICE_SCOPE');
  assert.equal(before.service.terminalCondition?.state, 'CONDITION_SUCCEEDED');
  previousSource(before.resource);
  return before;
}
export function buildPlan(input, baseline) {
  validateContract(input);
  const before = assertBaseline(baseline);
  return { schemaVersion: 1, kind: KIND, state: 'LOCAL_PLAN_REQUIRES_EXPLICIT_SOURCE_UPDATE_APPROVAL',
    target: TARGET, sourceIdentity: input.sourceIdentity, archiveSha256: input.archiveSha256, previousArchiveSha256: input.previousArchiveSha256,
    baselineDigest: digest(before), updateMask: 'buildConfig.source,labels',
    preserved: ['runtime', 'serviceConfig', 'environmentVariables', 'gates', 'IAM', 'otherFunctions'],
    controllerPins: controllerPins(), proofPins: Object.fromEntries(PROOF_KEYS.map(key => [key, input[`${key}ProofSha256`]])),
    rollback: 'Restore only the owned diagnostics source to the preserved c50 archive and baseline labels; no IAM or data writes.',
    regression: { status: 'BASELINE_COMPARISON', base: '25/26', candidate: '25/26', universalPass: false }, productionWrites: 0 };
}
function labelsFor(before, input) {
  return { ...before.labels, 'pay0-source-commit': input.sourceCommit, 'firebase-functions-hash': input.archiveSha256.slice(0, 40),
    'pay0-source-mode': 'production-overlay-v1', 'pay0-base-source': input.sourceIdentity.baseArchiveSha256.slice(0, 40), 'pay0-patch-sha': input.sourceIdentity.patchSha256.slice(0, 40) };
}
export function sourcePatch(before, source, input, rollback = false) {
  assert.equal(before.name, FUNCTION_NAME, 'WRONG_TARGET');
  assertUploadSource(source);
  return { name: FUNCTION_NAME, buildConfig: { source: { storageSource: source } }, labels: rollback ? structuredClone(before.labels || {}) : labelsFor(before, input) };
}
// Full Function comparison except documented generated output and exact source/label fields.
export function assertFunctionPreserved(before, after, expectedLabels) {
  assert.equal(after.state, 'ACTIVE', 'FUNCTION_NOT_ACTIVE');
  assert.deepEqual(after.labels || {}, expectedLabels, 'FUNCTION_LABEL_DRIFT');
  const comparable = value => {
    const copy = structuredClone(value);
    for (const key of ['updateTime', 'state', 'stateMessages', 'labels']) delete copy[key];
    for (const key of ['source', 'sourceProvenance', 'build']) delete copy.buildConfig[key];
    for (const key of ['revision', 'uri']) delete copy.serviceConfig[key];
    return copy;
  };
  assert.deepEqual(comparable(after), comparable(before), 'FUNCTION_CONFIGURATION_DRIFT');
}
// Dedicated fixed-target version of the existing Run preservation contract. No whitelist bypass.
export function assertRunPreserved(before, after, expectedLabels) {
  assert.equal(after.name, before.name, 'RUN_SCOPE');
  assert.equal(after.terminalCondition?.state, 'CONDITION_SUCCEEDED', 'RUN_NOT_READY');
  const normalizedAfter = structuredClone(after);
  const addedIdentity = (oldMap, map, key, expected) => {
    if (!Object.hasOwn(oldMap || {}, key) && Object.hasOwn(map || {}, key)) {
      assert.match(after.name, /^projects\/(pay-0-system|751158244178)\/locations\/us-central1\/services\/listagent007learningdiagnostics$/);
      assert.equal(before.buildConfig?.functionTarget, TARGET, 'RUN_FUNCTION_IDENTITY');
      assert.equal(map[key], expected, 'RUN_IDENTITY_VALUE'); delete map[key];
    }
  };
  addedIdentity(before.template?.labels, normalizedAfter.template?.labels, 'goog-drz-cloudfunctions-location', 'us-central1');
  addedIdentity(before.template?.labels, normalizedAfter.template?.labels, 'goog-drz-cloudfunctions-id', TARGET.toLowerCase());
  addedIdentity(before.annotations, normalizedAfter.annotations, 'cloudfunctions.googleapis.com/function-id', TARGET);
  for (const [oldMap, newMap, owner, key] of [[before.annotations, normalizedAfter.annotations, normalizedAfter, 'annotations'], [before.template?.labels, normalizedAfter.template?.labels, normalizedAfter.template, 'labels']]) {
    if (oldMap === undefined && newMap && Object.keys(newMap).length === 0) delete owner[key];
  }
  const provenance = ['pay0-source-commit', 'firebase-functions-hash', 'pay0-source-mode', 'pay0-base-source', 'pay0-patch-sha'];
  for (const target of [normalizedAfter, normalizedAfter.template]) for (const key of provenance) {
    assert.equal(target?.labels?.[key], expectedLabels[key], 'RUN_PROVENANCE_DRIFT');
  }
  const comparable = value => {
    const copy = structuredClone(value), latest = copy.latestReadyRevision;
    for (const key of ['generation', 'observedGeneration', 'updateTime', 'etag', 'latestCreatedRevision', 'latestReadyRevision']) delete copy[key];
    for (const target of [copy, copy.template]) if (target?.labels) for (const key of provenance) delete target.labels[key];
    if (copy.template) { delete copy.template.revision; for (const container of copy.template.containers || []) delete container.image; }
    if (copy.buildConfig) for (const key of ['name', 'sourceLocation', 'imageUri']) delete copy.buildConfig[key];
    if (copy.terminalCondition) delete copy.terminalCondition.lastTransitionTime;
    for (const condition of copy.conditions || []) delete condition.lastTransitionTime;
    for (const traffic of copy.trafficStatuses || []) if (traffic.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST') {
      assert(latest && [latest, latest.split('/').at(-1)].includes(traffic.revision), 'RUN_LATEST_TRAFFIC'); delete traffic.revision;
    }
    return copy;
  };
  assert.deepEqual(comparable(normalizedAfter), comparable(before), 'RUN_CONFIGURATION_DRIFT');
}
async function snapshot(io) {
  const resource = await io.read(FUNCTION_URL);
  assert.equal(resource.name, FUNCTION_NAME, 'WRONG_TARGET');
  const serviceUrl = `https://run.googleapis.com/v2/${resource.serviceConfig.service}`;
  assert.match(serviceUrl, /^https:\/\/run.googleapis.com\/v2\/projects\/(pay-0-system|751158244178)\/locations\/us-central1\/services\/listagent007learningdiagnostics$/);
  return { resource, service: await io.read(serviceUrl), iam: await io.read(`${serviceUrl}:getIamPolicy`) };
}
async function assertFresh(io, expected, message) {
  const current = await snapshot(io);
  assert.equal(digest(current), digest(expected), message);
  return current;
}
async function noActiveOperations(io) {
  const result = await io.read(`${BASE_URL}/operations?pageSize=100&filter=done%3Dfalse`);
  assert.equal((result.operations || []).filter(op => !op.done).length, 0, 'ACTIVE_OPERATION');
}
async function uploaded(io, bytes, expected, journal, direction) {
  const field = `${direction}UploadedSource`;
  if (!journal[field]) {
    journal.networkMutationStarted = true; io.persist(journal);
    const result = await io.mutate(`${BASE_URL}/functions:generateUploadUrl`, {}, 'POST');
    const url = new URL(result.uploadUrl);
    assert(url.protocol === 'https:' && (url.hostname === 'storage.googleapis.com' || url.hostname.endsWith('.storage.googleapis.com')), 'UPLOAD_HOST');
    const generation = await io.upload(url.href, bytes);
    assert.match(generation || '', /^[1-9][0-9]*$/, 'UPLOAD_GENERATION_REQUIRED');
    journal[field] = { ...result.storageSource, generation }; io.persist(journal);
  }
  assertUploadSource(journal[field]);
  assert.equal(sha(await io.readSource(journal[field])), expected, 'UPLOADED_SOURCE_MISMATCH');
  return journal[field];
}
export async function runUpdate({ input, plan, baseline, archive, previousArchive, journal, io, rollback = false }) {
  validateContract(input);
  assert.equal(sha(archive), input.archiveSha256, 'ARCHIVE_CHANGED');
  assert.equal(sha(previousArchive), input.previousArchiveSha256, 'PREVIOUS_ARCHIVE_CHANGED');
  assert.deepEqual(plan, { ...buildPlan(input, baseline), inputSha256: plan.inputSha256 }, 'PLAN_CHANGED');
  const before = assertBaseline(baseline), direction = rollback ? 'rollback' : 'update';
  const entry = journal[direction] ||= { phase: 'PREPARED' };
  assert.notEqual(entry.phase, 'DISPATCHING', 'UNKNOWN_OPERATION_REQUIRES_RECONCILIATION');
  assert(['PREPARED', 'ACCEPTED', 'VERIFIED'].includes(entry.phase), 'UNKNOWN_JOURNAL_PHASE');
  if (rollback) assert(journal.update?.phase === 'VERIFIED' && journal.update.after, 'OWNED_UPDATE_REQUIRED');
  if (rollback) {
    assertFunctionPreserved(before.resource, journal.update.after.resource, labelsFor(before.resource, input));
    assertRunPreserved(before.service, journal.update.after.service, labelsFor(before.resource, input));
    assert.equal(digest(journal.update.after.iam), digest(before.iam), 'OWNED_IAM_DRIFT');
  }
  const expectedBefore = rollback ? journal.update.after : before;
  const expectedLabels = rollback ? before.resource.labels || {} : labelsFor(before.resource, input);
  if (entry.phase === 'VERIFIED') {
    await assertFresh(io, entry.after, 'VERIFIED_STATE_DRIFT');
    assert.equal(sha(await io.readSource(previousSource(entry.after.resource))), rollback ? input.previousArchiveSha256 : input.archiveSha256, 'VERIFIED_SOURCE_DRIFT');
    return { state: rollback ? 'ROLLBACK_VERIFIED' : 'CONFIGURATION_VERIFIED', functionalVerification: 'PENDING', target: TARGET };
  }
  if (entry.phase === 'PREPARED') {
    await assertFresh(io, expectedBefore, rollback ? 'ROLLBACK_OWNED_STATE_DRIFT' : 'BASELINE_DRIFT');
    assert.equal(sha(await io.readSource(previousSource(expectedBefore.resource))), rollback ? input.archiveSha256 : input.previousArchiveSha256, 'LIVE_SOURCE_DRIFT');
    await noActiveOperations(io);
    const source = await uploaded(io, rollback ? previousArchive : archive, rollback ? input.previousArchiveSha256 : input.archiveSha256, journal, direction);
    await assertFresh(io, expectedBefore, 'PRE_PATCH_DRIFT');
    await noActiveOperations(io);
    // Persist before dispatch. An unknown outcome may never be blindly replayed.
    entry.phase = 'DISPATCHING'; journal.networkMutationStarted = true; io.persist(journal);
    const operation = await io.mutate(`${FUNCTION_URL}?updateMask=buildConfig.source,labels`, sourcePatch(before.resource, source, input, rollback), 'PATCH');
    assertOperationScope(operation);
    if (operation.metadata?.target !== undefined) assert.equal(operation.metadata.target, FUNCTION_NAME, 'OPERATION_TARGET');
    entry.phase = 'ACCEPTED'; entry.operation = operation.name; io.persist(journal);
  }
  assertOperationScope({ name: entry.operation });
  let operation;
  for (let attempt = 0; attempt < 120; attempt++) {
    operation = await io.read(`https://cloudfunctions.googleapis.com/v2/${entry.operation}`);
    assert.equal(operation.name, entry.operation, 'OPERATION_NAME_CHANGED');
    if (operation.metadata?.target !== undefined) assert.equal(operation.metadata.target, FUNCTION_NAME, 'OPERATION_TARGET');
    if (operation.done) break;
    await io.sleep(10000);
  }
  assert(operation?.done, 'OPERATION_TIMEOUT_RESUME_REQUIRED');
  assert(!operation.error, 'OPERATION_FAILED');
  assert(operation.response, 'OPERATION_RESPONSE_REQUIRED');
  const after = await snapshot(io);
  assertOperationMatchesGet(operation.response, after.resource);
  assertFunctionPreserved(before.resource, after.resource, expectedLabels);
  assertRunPreserved(before.service, after.service, expectedLabels);
  assert.equal(digest(after.iam), digest(before.iam), 'IAM_DRIFT');
  assert.equal(sha(await io.readSource(previousSource(after.resource))), rollback ? input.previousArchiveSha256 : input.archiveSha256, 'POSTFLIGHT_SOURCE_DRIFT');
  entry.phase = 'VERIFIED'; entry.after = after; io.persist(journal);
  return { state: rollback ? 'ROLLBACK_VERIFIED' : 'CONFIGURATION_VERIFIED', target: TARGET, functionalVerification: 'PENDING' };
}

export function loadLocal(inputFile) {
  const bytes = fs.readFileSync(privatePath(inputFile)), input = JSON.parse(bytes);
  validateInput(input); readProofs(input);
  const archive = readPinned(input.archive, ARCHIVE_SHA), previousArchive = readPinned(input.previousArchive, BASE_SHA);
  const baseline = JSON.parse(readPinned(input.baselineFile, input.baselineSha256));
  assert.equal(sha(fs.readFileSync(path.join(ROOT, 'qa/patches/d2-diagnostics-source.patch'))), PATCH_SHA, 'VERSIONED_PATCH_CHANGED');
  return { input, bytes, baseline, archive, previousArchive };
}
export function prepare(inputFile) {
  const context = loadLocal(inputFile);
  const plan = { ...buildPlan(context.input, context.baseline), inputSha256: sha(context.bytes) };
  const file = privatePath(path.join(path.dirname(inputFile), 'diagnostics-plan.json'));
  fs.writeFileSync(file, JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 });
  return { state: plan.state, planSha256: sha(fs.readFileSync(file)), inputSha256: plan.inputSha256, productionWrites: 0 };
}
function writeDurable(file, value) {
  const bytes = JSON.stringify(value), fd = fs.openSync(privatePath(file), 'w', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function readResumeState(lockFile, journalFile, inputSha256, planSha256) {
  const previousLock = JSON.parse(fs.readFileSync(privatePath(lockFile)));
  assert.equal(previousLock.kind, KIND);
  assert.equal(previousLock.inputSha256, inputSha256, 'LOCK_INPUT_MISMATCH');
  assert.equal(previousLock.planSha256, planSha256, 'LOCK_PLAN_MISMATCH');
  const journal = JSON.parse(fs.readFileSync(privatePath(journalFile)));
  assert.equal(journal.inputSha256, inputSha256, 'JOURNAL_INPUT_MISMATCH');
  assert.equal(journal.planSha256, planSha256, 'JOURNAL_PLAN_MISMATCH');
  assert.equal(journal.nonce, previousLock.nonce, 'JOURNAL_LOCK_IDENTITY');
  return { previousLock, journal };
}
export function networkIo(token, persist) {
  const request = async (url, method = 'GET', body) => {
    const parsed = new URL(url);
    assert(parsed.protocol === 'https:' && ['cloudfunctions.googleapis.com', 'run.googleapis.com'].includes(parsed.hostname), 'API_HOST');
    if (method !== 'GET') assert((method === 'POST' && url === `${BASE_URL}/functions:generateUploadUrl`) || (method === 'PATCH' && url === `${FUNCTION_URL}?updateMask=buildConfig.source,labels`), 'MUTATION_SCOPE');
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': 'pay-0-system' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert(response.ok, `API_HTTP_${response.status}`); return response.json();
  };
  return { persist, read: url => request(url), mutate: (url, body, method) => request(url, method, body), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    upload: async (url, bytes) => { const response = await fetch(url, { method: 'PUT', body: bytes, redirect: 'error', signal: AbortSignal.timeout(120000), headers: { 'Content-Type': 'application/zip' } }); assert(response.ok, 'UPLOAD_FAILED'); return response.headers.get('x-goog-generation'); },
    readSource: async source => { assertUploadSource(source); const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${source.bucket}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`, { redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${token}` } }); assert(response.ok, 'SOURCE_READ_FAILED'); return Buffer.from(await response.arrayBuffer()); } };
}
export async function execute(inputFile, args) {
  const context = loadLocal(inputFile), arg = key => args[args.indexOf(key) + 1];
  assert(args.includes('--execute') && args.includes('--input-sha256') && args.includes('--plan-sha256'), 'EXACT_APPROVAL_HASHES_REQUIRED');
  assert.equal(arg('--input-sha256'), sha(context.bytes), 'APPROVED_INPUT_CHANGED');
  const rollback = args.includes('--rollback');
  assert(args.includes(rollback ? '--approve-diagnostics-rollback' : '--approve-diagnostics-source-update'), 'EXPLICIT_APPROVAL_REQUIRED');
  const directory = path.dirname(path.resolve(inputFile)), planFile = privatePath(path.join(directory, 'diagnostics-plan.json'));
  const plan = JSON.parse(readPinned(planFile, arg('--plan-sha256')));
  assert.deepEqual(plan, { ...buildPlan(context.input, context.baseline), inputSha256: sha(context.bytes) }, 'APPROVED_PLAN_CHANGED');
  const activePath = privatePath(path.join(PRIVATE, 'active-executor.lock'));
  const lockPath = privatePath(path.join(PRIVATE, 'deployment.lock')), journalPath = privatePath(path.join(directory, 'diagnostics-journal.json'));
  const active = fs.openSync(activePath, 'wx', 0o600);
  const resume = args.includes('--resume');
  let lock, success = false, journal;
  try {
    fs.writeFileSync(active, JSON.stringify({ kind: KIND, ownerPid: process.pid })); fs.fsyncSync(active);
    if (resume) {
      const loaded = readResumeState(lockPath, journalPath, sha(context.bytes), arg('--plan-sha256'));
      const previousLock = loaded.previousLock;
      assert(Number.isInteger(previousLock.ownerPid), 'LOCK_OWNER_REQUIRED');
      let alive = true; try { process.kill(previousLock.ownerPid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      assert(!alive, 'PREVIOUS_OWNER_ALIVE'); lock = fs.openSync(lockPath, 'r+');
      journal = loaded.journal;
    } else lock = fs.openSync(lockPath, 'wx', 0o600);
    if (!resume) journal = rollback ? JSON.parse(fs.readFileSync(journalPath)) : { inputSha256: sha(context.bytes), planSha256: arg('--plan-sha256'), nonce: crypto.randomUUID() };
    assert.equal(journal.inputSha256, sha(context.bytes)); assert.equal(journal.planSha256, arg('--plan-sha256'));
    const persist = state => { writeDurable(journalPath, state); writeDurable(lockPath, { kind: KIND, ownerPid: process.pid, nonce: state.nonce, inputSha256: state.inputSha256, planSha256: state.planSha256 }); };
    persist(journal);
    const result = await runUpdate({ ...context, plan, journal, rollback, io: networkIo(tokenInMemory(), persist) });
    success = true; return result;
  } finally {
    if (lock !== undefined) { fs.closeSync(lock); if (mayReleaseLock(success, journal, resume)) fs.unlinkSync(lockPath); }
    fs.closeSync(active); fs.unlinkSync(activePath);
  }
}
export function mayReleaseLock(success, journal, resumed) {
  return success || (!resumed && journal !== undefined && journal.networkMutationStarted !== true);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const args = process.argv.slice(3); console.log(JSON.stringify(args.includes('--execute') ? await execute(process.argv[2], args) : prepare(process.argv[2]))); }
  catch (error) { console.error(String(error.message).split('\n')[0]); process.exitCode = 1; }
}
