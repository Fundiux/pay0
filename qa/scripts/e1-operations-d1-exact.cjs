// Run existing regression fixtures against an exact, isolated D1-on-R2 archive.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const JSZip = require('../../functions/node_modules/jszip');
const root = path.resolve(__dirname, '../..');
const directory = path.resolve(root, process.env.PAY0_D1_ARTIFACT_DIR || '');
assert.ok(directory.startsWith(path.join(root, '.firebase', 'modular-release') + path.sep), 'PRIVATE_ARTIFACT_REQUIRED');
const runtime = path.join(directory, 'runtime'), source = path.join(directory, 'source'), qa = path.join(directory, 'qa-reproduced');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const archives = fs.readdirSync(directory).filter(name => name.endsWith('.zip'));
assert.equal(archives.length, 1, 'ONE_ARCHIVE_REQUIRED');
const archive = fs.readFileSync(path.join(directory, archives[0]));
assert.equal(sha(archive), manifest.archiveSha256, 'ARCHIVE_CHANGED');
const env = { ...process.env, HUGO_TEST_FUNCTIONS_ROOT: runtime };
delete env.HUGO_SUPERVISED_RULES_ENABLED;
fs.mkdirSync(qa, { recursive: true });
const fixtures = [
  'phase4-context', 'phase5-learning', 'phase6-hardening', 'r1-token-usage-persistence', 'report-continuation',
];
const relocated = [];
function fixture(file, commit) {
  const original = execFileSync('git', ['show', `${commit}:${file}`], { cwd: root });
  const text = original.toString().replaceAll('../../functions/lib/', runtime.replaceAll('\\', '/') + '/lib/')
    .replaceAll('../../functions/node_modules/', runtime.replaceAll('\\', '/') + '/node_modules/')
    .replaceAll('../../functions/src/', source.replaceAll('\\', '/') + '/src/');
  const target = path.join(qa, path.basename(file));
  fs.writeFileSync(target, text);
  relocated.push({ file, commit, originalSha256: sha(original), relocatedSha256: sha(Buffer.from(text)) });
  return target;
}
for (const name of fixtures) fixture(`evals/hugo/${name}.test.cjs`, name === 'report-continuation' && process.env.PAY0_D1_R15_TESTS === 'true'
  ? '397035caa23ddd56fff0dedcf62158b7df129d4a' : '0b17cfc6423ab4005c6d30087e50aa90ddd5e748');
fixture('evals/hugo/evolution-reports.test.cjs', '9204e901efc3a1c49eb0e2d71e6d6a5f2c93307b');
fs.mkdirSync(path.join(qa, 'learning'), { recursive: true });
fs.writeFileSync(path.join(qa, 'learning/export.cjs'), execFileSync('git', ['show', '0b17cfc:evals/hugo/learning/export.cjs'], { cwd: root }));
for (const name of ['e1-learning-rules-emulator', 'e1-learning-emulator', 'r12-report-emulator'])
  fixture(`qa/scripts/${name}.test.cjs`, name === 'e1-learning-rules-emulator' && process.env.PAY0_D1_REVOKE_OFF_TESTS === 'true'
    ? 'b0545c2fdace63e8b366458d7abb0b7eecb98175' : '0b17cfc6423ab4005c6d30087e50aa90ddd5e748');
fixture('qa/scripts/r2-report-after-r13-emulator.test.cjs', '9204e901efc3a1c49eb0e2d71e6d6a5f2c93307b');
const onFile = path.join(qa, 'r13-report-gate-on.test.cjs');
fs.writeFileSync(onFile, fs.readFileSync(path.join(qa, 'r12-report-emulator.test.cjs'), 'utf8')
  .replaceAll('r12-root', 'd1-report-on-root').replaceAll('r12-reviewer', 'd1-report-on-reviewer'));
