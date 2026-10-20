// Future configuration executor. Local plan is the default; no implicit activation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { TARGETS, GATE, hashBytes, fingerprint, validateEvidence, planActivation, planEmergencyOff, planRollback } from './plan-supervised-learning-gates.mjs';
import { previousSource, assertOperationScope, assertOperationMatchesGet } from './deploy-scoped-functions.mjs';
import { tokenInMemory } from './capture-production-baseline.mjs';

const ROOT = path.resolve(import.meta.dirname, '..'), PRIVATE = path.join(ROOT, '.firebase/modular-release');
const BASE = 'https://cloudfunctions.googleapis.com/v2/projects/pay-0-system/locations/us-central1';
const KIND = 'D_GATE_EXECUTOR_V1';
const clone = value => structuredClone(value);
const same = (a, b, message) => assert.equal(fingerprint(a), fingerprint(b), message);
const url = name => { assert(TARGETS.includes(name), 'TARGET_SCOPE'); return `${BASE}/functions/${name}`; };
const pins = () => Object.fromEntries(['execute-supervised-learning-gates.mjs', 'plan-supervised-learning-gates.mjs', 'deploy-scoped-functions.mjs', 'capture-production-baseline.mjs'].map(name => [name, hashBytes(fs.readFileSync(path.join(import.meta.dirname, name)))]));

export function buildExecutionPlan(input) {
  assert.equal(input.kind, 'D_GATE_EXECUTION_INPUT_V1', 'INPUT_KIND');
  assert(['ACTIVATE', 'EMERGENCY_OFF', 'RESTORE_PREVIOUS'].includes(input.mode), 'EXPLICIT_MODE_REQUIRED');
  const proposed = input.mode === 'ACTIVATE' ? planActivation(input.evidence) : input.mode === 'EMERGENCY_OFF' ? planEmergencyOff(input.evidence) : planRollback(input.evidence, input.rollbackContext);
  if (input.recovery) loadRecovery(input);
  return { ...proposed, controllerPins: pins(), runtimePrerequisites: { chatPromptVersion: 'hugo-v2', selection: 'FIXED_IN_REVIEWED_CHAT_CALLABLE_SOURCE', environmentFlag: null } };
}

