// CREATE_ONLY. Preparing is read-only in Cloud; --execute is the explicit mutation boundary.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PROJECT, REGION, digest, getMetadata, tokenInMemory } from './capture-production-baseline.mjs';

export const NAMES = Object.freeze(['getControlCenterEngineering', 'importControlCenterEngineeringEvidence',
  'assignControlCenterEngineeringTask', 'listOperationalDocuments', 'getAuthorizedOperationalRecord', 'listAuthorizedRelatedRecords']);
const ROOT = path.resolve(import.meta.dirname, '..');
const PRIVATE = path.join(ROOT, '.firebase/modular-release');
const PARENT = `projects/${PROJECT}/locations/${REGION}`;
const API = `https://cloudfunctions.googleapis.com/v2/${PARENT}`;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const resourceName = name => `${PARENT}/functions/${name}`;
const serviceName = name => `${PARENT}/services/${name.toLowerCase()}`;
const hash = value => assert.match(value, /^[a-f0-9]{64}$/, 'HASH_REQUIRED');

function privatePath(file) {
  const result = path.resolve(file);
  assert.ok(result.startsWith(PRIVATE + path.sep), 'PRIVATE_PATH_REQUIRED');
  for (let parent = result; parent !== ROOT; parent = path.dirname(parent)) {
    if (fs.existsSync(parent)) assert.ok(!fs.lstatSync(parent).isSymbolicLink(), 'PRIVATE_LINK_FORBIDDEN');
  }
  assert.equal(spawnSync('git', ['check-ignore', '--quiet', '--', result], { cwd: ROOT }).status, 0, 'PRIVATE_NOT_IGNORED');
  return result;
}
function readPinned(file, expected) {
  hash(expected);
  const bytes = fs.readFileSync(privatePath(file));
  assert.equal(sha(bytes), expected, 'PINNED_FILE_CHANGED');
  return bytes;
}
const SOURCE_BUCKETS = new Set([
  'gcf-v2-uploads-751158244178.us-central1.cloudfunctions.appspot.com',
  'gcf-v2-uploads-751158244178-us-central1',
  'gcf-v2-sources-751158244178-us-central1',
]);
export function assertSource(source) {
  assert.ok(source && SOURCE_BUCKETS.has(source.bucket)
    && typeof source.object === 'string' && source.object.length > 0 && !source.object.includes('..')
    && (source.generation === undefined || /^\d+$/.test(String(source.generation))), 'SOURCE_INVALID');
}
export function pinUploadedSource(source, generation) {
  assertSource(source);
  assert.ok(typeof generation === 'string' && /^[1-9][0-9]*$/.test(generation), 'UPLOAD_GENERATION_REQUIRED');
  if (source.generation !== undefined && String(source.generation) !== '0') {
    assert.equal(String(source.generation), generation, 'UPLOAD_GENERATION_MISMATCH');
  }
  return { ...source, generation };
}
export function createPlan(artifact, baseline, proof) {
  assert.equal(baseline.project, PROJECT, 'PROJECT_SCOPE');
  assert.match(artifact.sourceCommit, /^[a-f0-9]{40}$/, 'COMMIT_REQUIRED');
  hash(artifact.archiveSha256);
  assert.deepEqual(proof.names, NAMES, 'AUTH_PROOF_SCOPE');
  assert.equal(proof.archiveSha256, artifact.archiveSha256, 'AUTH_PROOF_ARTIFACT');
  assert.equal(proof.result, 'ALL_UNAUTHENTICATED_WITHOUT_NETWORK', 'AUTH_PROOF_REQUIRED');
  assert.equal(baseline.activeOperations, 0, 'ACTIVE_OPERATION');
  for (const name of NAMES) {
    assert.ok(Object.hasOwn(baseline.functions, name), 'BASELINE_INCOMPLETE');
    assert.deepEqual(baseline.functions[name], { resource: null, service: null }, 'CREATE_ONLY_ALREADY_EXISTS');
  }
  assert.match(baseline.serviceAccountEmail, /^[a-zA-Z0-9._-]+@(?:pay-0-system\.iam\.gserviceaccount\.com|developer\.gserviceaccount\.com)$/, 'SERVICE_ACCOUNT_SCOPE');
  return { schemaVersion: 1, mode: 'CREATE_ONLY', project: PROJECT, region: REGION,
    artifact, baseline, proof, requests: NAMES.map(name => ({ method: 'POST', url: `${API}/functions?functionId=${name}`,
      body: { name: resourceName(name), environment: 'GEN_2',
        labels: { 'deployment-tool': 'cli-firebase', 'deployment-callable': 'true', 'pay0-source-commit': artifact.sourceCommit,
          'firebase-functions-hash': artifact.archiveSha256.slice(0, 40) },
        buildConfig: { runtime: 'nodejs22', entryPoint: name, environmentVariables: { GOOGLE_NODE_RUN_SCRIPTS: '' } },
        serviceConfig: { availableMemory: '256Mi', availableCpu: '1', timeoutSeconds: name.includes('Authorized') ? 60 : 30,
          minInstanceCount: 0, maxInstanceCount: 10, maxInstanceRequestConcurrency: 80,
          ingressSettings: 'ALLOW_ALL', serviceAccountEmail: baseline.serviceAccountEmail, allTrafficOnLatestRevision: true } },
      publicInvoker: { service: serviceName(name), role: 'roles/run.invoker', member: 'allUsers' },
    })) };
}
export function validatePlan(plan) {
  assert.deepEqual(plan, createPlan(plan.artifact, plan.baseline, plan.proof), 'PLAN_CHANGED');
}
export function assertCreated(plan, name, resource, source) {
  const expected = plan.requests.find(row => row.body.name === resourceName(name)).body;
  assert.equal(resource.name, expected.name, 'CREATED_SCOPE');
  assert.equal(resource.state, 'ACTIVE', 'CREATED_NOT_ACTIVE');
  assert.equal(resource.environment, 'GEN_2', 'CREATED_GENERATION');
  assert.equal(resource.serviceConfig.service, serviceName(name), 'CREATED_SERVICE_SCOPE');
  for (const [key, value] of Object.entries(expected.serviceConfig)) assert.deepEqual(resource.serviceConfig[key] ?? (key === 'minInstanceCount' ? 0 : undefined), value, `CREATED_CONFIG_${key}`);
  assert.equal(resource.buildConfig.runtime, 'nodejs22', 'CREATED_RUNTIME');
  assert.equal(resource.buildConfig.entryPoint, name, 'CREATED_ENTRYPOINT');
  assert.deepEqual(resource.buildConfig.environmentVariables, expected.buildConfig.environmentVariables, 'CREATED_BUILD_ENV');
  assert.equal(resource.labels?.['pay0-source-commit'], plan.artifact.sourceCommit, 'CREATED_COMMIT');
  assert.equal(resource.labels?.['firebase-functions-hash'], plan.artifact.archiveSha256.slice(0, 40), 'CREATED_ARCHIVE_LABEL');
  assertSource(source);
  assert.ok(!resource.serviceConfig.secretEnvironmentVariables?.length && !resource.serviceConfig.secretVolumes?.length, 'UNEXPECTED_SECRETS');
  assert.ok(!Object.keys(resource.serviceConfig.environmentVariables || {}).some(key => !['FUNCTION_TARGET', 'FUNCTION_SIGNATURE_TYPE', 'LOG_EXECUTION_ID'].includes(key)), 'UNEXPECTED_ENV');
}

