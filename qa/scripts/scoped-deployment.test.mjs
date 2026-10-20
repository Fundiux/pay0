import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOnlyPatch, assertRuntimePreserved, previousSource, assertOperationMatchesGet, DEPLOYMENT_GROUPS, deploymentScope, assertArtifactProof, assertUploadSource, assertOperationScope, assertRunRuntimePreserved, assertPreservedSource, validateSourceIdentity } from '../../scripts/deploy-scoped-functions.mjs';
import { createHash } from 'node:crypto';
import { digest } from '../../scripts/capture-production-baseline.mjs';
const resource = () => ({ name: 'projects/pay-0-system/locations/us-central1/functions/parsePagoReceiptPdf', state: 'ACTIVE',
  labels: { owner: 'existing' }, buildConfig: { runtime: 'nodejs22', entryPoint: 'parsePagoReceiptPdf', environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: '' },
    source: { storageSource: { bucket: 'gcf-v2-sources-751158244178-us-central1', object: 'parsePagoReceiptPdf/function-source.zip', generation: '123' } } },
  serviceConfig: { service: 'projects/pay-0-system/locations/us-central1/services/parsepagoreceiptpdf', revision: 'previous', uri: 'https://example.invalid',
    environmentVariables: { SECRET_TEST: 'retained-only-in-memory' }, maxInstanceCount: 4, availableMemory: '512Mi' } });
const upload = { bucket: 'gcf-v2-uploads-751158244178.us-central1.cloudfunctions.appspot.com', object: 'generated/archive.zip', generation: '234' };

test('learning overlays require exact endpoint sets and pinned overlay provenance', () => {
  const commit = 'a'.repeat(40);
  const identity = { mode: 'PRODUCTION_OVERLAY_V1', baseArchiveSha256: 'b'.repeat(64), patchSha256: 'c'.repeat(64), patchCommit: commit };
  for (const [group, functions] of [
    ['receipt-learning-overlay', ['parsePagoReceiptPdf', 'correctPagoReceiptSemanticField']],
    ['conversation-correction-overlay', ['sendAgent007Message', 'createAgent007MemoryCandidate', 'listAgent007MemoryDiagnostics', 'reviewAgent007MemoryCandidate']],
  ]) {
    assert.deepEqual(deploymentScope({ group, functions }).names, functions);
    assert.throws(() => deploymentScope({ group, functions: [...functions, 'createPago'] }));
    assert.throws(() => deploymentScope({ group, functions: functions.slice(1) }));
    assert.throws(() => validateSourceIdentity(undefined, group, commit), /OVERLAY_IDENTITY_REQUIRED/);
    assert.doesNotThrow(() => validateSourceIdentity(identity, group, commit));
    assert.throws(() => validateSourceIdentity({ ...identity, patchCommit: 'd'.repeat(40) }, group, commit), /OVERLAY_PATCH_COMMIT/);
    const before = resource();
    before.name = before.name.replace('parsePagoReceiptPdf', functions[0]);
    before.buildConfig.entryPoint = functions[0];
    const patch = sourceOnlyPatch(before, upload, commit, 'e'.repeat(64), group, identity);
    assert.deepEqual(Object.keys(patch.buildConfig), ['source']);
    assert.equal(patch.labels['pay0-source-mode'], 'production-overlay-v1');
  }
});
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
test('operation Any wrapper and final timestamp differ without hiding source or configuration changes', () => {
  const current = { ...resource(), updateTime: '2026-10-16T00:00:02Z' };
  const operation = { ...structuredClone(current), '@type': 'type.googleapis.com/google.cloud.functions.v2.Function', updateTime: '2026-10-16T00:00:01Z' };
  assert.doesNotThrow(() => assertOperationMatchesGet(operation, current));
  for (const mutate of [
    row => { row.buildConfig.source.storageSource.generation = '987'; },
    row => { row.serviceConfig.maxInstanceCount = 99; },
    row => { row.labels.owner = 'concurrent'; },
  ]) { const changed = structuredClone(current); mutate(changed); assert.throws(() => assertOperationMatchesGet(operation, changed)); }
});