function functionComparable(resource) {
  const value = clone(resource);
  for (const key of ['updateTime', 'stateMessages']) delete value[key];
  delete value.serviceConfig.revision;
  return value;
}
function runComparable(service) {
  const value = clone(service), latest = value.latestReadyRevision;
  for (const key of ['generation', 'observedGeneration', 'updateTime', 'etag', 'latestCreatedRevision', 'latestReadyRevision']) delete value[key];
  if (value.template) delete value.template.revision;
  if (value.terminalCondition) delete value.terminalCondition.lastTransitionTime;
  for (const condition of value.conditions || []) delete condition.lastTransitionTime;
  for (const traffic of value.trafficStatuses || []) if (traffic.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST') {
    assert(latest && [latest, latest.split('/').at(-1)].includes(traffic.revision), 'RUN_TRAFFIC_REVISION'); delete traffic.revision;
  }
  for (const container of value.template?.containers || []) if (container.env) container.env.sort((a, b) => a.name.localeCompare(b.name));
  return value;
}
/** All source/build/IAM/labels/network fields remain exact; only generated revisions and runtime gate differ. */
export function assertGatePreserved(before, after, nextEnvironment) {
  assert.equal(after.resource.state, 'ACTIVE', 'FUNCTION_NOT_ACTIVE');
  assert.equal(after.service.terminalCondition?.state, 'CONDITION_SUCCEEDED', 'RUN_NOT_READY');
  if (fingerprint(before.resource.serviceConfig.environmentVariables || {}) !== fingerprint(nextEnvironment)) assert.notEqual(after.resource.serviceConfig.revision, before.resource.serviceConfig.revision, 'NEW_FUNCTION_REVISION_REQUIRED');
  assert.match(String(after.service.generation || ''), /^[1-9][0-9]*$/, 'RUN_GENERATION_REQUIRED');
  assert.equal(String(after.service.observedGeneration), String(after.service.generation), 'RUN_NOT_OBSERVED');
  const revision = after.resource.serviceConfig.revision;
  assert(typeof revision === 'string' && revision.length > 0, 'FUNCTION_REVISION_REQUIRED');
  const sameRevision = value => typeof value === 'string' && value.split('/').at(-1) === revision.split('/').at(-1);
  assert(sameRevision(after.service.latestCreatedRevision) && sameRevision(after.service.latestReadyRevision) && sameRevision(after.service.template?.revision), 'RUN_REVISION_NOT_EFFECTIVE');
  const traffic = after.service.trafficStatuses;
  assert(Array.isArray(traffic) && traffic.length > 0 && traffic.every(row => Number.isInteger(row.percent) && row.percent >= 0 && sameRevision(row.revision)) && traffic.reduce((sum, row) => sum + row.percent, 0) === 100, 'RUN_TRAFFIC_NOT_EFFECTIVE');
  const expectedResource = clone(before.resource); expectedResource.serviceConfig.environmentVariables = clone(nextEnvironment);
  same(functionComparable(after.resource), functionComparable(expectedResource), 'NON_GATE_FUNCTION_DRIFT');
  same(after.iam, before.iam, 'IAM_DRIFT');
  same(previousSource(after.resource), previousSource(before.resource), 'SOURCE_GENERATION_DRIFT');
  const expectedRun = clone(before.service), container = expectedRun.template.containers[0];
  container.env = (container.env || []).filter(row => row.name !== GATE);
  if (Object.hasOwn(nextEnvironment, GATE)) container.env.push({ name: GATE, value: nextEnvironment[GATE] });
  same(runComparable(after.service), runComparable(expectedRun), 'NON_GATE_RUN_DRIFT');
}

async function readFresh(io, expected, artifacts) {
  const operations = await io.listOperations();
  assert(!operations.nextPageToken, 'OPERATIONS_PAGINATION_REQUIRES_RECONCILIATION');
  assert(!(operations.operations || []).some(row => !row.done), 'ACTIVE_OPERATION');
  for (const name of TARGETS) {
    const current = await io.snapshot(name); same(current, expected[name], 'FRESH_BASELINE_DRIFT');
    assertGatePreserved(current, current, current.resource.serviceConfig.environmentVariables || {});
    assert.equal(hashBytes(await io.readSource(previousSource(current.resource))), artifacts[name].archiveSha256, 'LIVE_SOURCE_BYTES_DRIFT');
  }
}
function operationIdentity(operation, target) {
  assertOperationScope(operation);
  assert.equal(operation.metadata?.target, `projects/pay-0-system/locations/us-central1/functions/${target}`, 'OPERATION_TARGET');
}
export function assertResumeJournal(input, plan, journal) {
  assert.match(journal.nonce || '', /^[a-f0-9-]{36}$/, 'JOURNAL_NONCE');
  assert(Array.isArray(journal.steps) && journal.steps.length <= plan.actions.length, 'JOURNAL_STEPS');
  const expected = clone(validateEvidence(input.evidence).baseline.functions);
  for (const [index, entry] of journal.steps.entries()) {
    const action = plan.actions[index]; assert.equal(entry.target, action.target, 'JOURNAL_TARGET');
    assert(['ACCEPTED', 'VERIFIED'].includes(entry.phase), entry.phase === 'DISPATCHING' ? 'UNKNOWN_PATCH_OUTCOME_REQUIRES_RECONCILIATION' : 'JOURNAL_PHASE_REQUIRES_APPROVED_RECOVERY');
    if (entry.phase === 'ACCEPTED') {
      assert.equal(index, journal.steps.length - 1, 'NON_PREFIX_JOURNAL'); assert.equal(journal.networkMutationStarted, true, 'MUTATION_MARK_REQUIRED'); assertOperationScope({ name: entry.operation });
    } else {
      if (!entry.noChange) assert.equal(journal.networkMutationStarted, true, 'MUTATION_MARK_REQUIRED');
      assertGatePreserved(expected[entry.target], entry.after, action.nextEnvironment); expected[entry.target] = clone(entry.after);
    }
  }
}