// Injectable transport is deliberately narrow; tests exercise the complete state machine.
export async function executePlan(plan, io) {
  validatePlan(plan);
  await io.verifyArtifact(plan.artifact, plan.proof);
  await io.assertIdle();
  for (const name of NAMES) await io.assertAbsent(name);
  const source = await io.upload(plan.artifact);
  assertSource(source);
  const verified = [];
  for (const request of plan.requests) {
    const name = request.body.buildConfig.entryPoint;
    await io.assertIdle();
    await io.assertAbsent(name);
    const body = structuredClone(request.body);
    body.buildConfig.source = { storageSource: source };
    // Persist BEFORE the request: a lost response must leave an explicit uncertain operation.
    await io.record({ state: 'CREATE_INTENT', name, body });
    const operation = await io.create(request.url, body);
    assert.match(operation.name, new RegExp(`^${PARENT}/operations/[a-zA-Z0-9_-]+$`), 'OPERATION_SCOPE');
    await io.record({ state: 'CREATE_ACCEPTED', name, operation: operation.name });
    await io.wait(operation.name);
    const created = await io.get(name);
    assertCreated(plan, name, created, source);
    await io.verifyDeployedArchive(created, plan.artifact.archiveSha256);
    const createdService = await io.getService(request.publicInvoker.service);
    assert.equal(createdService.name, request.publicInvoker.service, 'CREATED_RUN_SCOPE');
    await io.record({ state: 'CREATED_PRIVATE', name, resource: created, service: createdService });
    const policy = await io.getIam(request.publicInvoker.service);
    assert.ok(policy && typeof policy.etag === 'string' && policy.etag, 'IAM_ETAG_REQUIRED');
    assert.equal((policy.bindings || []).length, 0, 'UNEXPECTED_EXISTING_IAM');
    // Guard the function again directly before opening only this new callable endpoint.
    assert.equal(digest(await io.get(name)), digest(created), 'CONCURRENT_CREATED_CHANGE');
    assert.equal(digest(await io.getService(request.publicInvoker.service)), digest(createdService), 'CONCURRENT_RUN_CHANGE');
    const publicPolicy = { ...policy, bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] };
    await io.record({ state: 'IAM_INTENT', name, service: request.publicInvoker.service, previousPolicy: policy });
    await io.setIam(request.publicInvoker.service, publicPolicy);
    try {
      assert.deepEqual((await io.getIam(request.publicInvoker.service)).bindings, publicPolicy.bindings, 'IAM_POSTFLIGHT');
      await io.assertAnonymousDenied(name);
    } catch (error) {
      // Revoke only our own addition, under a fresh etag. Never overwrite a
      // concurrent policy or delete a function that may have acquired consumers.
      const currentPolicy = await io.getIam(request.publicInvoker.service);
      assert.deepEqual(currentPolicy.bindings, publicPolicy.bindings, 'IAM_RECOVERY_CONCURRENT_CHANGE');
      await io.record({ state: 'REVOKE_PUBLIC_INTENT', name, service: request.publicInvoker.service });
      await io.setIam(request.publicInvoker.service, { ...currentPolicy, bindings: policy.bindings || [] });
      assert.equal(((await io.getIam(request.publicInvoker.service)).bindings || []).length, 0, 'IAM_RECOVERY_FAILED');
      await io.record({ state: 'PUBLIC_REVOKED', name });
      throw error;
    }
    await io.record({ state: 'VERIFIED', name, authenticatedFunctionalVerification: 'PENDING' });
    verified.push(name);
  }
  return verified;
}

