// Preparation and read-only preflight for a complete, immutable Hosting release.
// Deliberately contains no cloud mutation or deployment command.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { inspectSource } from './prepare-release-candidate.mjs';
import { PROJECT, REGION, digest, getMetadata, tokenInMemory } from './capture-production-baseline.mjs';

const require = createRequire(import.meta.url);
const legacy = require('./lib/notes-hosting-ssr-update-only.cjs');
const ROOT = path.resolve(import.meta.dirname, '..');
const PRIVATE = path.join(ROOT, '.firebase/modular-release');
const NAME = 'ssrpay0system';
const RESOURCE = `projects/${PROJECT}/locations/${REGION}/functions/${NAME}`;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const helperSha = () => sha(fs.readFileSync(import.meta.filename));
const executorSha = () => sha(fs.readFileSync(path.join(import.meta.dirname, 'deploy-modular-hosting-execute.mjs')));
const guardPins = () => Object.fromEntries([
  'capture-production-baseline.mjs', 'deploy-scoped-functions.mjs', 'prepare-release-candidate.mjs',
  'inspect-modular-integration.mjs', 'lib/notes-hosting-ssr-update-only.cjs',
].map(file => [file, sha(fs.readFileSync(path.join(import.meta.dirname, file)))]));
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'GIT_FAILED'); return result.stdout.trim();
}
function privateFile(file) {
  const resolved = path.resolve(file);
  assert.ok(resolved.startsWith(PRIVATE + path.sep), 'PRIVATE_PATH_REQUIRED');
  for (let parent = resolved; parent !== ROOT; parent = path.dirname(parent))
    if (fs.existsSync(parent)) assert.ok(!fs.lstatSync(parent).isSymbolicLink(), 'PRIVATE_LINK_FORBIDDEN');
  assert.equal(spawnSync('git', ['check-ignore', '--quiet', '--', resolved], { cwd: ROOT }).status, 0, 'PRIVATE_NOT_IGNORED');
  return resolved;
}
export { privateFile, sha };
function write(file, value) { fs.writeFileSync(privateFile(file), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 }); }

export function artifactManifest(directory) {
  const rows = [];
  function walk(current, prefix = '') {
    assert.ok(!fs.lstatSync(current).isSymbolicLink(), 'ARTIFACT_LINK');
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      assert.ok(!item.isSymbolicLink(), 'ARTIFACT_LINK');
      assert.ok(!/^\.env(?:\.|$)/.test(item.name) && !['node_modules', '.git'].includes(item.name), 'ARTIFACT_PRIVATE_FILE');
      const relative = prefix + item.name, file = path.join(current, item.name);
      // These are non-runtime Next build outputs, never deployed.
      if (path.basename(directory) === '.next' && prefix === '' && ['cache', 'types', 'trace', 'dev'].includes(item.name)) continue;
      if (item.isDirectory()) walk(file, relative + '/');
      else { assert.ok(item.isFile(), 'ARTIFACT_NOT_FILE'); const bytes = fs.readFileSync(file); rows.push({ file: relative, bytes: bytes.length, sha256: sha(bytes) }); }
    }
  }
  walk(directory); return rows;
}

export function validateBaseline(value) {
  const row = value?.functions?.[NAME];
  assert.ok(row?.resource && row.service && row.iam, 'BASELINE_INCOMPLETE');
  legacy.baseline({ schema: 'PAY0-NOTES-HOSTING-BASELINE@1', function: row.resource });
  assert.equal(row.resource.name, RESOURCE, 'SSR_SCOPE');
  assert.ok(value.hosting?.releases?.[0]?.version?.config, 'HOSTING_CONFIG_REQUIRED');
  assert.equal(value.hosting.releases[0].version.status, 'FINALIZED', 'BASELINE_HOSTING_NOT_FINALIZED');
  assert.equal(row.service.terminalCondition?.state, 'CONDITION_SUCCEEDED', 'BASELINE_RUN_NOT_READY');
  assert.ok(!(value.operations?.operations || []).some(operation => !operation.done), 'BASELINE_ACTIVE_OPERATION');
  return row;
}