/** IO is injectable; persistDurable must finish and fsync before returning. No PATCH retry exists. */
export async function runGateExecution({ input, plan, inputSha256, journal, io }) {
  same(plan, { ...buildExecutionPlan(input), inputSha256 }, 'PLAN_CHANGED');
  const planSha256 = hashBytes(JSON.stringify(plan));
  assert.equal(journal.inputSha256, inputSha256, 'JOURNAL_INPUT'); assert.equal(journal.planSha256, planSha256, 'JOURNAL_PLAN');
  assert.match(journal.nonce || '', /^[a-f0-9-]{36}$/, 'JOURNAL_NONCE');
  assertResumeJournal(input, plan, journal);
  assert(Array.isArray(journal.steps) && journal.steps.length <= plan.actions.length, 'JOURNAL_STEPS');
  const { baseline, manifest } = validateEvidence(input.evidence), expected = clone(baseline.functions);
  const names = [];
  const ownedPrefix = () => input.mode === 'ACTIVATE' ? { kind: 'VERIFIED_D_GATE_AFTER_V1', activationPlanSha256: hashBytes(JSON.stringify(planActivation(input.evidence))), appliedTargets: [...names], functions: clone(expected) } : undefined;
  for (let index = 0; index < plan.actions.length; index++) {
    const action = plan.actions[index]; url(action.target);
    let entry = journal.steps[index];
    if (entry) {
      assert.equal(entry.target, action.target, 'JOURNAL_TARGET');
      assert(['DISPATCHING', 'ACCEPTED', 'VERIFIED'].includes(entry.phase), 'JOURNAL_PHASE');
      assert.notEqual(entry.phase, 'DISPATCHING', 'UNKNOWN_PATCH_OUTCOME_REQUIRES_RECONCILIATION');
    }
    if (entry?.phase === 'VERIFIED') {
      assertGatePreserved(expected[action.target], entry.after, action.nextEnvironment);
      expected[action.target] = clone(entry.after); names.push(action.target); continue;
    }
    assert.equal(journal.steps.length, index + (entry ? 1 : 0), 'NON_PREFIX_JOURNAL');
    if (!entry) {
      await readFresh(io, expected, manifest.functions);
      if (!action.changeRequired) {
        entry = { target: action.target, phase: 'VERIFIED', after: clone(expected[action.target]), noChange: true };
        journal.steps.push(entry); await io.persistDurable(journal); names.push(action.target); continue;
      }
      entry = { target: action.target, phase: 'DISPATCHING' }; journal.steps.push(entry);
      journal.networkMutationStarted = true;
      await io.persistDurable(journal);
      // A final read narrows the external-writer window; this API flow does not provide atomic CAS.
      await readFresh(io, expected, manifest.functions);
      const operation = await io.patch(action.target, clone(action.body), action.updateMask);
      operationIdentity(operation, action.target);
      entry.phase = 'ACCEPTED'; entry.operation = operation.name;
      await io.persistDurable(journal);
    }
    operationIdentity({ name: entry.operation, metadata: { target: `projects/pay-0-system/locations/us-central1/functions/${action.target}` } }, action.target);
    let operation;
    for (let attempt = 0; attempt < 120; attempt++) {
      operation = await io.operation(entry.operation); assert.equal(operation.name, entry.operation, 'OPERATION_NAME_DRIFT'); operationIdentity(operation, action.target);
      if (operation.done) break;
      await io.sleep(10000);
    }
    assert(operation?.done, 'KNOWN_OPERATION_TIMEOUT_RESUME_REQUIRED');
    if (operation.error) {
      await readFresh(io, expected, manifest.functions);
      entry.phase = 'FAILED_VERIFIED'; entry.failedOperation = { name: operation.name, metadata: operation.metadata, done: true, error: { code: operation.error.code } };
      journal.status = 'PARTIAL_FAILURE_VERIFIED';
      if (input.mode === 'ACTIVATE') journal.ownedAfter = ownedPrefix();
      await io.persistDurable(journal);
      throw Error('KNOWN_OPERATION_FAILED_VERIFIED_PREFIX_REQUIRES_APPROVED_RECOVERY');
    }
    assert(operation.response, 'OPERATION_RESPONSE_REQUIRED');
    const after = await io.snapshot(action.target); assertOperationMatchesGet(operation.response, after.resource);
    assertGatePreserved(expected[action.target], after, action.nextEnvironment);
    assert.equal(hashBytes(await io.readSource(previousSource(after.resource))), manifest.functions[action.target].archiveSha256, 'POST_SOURCE_BYTES_DRIFT');
    entry.after = after; entry.phase = 'VERIFIED'; expected[action.target] = clone(after); names.push(action.target);
    if (input.mode === 'ACTIVATE') { await readFresh(io, expected, manifest.functions); journal.ownedAfter = ownedPrefix(); }
    await io.persistDurable(journal);
  }
  await readFresh(io, expected, manifest.functions);
  journal.status = 'CONFIGURATION_VERIFIED'; journal.appliedTargets = names; journal.after = expected;
  if (input.mode === 'ACTIVATE') journal.ownedAfter = ownedPrefix();
  await io.persistDurable(journal);
  return { state: journal.status, mode: input.mode, targets: names, functionalVerification: 'NOT_VERIFIED', sourcePreserved: true, iamPreserved: true };
}