export async function verifyRuntimeArchive(bytes, directory, installDependencies) {
  const sourceDirectory = privatePath(directory);
  fs.mkdirSync(sourceDirectory); // Must be empty and new; never reuse a previous extraction.
  const require = createRequire(path.join(ROOT, 'functions/package.json'));
  const zip = await require('jszip').loadAsync(bytes);
  for (const [name, entry] of Object.entries(zip.files)) {
    assert.ok(!name.startsWith('/') && !name.includes('..') && !name.includes('\\') && !name.includes(':') && !/(^|\/)\.env/.test(name), 'ZIP_PATH');
    assert.ok(!entry.unsafeOriginalName || entry.unsafeOriginalName === name, 'ZIP_REWRITTEN_PATH');
    assert.ok(!entry.unixPermissions || (entry.unixPermissions & 0o170000) !== 0o120000, 'ZIP_SYMLINK');
    assert.ok(name.startsWith('lib/') || name === '.debug/' || name.startsWith('.debug/compiled/') || ['package.json', 'package-lock.json'].includes(name), 'ZIP_CONTENT');
    const target = privatePath(path.join(sourceDirectory, name));
    if (entry.dir) fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, await entry.async('nodebuffer'), { flag: 'wx', mode: 0o600 });
    }
  }
  assert.ok(zip.file('lib/index.js') && zip.file('package.json') && zip.file('package-lock.json'), 'ZIP_INCOMPLETE');
  if (installDependencies) await installDependencies(sourceDirectory);
  else {
    const install = spawnSync('npm', ['ci', '--omit=dev', '--prefer-offline', '--no-audit', '--no-fund'], {
      cwd: sourceDirectory, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true,
      timeout: 300_000, maxBuffer: 5 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(sourceDirectory, 'install.log'), (install.stdout || '') + (install.stderr || ''), { mode: 0o600 });
    assert.equal(install.status, 0, 'RUNTIME_DEPENDENCIES_FAILED');
  }
  // Load the exact archived compiled files in an isolated process with network
  // blocked. All six real callable.run handlers must reject before data access.
  const program = `const assert=require('node:assert/strict');
    const Module=require('node:module'),path=require('node:path');
    const originalResolve=Module._resolveFilename;
    Module._resolveFilename=function(...args){const resolved=originalResolve.apply(this,args);
      if(path.isAbsolute(resolved) && !resolved.startsWith(process.cwd()+path.sep)) throw Error('OUTSIDE_ARTIFACT_DEPENDENCY');return resolved;};
    let network=0; const deny=()=>{network++;throw Error('NETWORK_FORBIDDEN')};
    for(const name of ['node:http','node:https']) { const m=require(name);m.request=deny;m.get=deny; }
    const net=require('node:net');net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;global.fetch=deny;
    (async()=>{const api=require(${JSON.stringify(path.join(sourceDirectory, 'lib/index.js'))});
    for(const name of ${JSON.stringify(NAMES)}) {assert.equal(typeof api[name]?.run,'function');
      await assert.rejects(api[name].run({data:{},auth:undefined}),e=>e.code==='unauthenticated');}
    assert.equal(network,0);process.stdout.write('PAY0_AUTH_VERIFIED');process.exit(0)})().catch(()=>process.exit(1));`;
  const child = spawnSync(process.execPath, ['-e', program], { cwd: sourceDirectory, encoding: 'utf8', windowsHide: true, timeout: 60_000,
    env: { ...process.env, NODE_PATH: '', GCLOUD_PROJECT: 'demo-pay0-modular-auth', GOOGLE_CLOUD_PROJECT: 'demo-pay0-modular-auth',
      FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-pay0-modular-auth' }), GOOGLE_APPLICATION_CREDENTIALS: '', FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' } });
  assert.equal(child.status, 0, 'ARTIFACT_AUTH_FAILED');
  assert.ok(child.stdout.includes('PAY0_AUTH_VERIFIED'), 'ARTIFACT_AUTH_FAILED');
}
async function verifyArtifact(artifact, expectedProof) {
  const bytes = readPinned(artifact.archive, artifact.archiveSha256);
  const directory = privatePath(path.join(path.dirname(artifact.archive), `modular-runtime-${crypto.randomUUID()}`));
  await verifyRuntimeArchive(bytes, directory);
  const proof = { names: [...NAMES], archiveSha256: artifact.archiveSha256, result: 'ALL_UNAUTHENTICATED_WITHOUT_NETWORK' };
  if (expectedProof) assert.deepEqual(proof, expectedProof, 'AUTH_PROOF_CHANGED');
  return proof;
}

