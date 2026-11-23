const assert = require('node:assert/strict');
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = 'demo-pay0';
const admin = require('../../functions/node_modules/firebase-admin');
const lib = '../../functions/lib/modules/whatsappAutoReply/';
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-pay0' });
const db = admin.firestore();
const { listWhatsAppAgentReplies, markWhatsAppReplyCorrection, getWhatsAppAgentReplyMetrics } = require(lib + 'modeCallables.js');

const run = `list-${Date.now()}`;
const rootId = `${run}-root`, ownerUid = `${run}-owner`, otherUid = `${run}-other`, foreignRoot = `${run}-foreign`;
const call = (fn, uid, data) => fn.run({ auth: { uid }, data });
const metric = (id, over) => db.doc(`whatsappAgentReplyMetrics/${id}`).set({ rootId, agentId: 'hugo', chatId: 'g1', groupName: 'Contabilidad Oil', kind: 'GREETING', subject: null, monthKey: '2026-11', humanCorrection: false, queuedAtMs: 1000, ...over });
const job = (id, over) => db.doc(`documentDeliveryJobs/${id}`).set({ rootId, textBody: 'Buen día.', ...over });

(async () => {
  await db.doc(`users/${ownerUid}`).set({ role: 'superadmin', rootId, active: true });
  await db.doc(`users/${otherUid}`).set({ role: 'user', rootId, active: true });
  await metric('r1', { queuedAtMs: 1000 }); await job('r1', { textBody: 'Buen día.' });
  await metric('r2', { queuedAtMs: 3000, kind: 'PROCESSING', subject: 'TRANSFER' }); await job('r2', { textBody: 'Su transferencia ya está en proceso.' });
  await metric('r3', { queuedAtMs: 2000, monthKey: '2026-10' }); await job('r3', { textBody: 'Mes anterior.' });
  await metric('r4', { rootId: foreignRoot, queuedAtMs: 4000 }); await job('r4', { rootId: foreignRoot, textBody: 'De otra empresa.' });
  await metric('r5', { queuedAtMs: 500 }); await job('r5', { rootId: foreignRoot, textBody: 'Texto de un trabajo ajeno.' });

  const list = await call(listWhatsAppAgentReplies, ownerUid, { month: '2026-11' });
  assert.deepEqual(list.replies.map(r => r.id), ['r2', 'r1', 'r5'], 'this month and this root only, newest first');
  assert.equal(list.replies[0].text, 'Su transferencia ya está en proceso.');
  assert.equal(list.replies[0].kind, 'PROCESSING'); assert.equal(list.replies[0].groupName, 'Contabilidad Oil'); assert.equal(list.replies[0].humanCorrection, false);
  assert.equal(list.replies[2].text, '', 'a job of another root never leaks its text');
  assert.equal((await call(listWhatsAppAgentReplies, ownerUid, { month: '2026-10' })).replies.length, 1);
  assert.equal((await call(listWhatsAppAgentReplies, ownerUid, { month: 'basura' })).ok, true, 'a bad month falls back to the current one');
  await assert.rejects(() => call(listWhatsAppAgentReplies, otherUid, {}), 'only the owner');

  await call(markWhatsAppReplyCorrection, ownerUid, { jobId: 'r2', reason: 'No estaba en proceso', category: 'WRONG_FACT' });
  assert.equal((await call(listWhatsAppAgentReplies, ownerUid, { month: '2026-11' })).replies.find(r => r.id === 'r2').humanCorrection, true);
  const total = (await call(getWhatsAppAgentReplyMetrics, ownerUid, { month: '2026-11' })).buckets.find(b => b.agentId === 'hugo' && b.chatId === null);
  assert.equal(total.humanCorrections, 1);
  await call(markWhatsAppReplyCorrection, ownerUid, { jobId: 'r2', corrected: false });
  assert.equal((await call(listWhatsAppAgentReplies, ownerUid, { month: '2026-11' })).replies.find(r => r.id === 'r2').humanCorrection, false);
  await assert.rejects(() => call(markWhatsAppReplyCorrection, ownerUid, { jobId: 'r4' }), 'a reply of another root cannot be marked');

  console.log('whatsapp-reply-list: PASS');
})().catch(error => { console.error(error); process.exit(1); });
