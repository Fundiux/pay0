import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(value => value !== '--allow-dirty') || args.filter(value => value === '--allow-dirty').length > 1) throw Error('UNSUPPORTED_ARGUMENT');
if (process.versions.node.split('.')[0] !== '22') throw Error('NODE_22_REQUIRED');
const git = values => execFileSync('git', values, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
const commit = git(['rev-parse', 'HEAD']);
if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('GIT_COMMIT_REQUIRED');
const dirty = !!git(['status', '--porcelain=v1', '--untracked-files=all']);
if (dirty && !args.includes('--allow-dirty')) throw Error('CLEAN_COMMIT_REQUIRED_USE_ALLOW_DIRTY_FOR_LOCAL_TEST_ONLY');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const service = 'services/iq-staging-canary';
const policy = 'functions/src/modules/iq/externalActionsPolicy.ts';
const copyNames = ['server.mjs', 'package.json', 'Dockerfile', '.dockerignore', 'cloud-run.service.yaml', 'README.md'];
const sourceNames = [policy, 'scripts/prepare-iq-staging-canary.mjs', ...copyNames.map(name => `${service}/${name}`)];
// A clean preparation reads the commit itself, so an editor racing this command
// cannot silently replace committed inputs. Dirty snapshots are local-only.
const sourceBytes = new Map(sourceNames.map(name => [name, dirty ? fs.readFileSync(path.join(root, name)) :
  execFileSync('git', ['show', `${commit}:${name}`], { cwd: root, windowsHide: true, timeout: 15000 })]));
const sources = sourceNames.map(name => ({ path: name, sha256: sha(sourceBytes.get(name)) }));
const sourceDigest = sha(JSON.stringify(sources));
const base = path.join(root, 'tmp', 'iq-staging-canary');
const output = path.resolve(base, `${commit.slice(0, 12)}-${sourceDigest.slice(0, 16)}`);
if (!output.startsWith(base + path.sep)) throw Error('OUTPUT_SCOPE_INVALID');
fs.mkdirSync(output, { recursive: true });
for (const name of copyNames) fs.writeFileSync(path.join(output, name), sourceBytes.get(`${service}/${name}`));
const compiled = ts.transpileModule(sourceBytes.get(policy).toString('utf8'), {
  fileName: policy, reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, sourceMap: false, removeComments: false },
});
if (compiled.diagnostics?.some(row => row.category === ts.DiagnosticCategory.Error) || /\b(?:import|require)\s*\(/.test(compiled.outputText)) throw Error('POLICY_BUILD_FAILED');
fs.writeFileSync(path.join(output, 'externalActionsPolicy.mjs'), compiled.outputText);
const artifacts = [...copyNames, 'externalActionsPolicy.mjs'].map(name => ({ path: name, sha256: sha(fs.readFileSync(path.join(output, name))) }));
const manifest = {
  revision: 'PAY0_IQ_STAGING_SAFETY_V1', projectId: 'pay-0-system-staging', serviceName: 'pay0-iq-staging-safety', region: 'us-central1',
  sourceCommit: commit, workingTreeDirty: dirty, sourceReadyForBuild: !dirty, deployReady: false,
  localOnly: dirty, nodeVersion: process.version, typescriptVersion: ts.version,
  externalActions: 'disabled', financialEndToEnd: false, cloudAccessPerformed: false,
  containerBuilt: false, baseImage: 'node:22.23.2-alpine', baseImageDigest: null,
  requiresPrivateInvoker: true, requiresUnprivilegedRuntimeAccount: true,
  sourceDigest, sources, artifacts,
};
const bytes = JSON.stringify(manifest, null, 2) + '\n';
fs.writeFileSync(path.join(output, 'manifest.json'), bytes);
console.log(JSON.stringify({ ok: true, output, manifestSha256: sha(bytes), sourceCommit: commit, sourceDigest, workingTreeDirty: dirty,
  deployReady: false, sourceReadyForBuild: !dirty, files: artifacts.length + 1, cloudAccessPerformed: false }));
