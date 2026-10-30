// Read-only installation check. This does not audit vulnerabilities or certify a lockfile.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const shaFile = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const snapshot = directory => ({ manifestSha256: shaFile(path.join(directory, 'package.json')), lockSha256: shaFile(path.join(directory, 'package-lock.json')) });

function analyzeNpmTree(tree, exitCode) {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree) ||
      (typeof tree.name !== 'string' && (!tree.dependencies || typeof tree.dependencies !== 'object')))
    return { status: 'INDETERMINATE', reason: 'INVALID_NPM_TREE', findings: [], inspectedReferences: 0 };
  const findings = [], seen = new Set();
  let inspectedReferences = 0;
  function add(kind, dependency) {
    const key = `${kind}:${dependency}`;
    if (!seen.has(key)) { seen.add(key); findings.push({ kind, dependency }); }
  }
  function visit(node, trail) {
    if (!node || typeof node !== 'object') return;
    if (trail) {
      inspectedReferences++;
      if (node.missing === true) add('MISSING', trail);
      if (node.invalid) add('INVALID', trail);
      if (node.extraneous === true) add('EXTRANEOUS', trail);
    }
    for (const [name, child] of Object.entries(node.dependencies || {})) visit(child, trail ? `${trail} > ${name}` : name);
    for (const problem of Array.isArray(node.problems) ? node.problems : []) {
      // npm reports deduplicated dependencies in the root problems list too.
      // Do not persist raw problem text: it can include absolute paths or registry URLs.
      const kind = /^(missing|invalid|extraneous):/.exec(String(problem))?.[1]?.toUpperCase();
      if (!kind) add('UNCLASSIFIED', trail || '(root)');
      else if (!findings.some(row => row.kind === kind)) add(kind, '(npm-summary)');
    }
  }
  visit(tree, '');
  const broken = findings.some(row => ['MISSING', 'INVALID'].includes(row.kind));
  const unknown = findings.some(row => row.kind === 'UNCLASSIFIED');
  if (broken) return { status: 'FAIL', reason: 'BROKEN_RUNTIME_DEPENDENCY_TREE', findings, inspectedReferences };
  if (unknown || (exitCode !== 0 && !findings.length) || tree.error && exitCode !== 0)
    return { status: 'INDETERMINATE', reason: 'NPM_REPORTED_UNCLASSIFIED_FAILURE', findings, inspectedReferences };
  if (exitCode !== 0) return { status: 'INDETERMINATE', reason: 'NPM_NONZERO_WITHOUT_BROKEN_EDGE', findings, inspectedReferences };
  return { status: 'PASS', reason: 'NPM_RUNTIME_TREE_SATISFIED', findings, inspectedReferences };
}

function inspectRuntimeDependencyClosure(directory, { timeout = 60000, runner = spawnSync } = {}) {
  directory = fs.realpathSync(directory);
  const before = snapshot(directory);
  if (!before.manifestSha256) throw Error('RUNTIME_MANIFEST_REQUIRED');
  const args = ['ls', '--omit=dev', '--all', '--offline', '--json'];
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd', ...args] : args;
  const result = runner(command, commandArgs, { cwd: directory, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_update_notifier: 'false', npm_config_logs_max: '0', npm_config_audit: 'false', npm_config_fund: 'false' } });
  let tree, analysis;
  try { tree = JSON.parse(result.stdout || ''); analysis = analyzeNpmTree(tree, result.status); }
  catch { analysis = { status: 'INDETERMINATE', reason: 'NPM_JSON_UNAVAILABLE', findings: [], inspectedReferences: 0 }; }
  if (result.error || result.signal) analysis = { ...analysis, status: 'INDETERMINATE', reason: result.error?.code === 'ETIMEDOUT' ? 'NPM_TIMED_OUT' : 'NPM_EXECUTION_FAILED' };
  const after = snapshot(directory);
  if (JSON.stringify(before) !== JSON.stringify(after)) analysis = { ...analysis, status: 'INDETERMINATE', reason: 'MANIFEST_OR_LOCK_CHANGED_DURING_CHECK' };
  return { schemaVersion: 1, method: 'npm-ls-runtime-closure', ...analysis, npmExitCode: result.status ?? null,
    manifestSha256: before.manifestSha256, lockSha256: before.lockSha256, checkedAt: new Date().toISOString(),
    manifestAndLockUnchanged: JSON.stringify(before) === JSON.stringify(after), vulnerabilityReview: 'NOT_PERFORMED', lockfileConformance: 'NOT_VERIFIED',
    limitations: ['Optional dependencies and optional peers may be absent.', 'Platform-excluded packages are not required.',
      'Required runtime peers are checked by npm.', 'Dynamic imports and native binaries are not executed.',
      'Extraneous packages are reported but do not prove a missing runtime edge.', 'Concurrent dependency installation is not supported; node_modules is not frozen by this check.',
      'PASS does not certify an exact installation or vulnerability status.'] };
}

module.exports = { analyzeNpmTree, inspectRuntimeDependencyClosure };
if (require.main === module) {
  try {
    const args = process.argv.slice(2), directory = args.shift();
    if (!directory || args.length && (args.length !== 2 || args[0] !== '--output')) throw Error('Use <runtime-directory> [--output <report.json>]');
    const result = inspectRuntimeDependencyClosure(directory);
    if (args[0] === '--output') {
      const output = path.resolve(args[1]), runtime = fs.realpathSync(directory);
      if (output === runtime || output.startsWith(runtime + path.sep)) throw Error('OUTPUT_MUST_BE_OUTSIDE_RUNTIME');
      fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result));
    process.exitCode = result.status === 'PASS' ? 0 : result.status === 'FAIL' ? 1 : 2;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