export function assertFreshBaseline(expected, actual) {
  validateBaseline(expected); validateBaseline(actual);
  for (const key of ['resource', 'service', 'iam'])
    assert.equal(digest(actual.functions[NAME][key]), digest(expected.functions[NAME][key]), `CONCURRENT_${key.toUpperCase()}_CHANGE`);
  assert.equal(digest(actual.hosting.releases[0]), digest(expected.hosting.releases[0]), 'CONCURRENT_HOSTING_CHANGE');
}

export function assertRoutePreservation(before, after) {
  assert.ok(before && after && typeof before === 'object' && typeof after === 'object', 'ROUTES_REQUIRED');
  const available = new Set(Object.values(after));
  for (const route of Object.values(before)) assert.ok(available.has(route), 'PRODUCTION_ROUTE_REMOVED');
}

export function assertRuntimeSourceCompatible(before, after) {
  // A runtime dependency/configuration change needs an independently reviewed runtime bundle.
  for (const key of ['dependencies', 'optionalDependencies', 'overrides', 'engines', 'type'])
    assert.deepEqual(after.package[key], before.package[key], `RUNTIME_SOURCE_CHANGED_${key}`);
  assert.equal(after.lock, before.lock, 'RUNTIME_LOCK_CHANGED');
  assert.equal(after.config, before.config, 'RUNTIME_NEXT_CONFIG_CHANGED');
}

