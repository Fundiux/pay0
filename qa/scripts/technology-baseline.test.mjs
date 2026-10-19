import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { components, inspectTechnology, parseUniqueJson, matchesDeclaredVersion } from '../../scripts/verify-technology-baseline.mjs';
import { CANDIDATE_GATES } from '../../scripts/prepare-release-candidate.mjs';

test('candidate runs technology validation before installing dependencies', () => {
  assert.equal(CANDIDATE_GATES[0][0], 'technology-contract');
  assert.equal(CANDIDATE_GATES[1][0], 'technology-negative-tests');
  assert.equal(CANDIDATE_GATES[2][0], 'frontend-dependencies');
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pay0-technology-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof data === 'string' ? data : JSON.stringify(data));
  };
  for (const component of components) {
    const manifest = { name: component, engines: { node: '22' }, dependencies: { fixture: '^1.0.0' } };
    write(`${component}/package.json`, manifest);
    write(`${component}/package-lock.json`, { lockfileVersion: 3, packages: { '': manifest, 'node_modules/fixture': { version: '1.1.0', integrity: 'sha512-fixture' } } });
  }
  write('firebase.json', { functions: { runtime: 'nodejs22' } });
  write('.github/workflows/ci.yml', 'node-version: 22\n');
  write('config/release-baseline.json', { version: 1 });
  write('services/iq-staging-canary/package.json', { engines: { node: '>=22 <23' } });
  return { root, write };
}

test('reject duplicate keys, including escaped keys, but permit keys in separate objects', () => {
  assert.throws(() => parseUniqueJson('{"dependencies":{"x":"1","x":"2"}}'), /duplicate key x/);
  assert.throws(() => parseUniqueJson('{"x":1,"\\u0078":2}'), /duplicate key x/);
  assert.deepEqual(parseUniqueJson('[{"x":1},{"x":2}]'), [{ x: 1 }, { x: 2 }]);
});

test('range matching respects exact, caret zero-major and tilde boundaries', () => {
  for (const [version, range, expected] of [
    ['1.1.0', '^1.0.0', true], ['2.0.0', '^1.0.0', false],
    ['0.2.9', '^0.2.0', true], ['0.3.0', '^0.2.0', false],
    ['0.0.2', '^0.0.1', false], ['1.3.0', '~1.2.0', false],
    ['1.2.1', '1.2.0', false], ['1.2.0-beta', '^1.0.0', false],
  ]) assert.equal(matchesDeclaredVersion(version, range), expected);
});

test('valid fixture reports local identity without claiming deployment or certification', t => {
  const { root } = fixture(t);
  const report = inspectTechnology(root, { nodeVersion: '22.1.0' });
  assert.deepEqual(report.failures, []);
  assert.match(report.dependencyHash, /^[a-f0-9]{64}$/);
  assert.equal(report.production.runtime, 'UNKNOWN');
  assert.equal(report.certification, 'NOT_CERTIFIED');
  assert.equal(report.publication, 'NOT_PERFORMED');
});

test('reject manifest drift, incompatible resolved versions and runtime drift', t => {
  const { root, write } = fixture(t);
  write('package.json', { name: '.', engines: { node: '20' }, dependencies: { fixture: '^2.0.0' } });
  write('firebase.json', { functions: { runtime: 'nodejs20' } });
  write('.github/workflows/ci.yml', 'node-version: 20\n');
  const { failures } = inspectTechnology(root, { nodeVersion: '20.0.0' });
  for (const expected of ['Node 22 required', 'manifest/lock mismatch', 'outside declared range', 'expected nodejs22', 'CI:', 'running Node']) {
    assert.ok(failures.some(failure => failure.includes(expected)), expected);
  }
});

test('installed verification rejects missing installations', t => {
  const { root } = fixture(t);
  assert.ok(inspectTechnology(root, { nodeVersion: '22.0.0', installed: true }).failures.some(failure => failure.includes('MISSING')));
});

test('security override cannot claim a patched UUID while locking vulnerable UUID', t => {
  const { root, write } = fixture(t);
  write('package.json', { name: '.', engines: { node: '22' }, dependencies: { fixture: '^1.0.0' }, overrides: { uuid: '11.1.1' } });
  assert.ok(inspectTechnology(root, { nodeVersion: '22.0.0' }).failures.some(failure => failure.includes('uuid security override')));
});
