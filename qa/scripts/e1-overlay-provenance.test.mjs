import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOnlyPatch, assertArtifactProof, assertPublishedIdentity, validateSourceIdentity, assertRunRuntimePreserved, artifactProbeContract, assertRuntimePreserved } from '../../scripts/deploy-scoped-functions.mjs';

const identity = { mode: 'PRODUCTION_OVERLAY_V1', baseArchiveSha256: 'a'.repeat(64), patchCommit: 'b'.repeat(40), patchSha256: 'c'.repeat(64) };
const input = { group: 'hugo-chat-overlay', functions: ['sendAgent007Message'], sourceCommit: identity.patchCommit, sourceTree: null, archiveSha256: 'd'.repeat(64), sourceIdentity: identity };
const resource = { name: 'projects/pay-0-system/locations/us-central1/functions/sendAgent007Message', state: 'ACTIVE', labels: { owner: 'retained' }, buildConfig: { runtime: 'nodejs22', environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: '' } } };
const source = { bucket: 'gcf-v2-sources-751158244178-us-central1', object: 'fixture/function-source.zip', generation: '123' };

test('production overlay identifies deployed base and patch rather than claiming a complete checkout', () => {
  const patch = sourceOnlyPatch(resource, source, input.sourceCommit, input.archiveSha256, input.group, identity);
  assert.equal(patch.labels['pay0-source-mode'], 'production-overlay-v1');
  assert.equal(patch.labels['pay0-base-source'], identity.baseArchiveSha256.slice(0, 40));
  assert.equal(patch.labels.owner, 'retained');
  assert.deepEqual(resource.labels, { owner: 'retained' });
  assertPublishedIdentity(patch, input);
  assert.throws(() => assertPublishedIdentity({ ...patch, labels: { ...patch.labels, 'pay0-base-source': 'e'.repeat(40) } }, input));
});

test('artifact proof binds exact overlay base, patch, function scope and archive', () => {
  const proof = { status: 'PASS', sourceCommit: input.sourceCommit, archiveSha256: input.archiveSha256, functions: input.functions, unauthenticatedDenied: 1, sourceIdentity: identity };
  assertArtifactProof(input, proof);
  assert.throws(() => assertArtifactProof({ ...input, sourceTree: 'f'.repeat(40) }, proof), /OVERLAY_MUST_NOT_CLAIM_SOURCE_TREE/);
  assert.throws(() => assertArtifactProof(input, { ...proof, sourceIdentity: { ...identity, baseArchiveSha256: 'e'.repeat(64) } }));
  assert.throws(() => validateSourceIdentity({ ...identity, patchCommit: 'f'.repeat(40) }, input.group, input.sourceCommit));
  assert.throws(() => validateSourceIdentity(identity, 'receipts', input.sourceCommit));
  assert.throws(() => validateSourceIdentity(undefined, input.group, input.sourceCommit));
  assert.throws(() => validateSourceIdentity({ ...identity, extra: true }, input.group, input.sourceCommit));
});

test('document generation overlay pins only the authorized download endpoint', () => {
  const documentInput = { ...input, group: 'document-generation-overlay', functions: ['getAuthorizedDocumentDownloadUrl'] };
  const proof = { status: 'PASS', sourceCommit: input.sourceCommit, archiveSha256: input.archiveSha256,
    functions: documentInput.functions, unauthenticatedDenied: 1, sourceIdentity: identity };
  assertArtifactProof(documentInput, proof);
  assert.throws(() => assertArtifactProof({ ...documentInput, functions: ['listOperationalDocuments'] }, proof), /FUNCTION_SCOPE/);
  assert.throws(() => validateSourceIdentity(undefined, documentInput.group, input.sourceCommit), /OVERLAY_IDENTITY_REQUIRED/);
});

