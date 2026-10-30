// Exact artifact QA. No cloud credentials, business records or live providers.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const JSZip = require('../../functions/node_modules/jszip');
const root = path.resolve(__dirname, '../..'), directory = path.resolve(root, process.env.PAY0_CORRECTIONS_ARTIFACT || '');
assert(directory.startsWith(path.join(root, '.firebase/modular-release') + path.sep), 'PRIVATE_ARTIFACT_REQUIRED');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'))), runtime = path.join(directory, 'runtime');
const archiveName = process.env.PAY0_CORRECTIONS_ARCHIVE_NAME || (manifest.mode ? `conversation-corrections-memory-${manifest.mode}.zip` : 'conversation-corrections-chat.zip');
assert.equal(path.basename(archiveName), archiveName);
const archive = fs.readFileSync(path.join(directory, archiveName));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(archive), manifest.archiveSha256, 'ARCHIVE_CHANGED');
const env = { ...process.env, PAY0_CORRECTIONS_LIB: path.join(runtime, 'lib'), PAY0_CORRECTIONS_SCOPE: 'TEXT', NODE_OPTIONS: '--preserve-symlinks' };
delete env.GOOGLE_APPLICATION_CREDENTIALS; delete env.FIREBASE_TOKEN; delete env.HUGO_SUPERVISED_RULES_ENABLED;
const mode = process.argv[2]; assert(['--startup', '--regressions', '--emulator', '--scope-emulator'].includes(mode), 'EXPLICIT_QA_MODE_REQUIRED');
async function verify() { const zip = await JSZip.loadAsync(archive); for (const entry of Object.values(zip.files)) if (!entry.dir) assert.ok(fs.readFileSync(path.join(runtime, entry.name)).equals(await entry.async('nodebuffer')), 'RUNTIME_CHANGED:' + entry.name); }
const run = (args, cwd = root, childEnv = env) => {
  const result = spawnSync(process.execPath, args, { cwd, env: childEnv, encoding: 'utf8', windowsHide: true, timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
  fs.writeFileSync(path.join(directory, `qa-${mode.slice(2)}.log`), (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 0, 'ARTIFACT_QA_FAILED:' + mode);
  return result.stdout;
};
(async () => {
  await verify(); let detail;
  if (mode === '--startup') {
    const base = path.resolve(root, process.env.PAY0_CORRECTIONS_BASE_RUNTIME || '');
    assert(base.startsWith(path.join(root, '.firebase/modular-release') + path.sep), 'PRIVATE_BASE_REQUIRED');
    const prefix = `const assert=require('node:assert/strict');let networkCalls=0;const deny=()=>{networkCalls++;throw Error('NETWORK_BLOCKED')};require('node:http').request=deny;require('node:https').request=deny;require('node:net').connect=deny;require('node:net').Socket.prototype.connect=deny;require('node:tls').connect=deny;global.fetch=deny;const log=console.log;console.log=console.warn=console.error=()=>{};const entry=require('./');`;
    const safeEnv = { ...env, GCLOUD_PROJECT: 'demo-pay0-correction-startup', FIREBASE_CONFIG: '{"projectId":"demo-pay0-correction-startup"}', FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' };
    const baseline = spawnSync(process.execPath, ['-e', prefix + `log(JSON.stringify(Object.keys(entry).filter(name=>entry[name]?.__endpoint).sort()));`], { cwd: base, env: safeEnv, encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert.equal(baseline.status, 0, 'BASE_STARTUP_FAILED');
    const names = JSON.parse(baseline.stdout.trim());
    const handlers = manifest.mode ? manifest.targets : ['sendAgent007Message', 'createAgent007MemoryCandidate', 'listAgent007MemoryDiagnostics', 'reviewAgent007MemoryCandidate'];
    const preservation = manifest.mode ? `const original=require('./lib/conversation-correction-baseline-index');assert.deepEqual(Reflect.ownKeys(entry),Reflect.ownKeys(original));for(const key of Reflect.ownKeys(original))if(!names.includes(key))assert.deepEqual(Object.getOwnPropertyDescriptor(entry,key),Object.getOwnPropertyDescriptor(original,key));` : '';
    const probe = prefix + `(async()=>{const names=${JSON.stringify(handlers)};const all=Object.keys(entry).filter(name=>entry[name]?.__endpoint).sort();assert.deepEqual(all,${JSON.stringify(names)});const modules=require('./lib/modules/agent007/callables');for(const name of names){assert.equal(entry[name],modules[name]);assert(entry[name].__endpoint.callableTrigger);await assert.rejects(entry[name].run({data:{}}),error=>error.code==='unauthenticated');}${preservation}assert.equal(networkCalls,0);log(JSON.stringify({status:'PASS',exports:all.length,preserved:${names.length},handlerIdentity:names.length,anonymousDenied:names.length,networkCalls,gate:'OFF'}));})().catch(()=>{process.exitCode=1});`;
    detail = JSON.parse(run(['-e', probe], runtime, safeEnv).trim());
  } else if (mode === '--regressions') {
    detail = run([path.join(root, 'qa/scripts/e1-operations-d1-exact.cjs'), '--regressions'], root, { ...env, PAY0_D1_ARTIFACT_DIR: directory, PAY0_D1_R15_TESTS: 'true', PAY0_D1_REVOKE_OFF_TESTS: 'true' });
  } else {
    const file = mode === '--emulator' ? 'conversation-corrections-emulator.test.cjs' : 'conversation-correction-scope-emulator.test.cjs';
    detail = run([path.join(root, 'qa/scripts/e1-operations-emulator.mjs'), path.join(root, 'qa/scripts', file)]);
  }
  await verify();
  const proof = { status: 'PASS', mode, archiveSha256: manifest.archiveSha256, scope: 'TEXT', detail, productionWrites: 0 };
  fs.writeFileSync(path.join(directory, `proof-${mode.slice(2)}.json`), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ status: 'PASS', mode, archiveSha256: manifest.archiveSha256, scope: 'TEXT', productionWrites: 0 }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
