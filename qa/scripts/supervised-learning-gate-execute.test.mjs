import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { TARGETS, GATE, hashBytes, fingerprint, planActivation } from '../../scripts/plan-supervised-learning-gates.mjs';
import { buildExecutionPlan, runGateExecution, assertGatePreserved, assertResumeJournal, withExecutionLocks, durableWrite, networkIo, execute, prepare } from '../../scripts/execute-supervised-learning-gates.mjs';

// These exact reviewed source bytes are local QA prerequisites, never downloaded here.
const root = path.resolve(import.meta.dirname, '../..');
const files = [process.env.PAY0_D_GATE_REVIEW_ARCHIVE || '.firebase/modular-release/d1-after-r14-revoke-off/d1-after-r14-revoke-off.zip',
  process.env.PAY0_D_GATE_CHAT_ARCHIVE || '.firebase/modular-release/d1-after-r15-candidate/d1-after-r15.zip'];
const archives = files.map(file => fs.readFileSync(path.resolve(root, file)));
const hashes = ['c9a64571acecff5303afc99e79e17411bf3f3fdbcdfb9f6561705b74bb55280d', '763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62'];
archives.forEach((bytes, i) => assert.equal(hashBytes(bytes), hashes[i], 'REVIEWED_LOCAL_ARCHIVE_REQUIRED'));
const copy = value => structuredClone(value), encode = value => JSON.stringify(value);
function fixture(gates = [undefined, 'false']) {
  const manifest = { schemaVersion: 1, functions: {} }, baseline = { project: 'pay-0-system', operations: [], functions: {} };
  for (const [index, name] of TARGETS.entries()) {
    manifest.functions[name] = { archiveSha256: hashes[index], role: index ? 'CHAT_D1_ON_R15' : 'REVIEW_REVOKE_OFF', sourceTree: null,
      ...(index ? { baseRelease: 'R15' } : {}), sourceIdentity: { baseArchiveSha256: index ? '45e8233d67051d3b61ec9b787474fcdd7dd020f3b391b421d25dfcf731fa9474' : 'c'.repeat(64), patchSha256: 'd'.repeat(64), patchCommit: 'e'.repeat(40) } };
    const env = { KEEP: 'synthetic', EMPTY: '', ...(gates[index] === undefined ? {} : { [GATE]: gates[index] }) };
    const service = `projects/pay-0-system/locations/us-central1/services/${name.toLowerCase()}`;
    baseline.functions[name] = { resource: { name: `projects/pay-0-system/locations/us-central1/functions/${name}`, state: 'ACTIVE', environment: 'GEN_2',
      buildConfig: { runtime: 'nodejs22', entryPoint: name, sourceProvenance: { resolvedStorageSource: { bucket: 'gcf-v2-sources-751158244178-us-central1', object: `${name}/function-source.zip`, generation: '90071992547409939' } } },
      serviceConfig: { service, environmentVariables: env, revision: 'old' } },
      service: { name: service, generation: '1', observedGeneration: '1', latestCreatedRevision: 'old', latestReadyRevision: 'old', trafficStatuses: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', revision: 'old', percent: 100 }], buildConfig: { functionTarget: name }, terminalCondition: { state: 'CONDITION_SUCCEEDED' }, template: { revision: 'old', containers: [{ image: 'immutable-image', env: Object.entries(env).map(([name, value]) => ({ name, value })) }] } },
      iam: { etag: 'synthetic', bindings: [] } };
  }
  return { manifest, baseline };
}
function evidence(f) {
  const manifestBytes = encode(f.manifest), baselineBytes = encode(f.baseline), manifestSha256 = hashBytes(manifestBytes), baselineSha256 = hashBytes(baselineBytes);
  const proof = { kind: 'CAPTURED_SOURCE_BYTES_V1', manifestSha256, baselineSha256, functions: {} };
  for (const name of TARGETS) { const row = f.baseline.functions[name]; proof.functions[name] = { target: name, status: 'READBACK_VERIFIED', source: row.resource.buildConfig.sourceProvenance.resolvedStorageSource,
    archiveSha256: f.manifest.functions[name].archiveSha256, bytesRead: archives[TARGETS.indexOf(name)].length, ...Object.fromEntries(['resource', 'service', 'iam'].map(key => [`${key}Sha256`, fingerprint(row[key])])) }; }
  const sourceProofBytes = encode(proof); return { manifestBytes, baselineBytes, manifestSha256, baselineSha256, sourceProofBytes, sourceProofSha256: hashBytes(sourceProofBytes) };
}
function harness(gates) {
  const f = fixture(gates), input = { kind: 'D_GATE_EXECUTION_INPUT_V1', mode: 'ACTIVATE', evidence: evidence(f) };
  const inputSha256 = hashBytes(encode(input)), plan = { ...buildExecutionPlan(input), inputSha256 };
  const journal = { inputSha256, planSha256: hashBytes(encode(plan)), nonce: crypto.randomUUID(), steps: [] }, current = copy(f.baseline.functions), events = [], operations = new Map();
  let patches = 0;
  const io = { persistDurable: async state => { events.push({ type: 'persist', state: copy(state) }); }, listOperations: async () => ({ operations: [] }),
    readSource: async source => archives[TARGETS.findIndex(name => source.object.startsWith(name + '/'))], snapshot: async name => copy(current[name]), sleep: async () => {},
    patch: async (name, body, mask) => {
      patches++; assert.equal(mask, 'serviceConfig.environmentVariables'); const last = events.at(-1); assert.equal(last.type, 'persist'); assert.equal(last.state.networkMutationStarted, true); assert.equal(last.state.steps.at(-1).phase, 'DISPATCHING');
      events.push({ type: 'patch', name }); const row = current[name], revision = `new-${patches}`; row.resource.serviceConfig.environmentVariables = copy(body.serviceConfig.environmentVariables); row.resource.serviceConfig.revision = revision; row.resource.updateTime = 'new';
      row.service.generation = row.service.observedGeneration = '2'; row.service.latestCreatedRevision = row.service.latestReadyRevision = row.service.template.revision = revision; row.service.trafficStatuses[0].revision = revision;
      row.service.template.containers[0].env = Object.entries(body.serviceConfig.environmentVariables).map(([name, value]) => ({ name, value }));
      const operation = { name: `projects/pay-0-system/locations/us-central1/operations/operation-${patches}`, metadata: { target: row.resource.name }, done: true, response: copy(row.resource) };
      operations.set(operation.name, operation); return copy(operation);
    }, operation: async name => copy(operations.get(name)) };
  return { input, inputSha256, plan, journal, io, current, events, operations, patches: () => patches };
}
const run = h => runGateExecution(h);
test('configuration-only activation preserves source, IAM and environment and persists before every PATCH', async () => {
  const h = harness(); assert.equal((await run(h)).state, 'CONFIGURATION_VERIFIED'); assert.equal(h.patches(), 2);
  assert.deepEqual(h.events.filter(e => e.type === 'patch').map(e => e.name), TARGETS); assert.deepEqual(h.journal.appliedTargets, TARGETS);
  assert.equal(h.current[TARGETS[0]].resource.serviceConfig.environmentVariables.KEEP, 'synthetic'); assert.equal(h.journal.ownedAfter.kind, 'VERIFIED_D_GATE_AFTER_V1');
});
test('already enabled targets are verified and journalled without PATCH', async () => {
  const h = harness(['true', 'true']); await run(h); assert.equal(h.patches(), 0); assert(h.journal.steps.every(step => step.noChange));
});
test('persistence failure before dispatch performs zero PATCH', async () => {
  const h = harness(); h.io.persistDurable = async () => { throw Error('DURABLE_WRITE_FAILED'); }; await assert.rejects(run(h), /DURABLE_WRITE_FAILED/); assert.equal(h.patches(), 0);
});
test('unknown PATCH result is never replayed even when a retry has valid original evidence', async () => {
  const h = harness(); let count = 0; h.io.patch = async () => { count++; throw Error('UNKNOWN_401_OR_DISCONNECT'); };
  await assert.rejects(run(h), /UNKNOWN_401/); await assert.rejects(run(h), /UNKNOWN_PATCH_OUTCOME/); assert.equal(count, 1);
});
test('known operation resumes by GET and never repeats its PATCH', async () => {
  const h = harness(), operation = h.io.operation; h.io.operation = async () => { throw Error('POLL_INTERRUPTED'); };
  await assert.rejects(run(h), /POLL_INTERRUPTED/); assert.equal(h.patches(), 1); assert.equal(h.journal.steps[0].phase, 'ACCEPTED');
  h.io.operation = operation; await run(h); assert.equal(h.patches(), 2); assert.equal(h.events.filter(e => e.type === 'patch' && e.name === TARGETS[0]).length, 1);
});
test('preflight rejects source bytes, generation, IAM, configuration and active operations without PATCH', async () => {
  for (const mutate of [h => h.io.readSource = async () => Buffer.from('wrong'), h => h.current[TARGETS[0]].resource.buildConfig.sourceProvenance.resolvedStorageSource.generation = '123',
    h => h.current[TARGETS[1]].iam.etag = 'drift', h => h.current[TARGETS[1]].resource.serviceConfig.extra = 'drift', h => h.io.listOperations = async () => ({ operations: [{ done: false }] }),
    h => h.io.listOperations = async () => ({ nextPageToken: 'unknown' })]) { const h = harness(); mutate(h); await assert.rejects(run(h)); assert.equal(h.patches(), 0); }
});
test('postflight rejects non-gate env, image, source or IAM drift and retains accepted operation', async () => {
  for (const mutate of [row => row.service.template.containers[0].image = 'other', row => row.iam.etag = 'other', row => row.service.template.containers[0].env.push({ name: 'FOREIGN', value: 'other' }), row => row.resource.buildConfig.sourceProvenance.resolvedStorageSource.generation = '123']) {
    const h = harness(), patch = h.io.patch; h.io.patch = async (...args) => { const result = await patch(...args); mutate(h.current[args[0]]); return { ...result, response: copy(h.current[args[0]].resource) }; };
    await assert.rejects(run(h)); assert.equal(h.patches(), 1); assert.equal(h.journal.steps[0].phase, 'ACCEPTED');
  }
});
test('foreign operation target and tampered journal or plan cannot be resumed', async () => {
  const h = harness(), patch = h.io.patch; h.io.patch = async (...args) => ({ ...await patch(...args), metadata: { target: 'projects/pay-0-system/locations/us-central1/functions/other' } });
  await assert.rejects(run(h), /OPERATION_TARGET/); assert.equal(h.journal.steps[0].phase, 'DISPATCHING');
  const j = harness(); j.plan.actions[0].body.serviceConfig.environmentVariables.KEEP = 'other'; await assert.rejects(run(j), /PLAN_CHANGED/); assert.equal(j.patches(), 0);
});
test('emergency OFF uses reverse order and restore previous uses original absence, not false', async () => {
  const original = harness(); await run(original); const f = fixture(); f.baseline.functions = copy(original.current);
  const afterEvidence = evidence(f), pureActivation = planActivation(original.input.evidence);
  const activationPlanBytes = encode(pureActivation), ownedAfterBytes = encode(original.journal.ownedAfter);
  for (const mode of ['EMERGENCY_OFF', 'RESTORE_PREVIOUS']) {
    const h = harness(); h.current = copy(original.current); h.io.snapshot = async name => copy(h.current[name]);
    h.input = { kind: 'D_GATE_EXECUTION_INPUT_V1', mode, evidence: afterEvidence, ...(mode === 'RESTORE_PREVIOUS' ? { rollbackContext: { originalEvidence: original.input.evidence, activationPlanBytes, activationPlanSha256: hashBytes(activationPlanBytes), ownedAfterBytes, ownedAfterSha256: hashBytes(ownedAfterBytes) } } : {}) };
    h.inputSha256 = hashBytes(encode(h.input)); h.plan = { ...buildExecutionPlan(h.input), inputSha256: h.inputSha256 }; h.journal = { inputSha256: h.inputSha256, planSha256: hashBytes(encode(h.plan)), nonce: crypto.randomUUID(), steps: [] };
    // patch adapter's state is the original harness closure; mirror the verified after snapshot there.
    const originalPatch = h.io.patch; h.io.patch = async (...args) => { const op = await originalPatch(...args); const row = h.current[args[0]]; row.resource.serviceConfig.environmentVariables = copy(args[1].serviceConfig.environmentVariables); row.resource.serviceConfig.revision = 'new'; row.resource.updateTime = 'new'; row.service.generation = row.service.observedGeneration = '2'; row.service.latestCreatedRevision = row.service.latestReadyRevision = row.service.template.revision = 'new'; row.service.trafficStatuses[0].revision = 'new'; row.service.template.containers[0].env = Object.entries(args[1].serviceConfig.environmentVariables).map(([name, value]) => ({ name, value })); op.response = copy(row.resource); h.operations.set(op.name, op); return op; };
    await run(h); assert.deepEqual(h.events.filter(e => e.type === 'patch').map(e => e.name), [...TARGETS].reverse());
    assert.equal(Object.hasOwn(h.current[TARGETS[0]].resource.serviceConfig.environmentVariables, GATE), mode === 'EMERGENCY_OFF');
  }
});
test('filesystem locks preserve corrupt or foreign resume records byte for byte', async () => {
  const directory = path.join(root, '.firebase/modular-release', `gate-qa-${crypto.randomUUID()}`); fs.mkdirSync(directory);
  const activeFile = path.join(directory, 'active.lock'), lockFile = path.join(directory, 'deployment.lock'), journal = path.join(directory, 'gate-journal.json');
  const lock = '{"kind":"other"}', bad = '{broken'; fs.writeFileSync(lockFile, lock); fs.writeFileSync(journal, bad);
  try { await assert.rejects(withExecutionLocks({ directory, activeFile, lockFile, inputSha256: 'a', planSha256: 'b', resumed: true }, () => assert.fail('NO_RUN'))); assert.equal(fs.readFileSync(lockFile, 'utf8'), lock); assert.equal(fs.readFileSync(journal, 'utf8'), bad); assert(!fs.existsSync(activeFile)); }
  finally { for (const file of [lockFile, journal]) fs.unlinkSync(file); fs.rmdirSync(directory); }
});
test('durable journal is written before IO and uncertain failed executions retain their owned lock', async () => {
  const directory = path.join(root, '.firebase/modular-release', `gate-qa-${crypto.randomUUID()}`); fs.mkdirSync(directory);
  const activeFile = path.join(directory, 'active.lock'), lockFile = path.join(directory, 'deployment.lock');
  try { await assert.rejects(withExecutionLocks({ directory, activeFile, lockFile, inputSha256: 'a', planSha256: 'b' }, async (journal, persist) => { assert(fs.existsSync(lockFile)); journal.networkMutationStarted = true; persist(journal); assert(JSON.parse(fs.readFileSync(path.join(directory, 'gate-journal.json'))).networkMutationStarted); throw Error('UNKNOWN'); }), /UNKNOWN/); assert(fs.existsSync(lockFile)); assert(!fs.existsSync(activeFile)); }
  finally { for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file)); fs.rmdirSync(directory); }
});
test('GET 401 refreshes credentials but PATCH 401 never retries', async () => {
  const previous = global.fetch; let reads = 0, patches = 0, tokens = 0;
  global.fetch = async (_url, options) => { if (options.method === 'PATCH') { patches++; return new Response('{}', { status: 401 }); } reads++; return new Response(encode({ operations: [] }), { status: reads === 1 ? 401 : 200 }); };
  try { const io = networkIo(() => {}, () => { tokens++; return 'synthetic-token'; }); await io.listOperations(); assert.equal(reads, 2); assert.equal(tokens, 2); const name = TARGETS[0]; await assert.rejects(io.patch(name, { name: `projects/pay-0-system/locations/us-central1/functions/${name}`, serviceConfig: { environmentVariables: { [GATE]: 'true' } } }, 'serviceConfig.environmentVariables'), /API_HTTP_401/); assert.equal(patches, 1); }
  finally { global.fetch = previous; }
});
test('unobserved, old or split-traffic revisions never pass postflight', async () => {
  for (const mutate of [row => row.service.observedGeneration = '1', row => row.service.latestReadyRevision = 'old', row => row.service.template.revision = 'old',
    row => row.service.trafficStatuses[0].revision = 'old', row => row.service.trafficStatuses[0].percent = 90]) {
    const h = harness(), patch = h.io.patch; h.io.patch = async (...args) => { const result = await patch(...args); mutate(h.current[args[0]]); return result; };
    await assert.rejects(run(h)); assert.equal(h.journal.steps[0].phase, 'ACCEPTED'); assert.equal(h.patches(), 1);
  }
});
async function knownPartial(failedIndex = 1) {
  const h = harness(), patch = h.io.patch;
  h.io.patch = async (...args) => {
    if (args[0] !== TARGETS[failedIndex]) return patch(...args);
    const op = { name: 'projects/pay-0-system/locations/us-central1/operations/known-failure', metadata: { target: `projects/pay-0-system/locations/us-central1/functions/${args[0]}` }, done: true, error: { code: 9 } };
    h.operations.set(op.name, op); return op;
  };
  await assert.rejects(run(h), /KNOWN_OPERATION_FAILED_VERIFIED_PREFIX/);
  h.io.patch = patch; return h;
}
function restoration(h) {
  const f = fixture(); f.baseline.functions = copy(h.current);
  const activationPlanBytes = encode(planActivation(h.input.evidence)), ownedAfterBytes = encode(h.journal.ownedAfter);
  return { kind: 'D_GATE_EXECUTION_INPUT_V1', mode: 'RESTORE_PREVIOUS', evidence: evidence(f), rollbackContext: { originalEvidence: h.input.evidence,
    activationPlanBytes, activationPlanSha256: hashBytes(activationPlanBytes), ownedAfterBytes, ownedAfterSha256: hashBytes(ownedAfterBytes) } };
}
test('known second-target failure produces a verified prefix and a one-target original-evidence rollback', async () => {
  const h = await knownPartial(); assert.deepEqual(h.journal.ownedAfter.appliedTargets, [TARGETS[0]]); assert.equal(h.journal.steps[1].phase, 'FAILED_VERIFIED');
  const input = restoration(h), inputSha256 = hashBytes(encode(input)), plan = { ...buildExecutionPlan(input), inputSha256 };
  assert.deepEqual(plan.actions.map(action => action.target), [TARGETS[0]]);
  const journal = { inputSha256, planSha256: hashBytes(encode(plan)), nonce: crypto.randomUUID(), steps: [] };
  await runGateExecution({ input, plan, inputSha256, journal, io: h.io }); assert.equal(Object.hasOwn(h.current[TARGETS[0]].resource.serviceConfig.environmentVariables, GATE), false);
});
test('explicit pinned recovery transfers the retained lock without deleting or rewriting its original journal', async () => {
  const h = await knownPartial(), directory = path.join(root, '.firebase/modular-release', `gate-qa-${crypto.randomUUID()}`), next = path.join(directory, 'recovery'); fs.mkdirSync(next, { recursive: true });
  const inputFile = path.join(directory, 'input.json'), planFile = path.join(directory, 'gate-plan.json'), journalFile = path.join(directory, 'gate-journal.json');
  const lockFile = path.join(directory, 'deployment.lock'), activeFile = path.join(directory, 'active.lock');
  for (const [file, value] of [[inputFile, h.input], [planFile, h.plan], [journalFile, h.journal]]) durableWrite(file, value);
  durableWrite(lockFile, { kind: 'D_GATE_EXECUTOR_V1', ownerPid: 2147483647, nonce: h.journal.nonce, inputSha256: h.inputSha256, planSha256: h.journal.planSha256 });
  const originalBytes = fs.readFileSync(journalFile), input = restoration(h);
  input.recovery = { parentInputFile: inputFile, parentInputSha256: hashBytes(fs.readFileSync(inputFile)), parentPlanFile: planFile, parentPlanSha256: hashBytes(fs.readFileSync(planFile)), parentJournalFile: journalFile, parentJournalSha256: hashBytes(originalBytes) };
  const inputSha256 = hashBytes(encode(input)), plan = { ...buildExecutionPlan(input), inputSha256 }, planSha256 = hashBytes(encode(plan));
  try {
    await withExecutionLocks({ directory: next, activeFile, lockFile, inputSha256, planSha256, recoveryInput: input }, async (journal, persist) => {
      const io = { ...h.io, persistDurable: async state => { h.events.push({ type: 'persist', state: copy(state) }); persist(state); } };
      return runGateExecution({ input, plan, inputSha256, journal, io });
    });
    assert.deepEqual(fs.readFileSync(journalFile), originalBytes); assert(!fs.existsSync(lockFile)); assert(!fs.existsSync(activeFile));
  } finally { for (const file of fs.readdirSync(next)) fs.unlinkSync(path.join(next, file)); fs.rmdirSync(next); for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file)); fs.rmdirSync(directory); }
});
test('CLI rejects missing mode authorization and altered hashes locally before any network access', async () => {
  const h = harness(), directory = path.join(root, '.firebase/modular-release', `gate-qa-${crypto.randomUUID()}`); fs.mkdirSync(directory);
  const file = path.join(directory, 'input.json'); durableWrite(file, h.input); durableWrite(path.join(directory, 'gate-plan.json'), h.plan); const previous = global.fetch;
  global.fetch = async () => assert.fail('NO_NETWORK');
  try { await assert.rejects(execute(file, ['--execute', '--input-sha256', h.inputSha256, '--plan-sha256', h.journal.planSha256]), /SPECIFIC_MODE_APPROVAL/); await assert.rejects(execute(file, ['--execute', '--input-sha256', 'a'.repeat(64)]), /APPROVED_INPUT_CHANGED/); }
  finally { global.fetch = previous; for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); }
});
test('reviewed chat source hardcodes the actual V2 predicate without an invented environment flag', async () => {
  const JSZip = createRequire(path.join(root, 'functions/package.json'))('jszip'), zip = await JSZip.loadAsync(archives[1]);
  assert.match(await zip.file('lib/modules/agent007/callables.js').async('string'), /promptVersion: "hugo-v2"/);
  assert.match(await zip.file('lib/modules/agent007/hugoCore/conversationCore.js').async('string'), /input\.promptVersion === "hugo-v2"/);
  const h = harness(); assert.equal(h.plan.runtimePrerequisites.chatPromptVersion, 'hugo-v2'); assert.equal(h.plan.runtimePrerequisites.environmentFlag, null);
});
test('a final read detects drift introduced during durable marking and prevents PATCH', async () => {
  const h = harness(), persist = h.io.persistDurable;
  h.io.persistDurable = async state => { await persist(state); if (state.steps.at(-1)?.phase === 'DISPATCHING') h.current[TARGETS[0]].resource.serviceConfig.environmentVariables.KEEP = 'external-writer'; };
  await assert.rejects(run(h), /FRESH_BASELINE_DRIFT/); assert.equal(h.patches(), 0); assert.equal(h.journal.networkMutationStarted, true);
});
test('known first-target failure yields an empty owned prefix and no rollback PATCH', async () => {
  const h = await knownPartial(0); assert.deepEqual(h.journal.ownedAfter.appliedTargets, []);
  const input = restoration(h), inputSha256 = hashBytes(encode(input)), plan = { ...buildExecutionPlan(input), inputSha256 };
  assert.deepEqual(plan.actions, []); const journal = { inputSha256, planSha256: hashBytes(encode(plan)), nonce: crypto.randomUUID(), steps: [] };
  await runGateExecution({ input, inputSha256, plan, journal, io: h.io }); assert.equal(h.patches(), 0);
});
test('malformed or uncertain resume journals are rejected before lock ownership or bytes change', async () => {
  const h = harness(), directory = path.join(root, '.firebase/modular-release', `gate-qa-${crypto.randomUUID()}`); fs.mkdirSync(directory);
  const lockFile = path.join(directory, 'deployment.lock'), activeFile = path.join(directory, 'active.lock'), journalFile = path.join(directory, 'gate-journal.json');
  try {
    for (const phase of ['DISPATCHING', 'ACCEPTED']) {
      const journal = { ...h.journal, networkMutationStarted: true, steps: [{ target: TARGETS[0], phase }] };
      durableWrite(lockFile, { kind: 'D_GATE_EXECUTOR_V1', ownerPid: 2147483647, nonce: journal.nonce, inputSha256: h.inputSha256, planSha256: journal.planSha256 }); durableWrite(journalFile, journal);
      const before = [fs.readFileSync(lockFile), fs.readFileSync(journalFile)];
      await assert.rejects(withExecutionLocks({ directory, activeFile, lockFile, inputSha256: h.inputSha256, planSha256: journal.planSha256, resumed: true, validateBeforeOwnership: value => assertResumeJournal(h.input, h.plan, value) }, () => assert.fail('NO_RUN')));
      assert.deepEqual(fs.readFileSync(lockFile), before[0]); assert.deepEqual(fs.readFileSync(journalFile), before[1]); assert(!fs.existsSync(activeFile));
    }
  } finally { for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); }
});
test('default local preparation writes only a private plan and never touches credentials or network', () => {
  const h = harness(), directory = path.join(root, '.firebase/modular-release', `gate-qa-${crypto.randomUUID()}`); fs.mkdirSync(directory); const file = path.join(directory, 'input.json'); durableWrite(file, h.input);
  const previous = global.fetch; global.fetch = async () => assert.fail('NO_NETWORK');
  try { const result = prepare(file); assert.equal(result.networkCalls, 0); assert.equal(result.state, 'LOCAL_PLAN_ONLY_NOT_AUTHORIZATION'); assert.equal(hashBytes(fs.readFileSync(path.join(directory, 'gate-plan.json'))), result.planSha256); }
  finally { global.fetch = previous; for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); }
});
