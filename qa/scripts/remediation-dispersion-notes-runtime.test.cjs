'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const g = require('../../scripts/lib/dispersion-notes-runtime-check.cjs');
function fixture() {
  const revision = 'listclientdispersionnotes-00001-old';
  const row = { timeout: '60s', maxInstanceRequestConcurrency: 1, serviceAccount: '751158244178-compute@developer.gserviceaccount.com', containers: [{ resources: { limits: { memory: '256Mi', cpu: '1' } }, env: [{ name: 'SYNTHETIC', value: 'fixture' }] }] };
  return {
    function: { name: g.RESOURCE, state: 'ACTIVE', buildConfig: { runtime: 'nodejs22', entryPoint: 'listClientDispersionNotes', source: { storageSource: { bucket: 'gcf-v2-sources-751158244178-us-central1', object: 'listClientDispersionNotes/function-source.zip', generation: '1' } } }, serviceConfig: { service: g.SERVICE, revision, timeoutSeconds: 60, availableMemory: '256Mi', availableCpu: '1', maxInstanceRequestConcurrency: 1, serviceAccountEmail: row.serviceAccount, ingressSettings: 'ALLOW_ALL', environmentVariables: { SYNTHETIC: 'fixture' } } },
    service: { name: g.SERVICE, scaling: { maxInstanceCount: 20 }, template: structuredClone(row), latestReadyRevision: g.SERVICE + '/revisions/' + revision, latestCreatedRevision: g.SERVICE + '/revisions/' + revision, terminalCondition: { state: 'CONDITION_SUCCEEDED' }, trafficStatuses: [{ percent: 100, revision }] },
    revision: { ...structuredClone(row), name: g.SERVICE + '/revisions/' + revision, conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }] },
  };
}
function next(meta) {
  const r = 'listclientdispersionnotes-00002-new'; meta.function.serviceConfig.revision = r;
  meta.function.buildConfig.source.storageSource.generation = '2'; meta.revision.name = g.SERVICE + '/revisions/' + r;
  meta.service.latestReadyRevision = meta.revision.name; meta.service.latestCreatedRevision = meta.revision.name; meta.service.trafficStatuses[0].revision = r;
  meta.service.template.containers[0].image = 'synthetic:new'; meta.revision.containers[0].image = 'synthetic:new';
  return { revision: r, source: structuredClone(meta.function.buildConfig.source.storageSource) };
}
test('baseline and exact completed revision retain observed service max20', () => {
  const b = fixture(); assert.deepEqual(g.assertPreserved(structuredClone(b), b).scaling, g.SCALING);
  const n = structuredClone(b), completed = next(n); g.assertPreserved(n, b, completed);
  assert.throws(() => g.assertPreserved(n, b)); assert.throws(() => g.assertPreserved(n, b, { ...completed, revision: completed.revision + 'other' }));
});
test('scaling Ready traffic identity and bindings fail closed', () => {
  for (const mutate of [x => x.service.scaling.maxInstanceCount = 100, x => x.function.serviceConfig.maxInstanceCount = 20, x => x.service.template.scaling = { maxInstanceCount: 100 }, x => x.revision.scaling = { minInstanceCount: 1 }, x => x.service.trafficStatuses.push({ tag: 'alternate', revision: x.function.serviceConfig.revision }), x => x.service.trafficStatuses[0].percent = 99, x => x.service.latestReadyRevision += 'other', x => x.revision.conditions = [], x => x.service.template.serviceAccount = 'other', x => x.revision.containers[0].env.push({ name: 'SECRET', valueSource: {} }), x => x.function.serviceConfig.secretEnvironmentVariables = [{}], x => x.service.template.vpcAccess = { connector: 'other' }]) {
    const b = fixture(), n = structuredClone(b); mutate(n); assert.throws(() => g.assertPreserved(n, b));
  }
});
test('configuration and environment cannot drift with a new source revision', () => {
  for (const mutate of [x => x.function.serviceConfig.environmentVariables.SYNTHETIC = 'changed', x => x.service.template.containers[0].env[0].value = 'changed', x => x.revision.containers[0].command = ['other'], x => x.service.invokerIamDisabled = true, x => x.service.template.containers[0].resources.cpuIdle = false]) {
    const b = fixture(), n = structuredClone(b), completed = next(n); mutate(n); assert.throws(() => g.assertPreserved(n, b, completed));
  }
});
