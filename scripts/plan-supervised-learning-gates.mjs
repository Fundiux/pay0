// Pure planning only: no filesystem, credentials, network, process spawning or executor.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export const TARGETS = Object.freeze(['reviewAgent007LearningRule', 'sendAgent007Message']);
export const GATE = 'HUGO_SUPERVISED_RULES_ENABLED';
const REVIEW_ARCHIVE = 'c9a64571acecff5303afc99e79e17411bf3f3fdbcdfb9f6561705b74bb55280d';
const CHAT_ARCHIVE = '763134cfafb9854ef2f1b24c25ada58b59d0d95e848c5070f3ad27d045abfc62';
const R15_ARCHIVE = '45e8233d67051d3b61ec9b787474fcdd7dd020f3b391b421d25dfcf731fa9474';
const clone = value => structuredClone(value);
export const hashBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const fingerprint = value => hashBytes(JSON.stringify(canonical(value)));
function pinned(bytes, expected) {
  assert(typeof bytes === 'string' || Buffer.isBuffer(bytes), 'PINNED_BYTES_REQUIRED');
  assert.match(expected || '', /^[a-f0-9]{64}$/, 'SHA256_REQUIRED');
  assert.equal(hashBytes(bytes), expected, 'PINNED_BYTES_CHANGED');
  return JSON.parse(bytes);
}
function exactKeys(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'TARGET_MAP_REQUIRED');
  assert.deepEqual(Object.keys(value).sort(), [...TARGETS].sort(), 'EXACT_TWO_TARGETS_REQUIRED');
}
function assertEnvironmentMap(map) {
  assert(map && typeof map === 'object' && !Array.isArray(map), 'ENVIRONMENT_MAP_REQUIRED');
  assert(Object.values(map).every(value => typeof value === 'string'), 'ENVIRONMENT_VALUES_MUST_BE_STRINGS');
  if (Object.hasOwn(map, GATE)) assert(['true', 'false'].includes(map[GATE]), 'AMBIGUOUS_GATE');
}
function environment(row) {
  const map = row.resource.serviceConfig.environmentVariables ?? {};
  assertEnvironmentMap(map);
  const containers = row.service.template?.containers;
  assert(Array.isArray(containers) && containers.length === 1, 'ONE_RUNTIME_CONTAINER_REQUIRED');
  const gateEntries = (containers[0].env || []).filter(entry => entry.name === GATE);
  assert.equal(gateEntries.length, Object.hasOwn(map, GATE) ? 1 : 0, 'EFFECTIVE_GATE_DRIFT');
  if (gateEntries.length) assert.equal(gateEntries[0].value, map[GATE], 'EFFECTIVE_GATE_DRIFT');
  return clone(map);
}
function locator(resource) {
  const source = resource.buildConfig?.sourceProvenance?.resolvedStorageSource;
  assert(source && source.bucket === 'gcf-v2-sources-751158244178-us-central1', 'RESOLVED_SOURCE_REQUIRED');
  assert.match(source.object || '', /^[A-Za-z0-9_-]+\/function-source\.zip$/, 'SOURCE_OBJECT');
  assert.match(source.generation || '', /^[1-9][0-9]*$/, 'SOURCE_GENERATION_STRING_REQUIRED');
  return source;
}
/** Validates caller-pinned capture evidence; cannot authenticate the capture or read live source. */
export function validateEvidence(evidence) {
  const manifest = pinned(evidence.manifestBytes, evidence.manifestSha256);
  const baseline = pinned(evidence.baselineBytes, evidence.baselineSha256);
  const proof = pinned(evidence.sourceProofBytes, evidence.sourceProofSha256);
  assert.equal(manifest.schemaVersion, 1); exactKeys(manifest.functions);
  assert.equal(manifest.functions[TARGETS[0]].archiveSha256, REVIEW_ARCHIVE, 'REVIEW_ARCHIVE_NOT_REVIEWED');
  assert.equal(manifest.functions[TARGETS[0]].role, 'REVIEW_REVOKE_OFF');
  assert.equal(manifest.functions[TARGETS[1]].role, 'CHAT_D1_ON_R15', 'CHAT_R15_COMPOSITION_REQUIRED');
  assert.equal(manifest.functions[TARGETS[1]].archiveSha256, CHAT_ARCHIVE, 'CHAT_ARCHIVE_NOT_REVIEWED');
  assert.equal(manifest.functions[TARGETS[1]].sourceIdentity?.baseArchiveSha256, R15_ARCHIVE, 'CHAT_R15_BASE_REQUIRED');
  assert.equal(baseline.project, 'pay-0-system'); exactKeys(baseline.functions);
  assert(Array.isArray(baseline.operations) && baseline.operations.length === 0, 'ZERO_ACTIVE_OPERATIONS_REQUIRED');
  assert.equal(proof.kind, 'CAPTURED_SOURCE_BYTES_V1');
  assert.equal(proof.baselineSha256, evidence.baselineSha256, 'PROOF_BASELINE_BINDING');
  assert.equal(proof.manifestSha256, evidence.manifestSha256, 'PROOF_MANIFEST_BINDING');
  exactKeys(proof.functions);
  for (const name of TARGETS) {
    const artifact = manifest.functions[name], row = baseline.functions[name], observation = proof.functions[name];
    assert.match(artifact.archiveSha256 || '', /^[a-f0-9]{64}$/);
    assert.equal(artifact.sourceTree, null);
    assert.match(artifact.sourceIdentity?.baseArchiveSha256 || '', /^[a-f0-9]{64}$/);
    assert.match(artifact.sourceIdentity?.patchSha256 || '', /^[a-f0-9]{64}$/);
    assert.match(artifact.sourceIdentity?.patchCommit || '', /^[a-f0-9]{40}$/);
    if (name === TARGETS[1]) assert.equal(artifact.baseRelease, 'R15', 'CHAT_R15_COMPOSITION_REQUIRED');
    assert.equal(row.resource?.name, `projects/pay-0-system/locations/us-central1/functions/${name}`, 'FUNCTION_SCOPE');
    assert.equal(row.resource.state, 'ACTIVE'); assert.equal(row.resource.environment, 'GEN_2');
    assert.equal(row.resource.buildConfig?.runtime, 'nodejs22'); assert.equal(row.resource.buildConfig.entryPoint, name);
    assert(!row.resource.eventTrigger, 'CALLABLE_REQUIRED');
    assert.match(row.resource.serviceConfig?.service || '', new RegExp(`^projects/(?:pay-0-system|751158244178)/locations/us-central1/services/${name.toLowerCase()}$`));
    assert.equal(row.service?.name, row.resource.serviceConfig.service, 'RUN_SCOPE');
    assert.equal(row.service.terminalCondition?.state, 'CONDITION_SUCCEEDED');
    assert.equal(row.service.buildConfig?.functionTarget, name, 'RUN_ENTRYPOINT');
    assert(row.iam && Array.isArray(row.iam.bindings), 'IAM_SNAPSHOT_REQUIRED');
    environment(row);
    assert.equal(observation.target, name, 'SOURCE_PROOF_TARGET');
    assert.equal(observation.status, 'READBACK_VERIFIED');
    assert.deepEqual(observation.source, locator(row.resource), 'SOURCE_LOCATOR_DRIFT');
    assert.equal(observation.archiveSha256, artifact.archiveSha256, 'SOURCE_BYTES_DRIFT');
    assert(Number.isSafeInteger(observation.bytesRead) && observation.bytesRead > 0, 'SOURCE_BYTE_READ_REQUIRED');
    for (const key of ['resource', 'service', 'iam']) assert.equal(observation[`${key}Sha256`], fingerprint(row[key]), `SOURCE_PROOF_${key.toUpperCase()}_DRIFT`);
  }
  return { manifest, baseline, proof };
}
function action(name, before, after) {
  assertEnvironmentMap(before); assertEnvironmentMap(after);
  const withoutGate = map => Object.fromEntries(Object.entries(map).filter(([key]) => key !== GATE));
  assert.deepEqual(withoutGate(after), withoutGate(before), 'NON_GATE_ENVIRONMENT_CHANGED');
  return { target: name, method: 'PATCH', updateMask: 'serviceConfig.environmentVariables', changeRequired: fingerprint(before) !== fingerprint(after),
    previousEnvironment: clone(before), nextEnvironment: clone(after),
    body: { name: `projects/pay-0-system/locations/us-central1/functions/${name}`, serviceConfig: { environmentVariables: clone(after) } } };
}
function plan(evidence, mode) {
  const { manifest, baseline } = validateEvidence(evidence);
  const order = mode === 'ACTIVATE' ? TARGETS : [...TARGETS].reverse();
  return { schemaVersion: 1, kind: 'D_RUNTIME_GATE_PLAN_V1', mode, scope: [...TARGETS],
    evidencePins: { manifestSha256: evidence.manifestSha256, baselineSha256: evidence.baselineSha256, sourceProofSha256: evidence.sourceProofSha256 },
    artifacts: clone(manifest.functions), actions: order.map(name => { const before = environment(baseline.functions[name]); return action(name, before, { ...before, [GATE]: mode === 'ACTIVATE' ? 'true' : 'false' }); }),
    status: 'LOCAL_PLAN_ONLY_NOT_AUTHORIZATION', sourceVerification: 'CALLER_PINNED_CAPTURE_ONLY_NOT_LIVE_VERIFICATION', dataWrites: 0, networkCalls: 0 };
}
export const planActivation = evidence => plan(evidence, 'ACTIVATE');
export const planEmergencyOff = evidence => plan(evidence, 'EMERGENCY_OFF');