export async function packageSsr(receipt, previousBytes) {
  const JSZip = require(path.join(ROOT, 'functions/node_modules/jszip'));
  const previous = await JSZip.loadAsync(previousBytes), zip = new JSZip();
  const date = new Date('2026-01-01T00:00:00Z');
  for (const root of ['next', 'public']) for (const row of receipt[root]) {
    assert.ok(typeof row.file === 'string' && !/[\\:\0]/.test(row.file) && !row.file.split('/').some(part => !part || part === '.' || part === '..') && !path.isAbsolute(row.file), 'UNSAFE_ARTIFACT_PATH');
    const relative = `${root === 'next' ? '.next' : 'public'}/${row.file}`;
    const file = path.join(receipt.cwd, relative);
    assert.ok(!fs.lstatSync(file).isSymbolicLink(), 'ARTIFACT_LINK');
    const bytes = fs.readFileSync(file);
    assert.equal(sha(bytes), row.sha256, 'ARTIFACT_CHANGED_DURING_STAGE');
    zip.file(relative, bytes, { date });
  }
  for (const file of ['next.config.mjs', 'package.json', 'package-lock.json', 'server.js']) {
    assert.ok(previous.file(file), 'PRODUCTION_RUNTIME_FILE_REQUIRED');
    zip.file(file, await previous.file(file).async('nodebuffer'), { date });
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export function assertSsrUpdatePlan(plan) { legacy.assertPlan(plan); }
export function assertSsrApiPreserved(input, baseline) {
  const row = validateBaseline(baseline);
  legacy.assertApi(input, { schema: 'PAY0-NOTES-HOSTING-BASELINE@1', function: row.resource });
}
export function assertHostingConfigPreserved(before, after, revisionTag) {
  assert.match(revisionTag, /^fh-[a-f0-9]{8,64}$/);
  const expected = structuredClone(before);
  const rewrites = expected.rewrites || [];
  let changed = 0;
  for (const rule of rewrites) if (rule.run?.serviceId === NAME && rule.run?.region === REGION) { rule.run.tag = revisionTag; changed++; }
  assert.ok(changed > 0, 'SSR_REWRITE_REQUIRED');
  assert.deepEqual(after, expected, 'HOSTING_CONFIGURATION_CHANGED');
}
export function rollbackPlan(baseline, expectedCurrent) {
  validateBaseline(baseline); validateBaseline(expectedCurrent);
  assert.notEqual(baseline.functions[NAME].resource.serviceConfig.revision, expectedCurrent.functions[NAME].resource.serviceConfig.revision, 'ROLLBACK_RELEASE_REQUIRED');
  return { schema: 'PAY0-MODULAR-HOSTING-ROLLBACK@1', expectedCurrentSha256: digest(expectedCurrent),
    previousVersion: baseline.hosting.releases[0].version.name,
    previousSource: baseline.functions[NAME].resource.buildConfig.source.storageSource,
    requiresFreshExactMatch: true, restoreHostingAndSsrTogether: true, executionImplemented: true };
}

async function environmentFingerprint(cwd) {
  const front = await import(pathToFileURL(path.join(cwd, 'scripts/frontend-build-env.mjs')).href);
  const { environment } = front.resolveFrontendBuildEnvironment({ cwd, processEnv: process.env });
  await front.validateFrontendBuildEnvironment(environment, { cwd });
  assert.notEqual(environment.NEXT_PUBLIC_USE_EMULATORS, 'true', 'PRODUCTION_EMULATORS_FORBIDDEN');
  return digest(Object.fromEntries(Object.entries(environment).filter(([key]) => key.startsWith('NEXT_PUBLIC_'))));
}

export async function build(cwd) {
  cwd = fs.realpathSync(cwd);
  const source = inspectSource(cwd);
  assert.equal(source.mainOnly, 0, 'MAIN_NOT_INCLUDED');
  const environmentSha256 = await environmentFingerprint(cwd);
  const directory = privateFile(path.join(PRIVATE, `hosting-${source.sourceCommit.slice(0, 12)}-${crypto.randomUUID()}`));
  fs.mkdirSync(directory, { recursive: true });
  const log = fs.openSync(path.join(directory, 'build.log'), 'wx', 0o600);
  let result;
  try {
    const dependencies = spawnSync('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'],
      { cwd, shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', log, log] });
    assert.equal(dependencies.status, 0, 'LOCKED_DEPENDENCIES_FAILED');
    result = spawnSync(process.execPath, ['scripts/run-with-frontend-build-env.mjs', '--', 'node', 'node_modules/next/dist/bin/next', 'build'],
      { cwd, windowsHide: true, stdio: ['ignore', log, log] });
  } finally { fs.closeSync(log); }
  assert.equal(result.status, 0, 'FRONTEND_BUILD_FAILED');
  assert.deepEqual(inspectSource(cwd), source, 'SOURCE_CHANGED_DURING_BUILD');
  assert.equal(await environmentFingerprint(cwd), environmentSha256, 'BUILD_ENVIRONMENT_CHANGED');
  const receipt = { schema: 'PAY0-MODULAR-HOSTING-BUILD@1', source, cwd, environmentSha256, helperSha256: helperSha(), guardPins: guardPins(),
    buildId: fs.readFileSync(path.join(cwd, '.next/BUILD_ID'), 'utf8'), next: artifactManifest(path.join(cwd, '.next')),
    public: artifactManifest(path.join(cwd, 'public')), finishedAt: new Date().toISOString(), status: 'PASS' };
  const file = path.join(directory, 'build.json'); write(file, receipt);
  return { buildFile: file, buildSha256: sha(fs.readFileSync(file)), sourceCommit: source.sourceCommit };
}

export async function prepare({ buildFile, buildSha256, baselineFile, previousZip, provenanceFile, cliRoot }) {
  assert.match(buildSha256, /^[a-f0-9]{64}$/);
  assert.equal(sha(fs.readFileSync(privateFile(buildFile))), buildSha256, 'BUILD_RECEIPT_CHANGED');
  const receipt = json(buildFile), baseline = json(privateFile(baselineFile)); validateBaseline(baseline);
  assert.equal(receipt.schema, 'PAY0-MODULAR-HOSTING-BUILD@1', 'BUILD_SCHEMA');
  assert.equal(receipt.status, 'PASS', 'BUILD_NOT_PASSED');
  assert.equal(receipt.helperSha256, helperSha(), 'HELPER_CHANGED');
  assert.deepEqual(receipt.guardPins, guardPins(), 'GUARD_DEPENDENCY_CHANGED');
  assert.deepEqual(inspectSource(receipt.cwd), receipt.source, 'SOURCE_CHANGED_AFTER_BUILD');
  assert.equal(await environmentFingerprint(receipt.cwd), receipt.environmentSha256, 'BUILD_ENVIRONMENT_CHANGED');
  assert.deepEqual(artifactManifest(path.join(receipt.cwd, '.next')), receipt.next, 'NEXT_CHANGED_AFTER_BUILD');
  assert.deepEqual(artifactManifest(path.join(receipt.cwd, 'public')), receipt.public, 'PUBLIC_CHANGED_AFTER_BUILD');
  const zipBytes = fs.readFileSync(privateFile(previousZip)), proof = json(provenanceFile);
  assert.equal(proof.status, 'FRONTEND_ARTIFACTS_PREPARED', 'PRODUCTION_PROVENANCE_REQUIRED');
  assert.equal(proof.ssrSha256, sha(zipBytes), 'PRODUCTION_ARTIFACT_MISMATCH');
  assert.match(proof.sourceCommit, /^[a-f0-9]{40}$/, 'PRODUCTION_COMMIT_REQUIRED');
  git(receipt.cwd, ['merge-base', '--is-ancestor', proof.sourceCommit, receipt.source.sourceCommit]);
  const sourceRuntime = ref => ({ package: JSON.parse(git(receipt.cwd, ['show', `${ref}:package.json`])),
    lock: sha(git(receipt.cwd, ['show', `${ref}:package-lock.json`])), config: sha(git(receipt.cwd, ['show', `${ref}:next.config.mjs`])) });
  assertRuntimeSourceCompatible(sourceRuntime(proof.sourceCommit), sourceRuntime(receipt.source.sourceCommit));
  const JSZip = require(path.join(ROOT, 'functions/node_modules/jszip'));
  const oldZip = await JSZip.loadAsync(zipBytes);
  const publicFiles = new Set(receipt.public.map(item => `public/${item.file}`));
  for (const [file, entry] of Object.entries(oldZip.files))
    if (!entry.dir && file.startsWith('public/')) assert.ok(publicFiles.has(file), 'PRODUCTION_PUBLIC_FILE_REMOVED');
  const oldRoutes = JSON.parse(await oldZip.file('.next/app-path-routes-manifest.json').async('string'));
  assertRoutePreservation(oldRoutes, json(path.join(receipt.cwd, '.next/app-path-routes-manifest.json')));
  assert.equal(json(path.join(cliRoot, 'package.json')).version, '15.3.1', 'REVIEWED_CLI_REQUIRED');
  const nextPath = path.join(cliRoot, 'lib/frameworks/next/index.js');
  const cliSha256 = sha(fs.readFileSync(nextPath));
  const next = require(nextPath), generator = next['ɵcodegenPublicDirectory'];
  assert.equal(typeof generator, 'function', 'CLI_CONTRACT');
  const directory = path.dirname(buildFile), hosting = path.join(directory, 'hosting');
  assert.ok(!fs.existsSync(hosting), 'STAGE_ALREADY_EXISTS');
  await generator(receipt.cwd, hosting, 'production', {});
  assert.deepEqual(artifactManifest(path.join(receipt.cwd, '.next')), receipt.next, 'NEXT_CHANGED_DURING_STAGE');
  // Exact proven runtime wrapper/configuration, not a new auto-generated runtime.
  const bundle = await packageSsr(receipt, zipBytes);
  assert.deepEqual(inspectSource(receipt.cwd), receipt.source, 'SOURCE_CHANGED_DURING_STAGE');
  assert.deepEqual(artifactManifest(path.join(receipt.cwd, 'public')), receipt.public, 'PUBLIC_CHANGED_DURING_STAGE');
  const archive = path.join(directory, 'ssr.zip'); fs.writeFileSync(archive, bundle, { flag: 'wx', mode: 0o600 });
  const input = { schema: 'PAY0-MODULAR-HOSTING-INPUT@1', sourceCommit: receipt.source.sourceCommit, sourceTree: receipt.source.sourceTree,
    buildFile, buildSha256, baselineFile: privateFile(baselineFile), baselineSha256: sha(fs.readFileSync(baselineFile)),
    previousZip: privateFile(previousZip), previousSha256: sha(zipBytes), previousSourceCommit: proof.sourceCommit,
    archive, archiveSha256: sha(bundle), hosting, hostingFiles: artifactManifest(hosting), cliRoot, cliSha256,
    helperSha256: helperSha(), executorSha256: executorSha(), guardPins: guardPins(), createdAt: new Date().toISOString(), executionImplemented: true,
    requiredBeforeRelease: ['live-preflight', 'staged-SSR-runtime-and-browser-proof', 'guarded-source-only-update', 'guarded-Hosting-finalize-release', 'postflight-and-rollback-receipt'] };
  const inputFile = path.join(directory, 'input.json'); write(inputFile, input);
  return { inputFile, inputSha256: sha(fs.readFileSync(inputFile)), archiveSha256: input.archiveSha256,
    hostingFiles: input.hostingFiles.length, status: 'PREPARED_NOT_RELEASE_AUTHORIZED' };
}

export function check(inputFile, inputSha256) {
  assert.match(inputSha256, /^[a-f0-9]{64}$/);
  assert.equal(sha(fs.readFileSync(privateFile(inputFile))), inputSha256, 'INPUT_CHANGED');
  const input = json(inputFile); assert.equal(input.schema, 'PAY0-MODULAR-HOSTING-INPUT@1', 'INPUT_SCHEMA');
  assert.match(input.sourceCommit, /^[a-f0-9]{40}$/); assert.match(input.sourceTree, /^[a-f0-9]{40}$/);
  assert.equal(input.helperSha256, helperSha(), 'HELPER_CHANGED');
  assert.equal(input.executorSha256, executorSha(), 'EXECUTOR_CHANGED');
  assert.deepEqual(input.guardPins, guardPins(), 'GUARD_DEPENDENCY_CHANGED');
  for (const [file, expected] of [[input.archive, input.archiveSha256], [input.previousZip, input.previousSha256], [input.baselineFile, input.baselineSha256], [input.buildFile, input.buildSha256]])
    assert.equal(sha(fs.readFileSync(privateFile(file))), expected, 'PINNED_FILE_CHANGED');
  assert.deepEqual(artifactManifest(privateFile(input.hosting)), input.hostingFiles, 'HOSTING_FILES_CHANGED');
  assert.equal(sha(fs.readFileSync(path.join(input.cliRoot, 'lib/frameworks/next/index.js'))), input.cliSha256, 'CLI_CHANGED');
  validateBaseline(json(input.baselineFile)); return input;
}

export async function livePreflight(inputFile, inputSha256) {
  const input = check(inputFile, inputSha256), expected = json(input.baselineFile), token = tokenInMemory();
  const resource = await getMetadata(`https://cloudfunctions.googleapis.com/v2/${RESOURCE}`, token);
  const [service, iam, hosting] = await Promise.all([
    getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}`, token),
    getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}:getIamPolicy`, token),
    getMetadata(`https://firebasehosting.googleapis.com/v1beta1/sites/${PROJECT}/releases?pageSize=1`, token) ]);
  assertFreshBaseline(expected, { functions: { [NAME]: { resource, service, iam } }, hosting });
  const source = resource.buildConfig.sourceProvenance?.resolvedStorageSource || resource.buildConfig.source.storageSource;
  assert.equal(source.bucket, 'gcf-v2-sources-751158244178-us-central1'); assert.match(source.object, /^ssrpay0system\/function-source\.zip$/);
  assert.match(source.generation, /^[1-9][0-9]*$/);
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${source.bucket}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`,
    { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200, 'PRODUCTION_SOURCE_UNAVAILABLE');
  assert.equal(sha(Buffer.from(await response.arrayBuffer())), input.previousSha256, 'LIVE_PRODUCTION_SOURCE_MISMATCH');
  return { status: 'LIVE_PREFLIGHT_PASS', sourceCommit: input.sourceCommit, productionWrites: 0, executionImplemented: true };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [mode, ...args] = process.argv.slice(2); let result;
    if (mode === 'build' && args.length === 1) result = await build(args[0]);
    else if (mode === 'prepare' && args.length === 1) result = await prepare(json(privateFile(args[0])));
    else if (mode === 'check' && args.length === 2) { const input = check(...args); result = { status: 'LOCAL_PREFLIGHT_PASS', sourceCommit: input.sourceCommit, productionWrites: 0, executionImplemented: true }; }
    else if (mode === 'live-preflight' && args.length === 2) result = await livePreflight(...args);
    else throw Error('SUPPORTED_MODES_BUILD_PREPARE_CHECK_LIVE_PREFLIGHT_ONLY');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(JSON.stringify({ status: 'BLOCKED', reason: error?.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'PREPARATION_FAILED', detailsRedacted: true })); process.exitCode = 1; }
}
