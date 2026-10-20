import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectSource, prepareCandidate, CANDIDATE_GATES } from '../../scripts/prepare-release-candidate.mjs';

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pay0-candidate-test-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Synthetic fixture');
  fs.writeFileSync(path.join(cwd, '.gitignore'), 'output/\n.env.local\n');
  fs.writeFileSync(path.join(cwd, 'source.txt'), 'committed source\n');
  git('add', '.'); git('commit', '-m', 'Create fixture');
  return { cwd, git };
}

test('rejects tracked and untracked changes without deleting either', t => {
  const { cwd, git } = fixture(t);
  fs.writeFileSync(path.join(cwd, 'source.txt'), 'changed');
  assert.throws(() => inspectSource(cwd), /checkout limpio/);
  git('restore', 'source.txt');
  fs.writeFileSync(path.join(cwd, 'new-source.js'), 'new');
  assert.throws(() => inspectSource(cwd), /checkout limpio/);
  assert.equal(fs.readFileSync(path.join(cwd, 'new-source.js'), 'utf8'), 'new');
});

test('reports divergent main honestly and refuses missing references', t => {
  const { cwd, git } = fixture(t);
  git('checkout', '-b', 'candidate');
  fs.writeFileSync(path.join(cwd, 'candidate.txt'), 'candidate');
  git('add', '.'); git('commit', '-m', 'Candidate change');
  git('checkout', 'main');
  fs.writeFileSync(path.join(cwd, 'main.txt'), 'main');
  git('add', '.'); git('commit', '-m', 'Main change');
  git('checkout', 'candidate');
  const result = inspectSource(cwd);
  assert.equal(result.mainOnly, 1);
  assert.equal(result.candidateOnly, 1);
  assert.equal(result.mainCompatibility, 'diverged-not-integration-validated');
  assert.throws(() => inspectSource(cwd, 'missing'), /Git fallo/);
});

test('preserves explicitly classified local audit artifacts but rejects untracked runtime code', t => {
  const { cwd } = fixture(t);
  fs.mkdirSync(path.join(cwd, 'audit'));
  fs.writeFileSync(path.join(cwd, 'audit', 'local.json'), '{}');
  assert.equal(inspectSource(cwd).ignoredNonSourceUntracked, 1);
  fs.mkdirSync(path.join(cwd, 'functions', 'src'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'functions', 'src', 'new.ts'), 'export {};');
  assert.throws(() => inspectSource(cwd), /checkout limpio/);
  assert(fs.existsSync(path.join(cwd, 'audit', 'local.json')));
});

test('archives exact HEAD, excludes ignored credentials and records every successful gate', t => {
  const { cwd, git } = fixture(t);
  fs.writeFileSync(path.join(cwd, '.env.local'), 'SYNTHETIC_SECRET=do-not-archive');
  const executed = [];
  const { report, reportPath } = prepareCandidate({ cwd, execute: (command, args) => executed.push([command, ...args]) });
  assert.equal(report.sourceCommit, git('rev-parse', 'HEAD'));
  assert.equal(report.status, 'validated-source-candidate');
  assert.equal(report.deploymentAuthorized, false);
  assert.equal(executed.length, CANDIDATE_GATES.length);
  assert(report.checks.every(check => check.status === 'passed'));
  assert.match(report.sourceArchiveSha256, /^[a-f0-9]{64}$/);
  const archive = fs.readFileSync(path.join(path.dirname(reportPath), 'source.tar'));
  assert(archive.includes(Buffer.from('committed source')));
  assert(!archive.includes(Buffer.from('SYNTHETIC_SECRET')));
});

test('gate failure records failure and never creates source archive', t => {
  const { cwd } = fixture(t);
  assert.throws(() => prepareCandidate({ cwd, execute: () => { throw new Error('synthetic gate failure'); } }), /synthetic gate failure/);
  const base = path.join(cwd, 'output/release-candidates');
  const directory = path.join(base, fs.readdirSync(base)[0]);
  const evidence = JSON.parse(fs.readFileSync(path.join(directory, 'evidence.json')));
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.checks[0].status, 'failed');
  assert(!fs.existsSync(path.join(directory, 'source.tar')));
});

test('successful local gates preserve known blockers and never certify production', t => {
  const { cwd, git } = fixture(t);
  fs.mkdirSync(path.join(cwd, 'config'));
  const finding = { code: 'SYNTHETIC_RULE_GATE_FAILURE', requiredAction: 'Resolve before publication' };
  fs.writeFileSync(path.join(cwd, 'config/engineering-receipts-release.json'), JSON.stringify({ blockingFindings: [finding] }));
  git('add', 'config'); git('commit', '-m', 'Record blocking finding');
  const { report } = prepareCandidate({ cwd, execute: () => {} });
  assert.deepEqual(report.blockingFindings, [finding]);
  assert.equal(report.productionCertified, false);
  assert.equal(report.deploymentAuthorized, false);
});

test('source changes during checks invalidate candidate', t => {
  const { cwd } = fixture(t);
  assert.throws(() => prepareCandidate({ cwd, execute: () => fs.writeFileSync(path.join(cwd, 'source.txt'), 'mutated during gate') }), /checkout limpio/);
});

test('a new clean commit during checks cannot inherit evidence for original HEAD', t => {
  const { cwd, git } = fixture(t);
  let changed = false;
  assert.throws(() => prepareCandidate({ cwd, execute: () => {
    if (changed) return;
    changed = true;
    fs.writeFileSync(path.join(cwd, 'source.txt'), 'new commit');
    git('add', '.'); git('commit', '-m', 'Change HEAD during checks');
  } }), /referencia main cambio/);
});