/** Rollback requires a pinned, separately verified after-receipt and exact current state. */
export function planRollback(evidence, { activationPlanBytes, activationPlanSha256, ownedAfterBytes, ownedAfterSha256, originalEvidence }) {
  const { manifest, baseline } = validateEvidence(evidence);
  const activation = pinned(activationPlanBytes, activationPlanSha256);
  assert(originalEvidence, 'ORIGINAL_EVIDENCE_REQUIRED');
  assert.deepEqual(activation, planActivation(originalEvidence), 'ACTIVATION_PLAN_RECONSTRUCTION_FAILED');
  assert.equal(activation.kind, 'D_RUNTIME_GATE_PLAN_V1'); assert.equal(activation.mode, 'ACTIVATE');
  assert.deepEqual(activation.scope, [...TARGETS]);
  assert.deepEqual(activation.actions.map(row => row.target), [...TARGETS], 'ACTIVATION_ORDER_CHANGED');
  assert.equal(activation.evidencePins.manifestSha256, evidence.manifestSha256, 'ROLLBACK_MANIFEST_CHANGED');
  assert.deepEqual(activation.artifacts, manifest.functions, 'ROLLBACK_ARTIFACTS_CHANGED');
  const owned = pinned(ownedAfterBytes, ownedAfterSha256);
  assert.equal(owned.kind, 'VERIFIED_D_GATE_AFTER_V1');
  assert.equal(owned.activationPlanSha256, activationPlanSha256, 'OWNED_PLAN_BINDING');
  exactKeys(owned.functions);
  assert(Array.isArray(owned.appliedTargets) && owned.appliedTargets.length <= TARGETS.length, 'APPLIED_PREFIX_REQUIRED');
  assert.deepEqual(owned.appliedTargets, TARGETS.slice(0, owned.appliedTargets.length), 'APPLIED_PREFIX_REQUIRED');
  assert.deepEqual(baseline.functions, owned.functions, 'ROLLBACK_CURRENT_STATE_DRIFT');
  for (const name of TARGETS) {
    const approved = activation.actions.find(row => row.target === name), current = environment(baseline.functions[name]);
    assert.deepEqual(current, owned.appliedTargets.includes(name) ? approved.nextEnvironment : approved.previousEnvironment, 'ROLLBACK_ENVIRONMENT_DRIFT');
  }
  const actions = [...owned.appliedTargets].reverse().map(name => {
    const approved = activation.actions.find(row => row.target === name);
    return action(name, environment(baseline.functions[name]), approved.previousEnvironment);
  });
  return { schemaVersion: 1, kind: 'D_RUNTIME_GATE_PLAN_V1', mode: 'RESTORE_PREVIOUS', scope: [...TARGETS],
    evidencePins: { manifestSha256: evidence.manifestSha256, baselineSha256: evidence.baselineSha256, sourceProofSha256: evidence.sourceProofSha256, activationPlanSha256, ownedAfterSha256 },
    actions, status: 'LOCAL_PLAN_ONLY_NOT_AUTHORIZATION', dataWrites: 0, networkCalls: 0 };
}
