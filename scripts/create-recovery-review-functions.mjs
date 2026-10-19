// Plan by default. Execution requires exact hashes, scope and explicit public-invocation approval.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { tokenInMemory, digest } from './capture-production-baseline.mjs';
import { assertUploadSource, assertOperationScope } from './deploy-scoped-functions.mjs';
export const NAMES = Object.freeze(['listOperationRecoveryReviews', 'acknowledgeOperationRecoveryReview']);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const pick = (source, keys) => Object.fromEntries(keys.filter(k => source[k] !== undefined).map(k => [k, structuredClone(source[k])]));
export function privatePath(value, root = path.resolve('.firebase/modular-release')) {
  const target = path.resolve(value);
  assert(target.startsWith(root + path.sep), 'PRIVATE_PATH_REQUIRED');
  for (let current = target; ; current = path.dirname(current)) {
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), 'PRIVATE_PATH_SYMLINK');
    if (current === path.parse(current).root) break;
  }
  return target;
}
export function acquireActiveExecutor(lockFile) {
  const fd = fs.openSync(lockFile, 'wx');
  fs.writeFileSync(fd, JSON.stringify({ kind: 'RECOVERY_REVIEW_CREATE', ownerPid: process.pid }));
  return () => { fs.closeSync(fd); fs.unlinkSync(lockFile); };
}
export function validateScope(scope) {
  assert.deepEqual([...scope].sort(), [...NAMES].sort(), 'EXACT_TWO_FUNCTION_SCOPE_REQUIRED');
}
export function buildCreatePlan(input, baseline) {
  validateScope(input.functions);
  assert.equal(input.group, 'operation-recovery-review-new');
  assert.equal(input.sourceTree, null);
  assert.equal(input.sourceIdentity.mode, 'ADDITIVE_NEW_FUNCTIONS_V1');
  assert.match(input.sourceIdentity.baseArchiveSha256, /^[a-f0-9]{64}$/);
  assert.match(input.sourceIdentity.patchSha256, /^[a-f0-9]{64}$/);
  for (const name of NAMES) assert.equal(baseline.absent[name], true, 'FUNCTION_ALREADY_EXISTS');
  const parent = baseline.functions.getControlCenterEngineering;
  assert.equal(parent.resource.state, 'ACTIVE');
  assert.equal(parent.resource.buildConfig.runtime, 'nodejs22');
  assert.match(input.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(input.archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(baseline.project, 'pay-0-system');
  assert(!parent.resource.eventTrigger, 'CALLABLE_TEMPLATE_REQUIRED');
  const publicInvocationObserved = (parent.iam.bindings || []).some(b => b.role === 'roles/run.invoker' && b.members.includes('allUsers') && !b.condition);
  assert(publicInvocationObserved, 'PUBLIC_INVOCATION_POLICY_REQUIRES_SEPARATE_DESIGN');
  const functions = NAMES.map(name => {
    const buildConfig = pick(parent.resource.buildConfig, ['runtime', 'environmentVariables', 'dockerRepository', 'dockerRegistry', 'serviceAccount', 'automaticUpdatePolicy', 'onDeployUpdatePolicy']);
    buildConfig.entryPoint = name;
    if (buildConfig.environmentVariables?.FUNCTION_TARGET !== undefined) buildConfig.environmentVariables.FUNCTION_TARGET = name;
    const serviceConfig = pick(parent.resource.serviceConfig, ['availableMemory', 'availableCpu', 'maxInstanceCount', 'minInstanceCount', 'maxInstanceRequestConcurrency', 'ingressSettings', 'serviceAccountEmail', 'environmentVariables', 'secretEnvironmentVariables', 'secretVolumes', 'vpcConnector', 'vpcConnectorEgressSettings', 'allTrafficOnLatestRevision']);
    serviceConfig.timeoutSeconds = 30;
    if (serviceConfig.environmentVariables?.FUNCTION_TARGET !== undefined) serviceConfig.environmentVariables.FUNCTION_TARGET = name;
    return { functionId: name, resourceTemplate: { name: `projects/pay-0-system/locations/us-central1/functions/${name}`, environment: 'GEN_2', buildConfig, serviceConfig,
      labels: { 'deployment-callable': 'true', 'pay0-source-commit': input.sourceCommit, 'firebase-functions-hash': input.archiveSha256.slice(0, 40), 'pay0-source-mode': 'additive-new-functions-v1', 'pay0-base-source': input.sourceIdentity.baseArchiveSha256?.slice(0, 40), 'pay0-patch-sha': input.sourceIdentity.patchSha256?.slice(0, 40) } },
      sourceBinding: { requiresUploadOfSha256: input.archiveSha256, field: 'buildConfig.source.storageSource', status: 'NOT_UPLOADED' },
      iamProposal: { approved: false, resource: `projects/pay-0-system/locations/us-central1/services/${name.toLowerCase()}`, bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }], applicationAuthorization: 'Firebase Authentication + active superadmin + reportes/view + current root' } };
  });
  return { schemaVersion: 1, state: 'PLAN_ONLY_REQUIRES_EXPLICIT_CREATE_AND_IAM_APPROVAL', archiveSha256: input.archiveSha256, functions,
    rollbackProposal: { approved: false, action: 'Remove only the new services public invocation bindings and hide review UI; retain functions and all review/job/audit records.', dataDeletion: false },
    approvalRequiredFor: ['Create exactly these two Functions', 'Grant allUsers roles/run.invoker only on their new Cloud Run services', 'Upload the exact reviewed source archive'], productionWrites: 0 };
}
export function validateExecutionRequest(args, bytes) {
  if (!args.includes('--execute')) return;
  const value = flag => args[args.indexOf(flag) + 1];
  assert(args.includes('--input-sha256'), 'EXECUTE_INPUT_HASH_REQUIRED');
  assert.equal(value('--input-sha256'), sha(bytes), 'INPUT_HASH_MISMATCH');
  assert(args.includes('--scope'), 'EXECUTE_SCOPE_REQUIRED');
  validateScope(value('--scope').split(','));
  assert(args.includes('--plan-sha256'), 'EXECUTE_PLAN_HASH_REQUIRED');
  assert(args.includes(args.includes('--rollback') ? '--approve-rollback-public-invocation' : '--approve-create-and-public-invocation'), 'EXPLICIT_CREATE_AND_IAM_APPROVAL_REQUIRED');
}
export function prepare(inputFile, args = []) {
  const base = path.resolve('.firebase/modular-release');
  const file = privatePath(inputFile, base);
  const bytes = fs.readFileSync(file), input = JSON.parse(bytes);
  validateExecutionRequest(args, bytes);
  assert.equal(sha(fs.readFileSync(privatePath(input.archive))), input.archiveSha256, 'ARCHIVE_CHANGED');
  const baselineBytes = fs.readFileSync(privatePath(input.baselineFile));
  assert.equal(sha(baselineBytes), input.baselineSha256, 'BASELINE_CHANGED');
  const directory = path.dirname(file);
  const startup = JSON.parse(fs.readFileSync(path.join(directory, 'startup-verification.json')));
  const behavior = JSON.parse(fs.readFileSync(path.join(directory, 'behavior-verification.json')));
  for (const proof of [startup, behavior]) { assert.equal(proof.status, 'PASS'); assert.equal(proof.archiveSha256, input.archiveSha256); }
  assert.equal(startup.unauthenticatedDenied, 2);
  assert.deepEqual(startup.functions, NAMES);
  assert.deepEqual(startup.sourceIdentity, input.sourceIdentity);
  for (const key of ['authorizationPositiveAndNegative', 'revocationDenied', 'foreignRootsIsolated', 'emptyListClosed', 'concurrentAcknowledgeOnce', 'paginationBeyond50', 'sourceJobPreserved']) assert.equal(behavior[key], true, key);
  const plan = buildCreatePlan(input, JSON.parse(baselineBytes));
  plan.inputSha256 = sha(bytes);
  const output = path.join(directory, 'create-plan.json');
  fs.writeFileSync(output, JSON.stringify(plan, null, 2), { mode: 0o600 });
  return { state: plan.state, planFile: output, planSha256: sha(fs.readFileSync(output)), inputSha256: plan.inputSha256, functions: NAMES, productionWrites: 0 };
}
const baseUrl = 'https://cloudfunctions.googleapis.com/v2/projects/pay-0-system/locations/us-central1';
const functionUrl = name => `${baseUrl}/functions/${name}`;
export function assertCreated(resource, target, input) {
  assert.equal(resource.name, target.resourceTemplate.name, 'CREATED_NAME_MISMATCH');
  assert.equal(resource.state, 'ACTIVE', 'CREATED_NOT_ACTIVE');
  assert.equal(resource.environment, 'GEN_2');
  assert.equal(resource.buildConfig.entryPoint, target.functionId);
  assert.equal(resource.buildConfig.runtime, target.resourceTemplate.buildConfig.runtime);
  for (const [key,value] of Object.entries(target.resourceTemplate.buildConfig)) assert.deepEqual(resource.buildConfig[key], value, `CREATED_BUILD_${key}`);
  for (const [key, value] of Object.entries(target.resourceTemplate.serviceConfig)) assert.deepEqual(resource.serviceConfig[key], value, `CREATED_SERVICE_${key}`);
  for (const [key, value] of Object.entries(target.resourceTemplate.labels)) assert.equal(resource.labels?.[key], value, `CREATED_LABEL_${key}`);
  assert.equal(resource.labels['firebase-functions-hash'], input.archiveSha256.slice(0, 40));
  assert.match(resource.serviceConfig.service, /^projects\/(pay-0-system|751158244178)\/locations\/us-central1\/services\/[a-z0-9-]+$/);
  assert.equal(resource.serviceConfig.service.replace('projects/751158244178/', 'projects/pay-0-system/'), target.iamProposal.resource, 'IAM_SERVICE_TARGET_MISMATCH');
}
export async function executePlan({ input, plan, baseline, archive, journal, io }) {
  validateScope(input.functions);
  assert.equal(sha(archive), input.archiveSha256);
  assert.deepEqual(plan.functions.map(x => x.functionId), NAMES);
  const expectedPlan = buildCreatePlan(input, baseline);
  assert.deepEqual(plan.functions, expectedPlan.functions, 'CREATE_PLAN_DRIFT');
  const parent = baseline.functions.getControlCenterEngineering;
  const current = await io.read(functionUrl('getControlCenterEngineering'));
  assert.equal(digest(current), digest(parent.resource), 'PARENT_DRIFT');
  assert.equal(digest(await io.read(`https://run.googleapis.com/v2/${current.serviceConfig.service}`)), digest(parent.service), 'PARENT_SERVICE_DRIFT');
  assert.equal(digest(await io.read(`https://run.googleapis.com/v2/${current.serviceConfig.service}:getIamPolicy`)), digest(parent.iam), 'PARENT_IAM_DRIFT');
  for (const name of NAMES) {
    const found = await io.read(functionUrl(name), true);
    if (!journal.functions[name]) assert.equal(found, null, 'FUNCTION_ALREADY_EXISTS');
    else assert.notEqual(journal.functions[name].phase, 'CREATE_DISPATCHING', 'UNCERTAIN_CREATE_REQUIRES_RECONCILIATION');
  }
  if (!journal.uploadedSource) {
    const operations = await io.read(`${baseUrl}/operations?pageSize=100&filter=done%3Dfalse`);
    assert.equal((operations.operations || []).filter(op => !op.done).length, 0, 'CONCURRENT_OPERATION');
    journal.networkMutationStarted = true; io.persist(journal);
    const upload = await io.mutate(`${baseUrl}/functions:generateUploadUrl`, { environment: 'GEN_2' });
    const url = new URL(upload.uploadUrl);
    assert(url.protocol === 'https:' && (url.hostname === 'storage.googleapis.com' || url.hostname.endsWith('.storage.googleapis.com')), 'UPLOAD_HOST');
    const generation = await io.upload(url.href, archive);
    assert.match(generation, /^[1-9][0-9]*$/);
    journal.uploadedSource = { ...upload.storageSource, generation };
    assertUploadSource(journal.uploadedSource);
    assert.equal(sha(await io.readSource(journal.uploadedSource)), input.archiveSha256, 'UPLOADED_SOURCE_MISMATCH');
    io.persist(journal);
  }
  for (const target of plan.functions) {
    const name = target.functionId;
    let entry = journal.functions[name];
    if (!entry) {
      assert.equal(await io.read(functionUrl(name), true), null, 'FUNCTION_APPEARED_BEFORE_CREATE');
      entry = journal.functions[name] = { phase: 'CREATE_DISPATCHING' }; io.persist(journal);
      const body = structuredClone(target.resourceTemplate); body.buildConfig.source = { storageSource: journal.uploadedSource };
      const operation = await io.mutate(`${baseUrl}/functions?functionId=${name}`, body);
      assertOperationScope(operation);
      Object.assign(entry, { phase: 'CREATE_ACCEPTED', operation: operation.name }); io.persist(journal);
    }
    if (entry.phase === 'CREATE_ACCEPTED') {
      assertOperationScope({ name: entry.operation });
      let complete = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        const op = await io.read(`https://cloudfunctions.googleapis.com/v2/${entry.operation}`);
        if (op.done) { assert(!op.error, 'CREATE_OPERATION_FAILED'); complete = true; break; }
        await io.sleep(10000);
      }
      assert(complete, 'CREATE_TIMEOUT_RESUME_REQUIRED');
      entry.phase = 'CREATED'; io.persist(journal);
    }
    const resource = await io.read(functionUrl(name));
    assertCreated(resource, target, input);
    const source = resource.buildConfig.sourceProvenance?.resolvedStorageSource || resource.buildConfig.source.storageSource;
    assert.equal(sha(await io.readSource(source)), input.archiveSha256, 'CREATED_SOURCE_BYTES_MISMATCH');
    const iamUrl = `https://run.googleapis.com/v2/${resource.serviceConfig.service}`;
    const policy = await io.read(`${iamUrl}:getIamPolicy`);
    const bindings = target.iamProposal.bindings;
    if (digest(policy.bindings || []) !== digest(bindings)) {
      assert.deepEqual(policy.bindings || [], [], 'UNEXPECTED_NEW_SERVICE_IAM');
      entry.phase = 'IAM_DISPATCHING'; entry.beforeIam = policy; io.persist(journal);
      await io.mutate(`${iamUrl}:setIamPolicy`, { policy: { ...policy, bindings }, updateMask: 'bindings,etag' });
    }
    const afterIam = await io.read(`${iamUrl}:getIamPolicy`);
    assert.deepEqual(afterIam.bindings, bindings, 'POSTFLIGHT_IAM_MISMATCH');
    const service = await io.read(iamUrl);
    assert.equal(service.terminalCondition?.state, 'CONDITION_SUCCEEDED', 'RUN_NOT_READY');
    Object.assign(entry, { phase: 'VERIFIED', resource, service, iam: afterIam }); io.persist(journal);
  }
  journal.state = 'CONFIGURATION_VERIFIED_FUNCTIONAL_CHECK_PENDING'; io.persist(journal);
  return { state: journal.state, functions: NAMES, archiveSha256: input.archiveSha256 };
}

