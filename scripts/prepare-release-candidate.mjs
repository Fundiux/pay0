import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { inspectIntegration, integrationSummary } from './inspect-modular-integration.mjs';

export const CANDIDATE_GATES = [
  ['technology-contract', 'node', ['scripts/verify-technology-baseline.mjs']],
  ['technology-negative-tests', 'node', ['--test', 'qa/scripts/technology-baseline.test.mjs']],
  ['frontend-dependencies', 'npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund']],
  ['functions-dependencies', 'npm', ['ci', '--prefix', 'functions', '--prefer-offline', '--no-audit', '--no-fund']],
  ['authorization-policy', 'node', ['scripts/verify-authorization-policy.mjs']],
  ['authorization-contract', 'node', ['--test', 'qa/scripts/remediation-document-policy-specialization.test.mjs', 'qa/scripts/remediation-restrictions.test.cjs']],
  ['candidate-contract', 'node', ['--test', 'qa/scripts/release-candidate.test.mjs', 'qa/scripts/modular-integration.test.mjs', 'qa/scripts/scoped-deployment.test.mjs']],
  ['engineering-contract', 'node', ['--test', 'qa/scripts/engineering-catalog.test.cjs', 'qa/scripts/engineering-evidence.test.cjs']],
  ['receipt-contract', 'node', ['--test', 'qa/scripts/remediation-ocr-quota.test.cjs', 'qa/scripts/receipt-corpus.test.cjs']],
  ['materiality-contract', 'node', ['qa/scripts/check-materiality-canon.mjs']],
  ['functions-lint', 'npm', ['--prefix', 'functions', 'run', 'lint']],
  ['functions-build', 'npm', ['--prefix', 'functions', 'run', 'build']],
  ['frontend-build', 'npm', ['run', 'build']],
];

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Git fallo: ${args[0]}`);
  return result.stdout.trim();
}

export function inspectSource(cwd, mainRef = 'main') {
  // Preserve historical audit/prose files and nested worktrees. All tracked
  // changes still fail, as does untracked code outside these explicit artifacts.
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const localArtifact = file => /^(?:audit\/|docs\/(?:audits|architecture)\/|qa\/artifacts\/|\.worktrees\/)/.test(file)
    || /^functions\/\.tmp-[^/]+\.cjs$/.test(file);
  const sourceUntracked = untracked.filter(file => !localArtifact(file));
  if (git(cwd, ['status', '--porcelain=v1', '--untracked-files=no']) || sourceUntracked.length) {
    throw new Error('Se requiere un checkout limpio, sin cambios ni archivos no rastreados.');
  }
  const sourceCommit = git(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const mainCommit = git(cwd, ['rev-parse', '--verify', `${mainRef}^{commit}`]);
  const [mainOnly, candidateOnly] = git(cwd, ['rev-list', '--left-right', '--count', `${mainCommit}...${sourceCommit}`]).split(/\s+/).map(Number);
  return {
    sourceCommit,
    sourceTree: git(cwd, ['rev-parse', 'HEAD^{tree}']),
    mainRef,
    mainCommit,
    mainOnly,
    candidateOnly,
    mainCompatibility: mainOnly === 0 ? 'contains-main' : 'diverged-not-integration-validated',
    referenceFreshness: 'local-reference-no-fetch',
    ignoredNonSourceUntracked: untracked.length - sourceUntracked.length,
  };
}

function runGate(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error || result.status !== 0) throw new Error('El control fallo; consulte la salida local.');
}

export function prepareCandidate({ cwd = process.cwd(), mainRef = 'main', execute = runGate } = {}) {
  const source = inspectSource(cwd, mainRef);
  if (git(cwd, ['check-ignore', 'output/release-candidates/probe']) !== 'output/release-candidates/probe') {
    throw new Error('output/release-candidates debe estar ignorado por Git.');
  }
  const directory = path.join(cwd, 'output', 'release-candidates', `${source.sourceCommit.slice(0, 12)}-${crypto.randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  const report = {
    schemaVersion: 1, ...source, startedAt: new Date().toISOString(),
    integration: integrationSummary(inspectIntegration(cwd, mainRef)),
    nodeVersion: process.version, status: 'checking', checks: [],
    scope: 'committed-source-and-local-gates', deploymentAuthorized: false,
    productionExercised: false,
    blockingFindings: fs.existsSync(path.join(cwd, 'config/engineering-receipts-release.json'))
      ? JSON.parse(fs.readFileSync(path.join(cwd, 'config/engineering-receipts-release.json'), 'utf8')).blockingFindings || [] : [],
    productionCertified: false,
    limitations: ['No production, IQ, Telegram or WhatsApp validation', 'No emulator or browser validation in this gate', 'Source archive is not a deployment bundle'],
  };
  const reportPath = path.join(directory, 'evidence.json');
  const write = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  write();
  try {
    for (const [name, command, args] of CANDIDATE_GATES) {
      const check = { name, command: [command, ...args], status: 'running' };
      report.checks.push(check);
      write();
      try { execute(command, args, cwd); check.status = 'passed'; }
      catch (error) { check.status = 'failed'; throw error; }
      write();
    }
    const after = inspectSource(cwd, mainRef);
    if (after.sourceCommit !== source.sourceCommit || after.mainCommit !== source.mainCommit) {
      throw new Error('HEAD o la referencia main cambio durante la validacion.');
    }
    const archive = path.join(directory, 'source.tar');
    git(cwd, ['archive', '--format=tar', `--output=${archive}`, source.sourceCommit]);
    report.sourceArchive = 'source.tar';
    report.sourceArchiveSha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    report.status = 'validated-source-candidate';
  } catch (error) {
    report.status = 'failed';
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    write();
  }
  return { report, reportPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--main-ref' || !/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(args[1]))) {
      throw new Error('Uso: node scripts/prepare-release-candidate.mjs [--main-ref main|origin/main]');
    }
    if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Se requiere Node 22.');
    const result = prepareCandidate({ mainRef: args[1] || 'main' });
    console.log(`Candidato validado: ${result.reportPath}`);
    console.log(`Compatibilidad con main: ${result.report.mainCompatibility}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
