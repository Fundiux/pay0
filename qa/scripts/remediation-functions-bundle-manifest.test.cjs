// Functional equivalence capture is separate from the unchanged 7s release gate.
// Uses the repository's real SDK discovery transport and exact full manifest.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { performance } = require('node:perf_hooks');
const { readDiscoveryManifest, availablePort, startProcess, stopProcess } = require('./verify-functions-discovery-startup.cjs');
const root = path.resolve(__dirname, '../..');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const [mode, relative, pin] = process.argv.slice(2);
  assert.ok(['--capture-normal', '--compare-installed'].includes(mode));
  assert.match(relative || '', /^\.firebase\/internal-bundle-manifests\/[A-Za-z0-9_-]+\.json$/);
  const integrity = await import(pathToFileURL(path.join(root, 'scripts/lib/functions-bundle-integrity.mjs')));
  const installer = await import(pathToFileURL(path.join(root, 'scripts/install-functions-internal-bundle.mjs')));
  const file = integrity.checkedPath(root, relative);
  const inputs = integrity.sourceSnapshot(root);
  const entry = fs.readFileSync(path.join(root, 'functions/lib/index.js'));
  let baseline;
  if (mode === '--capture-normal') {
    assert.ok(!fs.existsSync(path.join(root, installer.PROVENANCE)), 'NORMAL_PROVENANCE_REQUIRED_ABSENT');
    assert.ok(!entry.toString().includes('var __commonJS'), 'NORMAL_ENTRY_REQUIRED');
  } else {
    assert.match(pin || '', /^[a-f0-9]{64}$/);
    const bytes = fs.readFileSync(file);
    assert.equal(sha(bytes), pin, 'BASELINE_PIN_MISMATCH');
    baseline = JSON.parse(bytes);
    installer.verifyInstalled(root);
    assert.deepEqual(inputs, baseline.sourceInputs, 'SOURCE_INPUT_DRIFT');
  }
  process.env.GCLOUD_PROJECT = 'demo-pay0-bundle-manifest';
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-pay0-bundle-manifest' });
  delete process.env.DEBUG;
  delete process.env.FUNCTIONS_DISCOVERY_TIMEOUT;
  const port = await availablePort(), startedAt = performance.now();
  const run = startProcess([path.join(root, 'functions/node_modules/firebase-functions/lib/bin/firebase-functions.js')], port);
  let result;
  try {
    result = await readDiscoveryManifest({ port, startedAt, deadlineMs: 10_000,
      assertRunning: () => { if (run.error || run.result) throw Error('DISCOVERY_EXITED'); } });
  } finally { await stopProcess(run, port); }
  integrity.assertSnapshot(root, inputs);
  assert.equal(sha(fs.readFileSync(path.join(root, 'functions/lib/index.js'))), sha(entry), 'ENTRY_CHANGED');
  const manifest = canonical(result.manifest);
  assert.equal(manifest.specVersion, 'v1alpha1');
  assert.equal(Object.keys(manifest.endpoints).length, 354);
  const manifestSha256 = sha(JSON.stringify(manifest));
  if (baseline) {
    assert.deepEqual(manifest, baseline.manifest, 'COMPLETE_MANIFEST_MISMATCH');
    assert.ok(result.elapsedMs <= 7_000, 'BUNDLED_DISCOVERY_EXCEEDS_7S');
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ sourceInputs: inputs, manifest, manifestSha256 }), { flag: 'wx' });
  }
  console.log(JSON.stringify({ mode, endpointCount: 354, elapsedMs: result.elapsedMs, manifestSha256,
    baselineSha256: sha(fs.readFileSync(file)), functionalParity: !!baseline, releaseTimingGate: !!baseline }));
}
main().catch(error => { console.error(JSON.stringify({ status: 'FAILED', code: /^[A-Z_]+$/.test(error.message) ? error.message : 'ASSERTION_OR_DISCOVERY' })); process.exitCode = 1; });