export function privatePath(file) {
  const absolute = path.resolve(file); assert(absolute.startsWith(PRIVATE + path.sep), 'PRIVATE_PATH_REQUIRED');
  for (let current = absolute; current !== ROOT; current = path.dirname(current)) {
    assert(current.startsWith(ROOT + path.sep), 'PATH_SCOPE');
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'PATH_LINK');
  }
  return absolute;
}
export function durableWrite(file, value) {
  const target = privatePath(file), temporary = privatePath(`${target}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, target);
  let parent;
  try { parent = fs.openSync(path.dirname(target), 'r'); fs.fsyncSync(parent); }
  catch (error) { if (!(process.platform === 'win32' && ['EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EACCES'].includes(error.code))) throw error; }
  finally { if (parent !== undefined) fs.closeSync(parent); }
}
function readLocal(file, expected) {
  const bytes = fs.readFileSync(privatePath(file)); if (expected) assert.equal(hashBytes(bytes), expected, 'LOCAL_BYTES_CHANGED'); return bytes;
}
/** Explicit input-pinned handoff only after a known failed operation left a verified prefix. */
export function loadRecovery(input) {
  assert(['RESTORE_PREVIOUS', 'EMERGENCY_OFF'].includes(input.mode), 'RECOVERY_MODE');
  const recovery = input.recovery;
  assert(recovery && typeof recovery === 'object', 'RECOVERY_REQUIRED');
  for (const key of ['parentInputSha256', 'parentPlanSha256', 'parentJournalSha256']) assert.match(recovery[key] || '', /^[a-f0-9]{64}$/, 'RECOVERY_PIN_REQUIRED');
  const parentBytes = readLocal(recovery.parentInputFile, recovery.parentInputSha256), parent = JSON.parse(parentBytes);
  assert.equal(parent.mode, 'ACTIVATE', 'RECOVERY_PARENT_MODE'); assert(!parent.recovery, 'NESTED_RECOVERY_FORBIDDEN');
  const parentPlan = JSON.parse(readLocal(recovery.parentPlanFile, recovery.parentPlanSha256));
  same(parentPlan, { ...buildExecutionPlan(parent), inputSha256: hashBytes(parentBytes) }, 'RECOVERY_PARENT_PLAN_CHANGED');
  assert.equal(hashBytes(JSON.stringify(parentPlan)), recovery.parentPlanSha256, 'RECOVERY_PLAN_SERIALIZATION');
  const journal = JSON.parse(readLocal(recovery.parentJournalFile, recovery.parentJournalSha256));
  assert.equal(journal.inputSha256, recovery.parentInputSha256, 'RECOVERY_PARENT_INPUT'); assert.equal(journal.planSha256, recovery.parentPlanSha256, 'RECOVERY_PARENT_PLAN');
  assert(['PARTIAL_FAILURE_VERIFIED', 'CONFIGURATION_VERIFIED'].includes(journal.status), 'RECOVERY_REQUIRES_VERIFIED_OUTCOME');
  const original = validateEvidence(parent.evidence), current = validateEvidence(input.evidence);
  same(original.manifest, current.manifest, 'RECOVERY_ARTIFACTS_CHANGED');
  const expected = clone(original.baseline.functions), appliedTargets = [];
  assert(Array.isArray(journal.steps) && journal.steps.length <= parentPlan.actions.length, 'RECOVERY_STEPS');
  for (const [index, step] of journal.steps.entries()) {
    const action = parentPlan.actions[index]; assert.equal(step.target, action.target, 'RECOVERY_STEP_ORDER');
    if (step.phase === 'FAILED_VERIFIED') {
      assert.equal(index, journal.steps.length - 1, 'RECOVERY_FAILED_PREFIX');
      operationIdentity(step.failedOperation, step.target); assert(step.failedOperation.done && step.failedOperation.error, 'RECOVERY_KNOWN_FAILURE_REQUIRED');
    } else {
      assert.equal(step.phase, 'VERIFIED', 'RECOVERY_UNKNOWN_OUTCOME');
      assertGatePreserved(expected[step.target], step.after, action.nextEnvironment); expected[step.target] = clone(step.after); appliedTargets.push(step.target);
    }
  }
  const ownedAfter = { kind: 'VERIFIED_D_GATE_AFTER_V1', activationPlanSha256: hashBytes(JSON.stringify(planActivation(parent.evidence))), appliedTargets, functions: expected };
  same(journal.ownedAfter, ownedAfter, 'RECOVERY_OWNED_RECEIPT'); same(current.baseline.functions, expected, 'RECOVERY_CURRENT_STATE');
  if (input.mode === 'RESTORE_PREVIOUS') {
    same(input.rollbackContext.originalEvidence, parent.evidence, 'RECOVERY_ORIGINAL_EVIDENCE');
    same(JSON.parse(input.rollbackContext.ownedAfterBytes), ownedAfter, 'RECOVERY_RESTORE_RECEIPT');
  }
  return { recovery, journal };
}
export function loadInput(file) {
  const bytes = readLocal(file), input = JSON.parse(bytes), plan = { ...buildExecutionPlan(input), inputSha256: hashBytes(bytes) };
  return { input, bytes, plan };
}
export function prepare(file) {
  const { bytes, plan } = loadInput(file), destination = path.join(path.dirname(path.resolve(file)), 'gate-plan.json');
  assert(!fs.existsSync(privatePath(destination)), 'PLAN_ALREADY_EXISTS'); durableWrite(destination, plan);
  return { state: 'LOCAL_PLAN_ONLY_NOT_AUTHORIZATION', inputSha256: hashBytes(bytes), planSha256: hashBytes(JSON.stringify(plan)), networkCalls: 0 };
}
export function networkIo(persistDurable, provider = tokenInMemory) {
  let token;
  const request = async (endpoint, method = 'GET', body) => {
    if (!token) token = provider();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(endpoint, { method, redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': 'pay-0-system' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (method === 'GET' && response.status === 401 && !attempt) { token = provider(); continue; }
      assert(response.ok, `API_HTTP_${response.status}`); return response;
    }
  };
  return { persistDurable, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    snapshot: async name => { const resource = await (await request(url(name))).json(); assert.equal(resource.name, url(name).replace('https://cloudfunctions.googleapis.com/v2/', ''), 'FUNCTION_SCOPE');
      const service = `https://run.googleapis.com/v2/${resource.serviceConfig.service}`;
      assert.match(service, new RegExp(`^https://run.googleapis.com/v2/projects/(?:pay-0-system|751158244178)/locations/us-central1/services/${name.toLowerCase()}$`));
      return { resource, service: await (await request(service)).json(), iam: await (await request(service + ':getIamPolicy')).json() }; },
    listOperations: async () => (await request(`${BASE}/operations?pageSize=100&filter=done%3Dfalse`)).json(),
    readSource: async source => { previousSource({ buildConfig: { sourceProvenance: { resolvedStorageSource: source } } }); return Buffer.from(await (await request(`https://storage.googleapis.com/storage/v1/b/${source.bucket}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`)).arrayBuffer()); },
    patch: async (name, body, mask) => { assert.equal(mask, 'serviceConfig.environmentVariables'); assert.deepEqual(Object.keys(body).sort(), ['name', 'serviceConfig']); assert.deepEqual(Object.keys(body.serviceConfig), ['environmentVariables']); assert.equal(body.name, url(name).replace('https://cloudfunctions.googleapis.com/v2/', '')); return (await request(`${url(name)}?updateMask=serviceConfig.environmentVariables`, 'PATCH', body)).json(); },
    operation: async name => { assertOperationScope({ name }); return (await request(`https://cloudfunctions.googleapis.com/v2/${name}`)).json(); } };
}

