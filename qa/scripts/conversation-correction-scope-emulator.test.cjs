const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
if (!/^demo-pay0-e1-/.test(process.env.GCLOUD_PROJECT || '') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('ISOLATED_EMULATOR_REQUIRED');
const workspace = path.resolve(__dirname, '../..');
const library = path.resolve(process.env.PAY0_CORRECTIONS_LIB || path.join(workspace, 'functions/lib'));
assert(library.startsWith(workspace + path.sep), 'WORKSPACE_LIBRARY_REQUIRED');
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore(), api = require(path.join(library, 'modules/agent007/callables'));
const { FirestoreHugoDataStore } = require(path.join(library, 'modules/agent007/firestoreHugoDataStore'));
const { explicitCorrectionTopic, correctionBindingId } = require(path.join(library, 'modules/agent007/conversationCorrections'));
const { emptyConversationState } = require(path.join(library, 'modules/agent007/hugoCore/conversationState'));
global.fetch = async () => { throw Error('EXTERNAL_PROVIDER_FORBIDDEN'); };
const store = new FirestoreHugoDataStore(db), rootId = 'scope-root', uid = 'scope-owner', other = 'scope-other', foreign = 'scope-foreign';
const identity = { uid, rootId }, conversationId = `${rootId}_${uid}_global`;
const invoke = (name, data, actor = uid) => api[name].run({ auth: actor ? { uid: actor, token: {} } : undefined, data });
const report = rows => ({ version: 1, kind: 'EARNINGS_BY_CLIENT', rows });
const client = id => ({ clienteId: id, clienteNombre: `Cliente sintético ${id}` });
async function answer(id, exported) {
  await db.doc(`agent007Conversations/${conversationId}`).set({ rootId, ownerUid: uid, status: 'ACTIVE', conversationState: { ...emptyConversationState(rootId), turn: 1 } });
  await db.doc(`agent007Messages/${id}`).set({ rootId, conversationId, role: 'assistant', recipientUid: uid, text: 'Respuesta sintética de alcance.', turn: 1, createdAt: admin.firestore.Timestamp.now(), ...(exported ? { reportExport: exported } : {}) });
}
const payload = (id, rememberFor) => ({ kind: 'CONVERSATION_CORRECTION', content: 'Explica la evidencia antes del resumen.', responseCorrection: { messageId: id, scope: 'GLOBAL', confirm: true, expectedText: 'Respuesta sintética de alcance.', expectedVersion: 0, rememberFor } });

test('durable corrections remain private to the exact confirmed client or topic', { timeout: 90000 }, async t => {
  await Promise.all([uid, other].map(id => db.doc(`users/${id}`).set({ rootId, role: 'superadmin', active: true })));
  await db.doc(`users/${foreign}`).set({ rootId: 'foreign-root', role: 'superadmin', active: true });
  let topicResult, clientResult;
  const topic = explicitCorrectionTopic('Revisión documental');
  await t.test('normalization is exact; a related label is a different topic', async () => {
    assert.equal(explicitCorrectionTopic('  REVISIÓN   DOCUMENTAL  ').id, topic.id);
    assert.equal(explicitCorrectionTopic('Revisio\u0301n documental').id, topic.id);
    assert.notEqual(explicitCorrectionTopic('Revisión de documentos').id, topic.id);
    assert.throws(() => explicitCorrectionTopic('tema\nsecreto'));
  });
  await t.test('confirmed topic survives a new conversation without global promotion', async () => {
    await answer('scope-topic'); topicResult = await invoke('createAgent007MemoryCandidate', payload('scope-topic', { kind: 'TOPIC', label: topic.label }));
    assert.equal(topicResult.correction.scope, 'USER_TOPIC'); assert.equal(topicResult.correction.expiresAt, null);
    const memory = (await db.doc(`agent007Memory/${topicResult.id}`).get()).data();
    assert.equal(memory.kind, 'USER_STATEMENT'); assert.equal(memory.authorUid, uid); assert.equal(memory.validUntil, null);
    await db.doc(`agent007Conversations/${conversationId}`).delete();
    assert.equal((await store.loadTopicCorrections(identity, [topic])).length, 1);
    assert.equal((await store.loadTopicCorrections(identity, [explicitCorrectionTopic('Otro tema')])).length, 0);
  });
  await t.test('same-root users and another root cannot reuse owner corrections', async () => {
    assert.equal((await store.loadTopicCorrections({ uid: other, rootId }, [topic])).length, 0);
    assert.equal((await store.loadTopicCorrections({ uid: foreign, rootId: 'foreign-root' }, [topic])).length, 0);
    await assert.rejects(store.loadTopicCorrections({ uid: foreign, rootId }, [topic]), error => error.code === 'permission-denied');
    const copied = (await db.doc(`agent007ConversationCorrectionBindings/${correctionBindingId(rootId, uid, topic)}`).get()).data();
    await db.doc(`agent007ConversationCorrectionBindings/${correctionBindingId(rootId, other, topic)}`).set({ ...copied, ownerUid: other });
    assert.equal((await store.loadTopicCorrections({ uid: other, rootId }, [topic])).length, 0);
  });
  await t.test('client binding comes from the persisted canonical export, never supplied client ID', async () => {
    await answer('scope-client', report([client('client-a')]));
    clientResult = await invoke('createAgent007MemoryCandidate', payload('scope-client', { kind: 'CLIENT', clientId: 'client-b' }));
    assert.equal(clientResult.correction.topic.kind, 'CLIENT'); assert.equal(clientResult.correction.topic.id, 'client-a');
    assert.equal((await store.loadTopicCorrections(identity, [{ kind: 'CLIENT', id: 'client-a', label: 'Nombre actualizado' }])).length, 1);
    assert.equal((await store.loadTopicCorrections(identity, [{ kind: 'CLIENT', id: 'client-b', label: 'Otro cliente' }])).length, 0);
  });
  await t.test('ambiguous or unrecognized exports require confirmation instead of guessing', async () => {
    for (const [id, exported] of [['scope-many', report([client('a'), client('b')])], ['scope-wrong-kind', { version: 1, kind: 'OTHER', rows: [client('a')] }], ['scope-wrong-version', { version: 2, kind: 'EARNINGS_BY_CLIENT', rows: [client('a')] }], ['scope-none', undefined]]) {
      await answer(id, exported);
      await assert.rejects(invoke('createAgent007MemoryCandidate', payload(id, { kind: 'CLIENT' })), error => error.code === 'failed-precondition');
    }
  });
  await t.test('revoked actor cannot load remembered guidance', async () => {
    await db.doc(`users/${uid}`).update({ active: false });
    await assert.rejects(store.loadTopicCorrections(identity, [topic]), error => error.code === 'permission-denied');
    await db.doc(`users/${uid}`).update({ active: true });
  });
  await t.test('a malformed durable binding rejects replay without an internal error', async () => {
    const ref = db.doc(`agent007ConversationCorrectionBindings/${correctionBindingId(rootId, uid, topic)}`);
    const original = (await ref.get()).data();
    await ref.update({ memoryIds: {} });
    try {
      await assert.rejects(invoke('createAgent007MemoryCandidate', payload('scope-topic', { kind: 'TOPIC', label: topic.label })), error => error.code === 'failed-precondition');
    } finally { await ref.set(original); }
  });
  await t.test('owner can withdraw guidance; another actor cannot withdraw it', async () => {
    await assert.rejects(invoke('reviewAgent007MemoryCandidate', { memoryId: clientResult.id, decision: 'REJECT' }, other), error => error.code === 'permission-denied');
    const result = await invoke('reviewAgent007MemoryCandidate', { memoryId: topicResult.id, decision: 'REJECT' });
    assert.equal(result.changed, true);
    assert.equal((await store.loadTopicCorrections(identity, [topic])).length, 0);
    const binding = (await db.doc(`agent007ConversationCorrectionBindings/${correctionBindingId(rootId, uid, topic)}`).get()).data();
    assert(!binding || !binding.memoryIds.includes(topicResult.id));
  });
  await t.test('the loop creates no financial operations', async () => {
    for (const collection of ['pagos', 'solicitudes', 'paymentApplications']) assert.equal((await db.collection(collection).limit(1).get()).size, 0);
  });
});
