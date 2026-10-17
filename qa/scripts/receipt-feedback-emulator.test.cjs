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
const runId = `feedback-${Date.now()}`, rootId = `${runId}-root`, uid = `${runId}-operator`, foreignUid = `${runId}-foreign`, blockedUid = `${runId}-blocked`, secondUid = `${runId}-second`;
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
    db.doc(`users/${secondUid}`).set({ rootId, role: 'operador', active: true }),
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
  check(persisted.get(`humanCorrectionsByActor.${uid}.reference`)?.correctedValue === 'SYNTHETIC457', 'Latest correction persists as a nested analysis field');
  check(!Object.hasOwn(persisted.data(), 'humanCorrections.reference'), 'New correction does not create a literal dotted key');
  const secondField = await call(uid, { field: 'trackingKey', correctedField: 'transactionId', correctedValue: 'SYNTHETIC789' });
  const combined = await analysisRef.get();
  assert.deepEqual(combined.get(`humanCorrectionsByActor.${uid}.reference`), persisted.get(`humanCorrectionsByActor.${uid}.reference`)); checks++;
  check(combined.get(`humanCorrectionsByActor.${uid}.trackingKey`)?.correctedValue === 'SYNTHETIC789', 'A different corrected field is merged alongside reference');
  assert.deepEqual(combined.get('semanticReceipt'), originalSemantic); checks++;
  check((await memoryRef.get()).get('receiptLearning.confirmations') === 3, 'Other pattern retains its evidence count');
  check((await db.doc(`agent007Memory/${secondField.memoryId}`).get()).get('receiptLearning.confirmations') === 1, 'Different field has independent evidence count');
  check(await count('pagoReceiptCorrections') === 4 && await count('agent007Observations') === 4, 'All four unique observations persist');
  const originalSnapshot = await analysisRef.get();
  const version = originalSnapshot.get(`correctionVersionsByActor.${uid}`);
  const operational = await call(uid, { field: 'transferAmount', correctedField: 'transferAmount', correctedValue: '123.45', expectedCorrectionVersion: version });
  check(operational.receipt.amount === 123.45, 'Missing operational amount accepts explicit human correction');
  check(operational.receipt.executionConfirmed !== true, 'Amount edit never confirms execution');
  check(operational.semanticReceipt.fields.transferAmount.provenance === 'HUMAN_CORRECTION', 'Human provenance remains explicit');
  check(operational.correctionVersion === version + 1, 'Version increments once');
  await assert.rejects(call(uid, { field: 'concept', correctedField: 'concept', correctedValue: 'Stale edit', expectedCorrectionVersion: version }), error => error.code === 'aborted'); checks++;
  const competing = await Promise.allSettled(['First edit', 'Second edit'].map(correctedValue => call(uid, { field: 'concept', correctedField: 'concept', correctedValue, expectedCorrectionVersion: version + 1 })));
  check(competing.filter(row => row.status === 'fulfilled').length === 1, 'Concurrent stale edits cannot both commit');
  check(competing.filter(row => row.status === 'rejected' && row.reason.code === 'aborted').length === 1, 'Losing concurrent edit fails with aborted');
  assert.deepEqual((await analysisRef.get()).get('semanticReceipt'), originalSemantic); checks++;
  const audit = (await db.doc(`pagoReceiptCorrections/${operational.correctionId}`).get()).data();
  check(audit.autoResult.normalizedValue === null && audit.humanCorrection.correctedValue === 123.45 && audit.humanCorrection.actorUid === uid && !!audit.humanCorrection.correctedAt, 'Audit includes original absence, value, actor and date');
  check((await db.collection('pagos').where('rootId', '==', rootId).get()).empty, 'No payment was created by feedback');
  const beforeRevert = (await analysisRef.get()).get(`correctionVersionsByActor.${uid}`);
  const amountEdit = { field: 'transferAmount', correctedField: 'transferAmount' };
  const valueB = await call(uid, { ...amountEdit, correctedValue: '456.78', expectedCorrectionVersion: beforeRevert });
  const valueA = await call(uid, { ...amountEdit, correctedValue: '123.45', expectedCorrectionVersion: valueB.correctionVersion });
  check(valueA.receipt.amount === 123.45 && valueA.correctionId !== operational.correctionId, 'A to B to A records independent reversion audit');
  check(valueA.correctionVersion === beforeRevert + 2, 'Reversion advances version twice');
  await assert.rejects(call(secondUid, { ...amountEdit, correctedValue: '123.45', expectedCorrectionVersion: valueB.correctionVersion }), error => error.code === 'aborted'); checks++;
  const otherActor = await call(secondUid, { ...amountEdit, correctedValue: '123.45', expectedCorrectionVersion: 0 });
  check(otherActor.correctionId !== valueA.correctionId, 'Second actor never reuses first actor audit');
  const secondAudit = (await db.doc(`pagoReceiptCorrections/${otherActor.correctionId}`).get()).data();
  check(secondAudit.humanCorrection.actorUid === secondUid, 'Second actor attribution remains accurate');
  const secondRetry = await call(secondUid, { ...amountEdit, correctedValue: '123.45', expectedCorrectionVersion: 0 });
  check(secondRetry.correctionId === otherActor.correctionId && secondRetry.correctionVersion === otherActor.correctionVersion, 'Second actor exact retry is idempotent');
  const implicitRetry = await call(secondUid, { ...amountEdit, correctedValue: '123.45' });
  check(implicitRetry.correctionId === otherActor.correctionId && implicitRetry.correctionVersion === otherActor.correctionVersion, 'Second actor current-overlay retry without version is idempotent');
  const independentA = await call(uid, { ...amountEdit, correctedValue: '123.45', expectedCorrectionVersion: valueB.correctionVersion });
  check(independentA.correctionVersion === valueA.correctionVersion && independentA.receipt.amount === 123.45, 'Other actor does not change actor A version or overlay');
  check(await count('pagoReceiptCorrections') === 9 && await count('agent007Observations') === 9, 'Reversion and actor change add exactly three unique audits');
  const report = { ok: true, checks, projectId, actualCallable: true, mockedDatabase: false, concurrentIdenticalCalls: 8, retryCalls: 4, uniqueCorrections: 9, observations: 9, confirmationsByPattern: [3, 1, 4, 1], nestedFieldsPreserved: true, governancePreserved: ['REJECTED', 'CONFIRMED'], externalActions: 0 };
  fs.mkdirSync('output', { recursive: true });
  fs.writeFileSync('output/receipt-feedback-emulator.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
run().catch(error => { console.error({ name: error.name, code: error.code || 'ASSERTION_FAILED', message: error.message, checks }); process.exitCode = 1; }).finally(() => admin.app().delete());