fs.writeFileSync(path.join(qa, 'test-provenance.json'), JSON.stringify(relocated, null, 2));
async function verifyBytes() {
  const zip = await JSZip.loadAsync(archive);
  for (const entry of Object.values(zip.files)) if (!entry.dir)
    assert.deepEqual(fs.readFileSync(path.join(runtime, entry.name)), await entry.async('nodebuffer'), `RUNTIME_CHANGED:${entry.name}`);
}
function run(file, gate = false) {
  const childEnv = { ...env };
  if (gate) childEnv.HUGO_SUPERVISED_RULES_ENABLED = 'true';
  const result = spawnSync(process.execPath, ['--test', '--test-timeout=120000', file], {
    cwd: root, env: childEnv, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 5e6,
  });
  fs.writeFileSync(path.join(qa, path.basename(file) + '.log'), (result.stdout || '') + (result.stderr || ''));
  console.log(JSON.stringify({ file: path.basename(file), gate: gate ? 'ON' : 'OFF', exit: result.status }));
  assert.equal(result.status, 0, `TEST_FAILED:${path.basename(file)}`);
}
(async () => {
  await verifyBytes();
  if (process.argv[2] === '--startup') {
    const baseRuntime = path.resolve(root, process.env.PAY0_D1_BASE_RUNTIME || '');
    assert.ok(baseRuntime.startsWith(path.join(root, '.firebase', 'modular-release') + path.sep), 'PRIVATE_BASE_REQUIRED');
    const prefix = `const assert=require('node:assert/strict');const deny=()=>{throw Error('NETWORK_DURING_PROBE')};require('node:http').request=deny;require('node:https').request=deny;require('node:net').connect=deny;require('node:net').Socket.prototype.connect=deny;require('node:tls').connect=deny;global.fetch=deny;const log=console.log;console.log=console.warn=console.error=()=>{};delete process.env.HUGO_SUPERVISED_RULES_ENABLED;const entry=require('./lib/index.js');`;
    const probeEnv = { ...env, GCLOUD_PROJECT: 'demo-pay0-artifact', FIREBASE_CONFIG: '{"projectId":"demo-pay0-artifact"}', FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' };
    const before = spawnSync(process.execPath, ['-e', prefix + `log(JSON.stringify(Object.keys(entry).filter(k=>entry[k]?.__endpoint).sort()));`], { cwd: baseRuntime, env: probeEnv, encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert.equal(before.status, 0, 'BASE_STARTUP_FAILED');
    const prior = JSON.parse(before.stdout.trim());
    const probe = prefix + `(async()=>{const names=['sendAgent007Message','reviewAgent007LearningRule'];const all=Object.keys(entry).filter(k=>entry[k]?.__endpoint).sort();assert.deepEqual(all,[...${JSON.stringify(prior)},'reviewAgent007LearningRule'].sort());for(const name of names){assert(entry[name].__endpoint.callableTrigger);await assert.rejects(entry[name].run({data:{}}),e=>e.code==='unauthenticated');}log(JSON.stringify({status:'PASS',endpointsLoaded:all.length,previousExportsPreserved:${prior.length},unauthenticatedDenied:2,gate:'OFF',networkBlocked:true}));})().catch(()=>{process.exitCode=1});`;
    const result = spawnSync(process.execPath, ['-e', probe], { cwd: runtime, env: probeEnv, encoding: 'utf8', windowsHide: true, timeout: 120000 });
    fs.writeFileSync(path.join(qa, 'startup.log'), result.stdout + result.stderr);
    assert.equal(result.status, 0, 'STARTUP_OR_AUTH_FAILED');
    console.log(result.stdout.trim());
  } else if (process.argv[2] === '--regressions') {
    for (const name of [...fixtures, 'evolution-reports']) run(path.join(qa, name + '.test.cjs'));
  } else {
    assert.match(env.GCLOUD_PROJECT || '', /^demo-pay0-e1-/);
    assert.match(env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
    for (const name of ['e1-learning-rules-emulator', 'e1-learning-emulator']) run(path.join(qa, name + '.test.cjs'));
    run(path.join(__dirname, 'e1-operations-d1-gate-off.test.cjs'));
    run(path.join(qa, 'r12-report-emulator.test.cjs'));
    run(onFile, true);
    run(path.join(qa, 'r2-report-after-r13-emulator.test.cjs'));
  }
  await verifyBytes();
  console.log(JSON.stringify({ status: 'PASS', archiveSha256: manifest.archiveSha256, productionWrites: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