for (const [group, name] of [['operation-recovery-queue-overlay', 'queueOperationRecovery'], ['operation-recovery-reconcile-overlay', 'reconcileOperationRecovery']]) {
  test(`${group} requires non-invoking registration proof and exact artifact behavior`, () => {
    const backgroundInput = { ...input, group, functions: [name] };
    const proof = { status: 'PASS', sourceCommit: input.sourceCommit, archiveSha256: input.archiveSha256, sourceIdentity: identity,
      functions: [name], registrationContract: artifactProbeContract(group), registeredFunctions: 1, invokedFunctions: 0,
      behaviorVerification: { status: 'PASS', archiveSha256: input.archiveSha256, terminalPreserved: true, retryBudgetPreserved: true, scopedRootsPreserved: true } };
    assertArtifactProof(backgroundInput, proof);
    assert.throws(() => assertArtifactProof(backgroundInput, { ...proof, invokedFunctions: 1 }));
    assert.throws(() => assertArtifactProof(backgroundInput, { ...proof, registrationContract: { kind: 'CALLABLE' }, unauthenticatedDenied: 1 }));
    for (const field of ['terminalPreserved', 'retryBudgetPreserved', 'scopedRootsPreserved']) {
      assert.throws(() => assertArtifactProof(backgroundInput, { ...proof, behaviorVerification: { ...proof.behaviorVerification, [field]: false } }));
    }
    assert.throws(() => assertArtifactProof(backgroundInput, { ...proof, behaviorVerification: { ...proof.behaviorVerification, archiveSha256: 'other' } }));
  });
}

test('source-only verification never permits an event trigger change', () => {
  const before = { serviceConfig: {}, buildConfig: {}, eventTrigger: { eventType: 'written', retryPolicy: 'RETRY_POLICY_RETRY' } };
  assertRuntimePreserved(before, structuredClone(before));
  const after = structuredClone(before); after.eventTrigger.retryPolicy = 'RETRY_POLICY_DO_NOT_RETRY';
  assert.throws(() => assertRuntimePreserved(before, after), /EVENT_TRIGGER_CHANGED/);
});

test('a later full-checkout update does not retain stale overlay provenance', () => {
  const baseline = { ...resource, labels: { owner: 'retained', 'pay0-source-mode': 'production-overlay-v1', 'pay0-base-source': 'a'.repeat(40), 'pay0-patch-sha': 'c'.repeat(40) } };
  const patch = sourceOnlyPatch(baseline, source, input.sourceCommit, input.archiveSha256, 'hugo-reports');
  assert.equal(patch.labels['pay0-source-mode'], undefined);
  assert.equal(patch.labels['pay0-base-source'], undefined);
});

test('Run comparison accepts only exact approved overlay labels and still rejects configuration drift', () => {
  const before = { labels: { owner: 'retained' }, template: { labels: { owner: 'retained' }, containers: [{ image: 'old', env: [{ name: 'SETTING', value: 'retained' }] }] }, terminalCondition: { state: 'CONDITION_SUCCEEDED' } };
  const after = structuredClone(before);
  const labels = { 'pay0-source-mode': 'production-overlay-v1', 'pay0-base-source': identity.baseArchiveSha256.slice(0, 40), 'pay0-patch-sha': identity.patchSha256.slice(0, 40) };
  Object.assign(after.labels, labels); Object.assign(after.template.labels, labels);
  assertRunRuntimePreserved(before, after, input);
  assert.throws(() => assertRunRuntimePreserved(before, after));
  for (const key of Object.keys(labels)) {
    const wrong = structuredClone(after); wrong.template.labels[key] = 'wrong';
    assert.throws(() => assertRunRuntimePreserved(before, wrong, input), /RUN_OVERLAY_PROVENANCE_CHANGED/);
  }
  const changed = structuredClone(after); changed.template.containers[0].env[0].value = 'changed';
  assert.throws(() => assertRunRuntimePreserved(before, changed, input), /RUN_CONFIGURATION_CHANGED/);
});
