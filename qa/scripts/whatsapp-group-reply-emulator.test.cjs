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
const { runGroupReplies, replyConfigId, replyJobId } = require(lib + 'whatsappAutoReply/runner.js');
const { getWhatsAppAgentPlaybook, decideWhatsAppPlaybookEntry } = require(lib + 'whatsappAutoReply/playbookCallables.js');
const { setWhatsAppReplySimulation, getWhatsAppSimulatedReplies } = require(lib + 'whatsappAutoReply/simulationCallables.js');
const { setSimulationModelForTests } = require(lib + 'whatsappAutoReply/simulationRunner.js');
const { mexicoDayStartMs } = require(lib + 'documentDelivery/whatsappDeliveryDomain.js');
const { runUnansweredAlerts } = require(lib + 'whatsappAutoReply/unansweredRunner.js');
const { operatorAuthorHashes, REPLY_TEXT_VARIANTS } = require(lib + 'whatsappAutoReply/domain.js');
const { saveWhatsAppAgentObservers, getWhatsAppAgentObservers } = require(lib + 'documentDelivery/whatsappObserverCallables.js');
const { setWhatsAppGroupAgentMode, getWhatsAppAgentReplyMetrics, markWhatsAppReplyCorrection } = require(lib + 'whatsappAutoReply/modeCallables.js');
const { createWorkerKey, createAuthorityTransport } = require('../../tools/whatsapp-qr-connector/connectorAuthority.cjs');

