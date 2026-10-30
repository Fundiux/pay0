const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeNpmTree, inspectRuntimeDependencyClosure } = require('./verify-runtime-dependency-closure.cjs');
const fixtures = require('../fixtures/runtime-dependency-closure.cjs');
const directory = path.resolve(__dirname, '../../output/dependency-closure/fixtures');
fs.mkdirSync(directory, { recursive: true });
function materialize(fixture) {
  const target = fs.mkdtempSync(path.join(directory, fixture.name + '-'));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'local-closure-fixture', version: '1.0.0', private: true, ...fixture.root }));
  for (const [name, manifest] of Object.entries(fixture.packages)) {
    const packageDirectory = path.join(target, 'node_modules', name);
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({ name, ...manifest }));
  }
  return target;
}
for (const fixture of fixtures) test(`real offline npm ls: ${fixture.name}`, () => {
  const result = inspectRuntimeDependencyClosure(materialize(fixture));
  assert.equal(result.status, fixture.expected, JSON.stringify(result));
  if (fixture.kind) assert.ok(result.findings.some(row => row.kind === fixture.kind), JSON.stringify(result));
  assert.equal(result.manifestAndLockUnchanged, true);
  assert.equal(result.vulnerabilityReview, 'NOT_PERFORMED');
  assert.equal(result.lockfileConformance, 'NOT_VERIFIED');
});
test('a nonzero npm invocation without a broken dependency is indeterminate', () => {
  assert.equal(analyzeNpmTree({ name: 'fixture', dependencies: {} }, 1).status, 'INDETERMINATE');
});
test('an error-shaped JSON response cannot become a pass even with zero exit status', () => {
  assert.equal(analyzeNpmTree({ error: { code: 'UNKNOWN' } }, 0).status, 'INDETERMINATE');
});
test('timeout and unparseable output cannot certify a runtime', () => {
  const target = materialize(fixtures[0]);
  const invalid = inspectRuntimeDependencyClosure(target, { runner: () => ({ status: 0, stdout: 'not json' }) });
  assert.equal(invalid.status, 'INDETERMINATE');
  const timeout = inspectRuntimeDependencyClosure(target, { runner: () => ({ status: null, stdout: '{}', error: { code: 'ETIMEDOUT' } }) });
  assert.equal(timeout.status, 'INDETERMINATE');
  assert.equal(timeout.reason, 'NPM_TIMED_OUT');
});
test('manifest changes during inspection invalidate the snapshot', () => {
  const target = materialize(fixtures[0]);
  const result = inspectRuntimeDependencyClosure(target, { runner: () => {
    fs.appendFileSync(path.join(target, 'package.json'), '\n');
    return { status: 0, stdout: '{"dependencies":{}}' };
  } });
  assert.equal(result.status, 'INDETERMINATE');
  assert.equal(result.manifestAndLockUnchanged, false);
});
