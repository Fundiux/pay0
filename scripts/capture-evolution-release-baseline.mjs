// Read-only production reconciliation. Raw metadata and rollback archives stay ignored.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PROJECT, REGION, tokenInMemory, getMetadata, digest } from './capture-production-baseline.mjs';
import { previousSource } from './deploy-scoped-functions.mjs';

export const EVOLUTION_FUNCTIONS = Object.freeze(['sendAgent007Message', 'delegateHugoVoiceTurn', 'getEarningsByClientReport']);
export const GATEWAY = 'hugo-voice-gateway-canary';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function publicReleaseIdentity(baseline) {
  const gateway = baseline.gateway.resource;
  const container = gateway.template?.containers?.[0];
  const buildIdentity = Object.fromEntries((container?.env || [])
    .filter(row => ['HUGO_BUILD_COMMIT', 'HUGO_BUILD_BRANCH', 'HUGO_BUILD_VERSION'].includes(row.name) && typeof row.value === 'string')
    .map(row => [row.name, row.value]));
  return { schemaVersion: 1, capturedAt: baseline.capturedAt, project: PROJECT, productionWrites: 0,
    functions: EVOLUTION_FUNCTIONS.map(name => {
      const { resource, sourceArchive } = baseline.functions[name];
      return { name, state: resource.state, revision: resource.serviceConfig?.revision,
        runtime: resource.buildConfig?.runtime, updateTime: resource.updateTime,
        declaredCommit: resource.labels?.['pay0-source-commit'] || 'UNKNOWN',
        sourceArchiveSha256: sourceArchive.sha256, source: sourceArchive.source };
    }),
    gateway: { name: GATEWAY, latestReadyRevision: gateway.latestReadyRevision, traffic: gateway.trafficStatuses || gateway.traffic,
      image: container?.image, buildIdentity, resourceSha256: digest(gateway), iamSha256: digest(baseline.gateway.iam) },
    functionalVerification: 'NOT_PERFORMED', publication: 'NOT_PERFORMED', metadataFingerprint: digest(baseline),
  };
}

export async function captureEvolutionBaseline({ root = process.cwd(), token = tokenInMemory() } = {}) {
  const directory = path.join(root, '.firebase', 'modular-release', `e1-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  for (let parent = path.dirname(directory); parent !== root; parent = path.dirname(parent)) {
    if (fs.existsSync(parent)) assert.ok(!fs.lstatSync(parent).isSymbolicLink(), 'PRIVATE_BASELINE_LINK');
  }
  assert.equal(spawnSync('git', ['check-ignore', '--quiet', '--', directory], { cwd: root }).status, 0, 'PRIVATE_BASELINE_NOT_IGNORED');
  fs.mkdirSync(directory, { recursive: true });
  const functions = Object.fromEntries(await Promise.all(EVOLUTION_FUNCTIONS.map(async name => {
    const resource = await getMetadata(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/${name}`, token);
    const [service, iam] = await Promise.all([
      getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}`, token),
      getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}:getIamPolicy`, token),
    ]);
    const source = previousSource(resource);
    const url = `https://storage.googleapis.com/storage/v1/b/${source.bucket}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(120_000) });
    assert.equal(response.status, 200, 'SOURCE_READ_FAILED');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 100 && bytes.length < 128 * 1024 * 1024 && bytes.subarray(0, 2).toString() === 'PK', 'SOURCE_ARCHIVE_INVALID');
    const file = path.join(directory, `${name}-previous.zip`);
    fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    return [name, { resource, service, iam, sourceArchive: { file, source, sha256: hash(bytes), bytes: bytes.length } }];
  })));
  const gatewayName = `projects/${PROJECT}/locations/${REGION}/services/${GATEWAY}`;
  const [resource, iam] = await Promise.all([
    getMetadata(`https://run.googleapis.com/v2/${gatewayName}`, token),
    getMetadata(`https://run.googleapis.com/v2/${gatewayName}:getIamPolicy`, token),
  ]);
  const baseline = { schemaVersion: 1, capturedAt: new Date().toISOString(), project: PROJECT, functions, gateway: { resource, iam } };
  const privateFile = path.join(directory, 'baseline.json');
  fs.writeFileSync(privateFile, JSON.stringify(baseline), { flag: 'wx', mode: 0o600 });
  const summary = publicReleaseIdentity(baseline);
  fs.writeFileSync(path.join(directory, 'identity.json'), JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 });
  return { privateFile: path.relative(root, privateFile), summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await captureEvolutionBaseline(), null, 2)); }
  catch (error) { console.error(JSON.stringify({ status: 'CAPTURE_FAILED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'REDACTED' })); process.exitCode = 1; }
}