const run = `wa-reply-${Date.now()}`;
const rootId = `${run}-root`, ownerUid = `${run}-owner`, betell = `${run}-betell`;
const groupA = '120363555000000001@g.us', groupB = '120363555000000002@g.us', groupC = '120363555000000003@g.us', groupD = '120363555000000004@g.us', groupE = '120363555000000005@g.us', groupF = '120363555000000006@g.us', groupG = '120363555000000007@g.us', groupH = '120363555000000008@g.us', groupI = '120363555000000009@g.us', groupJ = '120363555000000010@g.us', groupK = '120363555000000011@g.us', groupL = '120363555000000012@g.us', groupM = '120363555000000013@g.us', groupN = '120363555000000014@g.us', groupP = '120363555000000015@g.us';
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
// Observer mode is the default; the existing cases need Hugo acting, so the helper switches it on unless told otherwise.
const observe = (chatId, name, ownerUserUid, over = {}) => db.doc(`whatsappAgentObservers/${rootId}__${encodeURIComponent(chatId)}`).set({
  rootId, groupChatId: chatId, groupName: name, active: true, ...(ownerUserUid ? { ownerUserUid } : {}), observers: [{ agentId: 'hugo', phone: '' }], agentModes: { hugo: 'ACTING' }, ...over });
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
    assert.equal(job.textBody, 'Buen día, {{MENCION}}.');
    assert.equal(job.mentionInboundMessageId, greeting.split('__')[1], 'the greeting mentions whoever wrote; no number is stored');
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
    assert.equal(d.text, 'Buen día, {{MENCION}}.');
    assert.ok(d.mention && /^msg-\d+$/.test(d.mention.messageId), 'the claim carries the message to mention, not a number');
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
    assert.equal((await jobsFor(hello))[0].data().textBody, 'Buen día, {{MENCION}}.');
  });

  const asOwner = data => ({ auth: { uid: ownerUid }, data });
  const internalDoc = (ownerAdminId, data) => db.doc(`whatsappInternalGroups/${rootId}__${encodeURIComponent(ownerAdminId)}`).set({ rootId, ownerAdminId, ...data });
  const adminUid = `${run}-admin`;
  await test('no-internal-group-of-the-root-is-ever-answered', async () => {
    for (const [chatId, name] of [[groupE, 'RR - Equipo'], [groupF, 'Equipo admin']]) await db.doc(`whatsappAgentChats/${bindingId}__${encodeURIComponent(chatId)}`).set({ rootId, bindingId, chatId, name, isGroup: true, active: true });
    await setReply(true, 'STANDARD');
    // Observer rows written before the groups became internal must not make Hugo answer there.
    await observe(groupE, 'RR - Equipo', betell);
    await observe(groupF, 'Equipo admin', betell);
    await inbound(groupE, { timestampMs: NOW - 80 * HOUR, body: 'hola' });
    await inbound(groupF, { timestampMs: NOW - 80 * HOUR, body: 'hola' });
    const helloE = await inbound(groupE), helloF = await inbound(groupF);
    await internalDoc(ownerUid, { groupChatId: groupE, groupName: 'RR - Equipo' });
    await internalDoc(adminUid, { groupChatId: groupF, groupName: 'Equipo admin' });
    await runGroupReplies(rootId, NOW);
    assert.equal((await jobsFor(helloE)).length, 0);
    assert.equal((await jobsFor(helloF)).length, 0);
  });

  await test('no-internal-group-can-be-assigned-to-a-user', async () => {
    for (const chatId of [groupE, groupF]) await assert.rejects(() => saveWhatsAppAgentObservers.run(asOwner({ groupChatId: chatId, active: true, ownerUserUid: betell, observers: [{ agentId: 'hugo', phone: '' }] })), error => /grupo interno/.test(String(error.message)));
  });

  await test('an-empty-or-foreign-internal-group-document-blocks-nothing', async () => {
    await internalDoc(ownerUid, { groupChatId: '', groupName: '' });
    await internalDoc(adminUid, { groupChatId: '', groupName: '' });
    await db.doc(`whatsappInternalGroups/other-root__${encodeURIComponent(adminUid)}`).set({ rootId: 'other-root', ownerAdminId: adminUid, groupChatId: groupE, groupName: 'Otro' });
    await saveWhatsAppAgentObservers.run(asOwner({ groupChatId: groupE, active: true, ownerUserUid: betell, observers: [{ agentId: 'hugo', phone: '' }] }));
    await db.doc(`whatsappInternalGroups/other-root__${encodeURIComponent(adminUid)}`).delete();
  });

  const asOwner2 = data => ({ auth: { uid: ownerUid }, data });
  const chatDoc = (chatId, name) => db.doc(`whatsappAgentChats/${bindingId}__${encodeURIComponent(chatId)}`).set({ rootId, bindingId, chatId, name, isGroup: true, active: true });
  await test('observer-is-the-default-and-nothing-is-queued', async () => {
    await setReply(true, 'STANDARD');
    await chatDoc(groupG, 'Grupo modos');
    await observe(groupG, 'Grupo modos', betell, { agentModes: {} });
    const hello = await inbound(groupG);
    await runGroupReplies(rootId, NOW);
    assert.equal((await jobsFor(hello)).length, 0);
  });

  await test('switching-to-acting-queues-the-greeting-and-records-the-measurement', async () => {
    const changed = await setWhatsAppGroupAgentMode.run(asOwner2({ groupChatId: groupG, agentId: 'hugo', mode: 'ACTING' }));
    assert.equal(changed.agentModes.hugo, 'ACTING');
    await runGroupReplies(rootId, NOW);
    const [hello] = (await db.collection('whatsappInboundMessages').where('rootId', '==', rootId).where('chatId', '==', groupG).get()).docs;
    const [job] = await jobsFor(hello.id);
    assert.ok(job, 'greeting job');
    const metric = (await db.doc(`whatsappAgentReplyMetrics/${job.id}`).get()).data();
    assert.equal(metric.kind, 'GREETING');
    assert.equal(metric.agentId, 'hugo');
    assert.equal(metric.aiTokens, 0);
    assert.equal(metric.responseMs, MIN);
    assert.equal(metric.monthKey, '2026-11');
    assert.equal(metric.humanCorrection, false);
  });

  await test('a-second-greeting-the-same-day-is-not-sent', async () => {
    const again = await inbound(groupG, { body: 'Buenas tardes', timestampMs: NOW - 30 * 1000 });
    await runGroupReplies(rootId, NOW);
    assert.equal((await jobsFor(again)).length, 0);
  });

  await test('maria-and-sofia-cannot-act-and-hugo-observer-needs-a-reason', async () => {
    await observe(groupG, 'Grupo modos', betell, { observers: [{ agentId: 'hugo', phone: '' }, { agentId: 'maria', phone: '' }, { agentId: 'sofia', phone: '' }], agentModes: { hugo: 'ACTING' } });
    for (const agentId of ['maria', 'sofia']) await assert.rejects(() => setWhatsAppGroupAgentMode.run(asOwner2({ groupChatId: groupG, agentId, mode: 'ACTING' })), error => /apagado/.test(String(error.message)));
    await assert.rejects(() => setWhatsAppGroupAgentMode.run(asOwner2({ groupChatId: groupG, agentId: 'hugo', mode: 'OBSERVER' })), error => /motivo/.test(String(error.message)));
    await assert.rejects(() => setWhatsAppGroupAgentMode.run({ auth: { uid: betell }, data: { groupChatId: groupG, agentId: 'hugo', mode: 'OBSERVER', reason: 'prueba' } }));
    await assert.rejects(() => setWhatsAppGroupAgentMode.run(asOwner2({ groupChatId: groupG, agentId: 'iq', mode: 'ACTING' })));
  });

  await test('returning-hugo-to-observer-stops-replies-and-is-measured', async () => {
    const back = await setWhatsAppGroupAgentMode.run(asOwner2({ groupChatId: groupG, agentId: 'hugo', mode: 'OBSERVER', reason: 'Respondió mal a un cliente' }));
    assert.deepEqual(back.agentModes, {});
    const later = await inbound(groupG, { body: 'Buenos días', timestampMs: NOW + 24 * HOUR - 20 * 1000 });
    await runGroupReplies(rootId, NOW + 24 * HOUR);
    assert.equal((await jobsFor(later)).length, 0);
    const report = await getWhatsAppAgentReplyMetrics.run(asOwner2({ month: '2026-11' }));
    const total = report.buckets.find(row => row.agentId === 'hugo' && row.chatId === null);
    assert.ok(total.replies >= 1);
    assert.equal(total.returnsToObserver, 1);
    assert.deepEqual(total.returnReasons, ['Respondió mal a un cliente']);
    assert.ok(report.buckets.some(row => row.agentId === 'hugo' && row.chatId === groupG));
  });

  await test('a-person-can-mark-a-reply-as-corrected', async () => {
    const [metric] = (await db.collection('whatsappAgentReplyMetrics').where('rootId', '==', rootId).limit(1).get()).docs;
    await markWhatsAppReplyCorrection.run(asOwner2({ jobId: metric.id }));
    assert.equal((await db.doc(`whatsappAgentReplyMetrics/${metric.id}`).get()).data().humanCorrection, true);
    const total = (await getWhatsAppAgentReplyMetrics.run(asOwner2({ month: '2026-11' }))).buckets.find(row => row.agentId === 'hugo' && row.chatId === null);
    assert.ok(total.humanCorrections >= 1);
    await assert.rejects(() => markWhatsAppReplyCorrection.run(asOwner2({ jobId: 'no-existe' })));
  });

  await test('the-real-lookup-decides-processing-or-request-data', async () => {
    await setReply(true, 'STANDARD');
    for (const [chatId, name, clienteId] of [[groupH, 'Cliente con factura', 'cli-con'], [groupI, 'Cliente sin registros', 'cli-sin']]) {
      await chatDoc(chatId, name);
      await db.doc(`clientWhatsappGroups/${rootId}__${clienteId}`).set({ rootId, clienteId, groupChatId: chatId, groupName: name });
      await observe(chatId, name, betell);
      await inbound(chatId, { timestampMs: NOW - 80 * HOUR, body: 'hola' });
    }
    await db.doc('solicitudes/sol-lookup-1').set({ rootId, clienteId: 'cli-con', status: 'EN_PROCESO', folio: 'S1LOOKUP' });
    const invoiceQuestion = await inbound(groupH, { body: '¿Hay avance de mi factura?', timestampMs: NOW - 5 * MIN });
    const transferQuestion = await inbound(groupI, { body: '¿Ya salió mi transferencia?', timestampMs: NOW - 5 * MIN });
    await runGroupReplies(rootId, NOW);
    const [processing] = await jobsFor(invoiceQuestion), [requestData] = await jobsFor(transferQuestion);
    assert.equal(processing.data().replyKind, 'PROCESSING');
    assert.equal(requestData.data().replyKind, 'REQUEST_DATA');
    assert.equal((await db.doc(`whatsappAgentReplyMetrics/${requestData.id}`).get()).data().escalated, true);
    assert.equal((await db.doc(`whatsappAgentReplyMetrics/${processing.id}`).get()).data().escalated, false);
  });

  await test('an-answered-subject-is-not-repeated-within-the-cooldown', async () => {
    const repeat = await inbound(groupH, { body: '¿Hay avance de mi factura?', timestampMs: NOW - 4 * MIN });
    await runGroupReplies(rootId, NOW + 2 * MIN);
    assert.equal((await jobsFor(repeat)).length, 0);
  });

  await test('an-unanswered-question-becomes-a-masked-lesson-once', async () => {
    await chatDoc(groupK, 'Grupo lecciones');
    await observe(groupK, 'Grupo lecciones', betell);
    await inbound(groupK, { timestampMs: NOW - 80 * HOUR, body: 'hola' });
    const missed = await inbound(groupK, { body: '¿Ya salió mi transferencia de $45,000 a Juan Pérez?', timestampMs: NOW - 32 * MIN });
    await runGroupReplies(rootId, NOW);
    await runGroupReplies(rootId, NOW + MIN);
    const lessons = (await db.collection('whatsappAgentLessons').where('rootId', '==', rootId).where('type', '==', 'MISSED_QUESTION').get()).docs.filter(doc => doc.get('chatId') === groupK);
    assert.equal(lessons.length, 1);
    assert.equal(lessons[0].get('kind'), 'STATUS_INQUIRY');
    assert.equal(lessons[0].get('subject'), 'TRANSFER');
    assert.equal(lessons[0].get('groupName'), 'Grupo lecciones');
    assert.ok(!/\d|juan/i.test(lessons[0].get('phrase')), 'the stored phrase is masked');
    assert.equal(missed.length > 0, true);
  });

  await test('a-person-answering-where-hugo-stayed-silent-teaches-from-an-observer-group', async () => {
    const groupQ = '120363555000000016@g.us';
    // Observer mode (the default): Hugo says nothing here, and it must still learn from what the team does.
    await observe(groupQ, 'Grupo observado', betell, { agentModes: {} });
    const answer = (clientBody, minutesAgo, answered = true) => (async () => {
      const client = await inbound(groupQ, { body: clientBody, timestampMs: NOW - minutesAgo * MIN });
      if (answered) await inbound(groupQ, { body: 'Claro, ya lo vemos', authorHash: operatorHash, timestampMs: NOW - (minutesAgo - 2) * MIN });
      return client;
    })();
    const first = await answer('Buenos días', 34), second = await answer('Buenas tardes', 29), third = await answer('Hola buen día', 24), nobody = await answer('Buen día, ¿me ayudan?', 12, false);
    const result = await runGroupReplies(rootId, NOW);
    assert.equal(result.queued, 0, 'an observer group is never answered');
    for (const id of [first, second, third, nobody]) assert.equal((await db.doc(`documentDeliveryJobs/${replyJobId(rootId, id)}`).get()).exists, false);
    const lessons = (await db.collection('whatsappAgentLessons').where('rootId', '==', rootId).where('type', '==', 'HUMAN_ANSWERED').get()).docs.filter(doc => doc.get('chatId') === groupQ);
    assert.equal(lessons.length, 3, 'one per client message a person answered, none for the one nobody answered');
    assert.ok(lessons.every(doc => doc.get('actingGroup') === false && doc.get('kind') === 'GREETING'));
    await runGroupReplies(rootId, NOW + MIN);
    assert.equal((await db.collection('whatsappAgentLessons').where('rootId', '==', rootId).where('type', '==', 'HUMAN_ANSWERED').get()).docs.filter(doc => doc.get('chatId') === groupQ).length, 3, 'running again repeats nothing');
    const entries = (await getWhatsAppAgentPlaybook.run({ auth: { uid: ownerUid }, data: {} })).entries.filter(e => e.chatId === groupQ && e.type === 'HUMAN_ANSWERED');
    assert.equal(entries.length, 1, 'three cases in the group become one proposal');
    assert.equal(entries[0].status, 'PROPOSED'); assert.equal(entries[0].evidenceCount, 3);
  });

  await test('a-correction-keeps-the-reason-per-group-and-unmarking-removes-it', async () => {
    const [metric] = (await db.collection('whatsappAgentReplyMetrics').where('rootId', '==', rootId).limit(1).get()).docs;
    await markWhatsAppReplyCorrection.run({ auth: { uid: ownerUid }, data: { jobId: metric.id, reason: 'Dijo que estaba en proceso y no era cierto', category: 'WRONG_FACT' } });
    const lesson = (await db.doc(`whatsappAgentLessons/corr__${metric.id}`).get()).data();
    assert.equal(lesson.type, 'CORRECTION'); assert.equal(lesson.category, 'WRONG_FACT');
    assert.equal(lesson.chatId, metric.get('chatId')); assert.equal(lesson.reason, 'Dijo que estaba en proceso y no era cierto');
    await markWhatsAppReplyCorrection.run({ auth: { uid: ownerUid }, data: { jobId: metric.id, corrected: false } });
    assert.equal((await db.doc(`whatsappAgentLessons/corr__${metric.id}`).get()).exists, false);
  });

  await test('an-unanswered-question-is-told-to-the-team-after-3-min-and-every-5-min-until-answered', async () => {
    await chatDoc(groupL, 'Contabilidad Oil');
    await db.doc(`clientWhatsappGroups/${rootId}__cli-alerta`).set({ rootId, clienteId: 'cli-alerta', groupChatId: groupL, groupName: 'Contabilidad Oil' });
    await observe(groupL, 'Contabilidad Oil', betell, { agentModes: {} }); // observer mode still alerts the team
    await inbound(groupL, { timestampMs: NOW - 80 * HOUR, body: 'hola' });
    const mine = [];
    const deliver = async input => { if (input.clienteId === 'cli-alerta') mine.push(input); return 'OK'; };
    const step = async at => { const before = mine.length; await runUnansweredAlerts(rootId, at, deliver); return mine.length - before; };
    await inbound(groupL, { body: '¿Ya salió mi transferencia?', timestampMs: NOW - 2 * MIN });
    assert.equal(await step(NOW), 0, 'not yet 3 minutes');
    assert.equal(await step(NOW + 2 * MIN), 1);
    assert.match(mine[0].textBody, /«Contabilidad Oil»/); assert.match(mine[0].textBody, /más de 3 minutos/); assert.match(mine[0].textBody, /¿Ya salió mi transferencia\?/);
    assert.equal(await step(NOW + 3 * MIN), 0, 'no repeat before 5 minutes');
    assert.equal(await step(NOW + 7 * MIN), 1);
    assert.match(mine[1].textBody, /Recordatorio/); assert.notEqual(mine[0].sourceId, mine[1].sourceId);
    assert.equal(await step(NOW + 12 * MIN), 1);
    await inbound(groupL, { fromMe: true, authorHash: null, body: 'Ya lo estamos revisando', timestampMs: NOW + 13 * MIN });
    assert.equal(await step(NOW + 13 * MIN + 30000), 0);
    assert.equal(await step(NOW + 20 * MIN), 0);
    assert.equal(mine.length, 3);
    const [alert] = (await db.collection('whatsappAgentUnansweredAlerts').where('rootId', '==', rootId).where('chatId', '==', groupL).get()).docs;
    assert.equal(alert.get('status'), 'ANSWERED');
  });

  await test('three-corrections-in-a-group-become-a-proposal-only-the-owner-decides', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const id = `reply_playbook_${i}`; ids.push(id);
      await db.doc(`whatsappAgentReplyMetrics/${id}`).set({ rootId, agentId: 'hugo', chatId: groupL, groupName: 'Contabilidad Oil', kind: 'PROCESSING', subject: 'TRANSFER', monthKey: '2026-11', humanCorrection: false });
    }
    const call = (fn, uid, data) => fn.run({ auth: { uid }, data });
    for (const id of ids.slice(0, 2)) await call(markWhatsAppReplyCorrection, ownerUid, { jobId: id, reason: 'Dijo que estaba en proceso y no era cierto', category: 'WRONG_FACT' });
    assert.equal((await call(getWhatsAppAgentPlaybook, ownerUid, {})).entries.filter(e => e.chatId === groupL && e.type === 'CORRECTION').length, 0, 'two cases are not enough');
    await call(markWhatsAppReplyCorrection, ownerUid, { jobId: ids[2], reason: 'Otra vez dijo que estaba en proceso', category: 'WRONG_FACT' });
    const entries = (await call(getWhatsAppAgentPlaybook, ownerUid, {})).entries.filter(e => e.chatId === groupL && e.type === 'CORRECTION');
    assert.equal(entries.length, 1); const [entry] = entries;
    assert.equal(entry.status, 'PROPOSED'); assert.equal(entry.evidenceCount, 3); assert.equal(entry.category, 'WRONG_FACT'); assert.ok(entry.suggestedGuidance);
    // Only the owner: a user without the role cannot read or decide.
    await assert.rejects(() => call(getWhatsAppAgentPlaybook, betell, {}));
    await assert.rejects(() => call(decideWhatsAppPlaybookEntry, betell, { id: entry.id, decision: 'APPROVE', guidance: entry.suggestedGuidance }));
    // The guidance is validated: no numbers, nothing internal.
    await assert.rejects(() => call(decideWhatsAppPlaybookEntry, ownerUid, { id: entry.id, decision: 'APPROVE', guidance: 'Decir que son $540,000 de retorno' }), error => /cifras/.test(String(error.message)));
    await assert.rejects(() => call(decideWhatsAppPlaybookEntry, ownerUid, { id: entry.id, decision: 'APPROVE', guidance: 'Avisar que lo validamos con IQ primero' }), error => /IQ/.test(String(error.message)));
    const approved = await call(decideWhatsAppPlaybookEntry, ownerUid, { id: entry.id, decision: 'APPROVE', guidance: entry.suggestedGuidance });
    assert.equal(approved.status, 'APPROVED'); assert.ok(approved.simulationEndsAtMs > Date.now() + 2.9 * 24 * HOUR);
    await assert.rejects(() => call(decideWhatsAppPlaybookEntry, ownerUid, { id: entry.id, decision: 'REJECT' }), error => /ya fue decidida/.test(String(error.message)));
    // A fourth case refreshes nothing once decided, and a decided entry keeps its guidance.
    const after = (await call(getWhatsAppAgentPlaybook, ownerUid, {})).entries.find(e => e.id === entry.id);
    assert.equal(after.status, 'APPROVED'); assert.equal(after.guidance, entry.suggestedGuidance);
  });

  await test('simulation-stores-guarded-drafts-and-never-queues-or-sends-anything', async () => {
    const prompts = [];
    setSimulationModelForTests(async ({ system, prompt }) => {
      prompts.push({ system, prompt });
      if (/alfa/.test(prompt)) return { text: 'Son 5,000 pesos los que le depositamos.', tokens: 40 };
      if (/beta/.test(prompt)) return { text: 'Lo validamos con IQ y le avisamos.', tokens: 40 };
      if (/gamma/.test(prompt)) return { text: 'Se lo mandamos hoy mismo, se lo prometemos.', tokens: 40 };
      if (/delta/.test(prompt)) return { text: 'Su transferencia ya está en proceso.', tokens: 40 };
      return { text: 'Con gusto, permítanos validarlo y le confirmamos en cuanto lo tengamos.', tokens: 55 };
    });
    const ownerCall = (fn, data) => fn.run({ auth: { uid: ownerUid }, data });
    const approve = (chatId, over = {}) => db.doc(`whatsappAgentPlaybooks/pb_sim_${chatId.slice(-8, -5)}`).set({ rootId, chatId, groupName: 'Grupo sim', status: 'APPROVED', guidance: 'Responder con amabilidad y avisar al equipo.', simulationEndsAtMs: NOW + 2 * 24 * HOUR, ...over });
    await setReply(true, 'GREETINGS_ONLY');
    for (const [chatId, name] of [[groupM, 'Grupo sim'], [groupN, 'Grupo tope'], [groupP, 'Grupo vencido']]) {
      await chatDoc(chatId, name); await observe(chatId, name, betell); await inbound(chatId, { timestampMs: NOW - 80 * HOUR, body: 'hola' });
    }
    await approve(groupM); await approve(groupN); await approve(groupP, { simulationEndsAtMs: NOW - 1 });
    const ask = (chatId, body) => inbound(chatId, { body, timestampMs: NOW - 5 * MIN });
    const simId = id => `whatsappAgentSimulatedReplies/sim__${rootId.slice(0, 40)}__${id}`;
    const stored = async () => (await db.collection('whatsappAgentSimulatedReplies').where('rootId', '==', rootId).get()).docs;
    const before = (await stored()).length;

    // Off by default.
    const good = await ask(groupM, '¿Ya salió mi transferencia, soy Juan Pérez, folio 12345 por $45,000?');
    await runGroupReplies(rootId, NOW);
    assert.equal((await stored()).length, before, 'simulation is off by default');

    // On: a usable draft is stored, from a masked prompt, and nothing is queued for the client.
    assert.equal((await ownerCall(setWhatsAppReplySimulation, { enabled: true })).enabled, true);
    await assert.rejects(() => setWhatsAppReplySimulation.run({ auth: { uid: betell }, data: { enabled: true } }));
    await runGroupReplies(rootId, NOW);
    const goodDoc = (await db.doc(simId(good)).get()).data();
    assert.equal(goodDoc.status, 'SIMULATED'); assert.equal(goodDoc.usable, true); assert.equal(goodDoc.sentToClient, false); assert.equal(goodDoc.tokens, 55);
    assert.match(goodDoc.draft, /permítanos validarlo/);
    assert.ok(prompts.length >= 1 && prompts.every(({ prompt }) => !/12345|45,000|juan|pérez|Grupo sim/i.test(prompt) && /Responder con amabilidad/.test(prompt)), 'the prompt is masked and carries only the approved guidance');
    assert.ok(!/12345|juan/i.test(goodDoc.clientPhrase));
    await runGroupReplies(rootId, NOW);
    assert.equal(prompts.length, 1, 'the model is called once per message');

    // Bad drafts are kept apart and never usable.
    const rejected = [];
    for (const word of ['alfa', 'beta', 'gamma', 'delta']) rejected.push(await ask(groupM, `¿Ya salió mi transferencia ${word}?`));
    await runGroupReplies(rootId, NOW); await runGroupReplies(rootId, NOW);
    for (const id of rejected) {
      const doc = (await db.doc(simId(id)).get()).data();
      assert.equal(doc.status, 'REJECTED_BY_GUARD'); assert.equal(doc.usable, false); assert.equal(doc.draft, null); assert.ok(doc.guardReasons.length > 0);
    }
    const listing = await ownerCall(getWhatsAppSimulatedReplies, {});
    assert.equal(listing.enabled, true);
    assert.equal(listing.replies.filter(row => row.status === 'REJECTED_BY_GUARD').every(row => row.usable === false && row.draft === null), true);
    assert.equal(listing.replies.filter(row => row.usable).length >= 1, true);

    // Nothing was ever queued as a delivery job for any simulated message.
    for (const id of [good, ...rejected]) assert.equal((await jobsFor(id)).length, 0, 'no delivery job for a simulated message');

    // Daily cap per group, and an expired playbook simulates nothing.
    const day = String(mexicoDayStartMs(NOW));
    for (let i = 0; i < 10; i++) await db.doc(`whatsappAgentSimulatedReplies/cap_${i}`).set({ rootId, chatId: groupN, dayKey: day, status: 'SIMULATED' });
    const capped = await ask(groupN, '¿Hay avance de mi factura?'), expired = await ask(groupP, '¿Hay avance de mi factura?');
    await runGroupReplies(rootId, NOW);
    for (const id of [capped, expired]) assert.equal((await db.doc(simId(id)).get()).exists, false);

    // Kill switch.
    await ownerCall(setWhatsAppReplySimulation, { enabled: false });
    const late = await ask(groupM, '¿Ya salió mi transferencia de nuevo?');
    await runGroupReplies(rootId, NOW);
    assert.equal((await db.doc(simId(late)).get()).exists, false);
    setSimulationModelForTests(null);
    await setReply(true, 'STANDARD');
  });

  await test('an-agents-own-number-is-never-answered', async () => {
    await chatDoc(groupJ, 'Grupo agentes');
    await observe(groupJ, 'Grupo agentes', betell, { observers: [{ agentId: 'hugo', phone: '525522222222' }] });
    await inbound(groupJ, { timestampMs: NOW - 80 * HOUR, body: 'hola' });
    const fromAgent = await inbound(groupJ, { authorHash: [...operatorAuthorHashes(rootId, ['525522222222'])][0], body: 'Buenos días', timestampMs: NOW - 2 * MIN });
    await runGroupReplies(rootId, NOW);
    assert.equal((await jobsFor(fromAgent)).length, 0);
  });

  await test('observer-callables-limit-and-filter-the-agents', async () => {
    const save = observers => saveWhatsAppAgentObservers.run(asOwner2({ groupChatId: groupG, active: true, ownerUserUid: betell, observers }));
    await assert.rejects(() => save([{ agentId: 'iq', phone: '' }]), error => /Agente desconocido/.test(String(error.message)));
    await assert.rejects(() => save([{ agentId: 'hugo', phone: '' }, { agentId: 'hugo', phone: '' }]), error => /solo puede aparecer una vez/.test(String(error.message)));
    await assert.rejects(() => save(Array.from({ length: 11 }, () => ({ agentId: 'hugo', phone: '' }))), error => /máximo 10/.test(String(error.message)));
    const listing = await getWhatsAppAgentObservers.run(asOwner2({}));
    assert.deepEqual(listing.agents.map(row => row.id).sort(), ['hugo', 'maria', 'sofia']);
    assert.ok(listing.configs.every(row => typeof row.agentModes === 'object'));
    // Saving the group again keeps only the modes of agents that are still in it.
    await observe(groupG, 'Grupo modos', betell, { observers: [{ agentId: 'hugo', phone: '' }, { agentId: 'maria', phone: '' }], agentModes: { hugo: 'ACTING', maria: 'ACTING' } });
    await save([{ agentId: 'hugo', phone: '' }]);
    assert.deepEqual((await db.doc(`whatsappAgentObservers/${rootId}__${encodeURIComponent(groupG)}`).get()).data().agentModes, { hugo: 'ACTING' });
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
