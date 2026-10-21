import assert from 'node:assert/strict';
import crypto from 'node:crypto';

export const TARGET = 'projects/pay-0-system/locations/us-central1/services/telegramwebhook';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function assertPauseProof(proof, archiveSha256) {
  assert.equal(proof?.status, 'PASS', 'PAUSE_NOT_VERIFIED');
  assert.equal(proof.archiveSha256, archiveSha256, 'PAUSE_ARTIFACT_CHANGED');
  for (const key of ['permissions', 'zeroProviderCalls', 'zeroDatabaseWrites', 'retryable503', 'claimedReceiptsPreserved', 'freshEventsNotClaimed', 'restartCompatible'])
    assert.equal(proof[key], true, 'PAUSE_PROOF_INCOMPLETE');
}

export function assertDrainWitness(witness, expected, now = Date.now()) {
  assert.equal(witness?.status, 'PASS', 'DRAIN_NOT_VERIFIED');
  assert.equal(witness.service, TARGET, 'DRAIN_SERVICE_SCOPE');
  assert.equal(witness.pauseArchiveSha256, expected.pauseArchiveSha256, 'DRAIN_PAUSE_CHANGED');
  assert.equal(witness.pauseRevision, expected.pauseRevision, 'DRAIN_REVISION_CHANGED');
  assert.equal(witness.pauseStateDigest, expected.pauseStateDigest, 'DRAIN_STATE_CHANGED');
  assert.equal(witness.legacyRevision, expected.legacyRevision, 'DRAIN_LEGACY_CHANGED');
  assert.equal(witness.noLegacyTrafficOrTags, true, 'LEGACY_STILL_ROUTABLE');
  assert.equal(witness.legacyInactive, true, 'LEGACY_STILL_ACTIVE');
  assert.equal(witness.telemetryComplete, true, 'DRAIN_TELEMETRY_INCOMPLETE');
  assert.equal(witness.legacyActiveInstances, 0, 'LEGACY_ACTIVE_INSTANCES');
  assert.equal(witness.legacyIdleInstances, 0, 'LEGACY_IDLE_INSTANCES');
  assert.equal(witness.legacyInFlightRequests, 0, 'LEGACY_IN_FLIGHT');
  assert.equal(witness.activeOperations, 0, 'CONCURRENT_DEPLOYMENT');
  const sample = Date.parse(witness.sampledAt), checked = Date.parse(witness.checkedAt), barrier = Date.parse(witness.pauseTrafficConfirmedAt);
  assert(Number.isFinite(sample) && Number.isFinite(checked) && Number.isFinite(barrier), 'DRAIN_TIMES_REQUIRED');
  assert(sample > barrier, 'DRAIN_SAMPLE_BEFORE_PAUSE');
  assert(sample <= checked && checked <= now && now - checked <= 60000, 'DRAIN_STALE_OR_FUTURE');
  assert(checked - sample <= 240000, 'DRAIN_SAMPLE_STALE');
}

export function recoveryTrafficPatch(expected, current, pause) {
  assert.equal(current.service?.name, TARGET, 'RECOVERY_SERVICE_SCOPE');
  for (const key of ['resource', 'service', 'iam']) assert.equal(hash(current[key]), hash(expected[key]), 'RECOVERY_CONCURRENT_CHANGE');
  assert.equal(pause.service, TARGET, 'RECOVERY_PAUSE_SCOPE');
  assert.match(pause.revision, /^telegramwebhook-[a-z0-9-]+$/, 'RECOVERY_REVISION_SCOPE');
  assert.match(pause.archiveSha256, /^[a-f0-9]{64}$/, 'RECOVERY_HASH_REQUIRED');
  assert.match(pause.imageDigest, /@sha256:[a-f0-9]{64}$/, 'RECOVERY_IMAGE_REQUIRED');
  assertPauseProof(pause.proof, pause.archiveSha256);
  assert.equal(pause.observedRevision?.name, TARGET + '/revisions/' + pause.revision, 'RECOVERY_REVISION_MISSING');
  assert.equal(pause.observedRevision?.containers?.[0]?.image, pause.imageDigest, 'RECOVERY_IMAGE_CHANGED');
  assert.equal(pause.observedRevision?.reconciling, false, 'RECOVERY_REVISION_RECONCILING');
  assert.equal(pause.observedRevision?.conditions?.some(c => c.type === 'Ready' && c.state === 'CONDITION_SUCCEEDED'), true, 'RECOVERY_REVISION_NOT_READY');
  assert.equal(typeof current.service.etag, 'string', 'RECOVERY_ETAG_REQUIRED');
  return { name: TARGET, etag: current.service.etag, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: pause.revision, percent: 100 }] };
}

export function recoveryV1Body(expected, current, revision) {
  assert.equal(hash(current), hash(expected), 'RECOVERY_V1_CONCURRENT_CHANGE');
  assert.equal(current.metadata?.name, 'telegramwebhook', 'RECOVERY_V1_SERVICE_SCOPE');
  assert(['pay-0-system','751158244178'].includes(current.metadata?.namespace), 'RECOVERY_V1_PROJECT_SCOPE');
  assert.match(current.metadata?.resourceVersion || '', /^.+$/, 'RECOVERY_RESOURCE_VERSION_REQUIRED');
  assert.match(revision, /^telegramwebhook-[a-z0-9-]+$/, 'RECOVERY_V1_REVISION_SCOPE');
  return {apiVersion:current.apiVersion,kind:current.kind,metadata:{name:current.metadata.name,namespace:current.metadata.namespace,resourceVersion:current.metadata.resourceVersion,labels:current.metadata.labels,annotations:current.metadata.annotations},spec:{...current.spec,traffic:[{revisionName:revision,percent:100}]}};
}
