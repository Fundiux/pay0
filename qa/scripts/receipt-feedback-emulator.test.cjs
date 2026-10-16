const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const projectId = 'demo-pay0-receipt-feedback';
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Isolated demo project required');
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/, 'Loopback Firestore emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
for (const protocol of ['http', 'https']) {
  const api = require(`node:${protocol}`), original = api.request;
  api.request = function (url, ...args) {
    const host = typeof url === 'string' || url instanceof URL ? new URL(url).hostname : String(url.hostname || url.host || '').split(':')[0];
    assert.ok(['127.0.0.1', 'localhost'].includes(host), 'External HTTP transport forbidden');
    return original.call(this, url, ...args);
  };
}
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId });
const db = admin.firestore();
const { correctPagoReceiptSemanticField } = require('../../functions/lib/modules/pagos/receiptPdfCallables');
const runId = `feedback-${Date.now()}`, rootId = `${runId}-root`, uid = `${runId}-operator`, foreignUid = `${runId}-foreign`, blockedUid = `${runId}-blocked`;
const analysisId = crypto.createHash('sha256').update(runId).digest('hex');
const analysisRef = db.doc(`pagoReceiptAnalyses/${analysisId}`);
const originalSemantic = { readerVersion: 'SYNTHETIC_READER', fields: {
  reference: { value: 'SYNTHETIC123', normalizedValue: 'SYNTHETIC123', rawValue: 'SYNTHETIC123', label: 'Referencia', confidence: 'MEDIUM', excerpt: 'Referencia: SYNTHETIC123', decision: 'REVIEW' },
  trackingKey: { value: 'SYNTHETIC789', normalizedValue: 'SYNTHETIC789', rawValue: 'SYNTHETIC789', label: 'Rastreo', confidence: 'MEDIUM', excerpt: 'Rastreo: SYNTHETIC789', decision: 'REVIEW' },
  bankName: { normalizedValue: 'BANCO SINTETICO' }, folio: { decision: 'MISSING' },
} };
const data = { analysisId, field: 'reference', correctedField: 'folio', correctedValue: 'SYNTHETIC123' };
const call = (actorUid, patch = {}) => correctPagoReceiptSemanticField.run({ auth: actorUid ? { uid: actorUid, token: {} } : null, data: { ...data, ...patch } });
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const count = async collection => (await db.collection(collection).where('rootId', '==', rootId).get()).size;
async function run() {
  await Promise.all([
    db.doc(`users/${uid}`).set({ rootId, role: 'operador', active: true }),
    db.doc(`users/${foreignUid}`).set({ rootId: 'foreign-root', role: 'operador', active: true }),
    db.doc(`users/${blockedUid}`).set({ rootId, role: 'operador', active: true, disabled: true }),
    analysisRef.set({ rootId, readerVersion: 'SYNTHETIC_READER', contentSha256: 'c'.repeat(64), semanticReceipt: originalSemantic }),
  ]);
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => call(uid)));
  const result = concurrent[0], memoryRef = db.doc(`agent007Memory/${result.memoryId}`);
  check(concurrent.every(row => row.correctionId === result.correctionId && row.observationId === result.observationId && row.memoryId === result.memoryId), 'Concurrent calls share all durable identities');
  check(await count('pagoReceiptCorrections') === 1, 'Concurrent retries create one correction');
  check(await count('agent007Observations') === 1, 'Concurrent retries create one observation');
  check((await memoryRef.get()).get('receiptLearning.confirmations') === 1, 'Concurrent retries increment confirmation once');
  const originalCorrection = (await db.doc(`pagoReceiptCorrections/${result.correctionId}`).get()).data();
  await Promise.all(Array.from({ length: 4 }, () => call(uid)));
  check((await memoryRef.get()).get('receiptLearning.confirmations') === 1, 'Sequential retry group adds no evidence');
  assert.deepEqual((await db.doc(`pagoReceiptCorrections/${result.correctionId}`).get()).data(), originalCorrection); checks++;
  for (const [index, status] of ['REJECTED', 'CONFIRMED'].entries()) {
    await memoryRef.update({ status, kind: 'HYPOTHESIS', createdAt: 'ORIGINAL_CREATED', lastVerifiedAt: 'ORIGINAL_VERIFIED' });
    const changed = await call(uid, { correctedValue: `SYNTHETIC${index + 456}` });
    const memory = await memoryRef.get();
    check(changed.correctionId !== result.correctionId, `${status}: distinct correction has distinct identity`);
    check(memory.get('status') === status, `${status}: human governance is preserved`);
    check(memory.get('createdAt') === 'ORIGINAL_CREATED' && memory.get('lastVerifiedAt') === 'ORIGINAL_VERIFIED', `${status}: original governance timestamps preserved`);
    check(memory.get('receiptLearning.confirmations') === index + 2, `${status}: new evidence counted once`);
    check(changed.learningContext[0].advisory === (status === 'CONFIRMED'), `${status}: advisory eligibility follows governance`);
  }
  const before = await Promise.all(['pagoReceiptCorrections', 'agent007Observations'].map(count));
  for (const [actor, code] of [[foreignUid, 'not-found'], [blockedUid, 'permission-denied'], [null, 'unauthenticated']]) {
    await assert.rejects(call(actor, { correctedValue: 'MUST_NOT_WRITE' }), error => error.code === code); checks++;
  }
  assert.deepEqual(await Promise.all(['pagoReceiptCorrections', 'agent007Observations'].map(count)), before); checks++;
  check((await memoryRef.get()).get('receiptLearning.confirmations') === 3, 'Denied calls do not increment evidence');
  assert.deepEqual((await analysisRef.get()).get('semanticReceipt'), originalSemantic); checks++;
  const persisted = await analysisRef.get();
  check(persisted.get('humanCorrections.reference')?.correctedValue === 'SYNTHETIC457', 'Latest correction persists as a nested analysis field');
  check(!Object.hasOwn(persisted.data(), 'humanCorrections.reference'), 'New correction does not create a literal dotted key');
  const secondField = await call(uid, { field: 'trackingKey', correctedField: 'transactionId', correctedValue: 'SYNTHETIC789' });
  const combined = await analysisRef.get();
  assert.deepEqual(combined.get('humanCorrections.reference'), persisted.get('humanCorrections.reference')); checks++;
  check(combined.get('humanCorrections.trackingKey')?.correctedValue === 'SYNTHETIC789', 'A different corrected field is merged alongside reference');
  assert.deepEqual(combined.get('semanticReceipt'), originalSemantic); checks++;
  check((await memoryRef.get()).get('receiptLearning.confirmations') === 3, 'Other pattern retains its evidence count');
  check((await db.doc(`agent007Memory/${secondField.memoryId}`).get()).get('receiptLearning.confirmations') === 1, 'Different field has independent evidence count');
  check(await count('pagoReceiptCorrections') === 4 && await count('agent007Observations') === 4, 'All four unique observations persist');
  const report = { ok: true, checks, projectId, actualCallable: true, mockedDatabase: false, concurrentIdenticalCalls: 8, retryCalls: 4, uniqueCorrections: 4, observations: 4, confirmationsByPattern: [3, 1], nestedFieldsPreserved: true, governancePreserved: ['REJECTED', 'CONFIRMED'], externalActions: 0 };
  fs.mkdirSync('output', { recursive: true });
  fs.writeFileSync('output/receipt-feedback-emulator.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
run().catch(error => { console.error({ name: error.name, code: error.code || 'ASSERTION_FAILED', message: error.message, checks }); process.exitCode = 1; }).finally(() => admin.app().delete());
