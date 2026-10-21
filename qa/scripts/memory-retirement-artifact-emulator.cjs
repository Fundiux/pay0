// Public reviewer from an exact ZIP. Producer is an explicit fixture module,
// because this readers-only package does not replace the producer export.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto'), { createRequire } = require('node:module');
const Zip = require('../../functions/node_modules/jszip');
const root = path.resolve(__dirname, '../..');
assert(/^demo-pay0-e1-/.test(process.env.GCLOUD_PROJECT || ''), 'DEMO_PROJECT');
assert(/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''), 'ISOLATED_FIRESTORE');
const directory = path.resolve(root, process.env.PAY0_RETIREMENT_ARTIFACT || '');
assert(directory.startsWith(path.join(root, '.firebase/modular-release') + path.sep), 'PRIVATE_ARTIFACT');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
const archive = fs.readFileSync(path.join(directory, 'memory-retirement.zip'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(archive), manifest.archiveSha256, 'ARCHIVE_SHA');
const runtime = path.join(directory, 'runtime'), load = createRequire(path.join(runtime, 'package.json'));
const port = Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]);
let deniedNetworkCalls = 0;
const net = require('node:net'), originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let first = args[0]; if (Array.isArray(first)) first = first[0];
  const targetPort = typeof first === 'object' ? Number(first.port) : Number(first);
  const host = typeof first === 'object' ? first.host : args[1];
  if (targetPort !== port || !['127.0.0.1', 'localhost'].includes(host)) { deniedNetworkCalls++; throw Error('NON_EMULATOR_NETWORK'); }
  return originalConnect.apply(this, args);
};
const deny = () => { deniedNetworkCalls++; throw Error('PROVIDER_NETWORK_FORBIDDEN'); };
require('node:https').request = deny; require('node:http').request = deny; require('node:tls').connect = deny; global.fetch = deny;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS; delete process.env.FIREBASE_TOKEN;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
process.chdir(runtime);
const admin = load('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore(), main = load('./' + load('./package.json').main);
const modules = load('./lib/modules/agent007/callables.js');
assert.equal(main.reviewAgent007MemoryCandidate, modules.reviewAgent007MemoryCandidate, 'PUBLIC_HANDLER_IDENTITY');
const review = (uid, memoryId) => main.reviewAgent007MemoryCandidate.run({ ...(uid ? { auth: { uid, token: {} } } : {}), data: { memoryId, decision: 'REJECT' } });
async function verify() {
  const zip = await Zip.loadAsync(archive);
  for (const entry of Object.values(zip.files)) if (!entry.dir) assert(fs.readFileSync(path.join(runtime, entry.name)).equals(await entry.async('nodebuffer')), 'RUNTIME_ARCHIVE_BYTES');
}
async function run() {
  await verify();
  const rootId = 'retirement-root', uid = 'retirement-owner', other = 'retirement-other', foreign = 'retirement-foreign';
  for (const actor of [uid, other, foreign]) await db.doc(`users/${actor}`).set({ rootId: actor === foreign ? 'foreign-root' : rootId, role: 'superadmin', active: true });
  const conversationId = `${rootId}_${uid}_global`;
  await db.doc(`agent007Conversations/${conversationId}`).set({ rootId, ownerUid: uid, status: 'ACTIVE', conversationState: { version: 1, rootId, turn: 1 } });
  let checks = 0;
  for (const durable of [false, true]) {
    const id = durable ? 'durable-answer' : 'session-answer';
    await db.doc(`agent007Messages/${id}`).set({ rootId, conversationId, role: 'assistant', recipientUid: uid, text: 'Respuesta sintetica', turn: 1, createdAt: admin.firestore.Timestamp.now() });
    const created = await modules.createAgent007MemoryCandidate.run({ auth: { uid, token: {} }, data: { kind: 'CONVERSATION_CORRECTION', content: 'Mi indicacion sintetica', responseCorrection: { messageId: id, scope: 'GLOBAL', expectedText: 'Respuesta sintetica', expectedVersion: 0, confirm: true, ...(durable ? { rememberFor: { kind: 'TOPIC', label: 'Revisiones operativas' } } : {}) } } });
    const memoryId = created.id, expected = { memoryId, status: 'REJECTED', scope: durable ? 'USER_TOPIC' : 'CONVERSATION_ONLY' };
    await assert.rejects(review(other, memoryId), error => error.code === 'permission-denied');
    await assert.rejects(review(foreign, memoryId), error => error.code === 'not-found');
    assert.deepEqual(await review(uid, memoryId), { ok: true, changed: true, retirement: expected });
    const before = (await db.doc(`agent007Memory/${memoryId}`).get()).data();
    assert.deepEqual(await review(uid, memoryId), { ok: true, changed: false, retirement: expected });
    assert.deepEqual((await db.doc(`agent007Memory/${memoryId}`).get()).data(), before);
    assert.equal((await db.doc(`agent007Messages/${id}`).get()).get('responseCorrection.status'), 'REJECTED');
    await db.doc(`users/${uid}`).update({ active: false });
    await assert.rejects(review(uid, memoryId), error => error.code === 'permission-denied');
    await db.doc(`users/${uid}`).update({ active: true });
    await db.doc(`agent007Memory/${memoryId}`).update({ status: 'SUPERSEDED' });
    assert.deepEqual(await review(uid, memoryId), { ok: true, changed: false });
    checks += 8;
  }
  for (const collection of ['pagos', 'solicitudes', 'paymentApplications']) assert.equal((await db.collection(collection).limit(1).get()).size, 0);
  await assert.rejects(review(null, 'absent'), error => error.code === 'unauthenticated');
  assert.equal(deniedNetworkCalls, 0);
  await verify();
  const proof = { status: 'PASS', archiveSha256: manifest.archiveSha256, checks, extraAnonymousDenied: 1,
    scope: 'PUBLIC_REVIEWER_RUN_REAL_FIRESTORE_AUTH_CONTEXT_SYNTHETIC', producerFixture: 'ARCHIVED_MODULE_CALLABLE_NOT_MAIN_PRODUCER',
    runtimeArchivePrePost: true, financialWrites: 0, providerCalls: 0, testSha256: sha(fs.readFileSync(__filename)), productionWrites: 0 };
  fs.writeFileSync(path.join(directory, 'emulator-proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
}
run().then(async () => { await db.terminate(); await Promise.all(admin.apps.map(app => app.delete())); process.exit(0); }, error => { console.error(error.code || error.message); process.exit(1); });