test('groups pin exact endpoints and old receipt inputs remain compatible', () => {
  assert.equal(deploymentScope({ functions: [...DEPLOYMENT_GROUPS.receipts] }).group, 'receipts');
  assert.equal(DEPLOYMENT_GROUPS['security-readers'].length, 9);
  assert.deepEqual(DEPLOYMENT_GROUPS['engineering-action'], ['reconcileAgent007RecommendationsNow']);
  assert.deepEqual(DEPLOYMENT_GROUPS['hugo-reports'], ['sendAgent007Message', 'delegateHugoVoiceTurn', 'getEarningsByClientReport']);
  assert.deepEqual(DEPLOYMENT_GROUPS['receipt-workflow'], ['createPago', 'parsePagoReceiptPdf', 'correctPagoReceiptSemanticField']);
  for (const [group, names] of Object.entries(DEPLOYMENT_GROUPS)) {
    const input = { group, functions: [...names], buildMode: 'BUNDLED_V1' };
    assert.deepEqual(deploymentScope(input).names, names);
    for (const name of names) {
      const row = resource(); row.name = row.name.replace('parsePagoReceiptPdf', name);
      const identity = group.endsWith('-overlay') ? { mode: 'PRODUCTION_OVERLAY_V1', patchCommit: 'a'.repeat(40), baseArchiveSha256: 'c'.repeat(64), patchSha256: 'd'.repeat(64) } : undefined;
      assert.doesNotThrow(() => sourceOnlyPatch(row, upload, 'a'.repeat(40), 'b'.repeat(64), group, identity));
    }
    assert.throws(() => deploymentScope({ ...input, functions: [...names, 'createPago'] }));
    assert.throws(() => deploymentScope({ ...input, functions: [] }));
    assert.throws(() => deploymentScope({ ...input, buildMode: 'UNKNOWN' }));
  }
  assert.throws(() => deploymentScope({ group: '__proto__', functions: [] }));
  assert.throws(() => deploymentScope({ group: 'security-readers', functions: [...DEPLOYMENT_GROUPS.receipts] }));
});

test('proof requires exact names and counts for new groups and supports legacy receipt proof', () => {
  const oldInput = { functions: [...DEPLOYMENT_GROUPS.receipts], sourceCommit: 'commit', archiveSha256: 'archive' };
  const oldProof = { status: 'PASS', sourceCommit: 'commit', archiveSha256: 'archive', unauthenticatedDenied: 2 };
  assertArtifactProof(oldInput, oldProof);
  const input = { ...oldInput, group: 'security-readers', functions: [...DEPLOYMENT_GROUPS['security-readers']], buildMode: 'BUNDLED_V1' };
  const proof = { ...oldProof, functions: input.functions, unauthenticatedDenied: 9, buildMode: 'BUNDLED_V1' };
  assertArtifactProof(input, proof);
  for (const patch of [{ functions: undefined }, { functions: [...input.functions].reverse() }, { unauthenticatedDenied: 8 }, { buildMode: 'NORMAL' }])
    assert.throws(() => assertArtifactProof(input, { ...proof, ...patch }));
});

test('source and operation namespaces are exact to the production project and region', () => {
  assertUploadSource(upload);
  for (const patch of [{ generation: '0' }, { generation: '-1' }, { bucket: 'gcf-v2-uploads-999.us-central1.cloudfunctions.appspot.com' }, { bucket: 'gcf-v2-sources-751158244178-europe-west1' }])
    assert.throws(() => assertUploadSource({ ...upload, ...patch }));
  for (const project of ['pay-0-system', '751158244178']) assertOperationScope({ name: `projects/${project}/locations/us-central1/operations/fixture` });
  for (const name of ['projects/foreign/locations/us-central1/operations/id', 'projects/pay-0-system/locations/europe-west1/operations/id']) assert.throws(() => assertOperationScope({ name }));
});
test('resume rollback artifact must match its original baseline source and revision', () => {
  const before = resource(), bytes = Buffer.from('synthetic archived source');
  const receipt = { sha256: createHash('sha256').update(bytes).digest('hex'), source: previousSource(before), previousRevision: before.serviceConfig.revision };
  assertPreservedSource(before, receipt, bytes);
  assert.throws(() => assertPreservedSource(before, receipt, Buffer.from('changed')));
  assert.throws(() => assertPreservedSource(before, { ...receipt, previousRevision: 'foreign' }, bytes));
  assert.throws(() => assertPreservedSource(before, { ...receipt, source: { ...receipt.source, generation: '999' } }, bytes));
});

