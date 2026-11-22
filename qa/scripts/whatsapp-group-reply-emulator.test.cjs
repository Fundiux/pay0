'use strict';
// Emulator test: the group reply runner turns an observed client message into a queued reply that Hugo's
// connector claims, sends once and reports, using the same sender as documents. Real Firestore emulator,
// real Ed25519 signatures, no network beyond loopback.
//   node scripts/run-firebase-clean-env.mjs emulators:exec --config firebase.emulator-tests.json --project demo-pay0 \
//     --only auth,firestore,storage "node qa/scripts/whatsapp-group-reply-emulator.test.cjs"
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
assert.match(process.env.GCLOUD_PROJECT || '', /^demo-/, 'demo project required');
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/, 'loopback Firestore emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };

const admin = require('../../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const lib = '../../functions/lib/modules/';
const { WhatsAppConnectorAuthority } = require(lib + 'documentDelivery/whatsappConnectorAuthority.js');
const policy = require(lib + 'documentDelivery/whatsappConnectorPolicy.js');
const { runGroupReplies, replyConfigId } = require(lib + 'whatsappAutoReply/runner.js');
const { operatorAuthorHashes, REPLY_TEXT_VARIANTS } = require(lib + 'whatsappAutoReply/domain.js');
const { saveWhatsAppAgentObservers } = require(lib + 'documentDelivery/whatsappObserverCallables.js');
const { createWorkerKey, createAuthorityTransport } = require('../../tools/whatsapp-qr-connector/connectorAuthority.cjs');

const run = `wa-reply-${Date.now()}`;
const rootId = `${run}-root`, ownerUid = `${run}-owner`, betell = `${run}-betell`;
const groupA = '120363555000000001@g.us', groupB = '120363555000000002@g.us', groupC = '120363555000000003@g.us', groupD = '120363555000000004@g.us', groupE = '120363555000000005@g.us';
const MIN = 60_000, HOUR = 60 * MIN;
// Monday 2026-11-09 10:00 in Mexico City (UTC-6): inside Hugo's hours.
const NOW = Date.UTC(2026, 10, 9, 16, 0, 0);
const service = new WhatsAppConnectorAuthority(db, { signUrl: async () => 'https://signed.invalid/x', isOpen: () => true });
const fakeFetch = async (url, options) => {
  const body = JSON.parse(options.body), name = url.split('/').at(-1);
  const result = name === 'consumeWhatsAppConnectorEnrollment' ? await service.consume(body.data) : await service.operate(body.data.envelope, body.data.data);
  return { ok: true, json: async () => ({ result }) };
};
const cases = [];
const test = async (name, fn) => { await fn(); cases.push(name); };
const hash = authorId => crypto.createHash('sha256').update(`${rootId}|${authorId}`).digest('hex').slice(0, 32);
const operatorHash = [...operatorAuthorHashes(rootId, ['525511111111'])][0];
const jobsFor = async sourceId => (await db.collection('documentDeliveryJobs').where('rootId', '==', rootId).where('sourceId', '==', sourceId).get()).docs;
let bindingId, seq = 0;
async function inbound(chatId, over = {}) {
  const messageId = `msg-${++seq}`, id = `${bindingId}__${messageId}`;
  await db.doc(`whatsappInboundMessages/${id}`).set({ rootId, bindingId, agentId: 'hugo', chatId, messageId, fromMe: false, authorHash: hash('5215599999999@c.us'),
    timestampMs: NOW - MIN, type: 'chat', body: 'Buenos días', reportDay: '2026-11-09', ...over });
  return id;
}
const observe = (chatId, name, ownerUserUid) => db.doc(`whatsappAgentObservers/${rootId}__${encodeURIComponent(chatId)}`).set({
  rootId, groupChatId: chatId, groupName: name, active: true, ...(ownerUserUid ? { ownerUserUid } : {}), observers: [{ agentId: 'hugo', phone: '' }] });
const setReply = (enabled, mode) => db.doc(`whatsappAgentReplyConfigs/${replyConfigId(rootId)}`).set({ rootId, agentId: 'hugo', enabled, mode });

(async () => {
  await db.doc(`users/${ownerUid}`).set({ role: 'superadmin', rootId, active: true });
  await db.doc(`users/${betell}`).set({ rootId, role: 'cliente', displayName: 'Betell', active: true });
  const key = createWorkerKey();
  const created = await service.create({ auth: { uid: ownerUid }, data: { publicKeyPem: key.publicKeyPem, agentId: 'hugo' } });
  const hugo = createAuthorityTransport({ baseUrl: 'https://authority.invalid', privateKeyPem: key.privateKeyPem, policy, fetchImpl: fakeFetch });
  bindingId = (await hugo.consume(created.enrollment)).binding.id;
  await db.doc(`whatsappAutomationConfigs/${rootId}`).set({ rootId, enabled: true });
  await db.doc(`userOperatorNumbers/${rootId}__${betell}`).set({ rootId, userUid: betell, numbers: ['525511111111'] });
  await observe(groupA, 'Betell - Operaciones', betell);
  // The group has been observed for 80 hours: its first stored message.
  await inbound(groupA, { timestampMs: NOW - 80 * HOUR, body: 'hola' });
  const greeting = await inbound(groupA);

  await test('switch-off-queues-nothing', async () => {
    const result = await runGroupReplies(rootId, NOW);
    assert.equal(result.skipped, 'OFF');
    assert.equal((await jobsFor(greeting)).length, 0);
  });

  await test('greeting-is-queued-as-a-text-delivery-with-the-owner-name', async () => {
    await setReply(true, 'GREETINGS_ONLY');
    const result = await runGroupReplies(rootId, NOW);
    assert.equal(result.queued, 1);
    const [jobDoc] = await jobsFor(greeting);
    const job = jobDoc.data();
    assert.equal(job.sourceType, 'GRUPO_RESPUESTA');
    assert.equal(job.status, 'READY_FOR_SEND');
    assert.equal(job.textBody, 'Buen día, Betell.');
    assert.doesNotMatch(job.textBody, /pay\s*-?\s*0|despacho/i);
    const [delivery] = (await jobDoc.ref.collection('deliveries').get()).docs.map(doc => doc.data());
    assert.equal(delivery.status, 'PENDING_SEND');
    assert.equal(delivery.chatId, groupA);
    assert.equal(delivery.rootId, rootId);
  });

  await test('running-again-never-queues-a-second-reply', async () => {
    assert.equal((await runGroupReplies(rootId, NOW)).queued, 0);
    assert.equal((await jobsFor(greeting)).length, 1);
  });

  await test('connector-claims-sends-once-and-reports-the-reply', async () => {
    const claim = await hugo.operate('CLAIM_DELIVERY', {});
    const d = claim.delivery;
    assert.ok(d);
    assert.equal(d.kind, 'TEXT');
    assert.equal(d.text, 'Buen día, Betell.');
    assert.equal(d.chatId, groupA);
    assert.equal((await hugo.operate('REPORT_DELIVERY', { jobId: d.jobId, deliveryId: d.deliveryId, leaseId: d.leaseId, outcome: 'ATTEMPT' })).attemptAuthorized, true);
    const sent = await hugo.operate('REPORT_DELIVERY', { jobId: d.jobId, deliveryId: d.deliveryId, leaseId: d.leaseId, outcome: 'SENT', messageIds: ['true_x@g.us_ABC'] });
    assert.equal(sent.deliveryStatus, 'SENT');
    assert.equal((await hugo.operate('CLAIM_DELIVERY', {})).delivery, null);
    assert.equal((await runGroupReplies(rootId, NOW)).queued, 0);
  });

  await test('greetings-only-skips-questions-and-standard-validates-them', async () => {
    const question = await inbound(groupA, { body: '¿Ya salió mi transferencia?', timestampMs: NOW - 5 * MIN });
    assert.equal((await runGroupReplies(rootId, NOW)).queued, 0);
    await setReply(true, 'STANDARD');
    assert.equal((await runGroupReplies(rootId, NOW)).queued, 1);
    const [jobDoc] = await jobsFor(question);
    assert.ok(REPLY_TEXT_VARIANTS.VALIDATING.includes(jobDoc.data().textBody), jobDoc.data().textBody);
    assert.equal(jobDoc.data().replyKind, 'VALIDATING');
  });

  await test('a-team-answer-after-the-message-stops-the-reply', async () => {
    await observe(groupB, 'Betell - Pagos', betell);
    await inbound(groupB, { timestampMs: NOW - 80 * HOUR, body: 'hola' });
    const asked = await inbound(groupB, { body: '¿Cuándo sale mi factura?', timestampMs: NOW - 6 * MIN });
    await inbound(groupB, { authorHash: operatorHash, timestampMs: NOW - 4 * MIN, body: 'Ya lo revisamos' });
    assert.equal((await runGroupReplies(rootId, NOW)).queued, 0);
    assert.equal((await jobsFor(asked)).length, 0);
  });

  await test('a-group-without-an-owner-user-is-never-answered', async () => {
    await observe(groupC, 'Sin dueño', null);
    await inbound(groupC, { timestampMs: NOW - 80 * HOUR, body: 'hola' });
    const hello = await inbound(groupC);
    assert.equal((await runGroupReplies(rootId, NOW)).queued, 0);
    assert.equal((await jobsFor(hello)).length, 0);
  });

  await test('a-group-in-its-first-days-gets-the-greeting-but-no-other-reply', async () => {
    await observe(groupD, 'Nuevo grupo', betell);
    await inbound(groupD, { timestampMs: NOW - 10 * HOUR, body: 'hola' });
    const question = await inbound(groupD, { body: '¿Ya salió mi transferencia?', timestampMs: NOW - 5 * MIN });
    assert.equal((await runGroupReplies(rootId, NOW)).queued, 0);
    assert.equal((await jobsFor(question)).length, 0);
    const hello = await inbound(groupD, { timestampMs: NOW - 2 * MIN });
    assert.equal((await runGroupReplies(rootId, NOW)).queued, 1);
    assert.equal((await jobsFor(hello))[0].data().textBody, 'Buen día, Betell.');
  });

  const asOwner = data => ({ auth: { uid: ownerUid }, data });
  await test('the-internal-group-of-the-team-is-never-answered', async () => {
    await db.doc(`whatsappAgentChats/${bindingId}__${encodeURIComponent(groupE)}`).set({ rootId, bindingId, chatId: groupE, name: 'RR - Equipo', isGroup: true, active: true });
    await setReply(true, 'STANDARD');
    // An observer row written before the group became internal must not make Hugo answer there.
    await observe(groupE, 'RR - Equipo', betell);
    await inbound(groupE, { timestampMs: NOW - 80 * HOUR, body: 'hola' });
    const hello = await inbound(groupE);
    await db.doc(`whatsappInternalGroups/${rootId}`).set({ rootId, groupChatId: groupE, groupName: 'RR - Equipo' });
    await runGroupReplies(rootId, NOW);
    assert.equal((await jobsFor(hello)).length, 0);
  });

  await test('the-internal-group-cannot-be-assigned-to-a-user', async () => {
    await assert.rejects(() => saveWhatsAppAgentObservers.run(asOwner({ groupChatId: groupE, active: true, ownerUserUid: betell, observers: [{ agentId: 'hugo', phone: '' }] })), error => /grupo interno/.test(String(error.message)));
  });

  await test('an-empty-internal-group-document-means-there-is-none', async () => {
    await db.doc(`whatsappInternalGroups/${rootId}`).set({ rootId, groupChatId: '', groupName: '' });
    await db.doc(`whatsappAgentChats/${bindingId}__${encodeURIComponent(groupE)}`).set({ rootId, bindingId, chatId: groupE, name: 'RR - Equipo', isGroup: true, active: true });
    await saveWhatsAppAgentObservers.run(asOwner({ groupChatId: groupE, active: true, ownerUserUid: betell, observers: [{ agentId: 'hugo', phone: '' }] }));
    await db.doc(`whatsappInternalGroups/${rootId}`).delete();
  });

  await test('switching-replies-off-stops-new-replies', async () => {
    await setReply(false, 'STANDARD');
    await inbound(groupA, { body: 'Buenas tardes', timestampMs: NOW - 2 * MIN });
    const result = await runGroupReplies(rootId, NOW);
    assert.equal(result.skipped, 'OFF');
  });

  console.log(JSON.stringify({ status: 'PASS', checks: cases.length, cases, emulator: true, realProviderRequests: 0 }));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
