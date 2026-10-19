const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const JSZip = require('../../functions/node_modules/jszip');

(async () => {
  const base = path.resolve(__dirname, '../../.firebase/modular-release');
  const file = path.resolve(process.argv[2] || '');
  assert.ok(file.startsWith(base + path.sep), 'PRIVATE_INPUT_REQUIRED');
  const input = JSON.parse(fs.readFileSync(file));
  const { deploymentScope } = await import('../../scripts/deploy-scoped-functions.mjs');
  const { group, names, buildMode } = deploymentScope(input);
  assert.ok(path.resolve(input.archive).startsWith(path.dirname(file) + path.sep), 'ARTIFACT_SCOPE');
  const bytes = fs.readFileSync(input.archive);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), input.archiveSha256);
  const directory = path.join(path.dirname(file), `runtime-check-${crypto.randomUUID()}`);
  fs.mkdirSync(directory);
  const zip = await JSZip.loadAsync(bytes);
  if (buildMode === 'BUNDLED_V1') assert.ok(Object.keys(zip.files).some(name => name.startsWith('.debug/') && !zip.files[name].dir), 'BUNDLED_DEBUG_REQUIRED');
  for (const entry of Object.values(zip.files)) {
    assert.ok(!entry.name.includes('..') && !entry.name.includes('\\') && !entry.name.includes(':') && !entry.name.startsWith('/') && !/(^|\/)\.env/.test(entry.name), 'UNSAFE_ZIP_ENTRY');
    const target = path.join(directory, entry.name);
    if (entry.dir) fs.mkdirSync(target, { recursive: true });
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, await entry.async('nodebuffer')); }
  }
  const install = spawnSync('npm', ['ci', '--omit=dev', '--prefer-offline', '--no-audit', '--no-fund'], {
    cwd: directory, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, maxBuffer: 5 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(directory, 'install.log'), (install.stdout || '') + (install.stderr || ''));
  assert.equal(install.status, 0, 'RUNTIME_DEPENDENCIES_FAILED');
  const probe = `
    const assert = require('node:assert/strict');
    const deny = () => { throw Error('NETWORK_DURING_PROBE'); };
    require('node:http').request = deny; require('node:https').request = deny;
    require('node:net').connect = deny; require('node:net').Socket.prototype.connect = deny; require('node:tls').connect = deny; global.fetch = deny;
    const log = console.log; console.log = console.warn = console.error = () => {};
    const entry = require('./lib/index.js');
    (async () => {
      const names = ${JSON.stringify(names)};
      for (const name of names) {
        assert.equal(typeof entry[name]?.run, 'function');
        await assert.rejects(entry[name].run({ data: {} }), e => e.code === 'unauthenticated');
      }
      log(JSON.stringify({ status: 'PASS', endpointsLoaded: Object.keys(entry).filter(k => entry[k]?.__endpoint).length, unauthenticatedDenied: names.length, functions: names }));
    })().catch(() => { process.exitCode = 1; });
  `;
  const runtime = spawnSync(process.execPath, ['-e', probe], { cwd: directory, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GCLOUD_PROJECT: 'demo-pay0-artifact', FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-pay0-artifact' }), FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' }, timeout: 120_000 });
  if (runtime.status !== 0) console.error(JSON.stringify({ stage: 'isolated-runtime-probe', exitCode: runtime.status,
    signal: runtime.signal || null, errorCode: runtime.error?.code || null }));
  assert.equal(runtime.status, 0, 'ARTIFACT_STARTUP_OR_AUTH_FAILED');
  const result = JSON.parse(runtime.stdout.trim());
  assert.deepEqual(result.functions, [...names]); assert.equal(result.unauthenticatedDenied, names.length);
  fs.writeFileSync(path.join(path.dirname(file), 'artifact-verification.json'), JSON.stringify({ ...result, group, buildMode, sourceCommit: input.sourceCommit, archiveSha256: input.archiveSha256, ...(input.sourceIdentity ? { sourceIdentity: input.sourceIdentity } : {}), checkedAt: new Date().toISOString(), productionWrites: 0 }, null, 2));
  console.log(JSON.stringify(result));
})().catch(error => { const code = String(error.message).match(/^[A-Z_]+(?=\s|$)/)?.[0]; console.error(`ARTIFACT_VERIFICATION_FAILED ${code || 'detailsRedacted=true'}`); process.exitCode = 1; });