export async function rollbackPlan({ input, plan, journal, io }) {
  validateScope(input.functions);
  assert.deepEqual(plan.functions.map(f => f.functionId), NAMES);
  const targets = [];
  for (const target of plan.functions) {
    const saved = journal.functions[target.functionId];
    assert(saved?.resource && saved?.service && saved?.iam, 'VERIFIED_CREATE_JOURNAL_REQUIRED');
    const resource = await io.read(functionUrl(target.functionId));
    assertCreated(resource, target, input);
    assert.equal(digest(resource), digest(saved.resource), 'ROLLBACK_FUNCTION_DRIFT');
    const runUrl = `https://run.googleapis.com/v2/${resource.serviceConfig.service}`;
    const service = await io.read(runUrl);
    assert.equal(digest(service), digest(saved.service), 'ROLLBACK_SERVICE_DRIFT');
    const iam = await io.read(`${runUrl}:getIamPolicy`);
    const desired = saved.rollbackBindings || (saved.iam.bindings || []).map(binding => binding.role === 'roles/run.invoker' && !binding.condition ? { ...binding, members: binding.members.filter(member => member !== 'allUsers') } : binding).filter(binding => binding.members.length);
    const alreadyRemoved = saved.rollbackBindings && digest(iam.bindings || []) === digest(desired);
    if (!alreadyRemoved) assert.equal(digest(iam), digest(saved.iam), 'ROLLBACK_IAM_DRIFT');
    targets.push({ target, saved, runUrl, iam, desired, alreadyRemoved });
  }
  for (const { saved, runUrl, iam, desired, alreadyRemoved } of targets) {
    saved.rollbackBindings = desired; saved.phase = 'ROLLBACK_IAM_DISPATCHING'; io.persist(journal);
    if (!alreadyRemoved) await io.mutate(`${runUrl}:setIamPolicy`, { policy: { ...iam, bindings: desired }, updateMask: 'bindings,etag' });
    const after = await io.read(`${runUrl}:getIamPolicy`);
    assert.deepEqual(after.bindings || [], desired, 'ROLLBACK_IAM_POSTFLIGHT');
    saved.phase = 'PUBLIC_INVOCATION_REMOVED'; saved.rollbackIam = after; io.persist(journal);
  }
  journal.state = 'ROLLED_BACK_PUBLIC_INVOCATION_ONLY'; io.persist(journal);
  return { state: journal.state, functions: NAMES, dataDeleted: false };
}

