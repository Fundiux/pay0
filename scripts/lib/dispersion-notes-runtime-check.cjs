'use strict';

// Pure runtime comparison for the update launcher. No authentication or IO.
const assert = require('node:assert/strict');
const RESOURCE = 'projects/pay-0-system/locations/us-central1/functions/listClientDispersionNotes';
const SERVICE = 'projects/pay-0-system/locations/us-central1/services/listclientdispersionnotes';
const IDENTITY = '751158244178-compute@developer.gserviceaccount.com';
const SCALING = { gcf: null, service: 20, template: null, revision: null };
const FUNCTION_KEYS = ['timeoutSeconds', 'availableMemory', 'availableCpu', 'minInstanceCount', 'maxInstanceCount', 'maxInstanceRequestConcurrency', 'serviceAccountEmail', 'ingressSettings', 'vpcConnector', 'vpcConnectorEgressSettings', 'environmentVariables', 'secretEnvironmentVariables', 'secretVolumes'];
function equalRevision(actual, expected) {
  assert.ok(actual === expected || actual === SERVICE + '/revisions/' + expected, 'RUN_REVISION_SCOPE');
}
function scaling(meta) {
  return { gcf: meta.function.serviceConfig.maxInstanceCount ?? null, service: meta.service.scaling?.maxInstanceCount ?? null, template: meta.service.template?.scaling?.maxInstanceCount ?? null, revision: meta.revision.scaling?.maxInstanceCount ?? null };
}
function assertRuntime(meta) {
  const f = meta?.function, s = meta?.service, r = meta?.revision;
  assert.equal(f?.name, RESOURCE, 'FUNCTION_SCOPE'); assert.equal(f.state, 'ACTIVE', 'FUNCTION_ACTIVE');
  assert.equal(f.buildConfig?.runtime, 'nodejs22', 'FUNCTION_RUNTIME'); assert.equal(f.buildConfig.entryPoint, 'listClientDispersionNotes', 'FUNCTION_ENTRY');
  const c = f.serviceConfig, source = f.buildConfig.source?.storageSource;
  assert.equal(c?.service, SERVICE, 'FUNCTION_SERVICE'); assert.match(c.revision || '', /^listclientdispersionnotes-[a-z0-9-]+$/, 'FUNCTION_REVISION');
  assert.equal(c.timeoutSeconds, 60, 'FUNCTION_TIMEOUT'); assert.equal(c.availableMemory, '256Mi', 'FUNCTION_MEMORY'); assert.equal(String(c.availableCpu), '1', 'FUNCTION_CPU');
  assert.equal(c.maxInstanceRequestConcurrency, 1, 'FUNCTION_CONCURRENCY'); assert.equal(c.minInstanceCount ?? 0, 0, 'FUNCTION_MIN');
  assert.equal(c.serviceAccountEmail, IDENTITY, 'FUNCTION_IDENTITY'); assert.equal(c.ingressSettings, 'ALLOW_ALL', 'FUNCTION_INGRESS');
  assert.ok(!c.vpcConnector && !c.vpcConnectorEgressSettings && !c.secretEnvironmentVariables?.length && !c.secretVolumes?.length, 'FUNCTION_BINDINGS');
  assert.equal(source?.bucket, 'gcf-v2-sources-751158244178-us-central1', 'SOURCE_BUCKET'); assert.equal(source?.object, 'listClientDispersionNotes/function-source.zip', 'SOURCE_OBJECT');
  assert.match(source?.generation || '', /^[1-9][0-9]*$/, 'SOURCE_GENERATION');
  assert.equal(s?.name, SERVICE, 'SERVICE_SCOPE'); assert.equal(r?.name, SERVICE + '/revisions/' + c.revision, 'REVISION_SCOPE');
  assert.equal(s.terminalCondition?.state, 'CONDITION_SUCCEEDED', 'SERVICE_READY');
  assert.ok((r.conditions || []).some(x => x.type === 'Ready' && x.state === 'CONDITION_SUCCEEDED'), 'REVISION_READY');
  equalRevision(s.latestReadyRevision, c.revision); equalRevision(s.latestCreatedRevision, c.revision);
  assert.equal(s.trafficStatuses?.length, 1, 'TRAFFIC_SINGLE'); assert.equal(s.trafficStatuses[0].percent, 100, 'TRAFFIC_PERCENT');
  assert.ok(!s.trafficStatuses[0].tag, 'TRAFFIC_TAG'); equalRevision(s.trafficStatuses[0].revision, c.revision);
  assert.deepEqual(scaling(meta), SCALING, 'REVIEWED_SCALING');
  for (const row of [s.scaling, s.template?.scaling, r.scaling]) assert.equal(row?.minInstanceCount ?? 0, 0, 'RUN_MIN');
  for (const row of [s.template, r]) {
    assert.equal(row?.timeout, '60s', 'RUN_TIMEOUT'); assert.equal(row.maxInstanceRequestConcurrency, 1, 'RUN_CONCURRENCY');
    assert.equal(row.serviceAccount, IDENTITY, 'RUN_IDENTITY'); assert.equal(row.containers?.length, 1, 'RUN_CONTAINER_COUNT');
    assert.equal(row.containers[0].resources?.limits?.memory, '256Mi', 'RUN_MEMORY'); assert.equal(row.containers[0].resources?.limits?.cpu, '1', 'RUN_CPU');
    assert.ok(!row.vpcAccess || Object.keys(row.vpcAccess).length === 0, 'RUN_VPC'); assert.ok(!row.volumes?.length, 'RUN_VOLUMES');
    assert.ok(!(row.containers[0].env || []).some(x => x.valueSource), 'RUN_SECRETS');
  }
  return { revision: c.revision, source: structuredClone(source), scaling: scaling(meta) };
}
function assertPreserved(current, baseline, completed = null) {
  const before = assertRuntime(baseline), after = assertRuntime(current);
  for (const key of FUNCTION_KEYS) assert.deepEqual(current.function.serviceConfig[key] ?? null, baseline.function.serviceConfig[key] ?? null, 'FUNCTION_DRIFT_' + key);
  // Image and revision identifiers change on update. Retain executable settings
  // and exact env arrays (including ordering) rather than accepting broad drift.
  for (const key of ['ingress', 'invokerIamDisabled', 'defaultUriDisabled', 'customAudiences', 'binaryAuthorization']) assert.deepEqual(current.service[key] ?? null, baseline.service[key] ?? null, 'SERVICE_DRIFT_' + key);
  for (const [row, old] of [[current.service.template, baseline.service.template], [current.revision, baseline.revision]]) {
    for (const key of ['executionEnvironment', 'sessionAffinity', 'encryptionKey', 'serviceMesh', 'gpuZonalRedundancy']) assert.deepEqual(row[key] ?? null, old[key] ?? null, 'RUN_DRIFT_' + key);
    for (const key of ['resources', 'env', 'ports', 'volumeMounts', 'command', 'args', 'startupProbe', 'livenessProbe']) assert.deepEqual(row.containers[0][key] ?? null, old.containers[0][key] ?? null, 'CONTAINER_DRIFT_' + key);
  }
  if (completed) {
    assert.equal(after.revision, completed.revision, 'POSTFLIGHT_REVISION'); assert.deepEqual(after.source, completed.source, 'POSTFLIGHT_SOURCE');
    assert.notEqual(after.revision, before.revision, 'POSTFLIGHT_OLD_REVISION'); assert.notEqual(after.source.generation, before.source.generation, 'POSTFLIGHT_OLD_SOURCE');
  } else {
    assert.equal(after.revision, before.revision, 'BASELINE_REVISION'); assert.deepEqual(after.source, before.source, 'BASELINE_SOURCE');
  }
  return after;
}
module.exports = { RESOURCE, SERVICE, SCALING, assertRuntime, assertPreserved };