export function readResume(lockFile, journalFile, inputSha256, planSha256) {
  const lock = JSON.parse(readLocal(lockFile)), journal = JSON.parse(readLocal(journalFile));
  assert.equal(lock.kind, KIND, 'LOCK_KIND');
  for (const row of [lock, journal]) { assert.equal(row.inputSha256, inputSha256, 'RESUME_INPUT'); assert.equal(row.planSha256, planSha256, 'RESUME_PLAN'); }
  assert.equal(lock.nonce, journal.nonce, 'RESUME_NONCE'); assert(Number.isInteger(lock.ownerPid) && lock.ownerPid > 0, 'OWNER_PID');
  assert.match(journal.nonce || '', /^[a-f0-9-]{36}$/, 'JOURNAL_NONCE');
  let alive = true; try { process.kill(lock.ownerPid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
  assert(!alive, 'PREVIOUS_OWNER_ALIVE'); return journal;
}
export async function execute(file, args) {
  const { input, bytes, plan: proposed } = loadInput(file), value = key => args[args.indexOf(key) + 1];
  assert(args.includes('--execute'), 'EXECUTE_REQUIRED');
  assert.equal(value('--input-sha256'), hashBytes(bytes), 'APPROVED_INPUT_CHANGED');
  const planFile = path.join(path.dirname(path.resolve(file)), 'gate-plan.json'), plan = JSON.parse(readLocal(planFile, value('--plan-sha256')));
  assert(args.includes('--plan-sha256') && args.includes('--input-sha256'), 'EXACT_HASHES_REQUIRED'); same(plan, proposed, 'APPROVED_PLAN_CHANGED');
  assert.equal(value('--plan-sha256'), hashBytes(JSON.stringify(plan)), 'PLAN_SERIALIZATION_CHANGED');
  assert.equal(value('--approve-gate-mode'), input.mode, 'SPECIFIC_MODE_APPROVAL_REQUIRED');
  if (input.recovery) assert(args.includes('--approve-owned-recovery'), 'SPECIFIC_RECOVERY_APPROVAL_REQUIRED');
  const planSha256 = hashBytes(JSON.stringify(plan)), inputSha256 = hashBytes(bytes), resumed = args.includes('--resume');
  return withExecutionLocks({ directory: path.dirname(path.resolve(file)), inputSha256, planSha256, resumed, recoveryInput: input.recovery ? input : undefined, validateBeforeOwnership: journal => assertResumeJournal(input, plan, journal) }, async (journal, persistDurable) =>
    runGateExecution({ input, plan, inputSha256, journal, io: networkIo(persistDurable) }));
}
/** Paths are injectable only for isolated filesystem QA; the CLI always uses shared production locks. */
export async function withExecutionLocks({ directory, inputSha256, planSha256, resumed = false,
  activeFile = path.join(PRIVATE, 'active-executor.lock'), lockFile = path.join(PRIVATE, 'deployment.lock'), recoveryInput, validateBeforeOwnership = () => {} }, run) {
  privatePath(activeFile); privatePath(lockFile);
  const journalFile = privatePath(path.join(directory, 'gate-journal.json'));
  const recovering = !!recoveryInput && !resumed;
  const parent = recovering ? loadRecovery(recoveryInput) : undefined;
  if (parent) {
    assert.notEqual(path.resolve(parent.recovery.parentJournalFile), journalFile, 'RECOVERY_NEW_JOURNAL_REQUIRED');
    readResume(lockFile, parent.recovery.parentJournalFile, parent.recovery.parentInputSha256, parent.recovery.parentPlanSha256);
  }
  let journal = resumed ? readResume(lockFile, journalFile, inputSha256, planSha256) : { inputSha256, planSha256, nonce: crypto.randomUUID(), steps: [], ...(parent ? { recoveryParentJournalSha256: parent.recovery.parentJournalSha256 } : {}) };
  validateBeforeOwnership(journal);
  if (!resumed) assert(!fs.existsSync(journalFile), 'EXISTING_JOURNAL_REQUIRES_RESUME');
  const active = fs.openSync(activeFile, 'wx', 0o600); let lockOwned = false, success = false;
  try {
    fs.writeFileSync(active, JSON.stringify({ kind: KIND, nonce: journal.nonce, ownerPid: process.pid })); fs.fsyncSync(active);
    if (parent) {
      loadRecovery(recoveryInput); readResume(lockFile, parent.recovery.parentJournalFile, parent.recovery.parentInputSha256, parent.recovery.parentPlanSha256);
    } else if (!resumed) { const fd = fs.openSync(lockFile, 'wx', 0o600); fs.closeSync(fd); }
    lockOwned = true;
    const persistDurable = state => { durableWrite(journalFile, state); durableWrite(lockFile, { kind: KIND, ownerPid: process.pid, nonce: state.nonce, inputSha256, planSha256 }); };
    persistDurable(journal);
    const result = await run(journal, persistDurable); success = true; return result;
  } finally {
    if (lockOwned && (success || (!resumed && !recovering && journal.networkMutationStarted !== true))) {
      try { const lock = JSON.parse(readLocal(lockFile)); if (lock.nonce === journal.nonce && lock.kind === KIND) fs.unlinkSync(lockFile); } catch { /* Preserve uncertain or damaged locks. */ }
    }
    fs.closeSync(active);
    const activeState = JSON.parse(readLocal(activeFile)); if (activeState.nonce === journal.nonce) fs.unlinkSync(activeFile);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const args = process.argv.slice(3); console.log(JSON.stringify(args.includes('--execute') ? await execute(process.argv[2], args) : prepare(process.argv[2]))); }
  catch (error) { console.error(String(error.message).split('\n')[0]); process.exitCode = 1; }
}