test('Run comparison allows only release bookkeeping and preserves env, scaling, concurrency and traffic', () => {
  const before = { name: 'service', generation: '1', updateTime: 'first', latestReadyRevision: 'service/revisions/old', latestCreatedRevision: 'service/revisions/old',
    labels: { 'firebase-functions-hash': 'old', keep: 'yes' }, scaling: { maxInstanceCount: 4 }, ingress: 'ALL',
    terminalCondition: { state: 'CONDITION_SUCCEEDED', lastTransitionTime: 'first' },
    template: { revision: 'old', labels: { 'firebase-functions-hash': 'old' }, maxInstanceRequestConcurrency: 80, containers: [{ image: 'old', env: [{ name: 'FIXTURE', value: 'preserved' }], resources: { limits: { cpu: '1' } } }] },
    traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }], trafficStatuses: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100, revision: 'old' }],
    buildConfig: { name: 'old', sourceLocation: 'old', imageUri: 'old', functionTarget: 'same' } };
  const after = structuredClone(before); after.generation = '2'; after.updateTime = 'next'; after.latestReadyRevision = 'service/revisions/next'; after.latestCreatedRevision = after.latestReadyRevision;
  after.labels['firebase-functions-hash'] = 'new'; after.labels['pay0-source-commit'] = 'commit'; after.template.revision = 'next'; after.template.labels['firebase-functions-hash'] = 'new'; after.template.containers[0].image = 'new';
  after.terminalCondition.lastTransitionTime = 'next'; after.trafficStatuses[0].revision = 'next'; after.buildConfig.sourceLocation = 'new';
  assertRunRuntimePreserved(before, after);
  for (const change of [row => { row.template.containers[0].env = []; }, row => { row.template.maxInstanceRequestConcurrency = 1; }, row => { row.scaling.maxInstanceCount = 9; }, row => { row.traffic[0].percent = 50; }, row => { row.labels.keep = 'lost'; }, row => { row.buildConfig.functionTarget = 'other'; }]) {
    const changed = structuredClone(after); change(changed); assert.throws(() => assertRunRuntimePreserved(before, changed));
  }
});

// Sanitized shape of the 2026-10-16 listPagoNotes before/after snapshots.
// No production environment, source location, IAM members or revision IDs are retained.
function googleIdentityFixture() {
  const before = { name: 'projects/pay-0-system/locations/us-central1/services/listpagonotes',
    annotations: {}, template: { labels: { 'deployment-callable': 'true' }, maxInstanceRequestConcurrency: 80,
      containers: [{ env: [{ name: 'SYNTHETIC', value: 'unchanged' }], resources: { limits: { cpu: '1' } } }] },
    terminalCondition: { state: 'CONDITION_SUCCEEDED' }, buildConfig: { functionTarget: 'listPagoNotes' },
    invokerIamDisabled: false, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] };
  const after = structuredClone(before);
  Object.assign(after.template.labels, { 'goog-drz-cloudfunctions-location': 'us-central1', 'goog-drz-cloudfunctions-id': 'listpagonotes' });
  after.annotations['cloudfunctions.googleapis.com/function-id'] = 'listPagoNotes';
  return { before, after };
}
test('canonical Google identity additions are allowed without changing inputs', () => {
  const { before, after } = googleIdentityFixture(), original = structuredClone(after);
  assertRunRuntimePreserved(before, after); assert.deepEqual(after, original);
  delete before.annotations; assertRunRuntimePreserved(before, after);
  const unchanged = structuredClone(after); assertRunRuntimePreserved(unchanged, after);
});
test('Google identity additions must match exact function, service, project and region', () => {
  for (const mutate of [
    ({after}) => { after.template.labels['goog-drz-cloudfunctions-location'] = 'europe-west1'; },
    ({after}) => { after.template.labels['goog-drz-cloudfunctions-id'] = 'other'; },
    ({after}) => { after.annotations['cloudfunctions.googleapis.com/function-id'] = 'listpagonotes'; },
    ({before,after}) => { before.name = after.name = before.name.replace('pay-0-system', 'foreign'); },
    ({before,after}) => { before.name = after.name = before.name.replace('us-central1', 'europe-west1'); },
    ({before,after}) => { before.buildConfig.functionTarget = after.buildConfig.functionTarget = 'listPagos'; },
  ]) { const value=googleIdentityFixture(); mutate(value); assert.throws(()=>assertRunRuntimePreserved(value.before,value.after)); }
});
test('existing identity metadata is never normalized, repaired or removed', () => {
  for (const [location,key] of [['labels','goog-drz-cloudfunctions-location'],['labels','goog-drz-cloudfunctions-id'],['annotations','cloudfunctions.googleapis.com/function-id']]) {
    const {before,after}=googleIdentityFixture();
    const oldMap=location==='labels'?before.template.labels:before.annotations;
    const newMap=location==='labels'?after.template.labels:after.annotations;
    oldMap[key]='preexisting-different';
    assert.throws(()=>assertRunRuntimePreserved(before,after));
    newMap[key]=oldMap[key]; assertRunRuntimePreserved(before,after);
    delete newMap[key]; assert.throws(()=>assertRunRuntimePreserved(before,after));
  }
});
test('identity tolerance does not hide other annotations, runtime, invoker or traffic drift', () => {
  for (const mutate of [
    after=>{after.annotations['other.googleapis.com/key']='new';},
    after=>{after.template.labels['goog-other-key']='new';},
    after=>{after.template.containers[0].env[0].value='changed';},
    after=>{after.template.maxInstanceRequestConcurrency=1;},
    after=>{after.invokerIamDisabled=true;},
    after=>{after.traffic[0].percent=50;},
  ]) {const {before,after}=googleIdentityFixture(); mutate(after); assert.throws(()=>assertRunRuntimePreserved(before,after));}
});
