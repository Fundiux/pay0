import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const prepared = JSON.parse(execFileSync(process.execPath, ['scripts/prepare-iq-staging-canary.mjs', '--allow-dirty'], { cwd: root, encoding: 'utf8', windowsHide: true }));
const manifest = JSON.parse(fs.readFileSync(path.join(prepared.output, 'manifest.json'), 'utf8'));
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const children = new Set();
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
function launch(port, overrides = {}) {
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, GCLOUD_PROJECT: 'pay-0-system-staging', PAY0_ENVIRONMENT: 'staging',
    PAY0_EXTERNAL_ACTIONS_MODE: 'disabled', PORT: String(port), ...overrides };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const child = spawn(process.execPath, [path.join(prepared.output, 'server.mjs')], { cwd: prepared.output, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child); child.once('close', () => children.delete(child));
  return child;
}
function request(port, method, url, body = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: url, timeout: 5000,
      headers: body ? { 'Content-Length': Buffer.byteLength(body) } : {} }, response => {
      let bytes = ''; response.on('data', chunk => { bytes += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(bytes) }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(Error('LOCAL_REQUEST_TIMEOUT'))); req.end(body);
  });
}
async function close(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('close', resolve)); child.kill(); await exited;
}
async function main() {
  check(manifest.deployReady === false && manifest.financialEndToEnd === false && manifest.cloudAccessPerformed === false, 'Preparation does not claim deployment or financial E2E');
  check(manifest.workingTreeDirty === !manifest.sourceReadyForBuild, 'Manifest reflects Git status');
  if (manifest.workingTreeDirty) {
    assert.throws(() => execFileSync(process.execPath, ['scripts/prepare-iq-staging-canary.mjs'], { cwd: root, stdio: 'pipe', windowsHide: true }), /Command failed/); checks++;
  }
  for (const file of manifest.artifacts) check(hash(fs.readFileSync(path.join(prepared.output, file.path))) === file.sha256, `Artifact hash ${file.path}`);
  const packageJson = JSON.parse(fs.readFileSync(path.join(prepared.output, 'package.json'), 'utf8'));
  check(!packageJson.dependencies && !packageJson.devDependencies, 'Runtime has zero package dependencies');
  for (const overrides of [{ GCLOUD_PROJECT: 'pay-0-system' }, { PAY0_ENVIRONMENT: 'production' }, { PAY0_EXTERNAL_ACTIONS_MODE: 'live' },
    { PAY0_EXTERNAL_ACTIONS_MODE: undefined }, { GOOGLE_CLOUD_PROJECT: 'pay-0-system' }, { FIREBASE_CONFIG: '{}' }]) {
    const child = launch(await freePort(), overrides); let stderr = '', ready = false;
    child.stderr.on('data', bytes => { stderr += bytes; }); child.stdout.on('data', () => { ready = true; });
    const timer = setTimeout(() => child.kill(), 5000);
    const code = await new Promise(resolve => child.once('close', resolve)); clearTimeout(timer);
    check(code !== 0 && !ready && stderr.includes('STAGING_RUNTIME_CONFIGURATION_REQUIRED'), 'Unsafe startup rejected before listening');
  }
  for (const mode of ['disabled', 'simulated']) {
    const port = await freePort(), child = launch(port, { PAY0_EXTERNAL_ACTIONS_MODE: mode });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('LOCAL_STARTUP_TIMEOUT')), 5000);
      child.stdout.once('data', data => { clearTimeout(timer); const state = JSON.parse(data); if (state.event === 'staging-runtime-ready') resolve(); else reject(Error('INVALID_STARTUP')); });
      child.once('error', reject); child.once('exit', () => reject(Error('LOCAL_SERVER_EXITED')));
    });
    try {
      const health = await request(port, 'GET', '/healthz'); check(health.status === 200 && health.body.transportAttempts === 0, 'Healthy without external transport');
      const smoke = await request(port, 'POST', '/smoke');
      check(smoke.status === 200 && smoke.body.blocked === 12 && smoke.body.transportAttempts === 0 && smoke.body.mode === mode, 'Six families GET/POST blocked before transport');
      check(smoke.body.financialEndToEnd === false, 'Simulated mode never misrepresents financial testing');
      check((await request(port, 'POST', '/smoke', '{"url":"https://example.invalid"}')).status === 400, 'Caller cannot supply payloads or targets');
      check((await request(port, 'POST', '/deposit')).status === 404, 'No financial endpoint exists');
      check((await request(port, 'GET', '/healthz')).body.transportAttempts === 0, 'Rejected inputs trigger no transport');
    } finally { await close(child); }
    const probe = net.createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => probe.close(resolve)); checks++;
  }
  console.log(JSON.stringify({ result: 'PASS', checks, projectId: 'pay-0-system-staging', scope: 'local runtime and real external-action guard',
    externalTransportAttempts: 0, financialEndToEnd: false, artifact: prepared.output, manifestSha256: prepared.manifestSha256 }));
}
try { await main(); } finally { await Promise.all([...children].map(close)); }
