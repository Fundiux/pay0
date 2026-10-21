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
  // Retired revisions stop emitting metrics. A terminal zero AFTER the barrier
  // remains valid only while the exact fenced service generation is unchanged.
  if (checked - sample > 240000) {
    assert.equal(witness.legacyRetired, true, 'DRAIN_SAMPLE_STALE');
    assert.equal(witness.serviceStateUnchangedSinceBarrier, true, 'DRAIN_TERMINAL_FENCE_REQUIRED');
  }
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
  // Proto3 JSON omits false booleans. Readiness and observed generation must
  // independently confirm completion; missing monitoring counts remain unknown.
  assert.equal(pause.observedRevision?.reconciling ?? false, false, 'RECOVERY_REVISION_RECONCILING');
  assert.match(pause.observedRevision?.generation || '', /^[1-9][0-9]*$/, 'RECOVERY_GENERATION_REQUIRED');
  assert.equal(pause.observedRevision.observedGeneration, pause.observedRevision.generation, 'RECOVERY_GENERATION_NOT_OBSERVED');
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

export function drainProbeV1Body(current, pauseRevision, legacyRevision, tag, enabled) {
  assert.match(tag, /^drain-[a-f0-9]{12}$/, 'DRAIN_PROBE_TAG_SCOPE');
  assert.match(pauseRevision, /^telegramwebhook-[a-z0-9-]+$/, 'DRAIN_PROBE_PAUSE_SCOPE');
  assert.match(legacyRevision, /^telegramwebhook-[a-z0-9-]+$/, 'DRAIN_PROBE_LEGACY_SCOPE');
  assert.notEqual(pauseRevision,legacyRevision,'DRAIN_PROBE_DISTINCT_REVISION');
  assert.equal(current.spec?.template?.metadata?.name,pauseRevision,'DRAIN_PROBE_TEMPLATE_CHANGED');
  const traffic=current.spec?.traffic||[];
  assert.equal(traffic.length,enabled?1:2,'DRAIN_PROBE_UNEXPECTED_TRAFFIC');
  const primary=traffic.find(t=>t.percent===100);
  assert(primary&&primary.latestRevision===true&&!primary.tag&&!primary.revisionName,'DRAIN_PROBE_PRIMARY_MUST_STAY_PAUSED');
  if(!enabled){const probe=traffic.find(t=>t.tag===tag);assert(probe&&probe.revisionName===legacyRevision&&(probe.percent??0)===0,'DRAIN_PROBE_ROUTE_CHANGED')}
  const body=recoveryV1Body(current,current,pauseRevision);
  body.spec.traffic=[{latestRevision:true,percent:100},...(enabled?[{revisionName:legacyRevision,percent:0,tag}]:[])];
  return body;
}

export function normalizeWebhookBookkeeping(service, expectedLastModifier) {
  assert.equal(typeof expectedLastModifier, 'string', 'WEBHOOK_MODIFIER_IDENTITY_REQUIRED');
  assert.equal(service.lastModifier, expectedLastModifier, 'WEBHOOK_MODIFIER_CHANGED');
  const copy=structuredClone(service);delete copy.lastModifier;
  if(copy.conditions)copy.conditions=copy.conditions.filter(c=>{
    if(c.type==='BaseImageValidated'){assert.equal(c.state,'CONDITION_SUCCEEDED','WEBHOOK_BASE_IMAGE_NOT_VALIDATED');return false}
    return true;
  }).sort((a,b)=>a.type.localeCompare(b.type));
  return copy;
}