export function networkIo(token, persist) {
  async function request(url, method = 'GET', body, optional = false) {
    const parsed = new URL(url);
    assert(parsed.protocol === 'https:' && ['cloudfunctions.googleapis.com', 'run.googleapis.com'].includes(parsed.hostname), 'API_HOST');
    const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': 'pay-0-system', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (optional && response.status === 404) return null;
    assert(response.ok, `API_HTTP_${response.status}`);
    return response.json();
  }
  return { persist, read: (url, optional) => request(url, 'GET', undefined, optional), mutate: (url, body) => request(url, 'POST', body), sleep: ms => new Promise(r => setTimeout(r, ms)),
    upload: async (url, bytes) => { const r = await fetch(url, { method: 'PUT', body: bytes, redirect: 'error', signal: AbortSignal.timeout(120000), headers: { 'Content-Type': 'application/zip' } }); assert(r.ok, 'UPLOAD_FAILED'); return r.headers.get('x-goog-generation'); },
    readSource: async source => { assertUploadSource(source); const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${source.bucket}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`, { redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${token}` } }); assert(r.ok, 'SOURCE_READ_FAILED'); return Buffer.from(await r.arrayBuffer()); },
  };
}
export async function execute(inputFile, args) {
  assert(args.includes('--execute'), 'EXECUTE_FLAG_REQUIRED');
  const file = privatePath(inputFile), bytes = fs.readFileSync(file);
  validateExecutionRequest(args, bytes);
  const directory = path.dirname(file), planFile = path.join(directory, 'create-plan.json');
  const planBytes = fs.readFileSync(planFile);
  assert.equal(sha(planBytes), args[args.indexOf('--plan-sha256') + 1], 'PLAN_HASH_MISMATCH');
  const plan = JSON.parse(planBytes), input = JSON.parse(bytes);
  privatePath(input.archive); privatePath(input.baselineFile);
  assert.equal(plan.inputSha256, sha(bytes), 'PLAN_INPUT_MISMATCH');
  // Re-run read-only proof validation without rewriting the approved plan.
  assert.equal(sha(fs.readFileSync(input.baselineFile)), input.baselineSha256);
  const baseline = JSON.parse(fs.readFileSync(input.baselineFile));
  assert.deepEqual(plan, { ...buildCreatePlan(input, baseline), inputSha256: sha(bytes) }, 'APPROVED_PLAN_DRIFT');
  const startup = JSON.parse(fs.readFileSync(path.join(directory, 'startup-verification.json')));
  const behavior = JSON.parse(fs.readFileSync(path.join(directory, 'behavior-verification.json')));
  assert.equal(startup.status, 'PASS'); assert.equal(startup.archiveSha256, input.archiveSha256); assert.equal(startup.unauthenticatedDenied, 2);
  assert.deepEqual(startup.functions, NAMES); assert.deepEqual(startup.sourceIdentity, input.sourceIdentity);
  assert.equal(behavior.status, 'PASS'); assert.equal(behavior.archiveSha256, input.archiveSha256);
  for (const key of ['authorizationPositiveAndNegative', 'revocationDenied', 'foreignRootsIsolated', 'emptyListClosed', 'concurrentAcknowledgeOnce', 'paginationBeyond50', 'sourceJobPreserved']) assert.equal(behavior[key], true, key);
  const privateRoot = path.resolve('.firebase/modular-release');
  assert(file.startsWith(privateRoot + path.sep), 'PRIVATE_INPUT_REQUIRED');
  for (const check of [file, input.archive, input.baselineFile, planFile]) privatePath(check);
  const lockPath = path.join(privateRoot, 'deployment.lock'), journalPath = path.join(directory, 'create-journal.json');
  const activePath = privatePath(path.join(privateRoot, 'active-executor.lock'));
  const releaseActive = acquireActiveExecutor(activePath);
  let fd;
  try {
  const resume = args.includes('--resume');
  const rollback = args.includes('--rollback');
  let journal = resume || rollback ? JSON.parse(fs.readFileSync(privatePath(journalPath))) : { inputSha256: sha(bytes), planSha256: sha(planBytes), functions: {}, state: 'PREPARED' };
  assert.equal(journal.inputSha256, sha(bytes)); assert.equal(journal.planSha256, sha(planBytes));
  if (resume) {
    const existing = JSON.parse(fs.readFileSync(lockPath)); assert.equal(existing.inputSha256, sha(bytes)); assert.equal(existing.kind, 'RECOVERY_REVIEW_CREATE');
    assert(Number.isInteger(existing.ownerPid), 'CREATE_LOCK_OWNER_REQUIRED');
    let alive = true;
    try { process.kill(existing.ownerPid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    assert(!alive, 'CREATE_EXECUTOR_STILL_ACTIVE');
  }
  fd = fs.openSync(privatePath(lockPath), resume ? 'r+' : 'wx');
  let succeeded = false;
  const persist = state => { fs.writeFileSync(journalPath, JSON.stringify(state), { mode: 0o600 }); fs.writeFileSync(lockPath, JSON.stringify({ kind: 'RECOVERY_REVIEW_CREATE', ownerPid: process.pid, inputSha256: sha(bytes), planSha256: sha(planBytes), journalPath }), { mode: 0o600 }); };
  try { persist(journal); const context = { input, plan, baseline, archive: fs.readFileSync(input.archive), journal, io: networkIo(tokenInMemory(), persist) }; const result = await (rollback ? rollbackPlan(context) : executePlan(context)); succeeded = true; return result; }
  finally { fs.closeSync(fd); if (succeeded || !journal.networkMutationStarted) fs.unlinkSync(lockPath); }
  } finally { releaseActive(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const args = process.argv.slice(3); console.log(JSON.stringify(args.includes('--execute') ? await execute(process.argv[2], args) : prepare(process.argv[2], args))); }
  catch (error) { console.error(String(error.message).split('\n')[0]); process.exitCode = 1; }
}
