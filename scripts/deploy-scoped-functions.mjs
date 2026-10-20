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

export const DEPLOYMENT_GROUPS = Object.freeze({
  receipts: Object.freeze(['parsePagoReceiptPdf', 'correctPagoReceiptSemanticField']),
  'receipt-learning-overlay': Object.freeze(['parsePagoReceiptPdf', 'correctPagoReceiptSemanticField']),
  'conversation-memory-review-overlay': Object.freeze(['listAgent007MemoryDiagnostics', 'reviewAgent007MemoryCandidate']),
  'conversation-memory-create-overlay': Object.freeze(['createAgent007MemoryCandidate']),
  'receipt-workflow': Object.freeze(['createPago', 'parsePagoReceiptPdf', 'correctPagoReceiptSemanticField']),
  'security-readers': Object.freeze(['listClientsCanonical', 'getClientCanonical', 'listPagos', 'listSolicitudes', 'listScopedClientDispersions', 'listPagoNotes', 'listSolicitudNotes', 'listClientDispersionNotes', 'getAuthorizedDocumentDownloadUrl']),
  'engineering-action': Object.freeze(['reconcileAgent007RecommendationsNow']),
  'hugo-reports': Object.freeze(['sendAgent007Message', 'delegateHugoVoiceTurn', 'getEarningsByClientReport']),
  'hugo-chat-overlay': Object.freeze(['sendAgent007Message']),
  'hugo-voice-overlay': Object.freeze(['delegateHugoVoiceTurn']),
  'document-generation-overlay': Object.freeze(['getAuthorizedDocumentDownloadUrl']),
  'complement-config-overlay': Object.freeze(['configurePaymentComplementAutomation']),
  'mat-user-home-overlay': Object.freeze(['getMatUserHome']),
  'mat-client-home-overlay': Object.freeze(['getMatClientHome']),
  'mat-session-overlay': Object.freeze(['verifyTelegramMiniAppSession']),
  'operation-recovery-queue-overlay': Object.freeze(['queueOperationRecovery']),
  'operation-recovery-reconcile-overlay': Object.freeze(['reconcileOperationRecovery']),
});
const OVERLAY_GROUPS = Object.freeze(['receipt-learning-overlay', 'conversation-memory-review-overlay', 'conversation-memory-create-overlay', 'hugo-chat-overlay', 'hugo-voice-overlay', 'document-generation-overlay', 'complement-config-overlay', 'mat-user-home-overlay', 'mat-client-home-overlay', 'mat-session-overlay', 'operation-recovery-queue-overlay', 'operation-recovery-reconcile-overlay']);
export function artifactProbeContract(group) {
  if (['mat-user-home-overlay', 'mat-client-home-overlay', 'mat-session-overlay'].includes(group)) return { kind: 'SIGNED_SESSION', missingScopeError: 'invalid-argument' };
  if (group === 'operation-recovery-queue-overlay') return { kind: 'FIRESTORE', eventType: 'google.cloud.firestore.document.v1.written', document: 'solicitudes/{documentId}', retry: true };
  if (group === 'operation-recovery-reconcile-overlay') return { kind: 'SCHEDULE', schedule: 'every 5 minutes' };
  return { kind: 'CALLABLE' };
}
export function validateSourceIdentity(identity, group, sourceCommit) {
  if (identity === undefined) {
    assert.ok(!OVERLAY_GROUPS.includes(group), 'OVERLAY_IDENTITY_REQUIRED');
    return;
  }
  assert.ok(OVERLAY_GROUPS.includes(group), 'OVERLAY_GROUP_REQUIRED');
  assert.deepEqual(Object.keys(identity).sort(), ['baseArchiveSha256', 'mode', 'patchCommit', 'patchSha256'].sort(), 'OVERLAY_IDENTITY_FIELDS');
  assert.equal(identity.mode, 'PRODUCTION_OVERLAY_V1', 'OVERLAY_MODE');
  assert.equal(identity.patchCommit, sourceCommit, 'OVERLAY_PATCH_COMMIT');
  for (const key of ['baseArchiveSha256', 'patchSha256']) assert.match(identity[key], /^[a-f0-9]{64}$/, 'OVERLAY_HASH_REQUIRED');
}
export function assertPublishedIdentity(resource, input) {
  validateSourceIdentity(input.sourceIdentity, input.group, input.sourceCommit);
  assert.equal(resource.labels?.['pay0-source-commit'], input.sourceCommit, 'POSTFLIGHT_COMMIT');
  assert.equal(resource.labels?.['firebase-functions-hash'], input.archiveSha256.slice(0, 40), 'POSTFLIGHT_ARTIFACT_LABEL');
  if (input.sourceIdentity) {
    assert.equal(resource.labels?.['pay0-source-mode'], 'production-overlay-v1', 'POSTFLIGHT_SOURCE_MODE');
    assert.equal(resource.labels?.['pay0-base-source'], input.sourceIdentity.baseArchiveSha256.slice(0, 40), 'POSTFLIGHT_BASE_SOURCE');
    assert.equal(resource.labels?.['pay0-patch-sha'], input.sourceIdentity.patchSha256.slice(0, 40), 'POSTFLIGHT_PATCH');
  }
}
export function deploymentScope(input) {
  const group = input.group === undefined ? 'receipts' : input.group;
  assert.ok(Object.prototype.hasOwnProperty.call(DEPLOYMENT_GROUPS, group), 'GROUP_NOT_ALLOWED');
  const names = DEPLOYMENT_GROUPS[group];
  assert.deepEqual(input.functions, [...names], 'FUNCTION_SCOPE');
  const buildMode = input.buildMode === undefined ? 'NORMAL' : input.buildMode;
  assert.ok(['NORMAL', 'BUNDLED_V1'].includes(buildMode), 'BUILD_MODE_NOT_ALLOWED');
  return { group, names, buildMode };
}
export function assertArtifactProof(input, proof) {
  const { names } = deploymentScope(input);
  validateSourceIdentity(input.sourceIdentity, input.group, input.sourceCommit);
  if (input.sourceIdentity) {
    assert.equal(input.sourceTree, null, 'OVERLAY_MUST_NOT_CLAIM_SOURCE_TREE');
    assert.deepEqual(proof.sourceIdentity, input.sourceIdentity, 'ARTIFACT_PROOF_SOURCE_IDENTITY');
  }
  assert.equal(proof.status, 'PASS', 'ARTIFACT_NOT_VERIFIED');
  assert.equal(proof.sourceCommit, input.sourceCommit, 'ARTIFACT_PROOF_COMMIT');
  assert.equal(proof.archiveSha256, input.archiveSha256, 'ARTIFACT_PROOF_HASH');
  const contract = artifactProbeContract(input.group);
  if (contract.kind === 'CALLABLE') assert.equal(proof.unauthenticatedDenied, names.length, 'ARTIFACT_AUTH_NOT_VERIFIED');
  else if (contract.kind === 'SIGNED_SESSION') {
    assert.deepEqual(proof.sessionValidationContract, contract, 'ARTIFACT_SIGNED_SESSION_CONTRACT');
    assert.equal(proof.invalidSessionDenied, names.length, 'ARTIFACT_SIGNED_SESSION_NOT_VERIFIED');
    const behavior = proof.behaviorVerification;
    assert.equal(behavior?.status, 'PASS', 'SIGNED_SESSION_BEHAVIOR_NOT_VERIFIED');
    assert.equal(behavior.archiveSha256, input.archiveSha256, 'SIGNED_SESSION_ARTIFACT_MISMATCH');
    for (const key of ['invalidSignatureRejected', 'expiredSignatureRejected', 'membershipRevocationRejected', 'foreignRootsIsolated', 'emptyScopeDenied', 'canonicalUidPreserved']) assert.equal(behavior[key], true, 'SIGNED_SESSION_BEHAVIOR_INCOMPLETE');
  } else {
    assert.deepEqual(proof.registrationContract, contract, 'ARTIFACT_REGISTRATION_MISMATCH');
    assert.equal(proof.registeredFunctions, names.length, 'ARTIFACT_REGISTRATION_NOT_VERIFIED');
    assert.equal(proof.invokedFunctions, 0, 'BACKGROUND_PROBE_MUST_NOT_INVOKE');
    const behavior = proof.behaviorVerification;
    assert.equal(behavior?.status, 'PASS', 'BACKGROUND_BEHAVIOR_NOT_VERIFIED');
    assert.equal(behavior.archiveSha256, input.archiveSha256, 'BACKGROUND_BEHAVIOR_ARTIFACT_MISMATCH');
    for (const key of ['terminalPreserved', 'retryBudgetPreserved', 'scopedRootsPreserved']) assert.equal(behavior[key], true, 'BACKGROUND_BEHAVIOR_INCOMPLETE');
  }
  if (proof.functions !== undefined || input.group !== undefined) assert.deepEqual(proof.functions, [...names], 'ARTIFACT_PROOF_FUNCTIONS');
  if (input.buildMode !== undefined) assert.equal(proof.buildMode, input.buildMode, 'ARTIFACT_PROOF_MODE');
}
export function assertUploadSource(source) {
  assert.ok(source && /^(?:gcf-v2-sources-751158244178-us-central1|gcf-v2-uploads-751158244178\.us-central1\.cloudfunctions\.appspot\.com)$/.test(source.bucket)
    && typeof source.object === 'string' && source.object.length > 0 && !source.object.includes('..') && !source.object.startsWith('/')
    && /^[1-9][0-9]*$/.test(source.generation || ''), 'UPLOAD_SOURCE_INVALID');
}
export function assertOperationScope(operation) {
  assert.match(operation.name || '', /^projects\/(?:pay-0-system|751158244178)\/locations\/us-central1\/operations\/[^/]+$/, 'OPERATION_SCOPE');
}
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
function command(command, args, cwd, log, environment = process.env) {
  const result = spawnSync(command, args, { cwd, env: environment, encoding: 'utf8', windowsHide: true,
    shell: process.platform === 'win32' && command === 'npm', maxBuffer: 20 * 1024 * 1024 });
  if (log) fs.appendFileSync(log, (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 0, `COMMAND_FAILED_${command}`);
  return (result.stdout || '').trim();
}
export function sourceOnlyPatch(baseline, source, sourceCommit, archiveSha256, group = 'receipts', sourceIdentity) {
  assert.ok(Object.prototype.hasOwnProperty.call(DEPLOYMENT_GROUPS, group) && DEPLOYMENT_GROUPS[group].includes(baseline.name?.split('/').at(-1)), 'FUNCTION_NOT_ALLOWED');
  assert.equal(baseline.name, `projects/${PROJECT}/locations/${REGION}/functions/${baseline.name.split('/').at(-1)}`, 'FUNCTION_SCOPE');
  assert.equal(baseline.state, 'ACTIVE', 'FUNCTION_NOT_ACTIVE');
  assert.equal(baseline.buildConfig.runtime, 'nodejs22', 'RUNTIME_CHANGED');
  assert.equal(baseline.buildConfig.environmentVariables?.GOOGLE_NODE_RUN_SCRIPTS, '', 'BUILD_SCRIPTS_UNREVIEWED');
  assert.match(sourceCommit, /^[a-f0-9]{40}$/, 'COMMIT_REQUIRED');
  assert.match(archiveSha256, /^[a-f0-9]{64}$/, 'ARCHIVE_HASH_REQUIRED');
  assertUploadSource(source);
  validateSourceIdentity(sourceIdentity, group, sourceCommit);
  const labels = { ...baseline.labels, 'pay0-source-commit': sourceCommit, 'firebase-functions-hash': archiveSha256.slice(0, 40) };
  for (const key of ['pay0-source-mode', 'pay0-base-source', 'pay0-patch-sha']) delete labels[key];
  if (sourceIdentity) Object.assign(labels, { 'pay0-source-mode': 'production-overlay-v1', 'pay0-base-source': sourceIdentity.baseArchiveSha256.slice(0, 40), 'pay0-patch-sha': sourceIdentity.patchSha256.slice(0, 40) });
  return { name: baseline.name, buildConfig: { source: { storageSource: source } },
    labels };
}
function orderedEventTrigger(trigger) {
  const result = structuredClone(trigger);
  if (Array.isArray(result?.eventFilters)) result.eventFilters.sort((a, b) => digest(a).localeCompare(digest(b)));
  return result;
}
export function functionMetadataDigest(resource) {
  const copy = structuredClone(resource);
  if (copy.eventTrigger) copy.eventTrigger = orderedEventTrigger(copy.eventTrigger);
  return digest(copy);
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
  assert.deepEqual(orderedEventTrigger(after.eventTrigger), orderedEventTrigger(before.eventTrigger), 'EVENT_TRIGGER_CHANGED');
}
export function assertRunRuntimePreserved(before, after, input) {
  // Google may add these identity annotations while replacing a revision.
  // Normalize only additions absent in the baseline, and only canonical identity.
  const normalizedAfter = structuredClone(after);
  const normalizeAddedIdentity = (oldMap, newMap, key, expected) => {
    if (!Object.hasOwn(oldMap || {}, key) && Object.hasOwn(newMap || {}, key)) {
      assert.equal(after.name, before.name, 'RUN_IDENTITY_SERVICE_CHANGED');
      const match = /^projects\/(pay-0-system|751158244178)\/locations\/us-central1\/services\/([^/]+)$/.exec(after.name || '');
      assert.ok(match, 'RUN_IDENTITY_SCOPE');
      const functionId = before.buildConfig?.functionTarget;
      assert.ok(Object.values(DEPLOYMENT_GROUPS).flat().includes(functionId), 'RUN_IDENTITY_FUNCTION');
      assert.equal(functionId.toLowerCase(), match[2], 'RUN_IDENTITY_FUNCTION_SERVICE');
      assert.equal(newMap[key], expected(functionId, match[2]), 'RUN_IDENTITY_VALUE');
      delete newMap[key];
    }
  };
  normalizeAddedIdentity(before.template?.labels, normalizedAfter.template?.labels, 'goog-drz-cloudfunctions-location', () => REGION);
  normalizeAddedIdentity(before.template?.labels, normalizedAfter.template?.labels, 'goog-drz-cloudfunctions-id', (_, serviceId) => serviceId);
  normalizeAddedIdentity(before.annotations, normalizedAfter.annotations, 'cloudfunctions.googleapis.com/function-id', functionId => functionId);
  if (before.annotations === undefined && normalizedAfter.annotations && !Object.keys(normalizedAfter.annotations).length) delete normalizedAfter.annotations;
  if (before.template?.labels === undefined && normalizedAfter.template?.labels && !Object.keys(normalizedAfter.template.labels).length) delete normalizedAfter.template.labels;
  const overlayLabels = input?.sourceIdentity ? {
    'pay0-source-mode': 'production-overlay-v1',
    'pay0-base-source': input.sourceIdentity.baseArchiveSha256.slice(0, 40),
    'pay0-patch-sha': input.sourceIdentity.patchSha256.slice(0, 40),
  } : null;
  if (overlayLabels) {
    validateSourceIdentity(input.sourceIdentity, input.group, input.sourceCommit);
    for (const target of [after, after.template]) for (const [key, value] of Object.entries(overlayLabels)) {
      assert.equal(target?.labels?.[key], value, 'RUN_OVERLAY_PROVENANCE_CHANGED');
    }
  }
  const comparable = value => {
    const copy = structuredClone(value);
    const latest = copy.latestReadyRevision;
    for (const key of ['generation', 'observedGeneration', 'updateTime', 'etag', 'latestCreatedRevision', 'latestReadyRevision']) delete copy[key];
    const labels = target => {
      if (!target?.labels) return;
      delete target.labels['pay0-source-commit']; delete target.labels['firebase-functions-hash'];
      if (overlayLabels) for (const key of Object.keys(overlayLabels)) delete target.labels[key];
    };
    labels(copy); labels(copy.template);
    if (copy.template) {
      delete copy.template.revision;
      for (const container of copy.template.containers || []) delete container.image;
    }
    if (copy.buildConfig) for (const key of ['name', 'sourceLocation', 'imageUri']) delete copy.buildConfig[key];
    if (copy.terminalCondition) delete copy.terminalCondition.lastTransitionTime;
    for (const condition of copy.conditions || []) delete condition.lastTransitionTime;
    for (const target of copy.trafficStatuses || []) if (target.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST') {
      assert.ok(latest && [latest, latest.split('/').at(-1)].includes(target.revision), 'RUN_LATEST_TRAFFIC_INVALID');
      delete target.revision;
    }
    return copy;
  };
  assert.equal(after.terminalCondition?.state, 'CONDITION_SUCCEEDED', 'RUN_NOT_READY');
  assert.deepEqual(comparable(normalizedAfter), comparable(before), 'RUN_CONFIGURATION_CHANGED');
}
export function assertOperationMatchesGet(operationResource, getResource) {
  // Long-running operation responses wrap Function in protobuf Any and can
  // precede the final bookkeeping timestamp. Compare every substantive field.
  const comparable = value => {
    const copy = structuredClone(value);
    delete copy['@type']; delete copy.updateTime;
    return copy;
  };
  assert.equal(functionMetadataDigest(comparable(operationResource)), functionMetadataDigest(comparable(getResource)), 'CONCURRENT_POSTFLIGHT_CHANGE');
}
export function previousSource(resource) {
  const source = resource.buildConfig?.sourceProvenance?.resolvedStorageSource || resource.buildConfig?.source?.storageSource;
  assert.ok(source && /^gcf-v2-sources-751158244178-us-central1$/.test(source.bucket) && /^[A-Za-z0-9_-]+\/function-source\.zip$/.test(source.object) && /^[1-9][0-9]*$/.test(source.generation), 'PREVIOUS_SOURCE_NOT_PINNED');
  return source;
}
export function assertPreservedSource(resource, receipt, bytes) {
  assert.ok(receipt, 'PREVIOUS_SOURCE_RECEIPT_REQUIRED');
  assert.equal(sha(bytes), receipt.sha256, 'PREVIOUS_SOURCE_CHANGED');
  assert.deepEqual(receipt.source, previousSource(resource), 'PREVIOUS_SOURCE_BASELINE_MISMATCH');
  assert.equal(receipt.previousRevision, resource.serviceConfig.revision, 'PREVIOUS_REVISION_MISMATCH');
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
  assert.equal(functionMetadataDigest(resource), functionMetadataDigest(expected.resource), 'CONCURRENT_FUNCTION_CHANGE');
  const service = await getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}`, token);
  assert.equal(digest(service), digest(expected.service), 'CONCURRENT_RUN_CHANGE');
  const iam = await getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}:getIamPolicy`, token);
  assert.equal(digest(iam), digest(expected.iam), 'CONCURRENT_IAM_CHANGE');
  return resource;
}
async function waitOperation(operation, token, emit, name) {
  assertOperationScope(operation);
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10_000));
    const status = await getMetadata(`https://cloudfunctions.googleapis.com/v2/${operation.name}`, token);
    if (!status.done) { if (attempt % 3 === 0) emit({ state: 'BUILDING', function: name }); continue; }
    assert.ok(!status.error, 'DEPLOYMENT_OPERATION_FAILED'); return status.response;
  }
  throw Error('DEPLOYMENT_TIMEOUT');
}
export async function prepare(commit, baselineFile, group = 'receipts', buildMode = 'NORMAL') {
  const { names: functions } = deploymentScope({ group, functions: DEPLOYMENT_GROUPS[group], buildMode });
  assert.match(commit, /^[a-f0-9]{40}$/, 'COMMIT_REQUIRED');
  const baseline = fs.readFileSync(privatePath(baselineFile));
  const baselineData = JSON.parse(baseline);
  for (const name of functions) {
    const resource = baselineData.functions?.[name]?.resource;
    assert.ok(resource, 'EXISTING_FUNCTION_REQUIRED');
    sourceOnlyPatch(resource, previousSource(resource), commit, '0'.repeat(64), group);
  }
  const directory = privatePath(path.join(PRIVATE, `source-${commit.slice(0, 12)}-${crypto.randomUUID()}`));
  fs.mkdirSync(directory, { recursive: true });
  const source = path.join(directory, 'source'); fs.mkdirSync(source);
  const log = path.join(directory, 'build.log'), tar = path.join(directory, 'source.tar');
  command('git', ['archive', '--format=tar', `--output=${tar}`, commit], ROOT, log);
  command('tar', ['-xf', tar, '-C', source], ROOT, log);
  command('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], path.join(source, 'functions'), log);
  command('npm', ['run', 'build'], path.join(source, 'functions'), log, { ...process.env, PAY0_FUNCTIONS_BUILD_MODE: buildMode });
  const require = createRequire(path.join(source, 'functions/package.json'));
  const JSZip = require('jszip'), zip = new JSZip();
  const names = [];
  function add(relative) {
    const location = path.join(source, 'functions', relative);
    assert.ok(!fs.lstatSync(location).isSymbolicLink(), 'ARTIFACT_LINK');
    if (fs.statSync(location).isDirectory()) for (const child of fs.readdirSync(location).sort()) add(`${relative}/${child}`);
    else { zip.file(relative, fs.readFileSync(location), { date: new Date('2026-01-01T00:00:00Z') }); names.push(relative); }
  }
  add('lib'); if (buildMode === 'BUNDLED_V1') add('.debug'); add('package.json'); add('package-lock.json');
  assert.ok(names.includes('lib/index.js') && !names.some(name => /(?:^|\/)\.env/.test(name)), 'ARTIFACT_CONTENTS');
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const archive = path.join(directory, 'functions.zip'); fs.writeFileSync(archive, bytes, { flag: 'wx' });
  const input = { schemaVersion: 1, sourceCommit: commit, sourceTree: command('git', ['rev-parse', `${commit}^{tree}`], ROOT),
    archive, archiveSha256: sha(bytes), baselineFile: privatePath(baselineFile), baselineSha256: sha(baseline),
    group, buildMode, functions: [...functions], compiledFiles: names.length, createdAt: new Date().toISOString() };
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
async function executeInternal(inputFile, inputSha256, resume = false) {
  assert.match(inputSha256, /^[a-f0-9]{64}$/, 'INPUT_HASH_REQUIRED');
  const bytes = fs.readFileSync(privatePath(inputFile)); assert.equal(sha(bytes), inputSha256, 'INPUT_CHANGED');
  const input = JSON.parse(bytes);
  const { group, names } = deploymentScope(input);
  const baselineBytes = fs.readFileSync(privatePath(input.baselineFile)); assert.equal(sha(baselineBytes), input.baselineSha256, 'BASELINE_CHANGED');
  const baseline = JSON.parse(baselineBytes);
  const archive = fs.readFileSync(privatePath(input.archive)); assert.equal(sha(archive), input.archiveSha256, 'ARTIFACT_CHANGED');
  const proof = JSON.parse(fs.readFileSync(privatePath(path.join(path.dirname(inputFile), 'artifact-verification.json'))));
  assertArtifactProof(input, proof);
  const receiptFile = privatePath(path.join(path.dirname(inputFile), 'deployment.jsonl'));
  const receipt = fs.openSync(receiptFile, resume ? 'a' : 'wx');
  const emit = value => { fs.writeSync(receipt, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'); console.log(JSON.stringify(value)); };
  const lockPath = privatePath(path.join(PRIVATE, 'deployment.lock'));
  let lock, unresolved = resume;
  try {
    if (resume) {
      const pending = JSON.parse(fs.readFileSync(lockPath));
      assert.equal(path.resolve(pending.inputFile), path.resolve(inputFile), 'OTHER_DEPLOYMENT_LOCK');
      assert.equal(pending.inputSha256, inputSha256, 'OTHER_DEPLOYMENT_LOCK');
      lock = fs.openSync(lockPath, 'r+');
    } else lock = fs.openSync(lockPath, 'wx');
    let token = tokenInMemory();
    const completedNames = new Set();
    const preserved = resume ? fs.readFileSync(receiptFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    for (const name of names) {
      const expected = baseline.functions[name];
      assert.ok(expected?.resource, 'EXISTING_FUNCTION_REQUIRED');
      if (resume) assertPreservedSource(expected.resource,
        preserved.find(record => record.state === 'PREVIOUS_SOURCE_PRESERVED' && record.function === name),
        fs.readFileSync(privatePath(path.join(path.dirname(inputFile), `${name}-previous.zip`))));
      const afterFile = path.join(path.dirname(inputFile), `${name}-after.json`);
      if (resume && fs.existsSync(afterFile)) {
        const saved = JSON.parse(fs.readFileSync(afterFile));
        const current = await assertCurrent(saved, name, token);
        const operation = JSON.parse(fs.readFileSync(path.join(path.dirname(inputFile), `${name}-operation.json`)));
        assertOperationMatchesGet(operation, current);
        assertRuntimePreserved(expected.resource, current);
        assertRunRuntimePreserved(expected.service, saved.service, input);
        assert.equal(current.state, 'ACTIVE', 'POSTFLIGHT_NOT_ACTIVE');
        assertPublishedIdentity(current, input);
        assert.equal(sha(await readSourceBytes(previousSource(current), token)), input.archiveSha256, 'POSTFLIGHT_ARTIFACT_BYTES');
        assert.equal(digest(saved.iam), digest(expected.iam), 'POSTFLIGHT_IAM_CHANGED');
        completedNames.add(name);
        emit({ state: 'CONFIGURATION_VERIFIED', resumed: true, function: name, revision: current.serviceConfig.revision, functionalVerification: 'PENDING' });
        continue;
      }
      const fresh = await assertCurrent(expected, name, token);
      sourceOnlyPatch(fresh, fresh.buildConfig.source.storageSource, input.sourceCommit, input.archiveSha256, group, input.sourceIdentity);
      if (!resume) {
        const rollback = await preservePrevious(fresh, token, path.dirname(inputFile), name);
        if (input.sourceIdentity) assert.equal(rollback.sha256, input.sourceIdentity.baseArchiveSha256, 'OVERLAY_BASE_ARCHIVE_CHANGED');
        emit({ state: 'PREVIOUS_SOURCE_PRESERVED', function: name, source: rollback.source, sha256: rollback.sha256, previousRevision: fresh.serviceConfig.revision });
      }
    }
    if (completedNames.size === names.length) { unresolved = false; return; }
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
    for (const name of names) {
      if (completedNames.has(name)) continue;
      token = tokenInMemory();
      const expected = baseline.functions[name];
      const fresh = await assertCurrent(expected, name, token);
      const body = sourceOnlyPatch(fresh, uploadedSource, input.sourceCommit, input.archiveSha256, group, input.sourceIdentity);
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
      assertOperationMatchesGet(completed, after);
      assert.equal(after.state, 'ACTIVE', 'POSTFLIGHT_NOT_ACTIVE');
      assertRuntimePreserved(fresh, after);
      assertRunRuntimePreserved(expected.service, afterService, input);
      assertPublishedIdentity(after, input);
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
async function rollbackInternal(inputFile, inputSha256, name) {
  const inputBytes = fs.readFileSync(privatePath(inputFile)); assert.equal(sha(inputBytes), inputSha256, 'INPUT_CHANGED');
  const input = JSON.parse(inputBytes), directory = path.dirname(inputFile);
  assert.ok(deploymentScope(input).names.includes(name), 'FUNCTION_NOT_ALLOWED');
  const baselineBytes = fs.readFileSync(privatePath(input.baselineFile)); assert.equal(sha(baselineBytes), input.baselineSha256, 'BASELINE_CHANGED');
  const before = JSON.parse(baselineBytes).functions[name];
  const expected = JSON.parse(fs.readFileSync(privatePath(path.join(directory, `${name}-after.json`))));
  assertPublishedIdentity(expected.resource, input);
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
    assertRunRuntimePreserved(before.service, expected.service, input);
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
    const afterService = await getMetadata(`https://run.googleapis.com/v2/${after.serviceConfig.service}`, token);
    assertRunRuntimePreserved(before.service, afterService);
    const afterIam = await getMetadata(`https://run.googleapis.com/v2/${after.serviceConfig.service}:getIamPolicy`, token);
    assert.equal(digest(afterIam), digest(before.iam), 'ROLLBACK_IAM_CHANGED');
    assert.deepEqual(after.labels, before.resource.labels, 'ROLLBACK_LABELS_CHANGED');
    assert.equal(sha(await readSourceBytes(previousSource(after), token)), sha(fs.readFileSync(path.join(directory, `${name}-previous.zip`))), 'ROLLBACK_SOURCE_MISMATCH');
    emit({ state: 'ROLLBACK_VERIFIED', function: name, revision: after.serviceConfig.revision });
    unresolved = false;
  } finally { fs.closeSync(lock); if (!unresolved) fs.unlinkSync(lockPath); }
}
async function exclusiveRunner(task) {
  // A persistent deployment lock may be resumed; this separate process lock
  // prevents two --resume/rollback processes from acting on it concurrently.
  const file = privatePath(path.join(PRIVATE, 'active-executor.lock'));
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); return await task(); }
  finally { fs.closeSync(descriptor); fs.unlinkSync(file); }
}
export async function execute(inputFile, inputSha256, resume = false) {
  return exclusiveRunner(() => executeInternal(inputFile, inputSha256, resume));
}
export async function rollback(inputFile, inputSha256, name) {
  return exclusiveRunner(() => rollbackInternal(inputFile, inputSha256, name));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode, first, second, third, fourth] = process.argv.slice(2);
    if (mode === '--prepare') console.log(JSON.stringify(await prepare(first, second, third, fourth)));
    else if (mode === '--execute') await execute(first, second);
    else if (mode === '--resume') await execute(first, second, true);
    else if (mode === '--rollback') await rollback(first, second, third);
    else throw Error('MODE_REQUIRED');
  } catch (error) { console.error(`SCOPED_DEPLOYMENT_FAILED ${/^[A-Z][A-Z_0-9]+$/.test(error.message) ? error.message : 'detailsRedacted=true'}`); process.exitCode = 1; }
}
