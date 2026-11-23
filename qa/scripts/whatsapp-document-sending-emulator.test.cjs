'use strict';
// Emulator test: automatic job creation, Hugo-only claim with lease, report, double-send prevention
// and uncertain-result blocking. Real Firestore emulator, real Ed25519 signatures, fake Storage signer
// and a fake WhatsApp client. No network beyond loopback.
//   node scripts/run-firebase-clean-env.mjs emulators:exec --config firebase.emulator-tests.json --project demo-pay0 \
//     --only auth,firestore,storage "node qa/scripts/whatsapp-document-sending-emulator.test.cjs"
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
assert.match(process.env.GCLOUD_PROJECT || '', /^demo-/, 'demo project required');
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/, 'loopback Firestore emulator required');
global.fetch = async () => { throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };

const admin = require('../../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const lib = '../../functions/lib/modules/documentDelivery/';
const { WhatsAppConnectorAuthority } = require(lib + 'whatsappConnectorAuthority.js');
const policy = require(lib + 'whatsappConnectorPolicy.js');
const { queueAutomaticClientDelivery } = require(lib + 'whatsappAutomaticDelivery.js');
const { processWhatsAppInvoiceAutomation } = require(lib + 'whatsappAutomationTrigger.js');
const { releaseWhatsAppJobDeliveriesCore, resolveWhatsAppUncertainDelivery } = require(lib + 'whatsappReleaseCallables.js');
const { setWhatsAppAutomationEnabled } = require(lib + 'whatsappAutomationCallables.js');
const { mexicoDayStartMs } = require(lib + 'whatsappDeliveryDomain.js');
const { createWorkerKey, createAuthorityTransport } = require('../../tools/whatsapp-qr-connector/connectorAuthority.cjs');
const { runEnrolledConnector } = require('../../tools/whatsapp-qr-connector/enrolledConnector.cjs');

const run = `wa-send-${Date.now()}`;
const rootId = `${run}-root`, ownerUid = `${run}-owner`, clientId = `${run}-client`, group = '120363555000000001@g.us';
const signed = [];
const signUrl = async (storagePath) => { signed.push(storagePath); return `https://signed.invalid/${encodeURIComponent(storagePath)}`; };
let open = true;
const service = new WhatsAppConnectorAuthority(db, { signUrl, isOpen: () => open });
const fakeFetch = async (url, options) => {
  const body = JSON.parse(options.body), name = url.split('/').at(-1);
  const result = name === 'consumeWhatsAppConnectorEnrollment' ? await service.consume(body.data) : await service.operate(body.data.envelope, body.data.data);
  return { ok: true, json: async () => ({ result }) };
};
const transportFor = (privateKeyPem, binding) => createAuthorityTransport({ baseUrl: 'https://authority.invalid', privateKeyPem, binding, policy, fetchImpl: fakeFetch });
const cases = [];
const test = async (name, fn) => { await fn(); cases.push(name); };
const job = async id => (await db.doc(`documentDeliveryJobs/${id}`).get()).data();
const deliveriesOf = async id => (await db.collection(`documentDeliveryJobs/${id}/deliveries`).get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
const events = async (jobId, event) => (await db.collection('pay0ActivityLog').where('referenceId', '==', jobId).where('event', '==', event).get()).size;

async function enroll(agentId) {
  const key = createWorkerKey();
  const created = await service.create({ auth: { uid: ownerUid }, data: { publicKeyPem: key.publicKeyPem, agentId } });
  const transport = transportFor(key.privateKeyPem);
  const { binding } = await transport.consume(created.enrollment);
  return { key, transport, binding };
}

let uploadSeq = 0;
async function seedUpload(documentType, extra = {}) {
  const solicitudId = `${run}-sol-${++uploadSeq}`;
  await db.doc(`solicitudes/${solicitudId}`).set({ rootId, clienteId: clientId, empresaNombre: 'Comercial Norte SA', total: 1160, folio: `S${uploadSeq}-C1-U1` });
  const uploadId = `${run}-up-${uploadSeq}`;
  const row = { rootId, clienteId: clientId, entityType: 'solicitudes', entityId: solicitudId, solicitudId, documentType, status: 'READY', active: true,
    contentType: 'application/pdf', storagePath: `roots/${rootId}/solicitudes/${solicitudId}/docs/${uploadId}-S${uploadSeq}.pdf`, sha256: 'a'.repeat(64), version: 1, ...extra };
  await db.doc(`uploads/${uploadId}`).set(row);
  return { solicitudId, uploadId, row };
}

async function queueQuotation() {
  const { solicitudId, uploadId, row } = await seedUpload('COTIZACION');
  const snap = data => ({ exists: !!data, id: uploadId, data: () => data });
  // The real uploads trigger body, invoked directly.
  await processWhatsAppInvoiceAutomation.run({ data: { before: snap(null), after: snap(row) }, params: { uploadId } });
  const jobs = await db.collection('documentDeliveryJobs').where('sourceId', '==', solicitudId).get();
  assert.equal(jobs.size, 1, 'exactly one job per document');
  return jobs.docs[0].id;
}

(async () => {
  await db.doc(`users/${ownerUid}`).set({ role: 'superadmin', rootId, active: true });
  await db.doc(`clients/${clientId}`).set({ rootId, name: 'Cliente Norte', whatsapp: '5215550000000' });
  const hugo = await enroll('hugo');
  const maria = await enroll('maria');
  await db.doc(`whatsappAgentChats/${hugo.binding.id}__${encodeURIComponent(group)}`).set({ rootId, bindingId: hugo.binding.id, chatId: group, name: 'Cliente Norte - Documentos', isGroup: true, active: true });
  await db.doc(`clientWhatsappGroups/${rootId}__${encodeURIComponent(clientId)}`).set({ rootId, clientId, groupChatId: group, groupName: 'Cliente Norte - Documentos' });

  await test('switch-off-creates-nothing', async () => {
    const { solicitudId, uploadId, row } = await seedUpload('COTIZACION');
    await processWhatsAppInvoiceAutomation.run({ data: { before: { exists: false, data: () => null }, after: { exists: true, id: uploadId, data: () => row } }, params: { uploadId } });
    assert.equal((await db.collection('documentDeliveryJobs').where('sourceId', '==', solicitudId).get()).size, 0);
    const claim = await hugo.transport.operate('CLAIM_DELIVERY', {});
    assert.equal(claim.delivery, null);
    assert.equal(claim.reason, 'AUTOMATION_OFF');
  });
  await db.doc(`whatsappAutomationConfigs/${rootId}`).set({ rootId, enabled: true });

  let jobId;
  await test('trigger-creates-released-job-routed-to-hugo-group', async () => {
    jobId = await queueQuotation();
    const row = await job(jobId);
    assert.equal(row.status, 'READY_FOR_SEND');
    assert.equal(row.sourceType, 'COTIZACION_PDF');
    assert.equal(row.targetDestinationSource, 'CLIENT_GROUP');
    assert.match(row.caption, /^Cotización de Comercial Norte SA por \$1,160\.00 del /);
    assert.doesNotMatch(row.caption + row.documents[0].fileName, /pay\s*-?\s*0|S\d+-C1-U1|despacho/i);
    const [delivery] = await deliveriesOf(jobId);
    assert.equal(delivery.status, 'PENDING_SEND');
    assert.equal(delivery.chatId, group);
    assert.equal(delivery.connectorId, hugo.binding.id);
    assert.equal(delivery.rootId, rootId);
  });

  await test('non-hugo-binding-cannot-claim-or-report', async () => {
    await assert.rejects(() => maria.transport.operate('CLAIM_DELIVERY', {}));
    assert.equal((await deliveriesOf(jobId))[0].status, 'PENDING_SEND');
  });

  await test('outside-hugo-hours-stays-queued', async () => {
    open = false;
    const claim = await hugo.transport.operate('CLAIM_DELIVERY', {});
    open = true;
    assert.equal(claim.delivery, null);
    assert.equal(claim.reason, 'OFF_HOURS');
    assert.equal((await deliveriesOf(jobId))[0].status, 'PENDING_SEND');
  });

  let claimed;
  await test('concurrent-claims-lease-exactly-one', async () => {
    const results = await Promise.all([hugo.transport.operate('CLAIM_DELIVERY', {}), hugo.transport.operate('CLAIM_DELIVERY', {})]);
    const got = results.filter(r => r.delivery);
    assert.equal(got.length, 1);
    claimed = got[0].delivery;
    assert.equal(claimed.jobId, jobId);
    assert.equal(claimed.chatId, group);
    assert.equal(claimed.documents.length, 1);
    assert.match(claimed.documents[0].url, /^https:\/\/signed\.invalid\//);
    assert.ok(signed.at(-1).startsWith(`roots/${rootId}/`));
    const [delivery] = await deliveriesOf(jobId);
    assert.equal(delivery.status, 'SENDING');
    assert.equal(delivery.lease.leaseId, claimed.leaseId);
    assert.equal((await job(jobId)).status, 'SENDING');
  });

  const report = (d, outcome, extra = {}) => hugo.transport.operate('REPORT_DELIVERY', { jobId: d.jobId, deliveryId: d.deliveryId, leaseId: d.leaseId, outcome, ...extra });
  await test('sent-requires-attempt-and-attempt-is-single', async () => {
    await assert.rejects(() => report(claimed, 'SENT'));
    assert.equal((await report(claimed, 'ATTEMPT')).attemptAuthorized, true);
    await assert.rejects(() => report(claimed, 'ATTEMPT'));
    await assert.rejects(() => maria.transport.operate('REPORT_DELIVERY', { jobId: claimed.jobId, deliveryId: claimed.deliveryId, leaseId: claimed.leaseId, outcome: 'SENT' }));
  });

  await test('sent-is-recorded-once-and-never-claimed-again', async () => {
    const result = await report(claimed, 'SENT', { messageIds: ['true_120363@g.us_ABC'] });
    assert.equal(result.deliveryStatus, 'SENT');
    assert.equal((await report(claimed, 'SENT')).duplicate, true);
    assert.equal((await job(jobId)).status, 'SENT');
    assert.equal(await events(jobId, 'WHATSAPP_DOCUMENTO_ENVIADO'), 1);
    const again = await hugo.transport.operate('CLAIM_DELIVERY', {});
    assert.equal(again.delivery, null);
    // Re-running the trigger for the same document creates no second job.
    const jobs = await db.collection('documentDeliveryJobs').where('sourceId', '==', (await job(jobId)).sourceId).get();
    assert.equal(jobs.size, 1);
  });

  await test('expired-lease-without-attempt-is-reclaimed-old-lease-rejected', async () => {
    const id = await queueQuotation();
    const first = (await hugo.transport.operate('CLAIM_DELIVERY', {})).delivery;
    assert.equal(first.jobId, id);
    await db.doc(`documentDeliveryJobs/${id}/deliveries/${first.deliveryId}`).update({ 'lease.expiresAtMs': Date.now() - 1000 });
    const second = (await hugo.transport.operate('CLAIM_DELIVERY', {})).delivery;
    assert.equal(second.jobId, id);
    assert.notEqual(second.leaseId, first.leaseId);
    await assert.rejects(() => report(first, 'ATTEMPT'));
    await report(second, 'ERROR', { errorCode: 'DOCUMENT_DOWNLOAD_FAILED' });
    assert.equal((await deliveriesOf(id))[0].status, 'ERROR');
    assert.equal(await events(id, 'WHATSAPP_DOCUMENTO_ENVIO_FALLIDO'), 1);
  });

  let uncertainJob, uncertainClaim;
  await test('attempt-without-report-blocks-as-uncertain-and-never-resends', async () => {
    uncertainJob = await queueQuotation();
    uncertainClaim = (await hugo.transport.operate('CLAIM_DELIVERY', {})).delivery;
    assert.equal(uncertainClaim.jobId, uncertainJob);
    await report(uncertainClaim, 'ATTEMPT');
    // The connector crashed after sending: the lease expires with an attempt on record.
    await db.doc(`documentDeliveryJobs/${uncertainJob}/deliveries/${uncertainClaim.deliveryId}`).update({ 'lease.expiresAtMs': Date.now() - 1000 });
    const next = await hugo.transport.operate('CLAIM_DELIVERY', {});
    assert.equal(next.delivery, null);
    const [delivery] = await deliveriesOf(uncertainJob);
    assert.equal(delivery.status, 'SEND_UNCERTAIN');
    assert.equal(delivery.retryBlocked, true);
    assert.equal((await job(uncertainJob)).status, 'BLOCKED_UNCERTAIN');
    assert.equal(await events(uncertainJob, 'WHATSAPP_DOCUMENTO_ENVIO_BLOQUEADO'), 1);
    // Neither automatic release nor the trigger can resend it.
    await assert.rejects(() => releaseWhatsAppJobDeliveriesCore({ jobId: uncertainJob, uid: 'system', actorName: 'Sistema' }));
    assert.equal((await hugo.transport.operate('CLAIM_DELIVERY', {})).delivery, null);
  });

  await test('human-allow-resend-releases-exactly-one-new-send', async () => {
    await assert.rejects(() => resolveWhatsAppUncertainDelivery.run({ auth: { uid: 'nobody' }, data: { jobId: uncertainJob, decision: 'ALLOW_RESEND' } }));
    const result = await resolveWhatsAppUncertainDelivery.run({ auth: { uid: ownerUid }, data: { jobId: uncertainJob, decision: 'ALLOW_RESEND' } });
    assert.equal(result.status, 'READY_FOR_SEND');
    const again = (await hugo.transport.operate('CLAIM_DELIVERY', {})).delivery;
    assert.equal(again.jobId, uncertainJob);
    await report(again, 'ATTEMPT');
    await report(again, 'UNCERTAIN', { errorCode: 'SEND_FAILED_DURING_ATTEMPT' });
    assert.equal((await deliveriesOf(uncertainJob))[0].status, 'SEND_UNCERTAIN');
    const confirmed = await resolveWhatsAppUncertainDelivery.run({ auth: { uid: ownerUid }, data: { jobId: uncertainJob, decision: 'CONFIRM_SENT' } });
    assert.equal(confirmed.status, 'SENT');
    assert.equal(await events(uncertainJob, 'WHATSAPP_DOCUMENTO_REVISION_RESUELTA'), 2);
  });

  await test('used-signature-link-is-never-sent', async () => {
    const token = crypto.randomBytes(32).toString('base64url');
    await db.doc(`signatureRequests/${token}`).set({ rootId, status: 'PENDING', expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600000) });
    const outcome = await queueAutomaticClientDelivery({ rootId, sourceType: 'CONSTANCIA_FIRMA_LINK', sourceId: `${run}-link-sol`, clienteId: clientId,
      caption: 'Firma de constancia de recibido.', textBody: `Hola. Firma aqui: https://pay-0-system.web.app/firma/${token}`, linkToken: token, notes: 'test' });
    assert.equal(outcome, 'RELEASED');
    await db.doc(`signatureRequests/${token}`).update({ status: 'USED' });
    assert.equal((await hugo.transport.operate('CLAIM_DELIVERY', {})).delivery, null);
    const linkJobs = await db.collection('documentDeliveryJobs').where('sourceId', '==', `${run}-link-sol`).get();
    assert.equal((await deliveriesOf(linkJobs.docs[0].id))[0].status, 'OMITTED');
  });

  await test('connector-loop-sends-once-with-caption-then-reports', async () => {
    const id = await queueQuotation();
    const sent = [];
    const callbacks = {};
    const client = { on: (name, cb) => { callbacks[name] = cb; }, initialize: async () => {}, destroy: async () => {}, getChats: async () => [],
      sendMessage: async (chatId, content, options) => { sent.push({ chatId, content, options }); return { id: { _serialized: `msg-${sent.length}` } }; } };
    const timers = [];
    const running = await runEnrolledConnector({ transport: hugo.transport, client, encodeQr: async () => '', resetLocalSession: async () => {},
      setTimer: fn => { timers.push(fn); return fn; }, clearTimer: () => {}, sendDocuments: true,
      fetchFile: async url => { assert.match(url, /^https:\/\/signed\.invalid\//); return Buffer.from('%PDF-1.4 synthetic'); },
      createMedia: (mimetype, data, filename) => ({ mimetype, data, filename }) });
    await callbacks.ready();
    await running.deliver();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chatId, group);
    assert.equal(sent[0].options.sendMediaAsDocument, true);
    assert.match(sent[0].options.caption, /^Cotización de Comercial Norte SA/);
    assert.match(sent[0].content.filename, /^Cotizacion \d{2}-\d{2}-\d{4}\.pdf$/);
    assert.equal((await deliveriesOf(id))[0].status, 'SENT');
    await running.deliver();
    assert.equal(sent.length, 1, 'never sent twice');
    await running.stop();
  });

  await test('connector-send-failure-is-reported-uncertain', async () => {
    // The previous test syncs an empty chat list, which marks the group inactive. A group Hugo does not see is never a destination
    // (there is no private fallback), so the group is made visible again before queueing.
    await db.doc(`whatsappAgentChats/${hugo.binding.id}__${encodeURIComponent(group)}`).set({ rootId, bindingId: hugo.binding.id, chatId: group, name: 'Cliente Norte - Documentos', isGroup: true, active: true });
    const id = await queueQuotation();
    const callbacks = {};
    const client = { on: (name, cb) => { callbacks[name] = cb; }, initialize: async () => {}, destroy: async () => {}, getChats: async () => [],
      sendMessage: async () => { throw Error('PUPPETEER_TIMEOUT'); } };
    const running = await runEnrolledConnector({ transport: hugo.transport, client, encodeQr: async () => '', resetLocalSession: async () => {},
      setTimer: fn => fn, clearTimer: () => {}, sendDocuments: true, fetchFile: async () => Buffer.from('%PDF'), createMedia: (m, d, f) => ({ m, d, f }) });
    await callbacks.ready();
    await running.deliver();
    assert.equal((await deliveriesOf(id))[0].status, 'SEND_UNCERTAIN');
    assert.equal((await job(id)).status, 'BLOCKED_UNCERTAIN');
    await running.stop();
  });

  const fire = async (uploadId, row) => processWhatsAppInvoiceAutomation.run({ data: { before: { exists: false, data: () => null }, after: { exists: true, id: uploadId, data: () => row } }, params: { uploadId } });
  const jobsFor = async sourceId => (await db.collection('documentDeliveryJobs').where('sourceId', '==', sourceId).get()).docs.map(doc => doc.data());
  const put = async (uploadId, row) => { await db.doc(`uploads/${uploadId}`).set(row); return row; };

  await test('invoice-waits-for-pdf-and-xml-pair', async () => {
    const { solicitudId, uploadId, row } = await seedUpload('FACTURA_PDF');
    await fire(uploadId, row);
    assert.equal((await jobsFor(solicitudId)).length, 0, 'PDF alone waits');
    const xml = await put(`${uploadId}-xml`, { ...row, documentType: 'FACTURA_XML', contentType: 'application/xml', storagePath: row.storagePath.replace('.pdf', '.xml') });
    await Promise.all([fire(`${uploadId}-xml`, xml), fire(uploadId, row)]);
    const jobs = await jobsFor(solicitudId);
    assert.equal(jobs.length, 1, 'concurrent triggers create one job');
    assert.equal(jobs[0].sourceType, 'FACTURA_PDF_XML');
    assert.deepEqual(jobs[0].documents.map(doc => doc.documentType), ['FACTURA_PDF', 'FACTURA_XML']);
  });

  await test('payment-complement-pair-is-queued', async () => {
    const { solicitudId } = await seedUpload('OTRO');
    const pagoId = `${run}-pago`, key = crypto.randomUUID().toUpperCase(), applicationId = `${run}-app`;
    await db.doc(`pagoAplicaciones/${applicationId}`).set({ rootId, montoAplicado: 580 });
    const base = { rootId, clienteId: clientId, solicitudId, entityType: 'pagos', entityId: pagoId, pagoId, applicationId, complementKey: key, integritySealStatus: 'SEALED', status: 'READY', active: true, version: 1, sha256: 'b'.repeat(64) };
    const pdf = await put(`${run}-rep-pdf`, { ...base, documentType: 'COMPLEMENTO_PAGO_PDF', contentType: 'application/pdf', storagePath: `roots/${rootId}/pagos/${pagoId}/docs/REP-${key}.pdf` });
    await put(`${run}-rep-xml`, { ...base, documentType: 'COMPLEMENTO_PAGO_XML', contentType: 'application/xml', storagePath: `roots/${rootId}/pagos/${pagoId}/docs/REP-${key}.xml` });
    await fire(`${run}-rep-pdf`, pdf);
    const [rep] = await jobsFor(key);
    assert.equal(rep.sourceType, 'COMPLEMENTO_PAGO_PDF_XML');
    assert.equal(rep.documents.length, 2);
    assert.match(rep.caption, /^Complemento de pago de Comercial Norte SA por \$580\.00/);
    assert.doesNotMatch(rep.documents.map(doc => doc.fileName).join(' '), new RegExp(key));
  });

  await test('dispersion-receipt-from-iq-import-is-queued-user-funded-is-not', async () => {
    for (const [suffix, fundingSource, expected] of [['client', null, 1], ['user', { holderType: 'USER' }, 0]]) {
      const dispersionId = `${run}-disp-${suffix}`;
      await db.doc(`clientDispersions/${dispersionId}`).set({ rootId, clientId, beneficiaryNombre: 'Proveedor Uno', amount: 250, ...(fundingSource ? { fundingSource } : {}) });
      const row = await put(`${run}-disp-up-${suffix}`, { rootId, clienteId: clientId, clientId, entityType: 'clientDispersions', entityId: dispersionId, dispersionId, documentType: 'COMPROBANTE_DISPERSION',
        source: 'IQ_IMPORT', status: 'READY', active: true, contentType: 'application/pdf', storagePath: `roots/${rootId}/dispersiones/${dispersionId}/x.pdf`, sha256: 'c'.repeat(64), version: 1 });
      await fire(`${run}-disp-up-${suffix}`, row);
      const jobs = await jobsFor(dispersionId);
      assert.equal(jobs.length, expected, suffix);
      if (expected) assert.match(jobs[0].caption, /^Comprobante de dispersión a Proveedor Uno por \$250\.00/);
    }
  });

  await test('receipt-certificate-only-after-signature', async () => {
    const unsigned = await seedUpload('CONSTANCIA_RECEPCION_SATISFACCION');
    await fire(unsigned.uploadId, unsigned.row);
    assert.equal((await jobsFor(unsigned.solicitudId)).length, 0);
    const signedDoc = await seedUpload('CONSTANCIA_RECEPCION_SATISFACCION', { constanciaSnapshot: { signatureUploadId: 'sig-1' } });
    await fire(signedDoc.uploadId, signedDoc.row);
    const [row] = await jobsFor(signedDoc.solicitudId);
    assert.equal(row.sourceType, 'CONSTANCIA_FIRMADA_PDF');
  });

  // ---- Same-day catch-up: turning the switch OFF -> ON queues today's skipped documents only. ----
  const setSwitch = enabled => setWhatsAppAutomationEnabled.run({ auth: { uid: ownerUid }, data: { enabled } });
  const nowTs = () => admin.firestore.Timestamp.now();
  const dayStart = mexicoDayStartMs(Date.now());
  let sentToday, skippedQuote, skippedInvoice, yesterdayQuote;
  await test('catch-up-off-to-on-queues-todays-skipped-documents', async () => {
    // Earlier connector tests sync an empty chat list and mark the group inactive: make it visible again (no private fallback exists).
    await db.doc(`whatsappAgentChats/${hugo.binding.id}__${encodeURIComponent(group)}`).set({ rootId, bindingId: hugo.binding.id, chatId: group, name: 'Cliente Norte - Documentos', isGroup: true, active: true });
    // Sent today while ON: must never be queued again.
    sentToday = await seedUpload('COTIZACION', { createdAt: nowTs() });
    await fire(sentToday.uploadId, sentToday.row);
    const [sentJob] = (await db.collection('documentDeliveryJobs').where('sourceId', '==', sentToday.solicitudId).get()).docs;
    await sentJob.ref.update({ status: 'SENT' });

    const off = await setSwitch(false);
    assert.equal(off.data.enabled, false);
    assert.equal(off.catchUp, null);

    skippedQuote = await seedUpload('COTIZACION', { createdAt: nowTs() });
    skippedInvoice = await seedUpload('FACTURA_PDF', { createdAt: nowTs() });
    const xmlRow = await put(`${skippedInvoice.uploadId}-xml`, { ...skippedInvoice.row, documentType: 'FACTURA_XML', contentType: 'application/xml', storagePath: skippedInvoice.row.storagePath.replace('.pdf', '.xml') });
    yesterdayQuote = await seedUpload('COTIZACION', { createdAt: admin.firestore.Timestamp.fromMillis(dayStart - 3600000) });
    for (const [id, row] of [[skippedQuote.uploadId, skippedQuote.row], [skippedInvoice.uploadId, skippedInvoice.row], [`${skippedInvoice.uploadId}-xml`, xmlRow], [yesterdayQuote.uploadId, yesterdayQuote.row]]) await fire(id, row);
    for (const doc of [skippedQuote, skippedInvoice, yesterdayQuote]) assert.equal((await jobsFor(doc.solicitudId)).length, 0, 'OFF queues nothing');

    const on = await setSwitch(true);
    assert.equal(on.data.enabled, true);
    assert.deepEqual(on.catchUp, { queued: 2, already: 1, skipped: 0, truncated: false });
    assert.match(on.message, /Se enviarán 2 documento\(s\) de hoy/);
    const [quoteJob] = await jobsFor(skippedQuote.solicitudId);
    assert.equal(quoteJob.sourceType, 'COTIZACION_PDF');
    assert.equal(quoteJob.status, 'READY_FOR_SEND');
    assert.equal(quoteJob.origin, 'AUTOMATIC');
    const invoiceJobs = await jobsFor(skippedInvoice.solicitudId);
    assert.equal(invoiceJobs.length, 1, 'PDF and XML make one invoice job');
    assert.deepEqual(invoiceJobs[0].documents.map(doc => doc.documentType), ['FACTURA_PDF', 'FACTURA_XML']);
    assert.equal(invoiceJobs[0].status, 'READY_FOR_SEND');
  });

  await test('catch-up-never-resends-todays-sent-document', async () => {
    const jobs = await jobsFor(sentToday.solicitudId);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'SENT');
  });

  await test('catch-up-never-queues-yesterdays-skipped-document', async () => {
    assert.equal((await jobsFor(yesterdayQuote.solicitudId)).length, 0);
  });

  await test('catch-up-on-to-on-and-off-to-off-do-nothing', async () => {
    const again = await setSwitch(true);
    assert.equal(again.catchUp, null, 'ON -> ON runs no catch-up');
    await setSwitch(false);
    const offAgain = await setSwitch(false);
    assert.equal(offAgain.catchUp, null, 'OFF -> OFF runs no catch-up');
    for (const doc of [skippedQuote, skippedInvoice, sentToday]) assert.equal((await jobsFor(doc.solicitudId)).length, 1);
  });

  await test('catch-up-second-off-to-on-is-a-no-op', async () => {
    const on = await setSwitch(true);
    assert.deepEqual(on.catchUp, { queued: 0, already: 3, skipped: 0, truncated: false });
    assert.equal(on.message, 'Automatizacion WhatsApp activada.');
    for (const doc of [skippedQuote, skippedInvoice, sentToday]) assert.equal((await jobsFor(doc.solicitudId)).length, 1);
    assert.equal((await jobsFor(yesterdayQuote.solicitudId)).length, 0);
    assert.equal((await job((await db.collection('documentDeliveryJobs').where('sourceId', '==', skippedQuote.solicitudId).get()).docs[0].id)).status, 'READY_FOR_SEND');
  });

  // Internal groups belong to an owner: the superadmin or an admin. Operators use the group of their admin.
  await test('internal-group-is-per-owner-and-operators-use-their-admins', async () => {
    const { alertIfClientGroupIncomplete } = require('../../functions/lib/modules/documentDelivery/clientGroupAlerts.js');
    const { setWhatsAppInternalGroup } = require('../../functions/lib/modules/documentDelivery/clientWhatsappGroups.js');
    const day = mexicoDayStartMs(Date.now());
    const sourceOf = id => id + ':' + day;
    const groupA = '120363555000000101@g.us', groupB = '120363555000000102@g.us', groupS = '120363555000000103@g.us';
    const adminA = run + '-admin-a', adminB = run + '-admin-b', adminC = run + '-admin-c', operatorA = run + '-operator-a', operatorS = run + '-operator-s', operatorOld = run + '-operator-old';
    await setSwitch(true);
    for (const [uid, role, extra] of [[adminA, 'admin', {}], [adminB, 'admin', {}], [adminC, 'admin', {}], [operatorA, 'operador', { parentRole: 'admin', parentUserId: adminA }], [operatorS, 'operador', { parentRole: 'superadmin', parentUserId: ownerUid }], [operatorOld, 'operador', { adminId: adminB }]]) {
      await db.doc('users/' + uid).set({ role, rootId, active: true, ...extra });
    }
    for (const [chatId, name] of [[groupA, 'Equipo A'], [groupB, 'Equipo B'], [groupS, 'Equipo superadmin']]) {
      await db.doc('whatsappAgentChats/' + hugo.binding.id + '__' + encodeURIComponent(chatId)).set({ rootId, bindingId: hugo.binding.id, chatId, name, isGroup: true, active: true });
    }
    const client = async (id, adminId, name) => { await db.doc('clients/' + id).set({ rootId, name, adminId, whatsapp: '5215550000099' }); return id; };
    const as = uid => ({ auth: { uid } });
    const internalDoc = async (owner) => (await db.doc('whatsappInternalGroups/' + rootId + '__' + encodeURIComponent(owner)).get());

    // Nobody has marked a group yet: no notice and no waiting job, and never a private chat.
    const nobody = await client(run + '-c-none', adminA, 'Cliente Sin Dueno Con Grupo');
    assert.equal(await alertIfClientGroupIncomplete({ rootId, clienteId: nobody }), 'NO_INTERNAL_GROUP');
    assert.equal((await jobsFor(sourceOf(nobody))).length, 0);

    // An admin sets only its own group; the superadmin sets any owner; an operator cannot set one.
    assert.equal((await setWhatsAppInternalGroup.run({ ...as(adminA), data: { groupChatId: groupA } })).ownerAdminId, adminA);
    await assert.rejects(() => setWhatsAppInternalGroup.run({ ...as(adminA), data: { groupChatId: groupA, ownerAdminId: adminB } }), error => error.code === 'permission-denied');
    await assert.rejects(() => setWhatsAppInternalGroup.run({ ...as(operatorA), data: { groupChatId: groupA } }), error => error.code === 'permission-denied');
    assert.equal((await setWhatsAppInternalGroup.run({ ...as(ownerUid), data: { groupChatId: groupB, ownerAdminId: adminB } })).ownerAdminId, adminB);
    assert.equal((await setWhatsAppInternalGroup.run({ ...as(ownerUid), data: { groupChatId: groupS } })).ownerAdminId, ownerUid);
    await assert.rejects(() => setWhatsAppInternalGroup.run({ ...as(ownerUid), data: { groupChatId: groupA, ownerAdminId: 'no-such-owner' } }), error => error.code === 'failed-precondition');
    await assert.rejects(() => setWhatsAppInternalGroup.run({ ...as(adminA), data: { groupChatId: '120363555000009999@g.us' } }), error => error.code === 'failed-precondition');
    assert.equal((await internalDoc(adminA)).get('groupChatId'), groupA);
    assert.equal((await internalDoc(adminB)).get('groupChatId'), groupB);

    // Each client's notice goes to the group of its own owner.
    const cA = await client(run + '-c-a', adminA, 'Cliente De A');
    const cB = await client(run + '-c-b', adminB, 'Cliente De B');
    const cS = await client(run + '-c-s', ownerUid, 'Cliente Del Superadmin');
    const cOp = await client(run + '-c-op', operatorA, 'Cliente Del Operador');
    const cOpS = await client(run + '-c-ops', operatorS, 'Cliente Del Operador Del Superadmin');
    const destinationOf = async id => (await jobsFor(sourceOf(id)))[0].targetDestinations.map(d => d.chatId);
    for (const id of [cA, cB, cS, cOp, cOpS]) assert.equal(await alertIfClientGroupIncomplete({ rootId, clienteId: id }), 'NO_GROUP_ASSIGNED:RELEASED');
    assert.deepEqual(await destinationOf(cA), [groupA], 'admin A sees its client');
    assert.deepEqual(await destinationOf(cB), [groupB], 'admin B has a different group');
    assert.deepEqual(await destinationOf(cS), [groupS], 'the superadmin sees its own clients');
    assert.deepEqual(await destinationOf(cOp), [groupA], 'an operator resolves to the group of its admin');
    assert.deepEqual(await destinationOf(cOpS), [groupS], 'an operator of the superadmin resolves to the superadmin group');
    for (const id of [cA, cB, cS, cOp, cOpS]) assert.ok(!JSON.stringify((await jobsFor(sourceOf(id)))[0].targetDestinations).includes('@c.us'), 'never a private chat');

    // An operator that only has the older adminId field resolves to that admin.
    const cOld = await client(run + '-c-old', operatorOld, 'Cliente Del Operador Antiguo');
    assert.equal(await alertIfClientGroupIncomplete({ rootId, clienteId: cOld }), 'NO_GROUP_ASSIGNED:RELEASED');
    assert.deepEqual(await destinationOf(cOld), [groupB]);

    // An admin without an internal group receives nothing.
    const cC = await client(run + '-c-c', adminC, 'Cliente De C');
    assert.equal(await alertIfClientGroupIncomplete({ rootId, clienteId: cC }), 'NO_INTERNAL_GROUP');
    assert.equal((await jobsFor(sourceOf(cC))).length, 0);

    // Clearing a group stops that owner's notices.
    await setWhatsAppInternalGroup.run({ ...as(adminB), data: { groupChatId: '' } });
    assert.equal((await internalDoc(adminB)).exists, false);
    const cB2 = await client(run + '-c-b2', adminB, 'Otro Cliente De B');
    assert.equal(await alertIfClientGroupIncomplete({ rootId, clienteId: cB2 }), 'NO_INTERNAL_GROUP');
  });

  await test('group-alert-lists-missing-agents-once-per-day', async () => {
    const { alertIfClientGroupIncomplete } = require('../../functions/lib/modules/documentDelivery/clientGroupAlerts.js');
    const day = mexicoDayStartMs(Date.now());
    const sourceOf = id => id + ':' + day;
    // The client's group exists but only Hugo sees it: Maria is missing and Sofia has no connector.
    const adminA = run + '-admin-a';
    const id = run + '-c-incompleto';
    await db.doc('clients/' + id).set({ rootId, name: 'Cliente Oeste', adminId: adminA, whatsapp: '5215550000011' });
    await db.doc('clientWhatsappGroups/' + rootId + '__' + id).set({ rootId, clientId: id, groupChatId: group, groupName: 'Cliente Norte - Documentos' });
    await db.doc('whatsappAgentChats/' + hugo.binding.id + '__' + encodeURIComponent(group)).set({ rootId, bindingId: hugo.binding.id, chatId: group, name: 'Cliente Norte - Documentos', isGroup: true, active: true });
    assert.equal(await alertIfClientGroupIncomplete({ rootId, clienteId: id }), 'AGENTS_MISSING:RELEASED');
    const [notice] = await jobsFor(sourceOf(id));
    assert.match(notice.textBody, /Cliente Oeste/);
    assert.match(notice.textBody, /María/);
    assert.match(notice.textBody, /Sofía/);
    assert.equal(notice.targetDestinations[0].chatId, '120363555000000101@g.us');
    // Same client, same problem, same day: no second notice.
    assert.notEqual(await alertIfClientGroupIncomplete({ rootId, clienteId: id }), 'AGENTS_MISSING:RELEASED');
    assert.equal((await jobsFor(sourceOf(id))).length, 1);
  });

  console.log(JSON.stringify({ status: 'PASS', checks: cases.length, cases, emulator: true, realProviderRequests: 0 }));
  process.exit(0);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
