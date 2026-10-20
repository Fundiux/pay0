// R2 persistence uses its own isolated emulator; the R1.3 transcript runs separately.
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^demo-pay0-e1-/.test(process.env.GCLOUD_PROJECT || '')) throw Error('Isolated demo emulator required');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const load = createRequire(path.join(path.resolve(process.env.HUGO_TEST_FUNCTIONS_ROOT || 'functions'), 'package.json'));
const admin = load('firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
let providerCalls = 0;
global.fetch = async () => { providerCalls++; throw Error('EXTERNAL_PROVIDER_FORBIDDEN'); };
test.after(async () => admin.firestore().terminate());
const { sendAgent007Message } = load('./lib/modules/agent007/callables');

test('R2 preserves R1.3 format, client, comparison clarification and reset through real Firestore', { timeout: 90000 }, async () => {
  const db = admin.firestore(), rootId = 'r2-after-r13-root', uid = 'r2-after-r13-reviewer';
  await db.doc(`users/${uid}`).set({ rootId, role: 'superadmin', active: true });
  for (const [id, date, amount, client] of [
    ['r2-current', '2026-09-10T12:00:00Z', 37.45, 'pc'],
    ['r2-prior', '2026-08-10T12:00:00Z', 12.35, 'pc'],
    ['r2-unrequested', '2026-09-11T12:00:00Z', 999, 'other'],
  ]) await db.doc(`earningsDistributions/${id}`).set({ rootId, clienteId: client, clienteNombre: client === 'pc' ? 'PC Directo' : 'Other', totalEarningsAmount: amount, createdAt: admin.firestore.Timestamp.fromDate(new Date(date)) });
  const send = text => sendAgent007Message.run({ auth: { uid, token: {} }, data: { text, scope: 'GLOBAL' } });
  const conversation = db.doc(`agent007Conversations/${rootId}_${uid}_global`);
  const initial = await send('reporte de utilidades del cliente PC Directo del 2026-09-01 al 2026-09-30 en formato PDF');
  assert.equal(initial.message.reportExport.format, 'PDF');
  const comparison = await send('comparalo con 2026-08-01 al 2026-08-31');
  assert.equal(comparison.message.reportExport.format, 'PDF');
  assert.deepEqual(comparison.message.reportExport.rows.map(row => row.clienteId), ['pc']);
  assert.match(comparison.message.text, /25\.10/);
  assert.equal((await conversation.get()).get('conversationState.lastEarningsReport.query.format'), 'PDF');
  const clarification = await send('compara reporte de utilidades del cliente PC Directo del 2026-09-01 al 2026-09-30 contra 2026-08-01 al 2026-08-31');
  assert.match(clarification.message.text, /PDF.*Excel/);
  assert.equal(clarification.message.reportExport, undefined);
  assert.equal((await conversation.get()).get('conversationState.pendingEarningsReport.compareDateFrom'), '2026-08-01');
  const chosen = await send('PDF');
  assert.equal(chosen.message.reportExport.format, 'PDF');
  assert.match(chosen.message.text, /2026-08-01/);
  assert.deepEqual(chosen.message.reportExport.rows.map(row => row.clienteId), ['pc']);
  await send('hola Maria');
  const state = (await conversation.get()).get('conversationState');
  assert.equal(state.pendingEarningsReport, undefined);
  assert.equal(state.lastEarningsReport, undefined);
  const afterReset = await send('2026-08-01 al 2026-08-31');
  assert.equal(afterReset.message.reportExport, undefined);
  assert.match(afterReset.message.text, /cliente/i);
  await db.doc(`users/${uid}`).update({ active: false });
  await assert.rejects(() => send('comparalo con 2026-08-01 al 2026-08-31'));
  await db.doc(`users/${uid}`).update({ active: true, rootId: 'r2-after-r13-other-root' });
  const otherRoot = await send('comparalo con 2026-08-01 al 2026-08-31');
  assert.equal(otherRoot.message.reportExport, undefined);
  assert.doesNotMatch(otherRoot.message.text, /37\.45|PC Directo/);
  assert.equal(providerCalls, 0);
});
