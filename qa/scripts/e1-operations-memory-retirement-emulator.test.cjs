const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { createRequire } = require('node:module');
if (!/^demo-pay0-e1-/.test(process.env.GCLOUD_PROJECT || '') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('ISOLATED_EMULATOR_REQUIRED');
const base = path.resolve(__dirname, '../../functions'), load = createRequire(path.join(base, 'package.json'));
const admin = load('firebase-admin'); admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore(), ts = load('typescript'), exportsFixture = {};
const source = fs.readFileSync(path.join(base, 'src/modules/agent007/firestoreHugoDataStore.ts'), 'utf8');
new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(createRequire(path.join(base, 'lib/modules/agent007/firestoreHugoDataStore.js')), exportsFixture);
const store = new exportsFixture.FirestoreHugoDataStore(db);
const api = load('./lib/modules/agent007/callables.js');
const { emptyConversationState } = load('./lib/modules/agent007/hugoCore/conversationState.js');
global.fetch = async () => { throw Error('EXTERNAL_PROVIDER_FORBIDDEN'); };
async function run() {
  const rootId = 'retirement-root', uid = 'retirement-owner', other = 'retirement-other', foreign = 'retirement-foreign';
  for (const actor of [uid, other, foreign]) await db.doc(`users/${actor}`).set({ rootId: actor === foreign ? 'foreign-root' : rootId, role: 'superadmin', active: true });
  const conversationId = `${rootId}_${uid}_global`;
  await db.doc(`agent007Conversations/${conversationId}`).set({ rootId, ownerUid: uid, status: 'ACTIVE', conversationState: { ...emptyConversationState(rootId), turn: 1 } });
  let checks = 0;
  for (const durable of [false, true]) {
    const id = durable ? 'durable-answer' : 'session-answer';
    await db.doc(`agent007Messages/${id}`).set({ rootId, conversationId, role: 'assistant', recipientUid: uid, text: 'Respuesta sintetica', turn: 1, createdAt: admin.firestore.Timestamp.now() });
    const created = await api.createAgent007MemoryCandidate.run({ auth: { uid, token: {} }, data: { kind: 'CONVERSATION_CORRECTION', content: 'Mi indicacion sintetica', responseCorrection: { messageId: id, scope: 'GLOBAL', expectedText: 'Respuesta sintetica', expectedVersion: 0, confirm: true, ...(durable ? { rememberFor: { kind: 'TOPIC', label: 'Revisiones operativas' } } : {}) } } });
    const memoryId = created.id, expected = { memoryId, status: 'REJECTED', scope: durable ? 'USER_TOPIC' : 'CONVERSATION_ONLY' };
    await assert.rejects(store.reviewMemoryCandidate(rootId, other, memoryId, 'REJECT'), error => error.code === 'permission-denied');
    await assert.rejects(store.reviewMemoryCandidate('foreign-root', foreign, memoryId, 'REJECT'), error => error.code === 'not-found');
    const first = await store.reviewMemoryCandidate(rootId, uid, memoryId, 'REJECT');
    assert.deepEqual(first, { changed: true, retirement: expected });
    const before = (await db.doc(`agent007Memory/${memoryId}`).get()).data();
    // The caller lost the first ACK; its retry receives canonical state without a second write.
    assert.deepEqual(await store.reviewMemoryCandidate(rootId, uid, memoryId, 'REJECT'), { changed: false, retirement: expected });
    assert.deepEqual((await db.doc(`agent007Memory/${memoryId}`).get()).data(), before);
    assert.equal((await db.doc(`agent007Messages/${id}`).get()).get('responseCorrection.status'), 'REJECTED');
    await db.doc(`users/${uid}`).update({ active: false });
    await assert.rejects(store.reviewMemoryCandidate(rootId, uid, memoryId, 'REJECT'), error => error.code === 'permission-denied');
    await db.doc(`users/${uid}`).update({ active: true });
    await db.doc(`agent007Memory/${memoryId}`).update({ status: 'SUPERSEDED' });
    assert.deepEqual(await store.reviewMemoryCandidate(rootId, uid, memoryId, 'REJECT'), { changed: false });
    checks += 8;
  }
  for (const collection of ['pagos', 'solicitudes', 'paymentApplications']) assert.equal((await db.collection(collection).limit(1).get()).size, 0);
  console.log(JSON.stringify({ status: 'PASS', checks, mode: 'SOURCE_TRANSPILED_STORE_REAL_FIRESTORE_COMPILED_CANONICAL_PRODUCER', externalActions: 0, financialWrites: 0 }));
}
run().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