function cloudAdapter(record) {
  const get = (url, optional = false) => getMetadata(url, tokenInMemory(), optional);
  async function post(url, body) {
    const allowed = url === `${API}/functions:generateUploadUrl` || NAMES.some(name => url === `${API}/functions?functionId=${name}` || url === `https://run.googleapis.com/v2/${serviceName(name)}:setIamPolicy`);
    assert.ok(allowed, 'MUTATION_SCOPE');
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${tokenInMemory()}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT }, body: JSON.stringify(body) });
    assert.ok(response.ok, `MUTATION_HTTP_${response.status}`);
    return response.json();
  }
  return {
    verifyArtifact, record,
    async assertIdle() {
      let pageToken;
      do {
        const list = await get(`${API}/operations?pageSize=100&filter=done%3Dfalse${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
        assert.equal((list.operations || []).filter(op => !op.done).length, 0, 'ACTIVE_OPERATION');
        pageToken = list.nextPageToken;
      } while (pageToken);
    },
    async assertAbsent(name) {
      assert.equal(await get(`${API}/functions/${name}`, true), null, 'CREATE_ONLY_ALREADY_EXISTS');
      assert.equal(await get(`https://run.googleapis.com/v2/${serviceName(name)}`, true), null, 'CREATE_ONLY_SERVICE_EXISTS');
    },
    async upload(artifact) {
      const upload = await post(`${API}/functions:generateUploadUrl`, { environment: 'GEN_2' });
      assertSource(upload.storageSource);
      const url = new URL(upload.uploadUrl);
      assert.ok(url.protocol === 'https:' && (url.hostname === 'storage.googleapis.com' || url.hostname.endsWith('.storage.googleapis.com')), 'UPLOAD_HOST');
      const response = await fetch(url, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(120_000),
        headers: { 'Content-Type': 'application/zip' }, body: readPinned(artifact.archive, artifact.archiveSha256) });
      assert.ok(response.ok, 'UPLOAD_FAILED');
      return pinUploadedSource(upload.storageSource, response.headers.get('x-goog-generation'));
    },
    create: post,
    async wait(operation) {
      for (let attempt = 0; attempt < 120; attempt++) {
        const status = await get(`https://cloudfunctions.googleapis.com/v2/${operation}`);
        if (status.done) { assert.ok(!status.error, 'CREATE_FAILED'); return; }
        if (attempt % 3 === 0) await record({ state: 'BUILDING', operation });
        await new Promise(resolve => setTimeout(resolve, 10_000));
      }
      throw Error('CREATE_TIMEOUT');
    },
    get: name => get(`${API}/functions/${name}`),
    getService: service => get(`https://run.googleapis.com/v2/${service}`),
    async verifyDeployedArchive(resource, expectedHash) {
      const source = resource.buildConfig.sourceProvenance?.resolvedStorageSource || resource.buildConfig.source?.storageSource;
      assertSource(source);
      assert.match(String(source.generation), /^[1-9][0-9]*$/, 'DEPLOYED_SOURCE_UNPINNED');
      const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${source.bucket}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`, {
        headers: { Authorization: `Bearer ${tokenInMemory()}` }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
      assert.ok(response.ok, 'DEPLOYED_SOURCE_UNAVAILABLE');
      assert.equal(sha(Buffer.from(await response.arrayBuffer())), expectedHash, 'DEPLOYED_SOURCE_MISMATCH');
    },
    getIam: service => get(`https://run.googleapis.com/v2/${service}:getIamPolicy`),
    setIam: (service, policy) => post(`https://run.googleapis.com/v2/${service}:setIamPolicy`, { policy, updateMask: 'bindings,etag' }),
    async assertAnonymousDenied(name) {
      const response = await fetch(`https://${REGION}-${PROJECT}.cloudfunctions.net/${name}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }) });
      assert.equal(response.status, 401, 'ANONYMOUS_NOT_DENIED');
      assert.equal((await response.json()).error?.status, 'UNAUTHENTICATED', 'ANONYMOUS_WRONG_ERROR');
    },
  };
}

export async function prepare(inputFile, inputHash) {
  const artifact = JSON.parse(readPinned(inputFile, inputHash));
  const proof = await verifyArtifact(artifact);
  const io = cloudAdapter(async () => {});
  await io.assertIdle();
  const functions = {};
  for (const name of NAMES) { await io.assertAbsent(name); functions[name] = { resource: null, service: null }; }
  const trusted = await getMetadata(`${API}/functions/parsePagoReceiptPdf`, tokenInMemory());
  assert.equal(trusted.state, 'ACTIVE', 'SERVICE_ACCOUNT_REFERENCE_INACTIVE');
  const baseline = { project: PROJECT, capturedAt: new Date().toISOString(), activeOperations: 0,
    functions, serviceAccountEmail: trusted.serviceConfig.serviceAccountEmail };
  const plan = createPlan(artifact, baseline, proof);
  const file = privatePath(path.join(path.dirname(inputFile), `modular-plan-${crypto.randomUUID()}.json`));
  fs.writeFileSync(file, JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 });
  return { planFile: file, planSha256: sha(fs.readFileSync(file)), functions: NAMES, productionWrites: 0 };
}
export async function execute(file, expectedHash) {
  const plan = JSON.parse(readPinned(file, expectedHash));
  validatePlan(plan);
  const lockPath = privatePath(path.join(PRIVATE, 'deployment.lock'));
  const lock = fs.openSync(lockPath, 'wx', 0o600);
  const journal = privatePath(path.join(path.dirname(file), `modular-deployment-${crypto.randomUUID()}.jsonl`));
  let complete = false, fd;
  try {
    fs.writeSync(lock, JSON.stringify({ planFile: file, planSha256: expectedHash, journal })); fs.fsyncSync(lock);
    fd = fs.openSync(journal, 'wx', 0o600);
    const record = async event => { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); fs.fsyncSync(fd);
      console.log(JSON.stringify({ state: event.state, name: event.name, operation: event.operation })); };
    await record({ state: 'START', planSha256: expectedHash });
    const result = await executePlan(plan, cloudAdapter(record));
    await record({ state: 'COMPLETE', functions: result });
    complete = true;
    return result;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.closeSync(lock);
    // Any uncertainty retains journal + global lock for read-only reconciliation.
    // No automatic delete/rollback: new endpoints may already have consumers.
    if (complete) fs.unlinkSync(lockPath);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode, file, expectedHash] = process.argv.slice(2);
    if (mode === '--prepare') console.log(JSON.stringify(await prepare(file, expectedHash)));
    else if (mode === '--execute') console.log(JSON.stringify({ created: await execute(file, expectedHash) }));
    else throw Error('MODE_REQUIRED');
  } catch (error) {
    console.error(`MODULAR_DEPLOYMENT_FAILED ${/^[A-Z_0-9]+$/.test(error.message) ? error.message : 'detailsRedacted=true'}`);
    process.exitCode = 1;
  }
}
