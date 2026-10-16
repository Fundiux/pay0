import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOnlyPatch, assertRuntimePreserved, previousSource } from '../../scripts/deploy-scoped-functions.mjs';
import { digest } from '../../scripts/capture-production-baseline.mjs';
const resource = () => ({ name: 'projects/pay-0-system/locations/us-central1/functions/parsePagoReceiptPdf', state: 'ACTIVE',
  labels: { owner: 'existing' }, buildConfig: { runtime: 'nodejs22', entryPoint: 'parsePagoReceiptPdf', environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: '' },
    source: { storageSource: { bucket: 'gcf-v2-sources-751158244178-us-central1', object: 'parsePagoReceiptPdf/function-source.zip', generation: '123' } } },
  serviceConfig: { service: 'projects/pay-0-system/locations/us-central1/services/parsepagoreceiptpdf', revision: 'previous', uri: 'https://example.invalid',
    environmentVariables: { SECRET_TEST: 'retained-only-in-memory' }, maxInstanceCount: 4, availableMemory: '512Mi' } });
const upload = { bucket: 'gcf-v2-uploads-751158244178-us-central1', object: 'generated/archive.zip', generation: '234' };
test('patch changes only source and additive provenance labels without copying environment', () => {
  const before = resource();
  const patch = sourceOnlyPatch(before, upload, 'a'.repeat(40), 'b'.repeat(64));
  assert.deepEqual(Object.keys(patch).sort(), ['buildConfig', 'labels', 'name']);
  assert.deepEqual(patch.buildConfig, { source: { storageSource: upload } });
  assert.equal(patch.labels.owner, 'existing');
  assert.equal(JSON.stringify(patch).includes('retained-only-in-memory'), false);
  assert.equal(before.serviceConfig.environmentVariables.SECRET_TEST, 'retained-only-in-memory');
});
test('rejects unrelated targets, projects, runtime and unpinned source generations', () => {
  for (const mutate of [
    row => { row.name = row.name.replace('parsePagoReceiptPdf', 'createPago'); },
    row => { row.name = row.name.replace('pay-0-system', 'other-project'); },
    row => { row.buildConfig.runtime = 'nodejs20'; },
    row => { row.state = 'DEPLOYING'; },
    row => { row.buildConfig.environmentVariables = {}; },
  ]) { const before = resource(); mutate(before); assert.throws(() => sourceOnlyPatch(before, upload, 'a'.repeat(40), 'b'.repeat(64))); }
  assert.throws(() => sourceOnlyPatch(resource(), { ...upload, generation: undefined }, 'a'.repeat(40), 'b'.repeat(64)));
  const missing = resource(); missing.buildConfig.source.storageSource.generation = '0';
  assert.throws(() => previousSource(missing));
});
test('runtime verifier tolerates a new revision but rejects configuration drift', () => {
  const before = resource(), after = structuredClone(before); after.serviceConfig.revision = 'next';
  assert.doesNotThrow(() => assertRuntimePreserved(before, after));
  after.serviceConfig.environmentVariables = {};
  assert.throws(() => assertRuntimePreserved(before, after));
});
test('metadata digest ignores object serialization order but retains meaningful changes', () => {
  assert.equal(digest({ a: 1, b: { c: 2, d: 3 } }), digest({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(digest([1, 2]), digest([2, 1]));
});
