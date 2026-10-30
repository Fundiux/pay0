import test from 'node:test';
import assert from 'node:assert/strict';
import { TARGETS, GATE, hashBytes, fingerprint, planActivation, planEmergencyOff, planRollback } from '../../scripts/plan-supervised-learning-gates.mjs';
const REVIEW = 'c9a64571acecff5303afc99e79e17411bf3f3fdbcdfb9f6561705b74bb55280d';
const copy = value => structuredClone(value), encode = value => JSON.stringify(value);
function fixture(gates = [undefined, 'false']) {
  const manifest = { schemaVersion: 1, functions: {} }, baseline = { project: 'pay-0-system', operations: [], functions: {} };
  for (const [index, name] of TARGETS.entries()) {
    manifest.functions[name] = { archiveSha256: index ? '763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62' : REVIEW, role: index ? 'CHAT_D1_ON_R15' : 'REVIEW_REVOKE_OFF', sourceTree: null,
      ...(index ? { baseRelease: 'R15' } : {}), sourceIdentity: { baseArchiveSha256: index ? '45e8233d67051d3b61ec9b787474fcdd7dd020f3b391b421d25dfcf731fa9474' : 'c'.repeat(64), patchSha256: 'd'.repeat(64), patchCommit: 'e'.repeat(40) } };
    const env = { PRESERVE: 'synthetic-existing-value', EMPTY_VALUE: '', ...(gates[index] === undefined ? {} : { [GATE]: gates[index] }) };
    const service = `projects/pay-0-system/locations/us-central1/services/${name.toLowerCase()}`;
    baseline.functions[name] = {
      resource: { name: `projects/pay-0-system/locations/us-central1/functions/${name}`, state: 'ACTIVE', environment: 'GEN_2', labels: { keep: 'unchanged' },
        buildConfig: { runtime: 'nodejs22', entryPoint: name, environmentVariables: { KEEP_BUILD: 'unchanged' }, sourceProvenance: { resolvedStorageSource: { bucket: 'gcf-v2-sources-751158244178-us-central1', object: `${name}/function-source.zip`, generation: '90071992547409931' } } },
        serviceConfig: { service, environmentVariables: env, timeoutSeconds: 30, serviceAccountEmail: 'existing@example.invalid' } },
      service: { name: service, buildConfig: { functionTarget: name }, terminalCondition: { state: 'CONDITION_SUCCEEDED' }, template: { containers: [{ env: Object.entries(env).map(([name, value]) => ({ name, value })) }] } },
      iam: { etag: 'private-synthetic-etag', bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] },
    };
  }
  return { manifest, baseline };
}
function evidence(f) {
  const manifestBytes = encode(f.manifest), baselineBytes = encode(f.baseline);
  const manifestSha256 = hashBytes(manifestBytes), baselineSha256 = hashBytes(baselineBytes);
  const sourceProof = { kind: 'CAPTURED_SOURCE_BYTES_V1', manifestSha256, baselineSha256, functions: {} };
  for (const name of TARGETS) { const row = f.baseline.functions[name]; sourceProof.functions[name] = { target: name, status: 'READBACK_VERIFIED', source: row.resource.buildConfig.sourceProvenance.resolvedStorageSource,
    archiveSha256: f.manifest.functions[name].archiveSha256, bytesRead: 100, ...Object.fromEntries(['resource', 'service', 'iam'].map(key => [`${key}Sha256`, fingerprint(row[key])])) }; }
  const sourceProofBytes = encode(sourceProof);
  return { manifestBytes, manifestSha256, baselineBytes, baselineSha256, sourceProofBytes, sourceProofSha256: hashBytes(sourceProofBytes) };
}
function changeProof(e, mutate) { const p = JSON.parse(e.sourceProofBytes); mutate(p); e.sourceProofBytes = encode(p); e.sourceProofSha256 = hashBytes(e.sourceProofBytes); }
function after(f, activation, appliedTargets = [...TARGETS]) {
  const next = copy(f);
  for (const a of activation.actions) {
    if (!appliedTargets.includes(a.target)) continue;
    const row = next.baseline.functions[a.target]; row.resource.serviceConfig.environmentVariables = copy(a.nextEnvironment);
    row.resource.serviceConfig.revision = 'new-owned-revision'; row.service.template.containers[0].env = Object.entries(a.nextEnvironment).map(([name, value]) => ({ name, value }));
  }
  const activationPlanBytes = encode(activation), activationPlanSha256 = hashBytes(activationPlanBytes);
  const ownedAfterBytes = encode({ kind: 'VERIFIED_D_GATE_AFTER_V1', activationPlanSha256, functions: next.baseline.functions, appliedTargets });
  return { f: next, receipt: { activationPlanBytes, activationPlanSha256, ownedAfterBytes, ownedAfterSha256: hashBytes(ownedAfterBytes), originalEvidence: evidence(f) } };
}
test('pure activation changes only runtime gate in review then chat, preserving every other env value', () => {
  const f = fixture(), frozen = encode(f), p = planActivation(evidence(f));
  assert.deepEqual(p.actions.map(a => a.target), TARGETS); assert.equal(encode(f), frozen);
  for (const a of p.actions) {
    assert.equal(a.updateMask, 'serviceConfig.environmentVariables'); assert.equal(a.nextEnvironment[GATE], 'true');
    assert.equal(a.nextEnvironment.PRESERVE, 'synthetic-existing-value'); assert.equal(a.nextEnvironment.EMPTY_VALUE, '');
    assert.deepEqual(Object.keys(a.body).sort(), ['name', 'serviceConfig']); assert.deepEqual(Object.keys(a.body.serviceConfig), ['environmentVariables']);
  }
  assert.equal(p.networkCalls, 0); assert.equal(p.dataWrites, 0); assert.match(p.sourceVerification, /NOT_LIVE/);
});
test('no product plan can be generated while review is absent', () => { const f = fixture(); delete f.baseline.functions[TARGETS[0]]; const e = evidence(fixture()); e.baselineBytes = encode(f.baseline); e.baselineSha256 = hashBytes(e.baselineBytes); assert.throws(() => planActivation(e), /EXACT_TWO_TARGETS/); });
test('manifest changes are rejected before inspecting other evidence', () => { const e = evidence(fixture()); e.manifestBytes += ' '; assert.throws(() => planActivation(e), /PINNED_BYTES_CHANGED/); });
test('old review archive and non-R15 chat provenance cannot plan activation', () => {
  for (const mutate of [f => f.manifest.functions[TARGETS[0]].archiveSha256 = 'a'.repeat(64), f => f.manifest.functions[TARGETS[1]].role = 'CHAT_D1_ON_R14', f => f.manifest.functions[TARGETS[1]].baseRelease = 'R14']) { const f = fixture(); mutate(f); assert.throws(() => planActivation(evidence(f))); }
});
test('any third target in manifest, baseline or proof is rejected', () => {
  const e = evidence(fixture());
  for (const key of ['manifestBytes', 'baselineBytes', 'sourceProofBytes']) { const changed = copy(e), p = JSON.parse(changed[key]); p.functions.other = {}; changed[key] = encode(p); changed[key.replace('Bytes', 'Sha256')] = hashBytes(changed[key]); assert.throws(() => planActivation(changed)); }
});
test('Node runtime, entrypoint, readiness, IAM snapshot and zero operations are mandatory', () => {
  for (const mutate of [f => f.baseline.functions[TARGETS[0]].resource.buildConfig.runtime = 'nodejs20', f => f.baseline.functions[TARGETS[1]].resource.buildConfig.entryPoint = 'other', f => f.baseline.functions[TARGETS[0]].resource.state = 'DEPLOYING', f => f.baseline.functions[TARGETS[0]].service.terminalCondition.state = 'CONDITION_FAILED', f => f.baseline.functions[TARGETS[0]].iam = {}, f => f.baseline.operations.push({ done: false })]) { const f = fixture(); mutate(f); assert.throws(() => planActivation(evidence(f))); }
});
test('ambiguous gates and Run effective gate mismatch fail closed', () => {
  for (const value of ['', 'TRUE', '0', true, null]) assert.throws(() => planActivation(evidence(fixture([value, 'false']))), /AMBIGUOUS_GATE|ENVIRONMENT_VALUES/);
  const f = fixture(); f.baseline.functions[TARGETS[1]].service.template.containers[0].env = []; assert.throws(() => planActivation(evidence(f)), /EFFECTIVE_GATE_DRIFT/);
});
test('source proof binds target, locator, exact generation and downloaded hash', () => {
  for (const mutate of [p => p.functions[TARGETS[0]].source.generation = '90071992547409932', p => p.functions[TARGETS[0]].source.bucket = 'other', p => p.functions[TARGETS[0]].target = TARGETS[1], p => p.functions[TARGETS[1]].archiveSha256 = 'f'.repeat(64), p => p.functions[TARGETS[0]].bytesRead = 0]) { const e = evidence(fixture()); changeProof(e, mutate); assert.throws(() => planActivation(e)); }
  const f = fixture(); f.baseline.functions[TARGETS[0]].resource.buildConfig.sourceProvenance.resolvedStorageSource.generation = 123; assert.throws(() => planActivation(evidence(f)), /SOURCE_GENERATION_STRING/);
});
test('missing proof, changed proof bytes or stale baseline binding are rejected', () => {
  const e = evidence(fixture()); assert.throws(() => planActivation({ ...e, sourceProofBytes: undefined })); assert.throws(() => planActivation({ ...e, sourceProofBytes: e.sourceProofBytes + ' ' }), /PINNED_BYTES_CHANGED/);
  changeProof(e, p => p.baselineSha256 = 'f'.repeat(64)); assert.throws(() => planActivation(e), /PROOF_BASELINE_BINDING/);
});
test('IAM and resource drift cannot be disguised by merely rehashing baseline', () => {
  for (const key of ['iam', 'resource', 'service']) { const e = evidence(fixture()), b = JSON.parse(e.baselineBytes); b.functions[TARGETS[0]][key].extra = 'changed'; e.baselineBytes = encode(b); e.baselineSha256 = hashBytes(e.baselineBytes); changeProof(e, p => p.baselineSha256 = e.baselineSha256); assert.throws(() => planActivation(e), /SOURCE_PROOF_.*_DRIFT/); }
});
test('rollback restores exact prior false/true/absence and requires owned current state', () => {
  for (const gates of [[undefined, 'false'], ['true', 'false']]) {
    const f = fixture(gates), activation = planActivation(evidence(f)), a = after(f, activation), rollback = planRollback(evidence(a.f), a.receipt);
    assert.deepEqual(rollback.actions.map(row => row.target), [...TARGETS].reverse());
    for (const row of rollback.actions) assert.deepEqual(row.nextEnvironment, f.baseline.functions[row.target].resource.serviceConfig.environmentVariables);
  }
});
test('rollback rejects changed IAM, config, source and another receipt or manifest', () => {
  const f = fixture(), a = after(f, planActivation(evidence(f)));
  for (const key of ['iam', 'resource', 'service']) { const changed = copy(a.f); changed.baseline.functions[TARGETS[0]][key].drift = 'other'; assert.throws(() => planRollback(evidence(changed), a.receipt), /ROLLBACK_CURRENT_STATE_DRIFT/); }
  const receipt = copy(a.receipt), own = JSON.parse(receipt.ownedAfterBytes); own.activationPlanSha256 = 'f'.repeat(64); receipt.ownedAfterBytes = encode(own); receipt.ownedAfterSha256 = hashBytes(receipt.ownedAfterBytes); assert.throws(() => planRollback(evidence(a.f), receipt), /OWNED_PLAN_BINDING/);
  const source = copy(a.f); source.baseline.functions[TARGETS[0]].resource.buildConfig.sourceProvenance.resolvedStorageSource.generation = '90071992547409939'; assert.throws(() => planRollback(evidence(source), a.receipt), /ROLLBACK_CURRENT_STATE_DRIFT/);
  const manifest = copy(a.f); manifest.manifest.functions[TARGETS[1]].sourceIdentity.patchCommit = 'f'.repeat(40); assert.throws(() => planRollback(evidence(manifest), a.receipt), /ROLLBACK_MANIFEST_CHANGED/);
});
test('rollback cannot restore an ambiguous gate or alter another environment key', () => {
  for (const [field, value] of [[GATE, 'unapproved'], [GATE, 'true'], ['PRESERVE', 'unapproved']]) { const f = fixture(), activation = planActivation(evidence(f)); activation.actions[0].previousEnvironment[field] = value; const a = after(f, activation); assert.throws(() => planRollback(evidence(a.f), a.receipt), /ACTIVATION_PLAN_RECONSTRUCTION_FAILED/); }
});
test('arbitrary chat bytes labelled R15 and rollback without original evidence are rejected', () => {
  const f = fixture(); f.manifest.functions[TARGETS[1]].archiveSha256 = 'a'.repeat(64); assert.throws(() => planActivation(evidence(f)), /CHAT_ARCHIVE_NOT_REVIEWED/);
  const base = fixture(), a = after(base, planActivation(evidence(base))); delete a.receipt.originalEvidence; assert.throws(() => planRollback(evidence(a.f), a.receipt), /ORIGINAL_EVIDENCE_REQUIRED/);
});
test('emergency OFF is chat then review and differs from rollback restoring prior absence/true', () => {
  const f = fixture([undefined, 'true']), activation = planActivation(evidence(f)), a = after(f, activation);
  const emergency = planEmergencyOff(evidence(a.f)), rollback = planRollback(evidence(a.f), a.receipt);
  assert.deepEqual(emergency.actions.map(row => row.target), [...TARGETS].reverse());
  for (const row of emergency.actions) assert.equal(row.nextEnvironment[GATE], 'false');
  assert.equal(Object.hasOwn(rollback.actions[1].nextEnvironment, GATE), false); assert.equal(rollback.actions[0].nextEnvironment[GATE], 'true');
});
test('partial activation restores only the verified prefix, never an unknown or out-of-order step', () => {
  const f = fixture(), activation = planActivation(evidence(f)), partial = after(f, activation, [TARGETS[0]]);
  const rollback = planRollback(evidence(partial.f), partial.receipt);
  assert.deepEqual(rollback.actions.map(row => row.target), [TARGETS[0]]);
  assert.equal(Object.hasOwn(rollback.actions[0].nextEnvironment, GATE), false);
  const none = after(f, activation, []); assert.deepEqual(planRollback(evidence(none.f), none.receipt).actions, []);
  const wrong = after(f, activation, [TARGETS[1]]); assert.throws(() => planRollback(evidence(wrong.f), wrong.receipt), /APPLIED_PREFIX_REQUIRED/);
  const receipt = copy(partial.receipt), owned = JSON.parse(receipt.ownedAfterBytes); owned.appliedTargets = [...TARGETS]; receipt.ownedAfterBytes = encode(owned); receipt.ownedAfterSha256 = hashBytes(receipt.ownedAfterBytes);
  assert.throws(() => planRollback(evidence(partial.f), receipt), /ROLLBACK_ENVIRONMENT_DRIFT/);
});
