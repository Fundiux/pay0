// Source-only updates: retain live environment, IAM, runtime and traffic settings.
// API contract: https://cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PROJECT, REGION, tokenInMemory, getMetadata, digest } from './capture-production-baseline.mjs';

const ALLOWED = new Set(['parsePagoReceiptPdf', 'correctPagoReceiptSemanticField']);
const ROOT = path.resolve(import.meta.dirname, '..');
const PRIVATE = path.join(ROOT, '.firebase/modular-release');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const base = `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}`;
function privatePath(file) {
  const result = path.resolve(file);
  assert.ok(result.startsWith(PRIVATE + path.sep), 'PRIVATE_PATH_REQUIRED');
  for (let parent = result; parent !== ROOT; parent = path.dirname(parent)) {
    if (fs.existsSync(parent)) assert.ok(!fs.lstatSync(parent).isSymbolicLink(), 'PRIVATE_LINK_FORBIDDEN');
  }
  assert.equal(spawnSync('git', ['check-ignore', '--quiet', '--', result], { cwd: ROOT }).status, 0, 'PRIVATE_NOT_IGNORED');
  return result;
}
function command(command, args, cwd, log) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true,
    shell: process.platform === 'win32' && command === 'npm', maxBuffer: 20 * 1024 * 1024 });
  if (log) fs.appendFileSync(log, (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 0, `COMMAND_FAILED_${command}`);
  return (result.stdout || '').trim();
}
export function sourceOnlyPatch(baseline, source, sourceCommit, archiveSha256) {
  assert.ok(ALLOWED.has(baseline.name?.split('/').at(-1)), 'FUNCTION_NOT_ALLOWED');
  assert.equal(baseline.name, `projects/${PROJECT}/locations/${REGION}/functions/${baseline.name.split('/').at(-1)}`, 'FUNCTION_SCOPE');
  assert.equal(baseline.state, 'ACTIVE', 'FUNCTION_NOT_ACTIVE');
  assert.equal(baseline.buildConfig.runtime, 'nodejs22', 'RUNTIME_CHANGED');
  assert.equal(baseline.buildConfig.environmentVariables?.GOOGLE_NODE_RUN_SCRIPTS, '', 'BUILD_SCRIPTS_UNREVIEWED');
  assert.match(sourceCommit, /^[a-f0-9]{40}$/, 'COMMIT_REQUIRED');
  assert.match(archiveSha256, /^[a-f0-9]{64}$/, 'ARCHIVE_HASH_REQUIRED');
  assert.ok(source && /^gcf-v2-(?:uploads|sources)-/.test(source.bucket) && typeof source.object === 'string' && /^\d+$/.test(source.generation || ''), 'UPLOAD_SOURCE_INVALID');
  return { name: baseline.name, buildConfig: { source: { storageSource: source } },
    labels: { ...baseline.labels, 'pay0-source-commit': sourceCommit, 'firebase-functions-hash': archiveSha256.slice(0, 40) } };
}
export function assertRuntimePreserved(before, after) {
  const select = value => {
    const config = structuredClone(value.serviceConfig);
    for (const key of ['revision', 'uri']) delete config[key];
    return config;
  };
  assert.deepEqual(select(after), select(before), 'RUNTIME_CONFIGURATION_CHANGED');
  assert.equal(after.buildConfig.runtime, before.buildConfig.runtime, 'RUNTIME_CHANGED');
  assert.equal(after.buildConfig.entryPoint, before.buildConfig.entryPoint, 'ENTRYPOINT_CHANGED');
  assert.deepEqual(after.buildConfig.environmentVariables, before.buildConfig.environmentVariables, 'BUILD_ENV_CHANGED');
}
export function previousSource(resource) {
  const source = resource.buildConfig?.sourceProvenance?.resolvedStorageSource || resource.buildConfig?.source?.storageSource;
  assert.ok(source && /^gcf-v2-sources-[0-9]+-us-central1$/.test(source.bucket) && /^[A-Za-z0-9_-]+\/function-source\.zip$/.test(source.object) && /^[1-9][0-9]*$/.test(source.generation), 'PREVIOUS_SOURCE_NOT_PINNED');
  return source;
}
async function preservePrevious(resource, token, directory, name) {
  const source = previousSource(resource);
  const bytes = await readSourceBytes(source, token);
  const archive = path.join(directory, `${name}-previous.zip`);
  fs.writeFileSync(archive, bytes, { flag: 'wx', mode: 0o600 });
  return { source, archive, sha256: sha(bytes) };
}
async function readSourceBytes(source, token) {
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${source.bucket}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, 200, 'PREVIOUS_SOURCE_UNAVAILABLE');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 100 && bytes.subarray(0, 2).toString() === 'PK', 'PREVIOUS_SOURCE_NOT_ZIP');
  return bytes;
}
async function assertCurrent(expected, name, token) {
  const resource = await getMetadata(`${base}/functions/${name}`, token);
  assert.equal(digest(resource), digest(expected.resource), 'CONCURRENT_FUNCTION_CHANGE');
  const service = await getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}`, token);
  assert.equal(digest(service), digest(expected.service), 'CONCURRENT_RUN_CHANGE');
  const iam = await getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}:getIamPolicy`, token);
  assert.equal(digest(iam), digest(expected.iam), 'CONCURRENT_IAM_CHANGE');
  return resource;
}
async function waitOperation(operation, token, emit, name) {
  assert.match(operation.name, /^projects\/[^/]+\/locations\/us-central1\/operations\/[^/]+$/, 'OPERATION_SCOPE');
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10_000));
    const status = await getMetadata(`https://cloudfunctions.googleapis.com/v2/${operation.name}`, token);
    if (!status.done) { if (attempt % 3 === 0) emit({ state: 'BUILDING', function: name }); continue; }
    assert.ok(!status.error, 'DEPLOYMENT_OPERATION_FAILED'); return status.response;
  }
  throw Error('DEPLOYMENT_TIMEOUT');
}
export async function prepare(commit, baselineFile) {
  assert.match(commit, /^[a-f0-9]{40}$/, 'COMMIT_REQUIRED');
  const baseline = fs.readFileSync(privatePath(baselineFile));
  const directory = privatePath(path.join(PRIVATE, `source-${commit.slice(0, 12)}-${crypto.randomUUID()}`));
  fs.mkdirSync(directory, { recursive: true });
  const source = path.join(directory, 'source'); fs.mkdirSync(source);
  const log = path.join(directory, 'build.log'), tar = path.join(directory, 'source.tar');
  command('git', ['archive', '--format=tar', `--output=${tar}`, commit], ROOT, log);
  command('tar', ['-xf', tar, '-C', source], ROOT, log);
  command('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], path.join(source, 'functions'), log);
  command('npm', ['run', 'build'], path.join(source, 'functions'), log);
  const require = createRequire(path.join(source, 'functions/package.json'));
  const JSZip = require('jszip'), zip = new JSZip();
  const names = [];
  function add(relative) {
    const location = path.join(source, 'functions', relative);
    assert.ok(!fs.lstatSync(location).isSymbolicLink(), 'ARTIFACT_LINK');
    if (fs.statSync(location).isDirectory()) for (const child of fs.readdirSync(location).sort()) add(`${relative}/${child}`);
    else { zip.file(relative, fs.readFileSync(location), { date: new Date('2026-01-01T00:00:00Z') }); names.push(relative); }
  }
  add('lib'); add('package.json'); add('package-lock.json');
  assert.ok(names.includes('lib/index.js') && !names.some(name => /(?:^|\/)\.env/.test(name)), 'ARTIFACT_CONTENTS');
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const archive = path.join(directory, 'functions.zip'); fs.writeFileSync(archive, bytes, { flag: 'wx' });
  const input = { schemaVersion: 1, sourceCommit: commit, sourceTree: command('git', ['rev-parse', `${commit}^{tree}`], ROOT),
    archive, archiveSha256: sha(bytes), baselineFile: privatePath(baselineFile), baselineSha256: sha(baseline),
    functions: [...ALLOWED], compiledFiles: names.length, createdAt: new Date().toISOString() };
  const inputFile = path.join(directory, 'input.json');
  fs.writeFileSync(inputFile, JSON.stringify(input, null, 2), { flag: 'wx' });
  return { inputFile, inputSha256: sha(fs.readFileSync(inputFile)), archiveSha256: input.archiveSha256, compiledFiles: names.length };
}
async function mutation(url, token, body, method = 'POST') {
  assert.ok(url.startsWith(base + '/'), 'MUTATION_SCOPE');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT }, body: JSON.stringify(body) });
  assert.ok(response.ok, `MUTATION_HTTP_${response.status}`);
  return response.json();
}
export async function execute(inputFile, inputSha256) {
  assert.match(inputSha256, /^[a-f0-9]{64}$/, 'INPUT_HASH_REQUIRED');
  const bytes = fs.readFileSync(privatePath(inputFile)); assert.equal(sha(bytes), inputSha256, 'INPUT_CHANGED');
  const input = JSON.parse(bytes);
  assert.deepEqual(input.functions, [...ALLOWED], 'FUNCTION_SCOPE');
  const baselineBytes = fs.readFileSync(privatePath(input.baselineFile)); assert.equal(sha(baselineBytes), input.baselineSha256, 'BASELINE_CHANGED');
  const baseline = JSON.parse(baselineBytes);
  const archive = fs.readFileSync(privatePath(input.archive)); assert.equal(sha(archive), input.archiveSha256, 'ARTIFACT_CHANGED');
  const proof = JSON.parse(fs.readFileSync(privatePath(path.join(path.dirname(inputFile), 'artifact-verification.json'))));
  assert.equal(proof.status, 'PASS', 'ARTIFACT_NOT_VERIFIED');
  assert.equal(proof.sourceCommit, input.sourceCommit, 'ARTIFACT_PROOF_COMMIT');
  assert.equal(proof.archiveSha256, input.archiveSha256, 'ARTIFACT_PROOF_HASH');
  assert.equal(proof.unauthenticatedDenied, 2, 'ARTIFACT_AUTH_NOT_VERIFIED');
  const receiptFile = privatePath(path.join(path.dirname(inputFile), 'deployment.jsonl'));
  const receipt = fs.openSync(receiptFile, 'wx');
  const emit = value => { fs.writeSync(receipt, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'); console.log(JSON.stringify(value)); };
  const lockPath = privatePath(path.join(PRIVATE, 'deployment.lock'));
  let lock, unresolved = false;
  try {
    lock = fs.openSync(lockPath, 'wx');
    let token = tokenInMemory();
    for (const name of ALLOWED) {
      const expected = baseline.functions[name];
      assert.ok(expected?.resource, 'EXISTING_FUNCTION_REQUIRED');
      const fresh = await assertCurrent(expected, name, token);
      sourceOnlyPatch(fresh, fresh.buildConfig.source.storageSource, input.sourceCommit, input.archiveSha256);
      const rollback = await preservePrevious(fresh, token, path.dirname(inputFile), name);
      emit({ state: 'PREVIOUS_SOURCE_PRESERVED', function: name, source: rollback.source, sha256: rollback.sha256, previousRevision: fresh.serviceConfig.revision });
    }
    const operations = await getMetadata(`${base}/operations?pageSize=100&filter=done%3Dfalse`, token);
    assert.equal((operations.operations || []).filter(row => !row.done).length, 0, 'CONCURRENT_DEPLOYMENT');
    const upload = await mutation(`${base}/functions:generateUploadUrl`, token, {});
    const uploadUrl = new URL(upload.uploadUrl);
    assert.ok(uploadUrl.protocol === 'https:' && (uploadUrl.hostname === 'storage.googleapis.com' || uploadUrl.hostname.endsWith('.storage.googleapis.com')), 'UPLOAD_HOST');
    const uploaded = await fetch(uploadUrl, { method: 'PUT', body: archive, redirect: 'error', signal: AbortSignal.timeout(120_000), headers: { 'Content-Type': 'application/zip' } });
    assert.ok(uploaded.ok, 'UPLOAD_FAILED');
    const uploadedGeneration = uploaded.headers.get('x-goog-generation');
    assert.match(uploadedGeneration || '', /^[1-9][0-9]*$/, 'UPLOAD_GENERATION_REQUIRED');
    const uploadedSource = { ...upload.storageSource, generation: uploadedGeneration };
    emit({ state: 'ARTIFACT_UPLOADED', archiveSha256: input.archiveSha256, sourceCommit: input.sourceCommit });
    for (const name of ALLOWED) {
      token = tokenInMemory();
      const expected = baseline.functions[name];
      const fresh = await assertCurrent(expected, name, token);
      const body = sourceOnlyPatch(fresh, uploadedSource, input.sourceCommit, input.archiveSha256);
      emit({ state: 'UPDATE_PREPARED', function: name, previousSource: previousSource(fresh), source: uploadedSource, previousRevision: fresh.serviceConfig.revision });
      unresolved = true;
      fs.writeFileSync(lockPath, JSON.stringify({ inputFile, inputSha256, function: name, state: 'DISPATCHING' }));
      const operation = await mutation(`${base}/functions/${name}?updateMask=buildConfig.source,labels`, token, body, 'PATCH');
      fs.writeFileSync(lockPath, JSON.stringify({ inputFile, inputSha256, function: name, operation: operation.name, state: 'ACCEPTED' }));
      emit({ state: 'UPDATE_ACCEPTED', function: name, operation: operation.name });
      const completed = await waitOperation(operation, token, emit, name);
      fs.writeFileSync(path.join(path.dirname(inputFile), `${name}-operation.json`), JSON.stringify(completed), { flag: 'wx', mode: 0o600 });
      const after = await getMetadata(`${base}/functions/${name}`, token);
      const afterService = await getMetadata(`https://run.googleapis.com/v2/${after.serviceConfig.service}`, token);
      fs.writeFileSync(path.join(path.dirname(inputFile), `${name}-after.json`), JSON.stringify({ resource: after, service: afterService, iam: expected.iam }), { flag: 'wx', mode: 0o600 });
      assert.equal(digest(after), digest(completed), 'CONCURRENT_POSTFLIGHT_CHANGE');
      assert.equal(after.state, 'ACTIVE', 'POSTFLIGHT_NOT_ACTIVE');
      assertRuntimePreserved(fresh, after);
      assert.equal(after.labels?.['pay0-source-commit'], input.sourceCommit, 'POSTFLIGHT_COMMIT');
      assert.equal(after.labels?.['firebase-functions-hash'], input.archiveSha256.slice(0, 40), 'POSTFLIGHT_ARTIFACT_LABEL');
      assert.equal(sha(await readSourceBytes(previousSource(after), token)), input.archiveSha256, 'POSTFLIGHT_ARTIFACT_BYTES');
      const iam = await getMetadata(`https://run.googleapis.com/v2/${after.serviceConfig.service}:getIamPolicy`, token);
      assert.equal(digest(iam), digest(expected.iam), 'POSTFLIGHT_IAM_CHANGED');
      emit({ state: 'CONFIGURATION_VERIFIED', function: name, revision: after.serviceConfig.revision, previousRevision: fresh.serviceConfig.revision,
        functionalVerification: 'PENDING', previousSource: fresh.buildConfig.source.storageSource });
      unresolved = false;
    }
  } finally {
    fs.closeSync(receipt);
    if (lock !== undefined) { fs.closeSync(lock); if (!unresolved) fs.unlinkSync(lockPath); }
  }
}
export async function rollback(inputFile, inputSha256, name) {
  assert.ok(ALLOWED.has(name), 'FUNCTION_NOT_ALLOWED');
  const inputBytes = fs.readFileSync(privatePath(inputFile)); assert.equal(sha(inputBytes), inputSha256, 'INPUT_CHANGED');
  const input = JSON.parse(inputBytes), directory = path.dirname(inputFile);
  const baselineBytes = fs.readFileSync(privatePath(input.baselineFile)); assert.equal(sha(baselineBytes), input.baselineSha256, 'BASELINE_CHANGED');
  const before = JSON.parse(baselineBytes).functions[name];
  const expected = JSON.parse(fs.readFileSync(privatePath(path.join(directory, `${name}-after.json`))));
  assert.equal(expected.resource.labels?.['pay0-source-commit'], input.sourceCommit, 'ROLLBACK_NOT_OWN_RELEASE');
  const lockPath = privatePath(path.join(PRIVATE, 'deployment.lock'));
  let lock, unresolved = false;
  if (fs.existsSync(lockPath)) {
    const pending = JSON.parse(fs.readFileSync(lockPath));
    assert.equal(path.resolve(pending.inputFile), path.resolve(inputFile), 'OTHER_DEPLOYMENT_LOCK');
    assert.equal(pending.inputSha256, inputSha256, 'OTHER_DEPLOYMENT_LOCK');
    assert.equal(pending.function, name, 'OTHER_DEPLOYMENT_LOCK');
    lock = fs.openSync(lockPath, 'r+');
  } else lock = fs.openSync(lockPath, 'wx');
  try {
    const token = tokenInMemory();
    await assertCurrent(expected, name, token);
    assertRuntimePreserved(before.resource, expected.resource);
    unresolved = true;
    fs.writeFileSync(lockPath, JSON.stringify({ inputFile, inputSha256, function: name, state: 'ROLLBACK_DISPATCHING' }));
    const operation = await mutation(`${base}/functions/${name}?updateMask=buildConfig.source,labels`, token,
      { name: before.resource.name, buildConfig: { source: { storageSource: previousSource(before.resource) } }, labels: before.resource.labels }, 'PATCH');
    const emit = row => { fs.appendFileSync(path.join(directory, 'rollback.jsonl'), JSON.stringify(row) + '\n'); console.log(JSON.stringify(row)); };
    emit({ state: 'ROLLBACK_ACCEPTED', function: name, operation: operation.name });
    await waitOperation(operation, token, emit, name);
    const after = await getMetadata(`${base}/functions/${name}`, token);
    assert.equal(after.state, 'ACTIVE', 'ROLLBACK_NOT_ACTIVE');
    assertRuntimePreserved(before.resource, after);
    assert.deepEqual(after.labels, before.resource.labels, 'ROLLBACK_LABELS_CHANGED');
    assert.equal(sha(await readSourceBytes(previousSource(after), token)), sha(fs.readFileSync(path.join(directory, `${name}-previous.zip`))), 'ROLLBACK_SOURCE_MISMATCH');
    emit({ state: 'ROLLBACK_VERIFIED', function: name, revision: after.serviceConfig.revision });
    unresolved = false;
  } finally { fs.closeSync(lock); if (!unresolved) fs.unlinkSync(lockPath); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode, first, second, third] = process.argv.slice(2);
    if (mode === '--prepare') console.log(JSON.stringify(await prepare(first, second)));
    else if (mode === '--execute') await execute(first, second);
    else if (mode === '--rollback') await rollback(first, second, third);
    else throw Error('MODE_REQUIRED');
  } catch (error) { console.error(`SCOPED_DEPLOYMENT_FAILED ${/^[A-Z][A-Z_0-9]+$/.test(error.message) ? error.message : 'detailsRedacted=true'}`); process.exitCode = 1; }
}
