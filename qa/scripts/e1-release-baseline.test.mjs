import test from 'node:test';
import assert from 'node:assert/strict';
import { EVOLUTION_FUNCTIONS, publicReleaseIdentity } from '../../scripts/capture-evolution-release-baseline.mjs';

test('release identity records exact source revisions without exposing runtime credentials', () => {
  const baseline = { capturedAt: 'fixture', functions: Object.fromEntries(EVOLUTION_FUNCTIONS.map(name => [name, {
    resource: { state: 'ACTIVE', serviceConfig: { revision: `${name}-001`, environmentVariables: { SECRET: 'do-not-expose' } }, buildConfig: { runtime: 'nodejs22' } },
    sourceArchive: { sha256: 'a'.repeat(64), source: { generation: '123' } },
  }])), gateway: { resource: { latestReadyRevision: 'gateway-001', template: { containers: [{ image: 'image@sha256:abc', env: [
    { name: 'HUGO_BUILD_COMMIT', value: 'b'.repeat(40) }, { name: 'TOKEN', value: 'do-not-expose' }, { name: 'KEY', valueSource: { secretKeyRef: { secret: 'private-name' } } },
  ] }] } }, iam: { bindings: [] } } };
  const report = publicReleaseIdentity(baseline);
  assert.equal(report.functions.length, 3);
  assert.equal(report.gateway.buildIdentity.HUGO_BUILD_COMMIT, 'b'.repeat(40));
  assert.equal(report.functionalVerification, 'NOT_PERFORMED');
  assert.equal(report.productionWrites, 0);
  assert.doesNotMatch(JSON.stringify(report), /do-not-expose|private-name/);
});
