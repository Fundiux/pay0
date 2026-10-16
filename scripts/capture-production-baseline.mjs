import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'pay-0-system';
export const REGION = 'us-central1';
export const FUNCTIONS = ['ssrpay0system', 'parsePagoReceiptPdf', 'correctPagoReceiptSemanticField',
  'getControlCenterEngineering', 'importControlCenterEngineeringEvidence', 'listOperationalDocuments',
  'getAuthorizedDocumentDownloadUrl', 'getAuthorizedOperationalRecord',
  'listClientsCanonical', 'getClientCanonical', 'listPagos', 'listSolicitudes', 'listScopedClientDispersions',
  'listPagoNotes', 'listSolicitudNotes', 'listClientDispersionNotes', 'reconcileAgent007RecommendationsNow'];
const hosts = new Set(['cloudfunctions.googleapis.com', 'run.googleapis.com', 'firebasehosting.googleapis.com', 'firebaserules.googleapis.com']);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function tokenInMemory() {
  const args = ['auth', 'print-access-token', '--project', PROJECT, '--quiet'];
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'gcloud.cmd', ...args], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
    : spawnSync('gcloud', args, { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, 'AUTH_UNAVAILABLE');
  const token = result.stdout.trim();
  assert.match(token, /^[A-Za-z0-9._~-]{20,4096}$/, 'AUTH_FORMAT');
  return token;
}
export async function getMetadata(url, token, optional = false) {
  const parsed = new URL(url);
  assert.ok(parsed.protocol === 'https:' && hosts.has(parsed.hostname), 'API_SCOPE');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT },
    signal: AbortSignal.timeout(30_000), redirect: 'error' });
  if (optional && response.status === 404) return null;
  assert.equal(response.status, 200, `METADATA_HTTP_${response.status}`);
  return response.json();
}
export async function captureBaseline(token) {
  const base = `https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}`;
  const functions = {};
  for (const name of FUNCTIONS) {
    const resource = await getMetadata(`${base}/functions/${name}`, token, true);
    let service = null, iam = null;
    if (resource?.serviceConfig?.service) {
      service = await getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}`, token);
      iam = await getMetadata(`https://run.googleapis.com/v2/${resource.serviceConfig.service}:getIamPolicy`, token);
    }
    functions[name] = { resource, service, iam };
  }
  const hosting = await getMetadata(`https://firebasehosting.googleapis.com/v1beta1/sites/${PROJECT}/releases?pageSize=5`, token);
  const rules = await getMetadata(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases?pageSize=100`, token);
  const operations = await getMetadata(`${base}/operations?pageSize=100&filter=done%3Dfalse`, token);
  return { schemaVersion: 1, capturedAt: new Date().toISOString(), project: PROJECT, functions, hosting, rules, operations };
}
export function summarizeBaseline(baseline) {
  return { schemaVersion: 1, capturedAt: baseline.capturedAt, project: PROJECT, productionWrites: 0,
    fingerprint: digest(baseline),
    functions: Object.entries(baseline.functions).map(([name, { resource, service, iam }]) => ({
      name, exists: !!resource, state: resource?.state || null, updateTime: resource?.updateTime || null,
      revision: resource?.serviceConfig?.revision || null, runtime: resource?.buildConfig?.runtime || null,
      source: resource?.buildConfig?.sourceProvenance?.resolvedStorageSource || resource?.buildConfig?.source?.storageSource || null,
      resourceSha256: digest(resource), serviceSha256: digest(service), iamSha256: digest(iam),
    })),
    hostingRelease: baseline.hosting.releases?.[0]?.name || null,
    hostingVersion: baseline.hosting.releases?.[0]?.version?.name || null,
    rules: (baseline.rules.releases || []).map(row => ({ name: row.name, rulesetName: row.rulesetName, updateTime: row.updateTime })),
    activeOperations: (baseline.operations.operations || []).filter(row => !row.done).map(row => ({ name: row.name })),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = process.cwd(), directory = path.join(root, '.firebase/modular-release');
    for (let parent = directory; parent !== root; parent = path.dirname(parent)) {
      if (fs.existsSync(parent)) assert.ok(!fs.lstatSync(parent).isSymbolicLink(), 'PRIVATE_BASELINE_LINK');
    }
    const ignored = spawnSync('git', ['check-ignore', '--quiet', '.firebase/modular-release/baseline.json'], { cwd: root });
    assert.equal(ignored.status, 0, 'PRIVATE_BASELINE_NOT_IGNORED');
    const baseline = await captureBaseline(tokenInMemory());
    const name = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(baseline), { flag: 'wx', mode: 0o600 });
    const summary = summarizeBaseline(baseline);
    const output = path.join(root, 'output/production-baseline');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ capturedAt: summary.capturedAt, privateBaseline: `.firebase/modular-release/${name}.json`,
      summary: `output/production-baseline/${name}.json`, functionsPresent: summary.functions.filter(row => row.exists).map(row => row.name),
      activeOperations: summary.activeOperations.length, hostingVersion: summary.hostingVersion, productionWrites: 0 }));
  } catch (error) {
    console.error(`PRODUCTION_BASELINE_FAILED ${/^(?:METADATA_HTTP_\d+|AUTH_UNAVAILABLE|AUTH_FORMAT|PRIVATE_BASELINE_NOT_IGNORED)$/.test(error.message) ? error.message : 'detailsRedacted=true'}`);
    process.exitCode = 1;
  }
}
