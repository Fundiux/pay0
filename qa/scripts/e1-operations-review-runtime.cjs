const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const JSZip = require('../../functions/node_modules/jszip');
(async () => {
  const dir = path.resolve(__dirname, '../../.firebase/modular-release/new-recovery-review');
  const input = JSON.parse(fs.readFileSync(path.join(dir, 'input.json')));
  const bytes = fs.readFileSync(input.archive);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), input.archiveSha256);
  const runtime = path.join(dir, 'runtime');
  assert(!fs.existsSync(runtime), 'Runtime exists; preserve evidence instead of overwriting it');
  fs.mkdirSync(runtime);
  const zip = await JSZip.loadAsync(bytes);
  for (const entry of Object.values(zip.files)) {
    assert(!entry.name.includes('..') && !entry.name.includes('\\') && !entry.name.includes(':') && !entry.name.startsWith('/') && !/(^|\/)\.env/.test(entry.name));
    const dest = path.join(runtime, entry.name);
    if (entry.dir) fs.mkdirSync(dest, { recursive: true });
    else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, await entry.async('nodebuffer')); }
  }
  const result = spawnSync('npm', ['ci', '--omit=dev', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: runtime, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });
  fs.writeFileSync(path.join(dir, 'install.log'), (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 0, 'Exact archive dependencies failed');
  const probe = `const assert=require('assert');const deny=()=>{throw Error('NETWORK_DURING_PROBE')};require('http').request=deny;require('https').request=deny;require('net').connect=deny;require('net').Socket.prototype.connect=deny;require('tls').connect=deny;global.fetch=deny;const log=console.log;console.log=console.warn=console.error=()=>{};const e=require('./lib/index.js');(async()=>{for(const n of ${JSON.stringify(input.functions)}){assert(e[n].__endpoint.callableTrigger);await assert.rejects(e[n].run({data:{}}),x=>x.code==='unauthenticated');}log(JSON.stringify({status:'PASS',functions:${JSON.stringify(input.functions)},unauthenticatedDenied:2}));})().catch(()=>{process.exitCode=1});`;
  const p = spawnSync(process.execPath, ['-e', probe], { cwd: runtime, encoding: 'utf8', timeout: 120000, env: { ...process.env, GCLOUD_PROJECT: 'demo-pay0-review-artifact', FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-pay0-review-artifact' }), FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' } });
  assert.equal(p.status, 0, 'Isolated startup or unauthenticated denial failed');
  const proof = { ...JSON.parse(p.stdout.trim()), archiveSha256: input.archiveSha256, sourceIdentity: input.sourceIdentity, sourceCommit: input.sourceCommit, productionWrites: 0 };
  fs.writeFileSync(path.join(dir, 'startup-verification.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
