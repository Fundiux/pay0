'use strict';
// Emulator test: what the recovery sweep does after Hugo was offline. Real Firestore emulator, no network.
//   node scripts/run-firebase-clean-env.mjs emulators:exec --config firebase.emulator-tests.json --project demo-pay0 \
//     --only firestore "node qa/scripts/whatsapp-delivery-recovery-emulator.test.cjs"
const assert = require('node:assert/strict');
assert.match(process.env.GCLOUD_PROJECT || '', /^demo-/, 'demo project required');
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/, 'loopback Firestore emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };

const admin = require('../../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { Timestamp } = admin.firestore;
const lib = '../../functions/lib/modules/documentDelivery/';
const { recoverWhatsAppDeliveriesForRoot, evaluateAndStoreDeliveryAlert, noticeUnclaimedToInternalGroup } = require(lib + 'whatsappRecoverySweep.js');
const { RECOVERED_BACKLOG_CUTOFF_MS } = require(lib + 'whatsappDeliveryDomain.js');

const run = `wa-rec-${Date.now()}`;
const rootId = `${run}-root`, bindingId = `${run}-binding`, clientId = `${run}-client`, group = '120363555000000009@g.us';
const NOW = Date.UTC(2026, 10, 25, 16, 0); // Wednesday 10:00 Mexico City, inside Hugo's hours
const at = (ms) => Timestamp.fromMillis(ms);
const checks = [];
const ok = (name, fn) => fn().then(() => checks.push(name));

const job = (id, fields, deliveries) => Promise.all([
  db.doc(`documentDeliveryJobs/${id}`).set({ rootId, channel: 'WHATSAPP', origin: 'AUTOMATIC', clienteId: clientId, clienteNombre: 'Cliente', sourceType: 'DISPERSION_COMPROBANTE', createdAt: at(NOW - 3 * 3600000), ...fields }),
  ...deliveries.map(([deliveryId, data]) => db.doc(`documentDeliveryJobs/${id}/deliveries/${deliveryId}`).set({ rootId, chatId: group, chatName: 'Grupo', ...data })),
]);
const statusOf = async (id, deliveryId) => ({ job: (await db.doc(`documentDeliveryJobs/${id}`).get()).get('status'), delivery: (await db.doc(`documentDeliveryJobs/${id}/deliveries/${deliveryId}`).get()).data() });
const failed = (over = {}) => ({ status: 'ERROR', lastError: 'PRE_SEND_FAILED', errorAt: at(NOW - 20 * 60000), ...over });

(async () => {
  await db.doc(`whatsappAutomationConfigs/${rootId}`).set({ enabled: true, rootId });
  await db.doc(`whatsappQrConnectorBindings/${bindingId}`).set({ id: bindingId, rootId, agentId: 'hugo', state: 'ACTIVE', generation: 1, ownerUid: `${run}-owner` });
  await db.doc(`whatsappQrConnectors/${bindingId}`).set({ bindingId, rootId, status: 'CONNECTED', lastSeenAt: at(NOW - 30 * 1000) });
  await db.doc(`clients/${clientId}`).set({ rootId, nombre: 'Cliente' });

  await ok('failed-pre-send-delivery-returns-to-the-queue-once-with-audit', async () => {
    await job('retry', { status: 'ERROR' }, [['d1', failed()]]);
    const summary = await recoverWhatsAppDeliveriesForRoot(rootId, NOW);
    assert.equal(summary.retried, 1);
    const after = await statusOf('retry', 'd1');
    assert.equal(after.job, 'READY_FOR_SEND');
    assert.equal(after.delivery.status, 'PENDING_SEND');
    assert.equal(after.delivery.autoRetryCount, 1);
    assert.equal(after.delivery.lease ?? null, null);
    const audit = await db.collection('pay0ActivityLog').where('rootId', '==', rootId).where('event', '==', 'WHATSAPP_DOCUMENTO_REINTENTO_AUTOMATICO').get();
    assert.equal(audit.size, 1);
    // A second pass finds nothing to retry: the delivery is already queued.
    assert.equal((await recoverWhatsAppDeliveriesForRoot(rootId, NOW + 60000)).retried, 0);
  });

  await ok('uncertain-permanent-old-attempted-and-exhausted-are-never-touched', async () => {
    await job('uncertain', { status: 'BLOCKED_UNCERTAIN' }, [['d', { status: 'SEND_UNCERTAIN', retryBlocked: true, uncertainReason: 'SEND_FAILED_DURING_ATTEMPT' }]]);
    await job('permanent', { status: 'ERROR' }, [['d', failed({ lastError: 'DESTINATION_INVALID' })]]);
    await job('attempted', { status: 'ERROR' }, [['d', failed({ attemptStartedAtMs: NOW - 60000 })]]);
    await job('exhausted', { status: 'ERROR' }, [['d', failed({ autoRetryCount: 3 })]]);
    await job('old', { status: 'ERROR', createdAt: at(NOW - 30 * 3600000) }, [['d', failed()]]);
    await job('backlog', { status: 'ERROR', createdAt: at(RECOVERED_BACKLOG_CUTOFF_MS - 3600000) }, [['d', failed()]]);
    await job('manual', { status: 'ERROR', origin: 'MANUAL' }, [['d', failed()]]);
    const before = await Promise.all(['uncertain', 'permanent', 'attempted', 'exhausted', 'old', 'backlog', 'manual'].map(async (id) => [id, (await statusOf(id, 'd')).delivery.status]));
    assert.equal((await recoverWhatsAppDeliveriesForRoot(rootId, NOW)).retried, 0);
    for (const [id, status] of before) assert.equal((await statusOf(id, 'd')).delivery.status, status, id);
    assert.equal((await statusOf('uncertain', 'd')).job, 'BLOCKED_UNCERTAIN');
  });

  await ok('recent-failure-waits-for-the-backoff', async () => {
    await job('backoff', { status: 'ERROR' }, [['d', failed({ errorAt: at(NOW - 2 * 60000) })]]);
    await recoverWhatsAppDeliveriesForRoot(rootId, NOW);
    assert.equal((await statusOf('backoff', 'd')).delivery.status, 'ERROR');
  });

  await ok('a-delivery-claimed-or-sent-in-the-same-job-is-left-alone', async () => {
    await job('mixed', { status: 'ERROR_PARTIAL' }, [['sent', { status: 'SENT' }], ['err', failed()]]);
    await recoverWhatsAppDeliveriesForRoot(rootId, NOW);
    assert.equal((await statusOf('mixed', 'sent')).delivery.status, 'SENT');
    assert.equal((await statusOf('mixed', 'err')).delivery.status, 'PENDING_SEND');
    assert.equal((await statusOf('mixed', 'err')).job, 'READY_FOR_SEND');
  });

  await ok('job-waiting-for-group-visibility-is-routed-and-released-when-hugo-sees-the-group', async () => {
    await job('waiting', { status: 'READY_FOR_MANUAL_SEND', targetDestinationsCount: 0, targetResolutionStatus: 'CLIENT_GROUP_NOT_VISIBLE' }, []);
    await job('no-group', { status: 'READY_FOR_MANUAL_SEND', targetDestinationsCount: 0, targetResolutionStatus: 'CLIENT_GROUP_MISSING' }, []);
    // Hugo does not see the group yet: nothing happens and the job keeps waiting.
    await db.doc(`clientWhatsappGroups/${rootId}__${encodeURIComponent(clientId)}`).set({ rootId, clientId, groupChatId: group, groupName: 'Grupo' });
    assert.equal((await recoverWhatsAppDeliveriesForRoot(rootId, NOW)).rerouted, 0);
    assert.equal((await db.doc('documentDeliveryJobs/waiting').get()).get('status'), 'READY_FOR_MANUAL_SEND');
    // Hugo's sync now lists the group.
    await db.doc(`whatsappAgentChats/${bindingId}__${encodeURIComponent(group)}`).set({ rootId, bindingId, chatId: group, isGroup: true, active: true, name: 'Grupo' });
    assert.equal((await recoverWhatsAppDeliveriesForRoot(rootId, NOW)).rerouted, 1);
    assert.equal((await db.doc('documentDeliveryJobs/waiting').get()).get('status'), 'READY_FOR_SEND');
    const deliveries = await db.collection('documentDeliveryJobs/waiting/deliveries').get();
    assert.deepEqual(deliveries.docs.map((doc) => doc.get('status')), ['PENDING_SEND']);
    // A client without an assigned group stays a person's task.
    assert.equal((await db.doc('documentDeliveryJobs/no-group').get()).get('status'), 'READY_FOR_MANUAL_SEND');
  });

  await ok('switch-off-recovers-nothing', async () => {
    const otherRoot = `${run}-off`;
    await db.doc(`whatsappAutomationConfigs/${otherRoot}`).set({ enabled: false, rootId: otherRoot });
    assert.deepEqual(await recoverWhatsAppDeliveriesForRoot(otherRoot, NOW), { retried: 0, rerouted: 0 });
  });

  await ok('alert-turns-on-for-a-missing-heartbeat-and-for-unclaimed-documents-once-per-episode', async () => {
    const alertRoot = `${run}-alert`, alertBinding = `${run}-alert-binding`;
    await db.doc(`whatsappAutomationConfigs/${alertRoot}`).set({ enabled: true, rootId: alertRoot });
    await db.doc(`whatsappQrConnectorBindings/${alertBinding}`).set({ id: alertBinding, rootId: alertRoot, agentId: 'hugo', state: 'ACTIVE', generation: 1, ownerUid: 'o' });
    await db.doc(`whatsappQrConnectors/${alertBinding}`).set({ bindingId: alertBinding, rootId: alertRoot, status: 'CONNECTED', lastSeenAt: at(NOW - 30 * 1000) });
    // Alive and nothing waiting: no alert.
    assert.equal((await evaluateAndStoreDeliveryAlert(alertRoot, NOW)).active, false);
    // Alive but a document released 40 minutes ago is still waiting.
    await db.doc('documentDeliveryJobs/stuck').set({ rootId: alertRoot, channel: 'WHATSAPP', status: 'READY_FOR_SEND', createdAt: at(NOW - 3600000), releasedAt: at(NOW - 40 * 60000) });
    const stuck = await evaluateAndStoreDeliveryAlert(alertRoot, NOW);
    assert.deepEqual([stuck.active, stuck.heartbeatMissing, stuck.unclaimedCount], [true, false, 1]);
    // Heartbeat gone for more than 5 minutes.
    await db.doc(`whatsappQrConnectors/${alertBinding}`).set({ lastSeenAt: at(NOW - 6 * 60000) }, { merge: true });
    const missing = await evaluateAndStoreDeliveryAlert(alertRoot, NOW + 1000);
    assert.equal(missing.heartbeatMissing, true);
    const stored = (await db.doc(`whatsappDeliveryAlerts/${alertRoot}`).get()).data();
    assert.equal(stored.active, true);
    // One audit entry for the whole episode, not one per evaluation.
    const audit = await db.collection('pay0ActivityLog').where('rootId', '==', alertRoot).where('event', '==', 'WHATSAPP_ALERTA_ENVIO_DOCUMENTOS').get();
    assert.equal(audit.size, 1);
    // Outside Hugo's hours (Wednesday 21:00) the alert clears.
    const night = await evaluateAndStoreDeliveryAlert(alertRoot, Date.UTC(2026, 10, 26, 3, 0));
    assert.equal(night.active, false);
    assert.equal((await db.doc(`whatsappDeliveryAlerts/${alertRoot}`).get()).get('active'), false);
  });

  await ok('hugo-alive-but-not-claiming-tells-the-internal-group-once-an-hour-and-never-when-hugo-is-down', async () => {
    const noticeRoot = `${run}-notice`, noticeBinding = `${run}-notice-binding`, internalGroup = '120363555000000077@g.us';
    await db.doc(`whatsappAutomationConfigs/${noticeRoot}`).set({ enabled: true, rootId: noticeRoot });
    await db.doc(`whatsappQrConnectorBindings/${noticeBinding}`).set({ id: noticeBinding, rootId: noticeRoot, agentId: 'hugo', state: 'ACTIVE', generation: 1, ownerUid: 'o' });
    await db.doc(`whatsappQrConnectors/${noticeBinding}`).set({ bindingId: noticeBinding, rootId: noticeRoot, status: 'CONNECTED', lastSeenAt: at(NOW - 30 * 1000) });
    await db.doc('documentDeliveryJobs/waiting-too-long').set({ rootId: noticeRoot, channel: 'WHATSAPP', status: 'READY_FOR_SEND', createdAt: at(NOW - 3600000), releasedAt: at(NOW - 40 * 60000) });
    const notices = async () => (await db.collection('documentDeliveryJobs').where('rootId', '==', noticeRoot).where('sourceType', '==', 'AVISO_GRUPO_INTERNO').get()).docs;
    // No internal group configured: nothing is queued.
    assert.equal((await evaluateAndStoreDeliveryAlert(noticeRoot, NOW)).unclaimedCount, 1);
    assert.equal((await notices()).length, 0);
    // The internal group exists but Hugo does not see it yet: nothing is queued.
    await db.doc(`whatsappInternalGroups/${noticeRoot}__${encodeURIComponent(noticeRoot)}`).set({ rootId: noticeRoot, ownerAdminId: noticeRoot, groupChatId: internalGroup, groupName: 'Interno' });
    await evaluateAndStoreDeliveryAlert(noticeRoot, NOW + 1000);
    assert.equal((await notices()).length, 0);
    // Hugo sees it: one notice, a ready TEXT delivery to that group with only counts in it.
    await db.doc(`whatsappAgentChats/${noticeBinding}__${encodeURIComponent(internalGroup)}`).set({ rootId: noticeRoot, bindingId: noticeBinding, chatId: internalGroup, isGroup: true, active: true, name: 'Interno' });
    await evaluateAndStoreDeliveryAlert(noticeRoot, NOW + 2000);
    const queued = await notices();
    assert.equal(queued.length, 1);
    const job = queued[0].data();
    assert.equal(job.status, 'READY_FOR_SEND');
    assert.match(job.textBody, /^Aviso: 1 documento para un cliente lleva más de 15 minutos/);
    const deliveries = await queued[0].ref.collection('deliveries').get();
    assert.deepEqual(deliveries.docs.map((doc) => [doc.get('status'), doc.get('chatId')]), [['PENDING_SEND', internalGroup]]);
    // Evaluating again within the hour does not queue another one.
    await evaluateAndStoreDeliveryAlert(noticeRoot, NOW + 10 * 60000);
    assert.equal((await notices()).length, 1);
    // Direct calls: too soon, and the heartbeat-missing alert never sends (the notice would leave through Hugo).
    assert.equal(await noticeUnclaimedToInternalGroup(noticeRoot, { active: true, heartbeatMissing: false, unclaimedCount: 1, oldestUnclaimedMinutes: 20 }, NOW + 20 * 60000, NOW + 2000), 'TOO_SOON');
    assert.equal(await noticeUnclaimedToInternalGroup(noticeRoot, { active: true, heartbeatMissing: true, unclaimedCount: 3, oldestUnclaimedMinutes: 50 }, NOW + 2 * 3600000, 0), 'NOT_NEEDED');
    assert.equal(await noticeUnclaimedToInternalGroup(noticeRoot, { active: false, heartbeatMissing: false, unclaimedCount: 0, oldestUnclaimedMinutes: 0 }, NOW + 2 * 3600000, 0), 'NOT_NEEDED');
    // An hour later and still stuck: the next notice goes out.
    assert.equal(await noticeUnclaimedToInternalGroup(noticeRoot, { active: true, heartbeatMissing: false, unclaimedCount: 2, oldestUnclaimedMinutes: 100 }, NOW + 61 * 60000, NOW + 2000), 'SENT');
    assert.equal((await notices()).length, 2);
  });

  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, cases: checks, emulator: true, realProviderRequests: 0 }));
})().catch((error) => { console.error('FAIL', error && error.stack || error); process.exit(1); });
