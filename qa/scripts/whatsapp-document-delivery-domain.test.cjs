'use strict';
// Pure rules of automatic WhatsApp document delivery: source list, white-label texts, Hugo hours,
// destination order, lease decisions and the signed connector actions. No I/O.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const d = require('../../functions/lib/modules/documentDelivery/whatsappDeliveryDomain.js');
const p = require('../../functions/lib/modules/documentDelivery/whatsappConnectorPolicy.js');

let checks = 0;
const check = (name, fn) => { fn(); checks++; };

// ---- source types: one extensible list ----
check('source-list', () => {
  assert.deepEqual(d.DELIVERY_SOURCE_TYPES.sort(), ['ACUSE_CANCELACION', 'AVISO_GRUPO_INTERNO', 'COMPLEMENTO_PAGO_PDF_XML', 'CONSTANCIA_FIRMADA_PDF', 'CONSTANCIA_FIRMA_LINK', 'COTIZACION_PDF', 'DISPERSION_COMPROBANTE', 'FACTURA_PDF_XML', 'GRUPO_RESPUESTA']);
  // A group reply is a server-made TEXT delivery: never a document, never prepared by hand, never triggered by an upload.
  assert.equal(d.deliverySource('GRUPO_RESPUESTA').kind, 'TEXT');
  assert.equal(d.normalizeDeliverySourceType('grupo_respuesta'), 'GRUPO_RESPUESTA');
  assert.equal(d.sourceTypeForUpload({ active: true, status: 'READY', storagePath: 'roots/r/x.pdf', rootId: 'r', documentType: 'GRUPO_RESPUESTA', entityType: 'solicitudes' }), null);
  assert.equal(d.normalizeDeliverySourceType('factura_pdf_xml'), 'FACTURA_PDF_XML');
  assert.equal(d.normalizeDeliverySourceType('PAGO_COMPROBANTE'), null);
  assert.equal(d.deliverySource('CONSTANCIA_FIRMA_LINK').kind, 'TEXT');
});
const ready = (over) => ({ rootId: 'r1', active: true, status: 'READY', storagePath: 'roots/r1/x/file.pdf', ...over });
check('upload-to-source-type', () => {
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'solicitudes', documentType: 'FACTURA_PDF' })), 'FACTURA_PDF_XML');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'solicitudes', documentType: 'FACTURA_XML' })), 'FACTURA_PDF_XML');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'pagos', documentType: 'COMPLEMENTO_PAGO_PDF', complementKey: 'U', integritySealStatus: 'SEALED' })), 'COMPLEMENTO_PAGO_PDF_XML');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'pagos', documentType: 'COMPLEMENTO_PAGO_PDF' })), null, 'manual complement upload without canonical key');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'clientDispersions', documentType: 'COMPROBANTE_DISPERSION' })), 'DISPERSION_COMPROBANTE');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'solicitudes', documentType: 'COTIZACION' })), 'COTIZACION_PDF');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'solicitudes', documentType: 'ACUSE_CANCELACION_CFDI' })), 'ACUSE_CANCELACION');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'pagos', documentType: 'ACUSE_CANCELACION_CFDI' })), null, 'acuse only for solicitudes');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'solicitudes', documentType: 'ACUSE_CANCELACION_CFDI', status: 'PENDING' })), null, 'acuse not ready');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'solicitudes', documentType: 'CONSTANCIA_RECEPCION_SATISFACCION' })), null, 'constancia without signature');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'solicitudes', documentType: 'CONSTANCIA_RECEPCION_SATISFACCION', constanciaSnapshot: { signatureUploadId: 's1' } })), 'CONSTANCIA_FIRMADA_PDF');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'pagos', documentType: 'COMPROBANTE_PAGO' })), null, 'pago receipts are not sent');
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'solicitudes', documentType: 'COTIZACION', status: 'PENDING' })), null);
  assert.equal(d.sourceTypeForUpload(ready({ entityType: 'solicitudes', documentType: 'COTIZACION', active: false })), null);
});
check('same-version-does-not-resend', () => {
  const row = ready({ sha256: 'a', version: 1 });
  assert.equal(d.sameUploadVersion(row, { ...row }), true);
  assert.equal(d.sameUploadVersion({ ...row, status: 'PENDING' }, row), false);
  assert.equal(d.sameUploadVersion(row, { ...row, version: 2 }), false);
});

// ---- white-label texts ----
const date = Date.UTC(2026, 10, 13, 18, 0, 0);
check('captions-are-white-label', () => {
  const caption = d.buildDeliveryCaption({ sourceType: 'FACTURA_PDF_XML', counterpartyName: 'Comercial Norte SA', amount: 1234.5, dateMs: date, fileName: 'Factura 13-11-2026.pdf' });
  assert.match(caption, /^Factura de Comercial Norte SA por \$1,234\.50 del 13\/11\/2026\. Archivo: Factura 13-11-2026\.pdf$/);
  assert.match(d.buildDeliveryCaption({ sourceType: 'DISPERSION_COMPROBANTE', counterpartyName: 'Juan Perez', amount: 50, dateMs: date }), /^Comprobante de dispersión a Juan Perez por \$50\.00/);
  for (const name of ['PAY0 Servicios', 'Pay-0', 'Despacho Centro']) {
    const text = d.buildDeliveryCaption({ sourceType: 'COTIZACION_PDF', counterpartyName: name, amount: 10, dateMs: date });
    assert.doesNotMatch(text, /pay\s*-?\s*0|despacho/i, name);
  }
  const link = d.buildDeliveryCaption({ sourceType: 'CONSTANCIA_FIRMA_LINK', counterpartyName: 'Comercial Norte SA', amount: 99, link: 'https://pay-0-system.web.app/firma/abc' });
  assert.match(link, /firma la constancia en este enlace: https:\/\/pay-0-system\.web\.app\/firma\/abc$/);
  assert.doesNotMatch(link.replace('https://pay-0-system.web.app', ''), /pay\s*-?\s*0/i);
});
check('neutral-file-names', () => {
  assert.equal(d.clientFacingFileName({ sourceType: 'FACTURA_PDF_XML', documentType: 'FACTURA_XML', storagePath: 'roots/r/s/S12-C3-U4.xml', dateMs: date }), 'Factura 13-11-2026.xml');
  assert.equal(d.clientFacingFileName({ sourceType: 'DISPERSION_COMPROBANTE', contentType: 'application/pdf', storagePath: 'roots/r/d/D9-PAY0.pdf', dateMs: date }), 'Comprobante de dispersion 13-11-2026.pdf');
  assert.equal(d.clientFacingFileName({ sourceType: 'CONSTANCIA_FIRMADA_PDF', storagePath: 'x.pdf' }), 'Constancia de recibido firmada.pdf');
});

// ---- Hugo hours (America/Mexico_City = UTC-6) ----
check('hugo-hours', () => {
  const mx = (y, m, day, h, min) => Date.UTC(y, m - 1, day, h + 6, min);
  assert.equal(d.isWithinHugoHours(mx(2026, 11, 13, 7, 29)), false); // Fri before opening
  assert.equal(d.isWithinHugoHours(mx(2026, 11, 13, 7, 30)), true);
  assert.equal(d.isWithinHugoHours(mx(2026, 11, 13, 19, 29)), true);
  assert.equal(d.isWithinHugoHours(mx(2026, 11, 13, 19, 30)), false);
  assert.equal(d.isWithinHugoHours(mx(2026, 11, 14, 8, 0)), true); // Sat
  assert.equal(d.isWithinHugoHours(mx(2026, 11, 14, 15, 0)), false);
  assert.equal(d.isWithinHugoHours(mx(2026, 11, 15, 12, 0)), false); // Sun
});

// ---- destination: client group only ----
const group = '120363000000000001@g.us';
const hugoGroup = { bindingId: 'hugo-binding', chatId: group, name: 'Cliente Norte', isGroup: true, active: true, rootId: 'r1' };
const base = { assignment: { groupChatId: group, groupName: 'Cliente Norte' }, hugoGroup, rootId: 'r1' };
check('destination-group-only', () => {
  const first = d.chooseDeliveryDestination(base);
  assert.equal(first.source, 'CLIENT_GROUP');
  assert.equal(first.destinations[0].chatId, group);
  assert.equal(first.destinations[0].connectorId, 'hugo-binding');
  // A group Hugo does not see, is inactive, belongs to another root or differs from the assigned one never falls back to a private chat.
  for (const bad of [null, { ...hugoGroup, active: false }, { ...hugoGroup, rootId: 'other' }, { ...hugoGroup, chatId: '120363000000000002@g.us' }, { ...hugoGroup, isGroup: false }]) {
    const choice = d.chooseDeliveryDestination({ ...base, hugoGroup: bad });
    assert.equal(choice.source, 'NONE');
    assert.equal(choice.reason, 'GROUP_NOT_VISIBLE');
    assert.equal(choice.destinations.length, 0);
  }
  const none = d.chooseDeliveryDestination({ ...base, assignment: null, hugoGroup: null });
  assert.equal(none.source, 'NONE');
  assert.equal(none.reason, 'NO_GROUP_ASSIGNED');
  // Extra private inputs are ignored: no legacy route or phone can become a destination.
  const withPrivate = d.chooseDeliveryDestination({ ...base, assignment: null, hugoGroup: null, legacyRoute: { routeId: 'r', matchType: 'DEFAULT', destinations: [{ safeDocId: 'x', chatId: 'y', chatName: 'z', chatType: 'GROUP' }] }, clientPhone: '5215550000000' });
  assert.equal(withPrivate.source, 'NONE');
  // A chat id that is not a group id is never accepted as a group.
  assert.equal(d.chooseDeliveryDestination({ ...base, assignment: { groupChatId: '5215550000000@c.us' }, hugoGroup: { ...hugoGroup, chatId: '5215550000000@c.us' } }).source, 'NONE');
});

// ---- every client group has the three agents ----
check('group-agents', () => {
  const g = '120363000000000001@g.us';
  const bindings = ['hugo', 'maria', 'sofia'].map((agentId) => ({ id: 'b-' + agentId, agentId, state: 'ACTIVE', rootId: 'r1' }));
  const chat = (agentId, over = {}) => ({ bindingId: 'b-' + agentId, chatId: g, isGroup: true, active: true, rootId: 'r1', ...over });
  const all = ['hugo', 'maria', 'sofia'].map((a) => chat(a));
  const run = (over) => d.checkClientGroupAgents({ rootId: 'r1', groupChatId: g, bindings, chats: all, ...over });
  assert.deepEqual(run({}), { status: 'OK' });
  assert.deepEqual(run({ groupChatId: '' }), { status: 'NO_GROUP_ASSIGNED' });
  assert.deepEqual(run({ chats: all.filter((c) => c.bindingId !== 'b-maria') }), { status: 'AGENTS_MISSING', missing: ['maria'], notConnected: [] });
  assert.deepEqual(run({ chats: all.map((c) => (c.bindingId === 'b-sofia' ? { ...c, active: false } : c)) }).missing, ['sofia']);
  assert.deepEqual(run({ chats: all.map((c) => (c.bindingId === 'b-hugo' ? { ...c, rootId: 'other' } : c)) }).missing, ['hugo']);
  assert.deepEqual(run({ bindings: bindings.filter((b) => b.agentId !== 'sofia') }), { status: 'AGENTS_MISSING', missing: [], notConnected: ['sofia'] });
  assert.deepEqual(run({ bindings: bindings.map((b) => (b.agentId === 'maria' ? { ...b, state: 'REVOKED' } : b)) }).notConnected, ['maria']);
});

// ---- internal notice text ----
check('group-alert-text', () => {
  assert.equal(d.buildGroupAlertText({ clientName: 'Norte', check: { status: 'OK' } }), null);
  assert.match(d.buildGroupAlertText({ clientName: 'Norte', check: { status: 'NO_GROUP_ASSIGNED' } }), /Norte.*no tiene grupo/);
  const one = d.buildGroupAlertText({ clientName: 'Norte', check: { status: 'AGENTS_MISSING', missing: ['maria'], notConnected: [] } });
  assert.match(one, /falta: María. Agrégalo/);
  const two = d.buildGroupAlertText({ clientName: 'Norte', check: { status: 'AGENTS_MISSING', missing: ['maria', 'sofia'], notConnected: [] } });
  assert.match(two, /faltan: María, Sofía. Agrégalos/);
  assert.match(d.buildGroupAlertText({ clientName: 'Norte', check: { status: 'AGENTS_MISSING', missing: [], notConnected: ['hugo'] } }), /Hugo no tiene una conexión activa/);
  assert.equal(d.deliverySource('AVISO_GRUPO_INTERNO').kind, 'TEXT');
});

// ---- recovered from IQ: what is dated up to 2026-11-23 is never sent; from 2026-11-24 everything is sent, even late ----
check('recovered-backlog-by-original-date', () => {
  const cut = d.RECOVERED_BACKLOG_CUTOFF_MS, hour = 60 * 60 * 1000;
  const rec = (ms, over = {}) => ({ source: 'IQ_IMPORT', importMode: 'DAILY_SYNC', createdAt: { toMillis: () => ms }, ...over });
  assert.equal(cut, Date.UTC(2026, 10, 24, 6, 0, 0), 'start of 2026-11-24 in Mexico');
  for (const fn of [d.isBacklogRecoveredSolicitud, d.isBacklogRecoveredDispersion]) {
    assert.equal(fn(rec(cut - hour)), true, 'dated 2026-11-23 evening is backlog');
    assert.equal(fn(rec(Date.UTC(2026, 10, 6))), true);
    assert.equal(fn(rec(cut)), false, 'dated 2026-11-24 is sent');
    assert.equal(fn(rec(cut + 10 * 24 * hour)), false, 'later is sent whatever the age');
    assert.equal(fn(rec(cut + hour, { createdAt: new Date(cut + hour) })), false, 'a plain Date works');
    assert.equal(fn({ source: 'IQ_IMPORT', importMode: 'DAILY_SYNC' }), true, 'no date counts as backlog');
    assert.equal(fn({ source: 'PAY0', createdAt: new Date(0) }), false, 'a record PAY0 made keeps its own delivery');
    assert.equal(fn(rec(cut - hour, { importMode: 'MANUAL' })), false);
    assert.equal(fn(null), false);
  }
});

// ---- lease state machine ----
const now = 1_000_000;
const lease = { leaseId: '11111111-1111-4111-8111-111111111111', bindingId: 'b', generation: 1, expiresAtMs: now + 1000 };
const report = (outcome) => ({ outcome, leaseId: lease.leaseId, bindingId: 'b', generation: 1 });
check('claim-decisions', () => {
  assert.equal(d.decideClaim({ status: 'PENDING_SEND' }, now), 'CLAIM');
  assert.equal(d.decideClaim({ status: 'SENDING', lease }, now), 'SKIP');
  assert.equal(d.decideClaim({ status: 'SENDING', lease: { ...lease, expiresAtMs: now - 1 } }, now), 'RECLAIM_EXPIRED');
  assert.equal(d.decideClaim({ status: 'SENDING', lease: { ...lease, expiresAtMs: now - 1 }, attemptStartedAtMs: now - 5 }, now), 'MARK_UNCERTAIN');
  for (const status of ['SENT', 'SEND_UNCERTAIN', 'ERROR', 'PENDING_MANUAL_RELEASE', 'OMITTED']) assert.equal(d.decideClaim({ status }, now), 'SKIP', status);
});
check('report-decisions', () => {
  const sending = { status: 'SENDING', lease };
  assert.equal(d.decideReport(sending, report('ATTEMPT'), now).action, 'ATTEMPT_AUTHORIZED');
  assert.equal(d.decideReport({ ...sending, attemptStartedAtMs: now }, report('ATTEMPT'), now).action, 'REJECT', 'second attempt');
  assert.equal(d.decideReport({ ...sending, lease: { ...lease, expiresAtMs: now } }, report('ATTEMPT'), now).action, 'REJECT', 'expired lease');
  assert.equal(d.decideReport(sending, { ...report('ATTEMPT'), leaseId: 'other' }, now).action, 'REJECT');
  assert.equal(d.decideReport(sending, { ...report('ATTEMPT'), generation: 2 }, now).action, 'REJECT');
  assert.equal(d.decideReport(sending, report('SENT'), now).action, 'REJECT', 'SENT without attempt');
  assert.equal(d.decideReport({ ...sending, attemptStartedAtMs: now }, report('SENT'), now).action, 'MARK_SENT');
  assert.equal(d.decideReport({ status: 'SEND_UNCERTAIN', lease, attemptStartedAtMs: now }, report('SENT'), now).action, 'MARK_SENT', 'late SENT resolves');
  assert.equal(d.decideReport({ status: 'SENT', lease, attemptStartedAtMs: now }, report('SENT'), now).action, 'ALREADY_SENT');
  assert.equal(d.decideReport(sending, report('ERROR'), now).action, 'MARK_ERROR');
  assert.equal(d.decideReport({ ...sending, attemptStartedAtMs: now }, report('ERROR'), now).action, 'MARK_UNCERTAIN', 'error after attempt');
  assert.equal(d.decideReport({ ...sending, attemptStartedAtMs: now }, report('UNCERTAIN'), now).action, 'MARK_UNCERTAIN');
});
check('job-aggregation', () => {
  assert.equal(d.aggregateJobStatus(['SENT', 'OMITTED'], 'X'), 'SENT');
  assert.equal(d.aggregateJobStatus(['SENT', 'SENDING'], 'X'), 'SENDING');
  assert.equal(d.aggregateJobStatus(['SENT', 'PENDING_SEND'], 'X'), 'READY_FOR_SEND');
  assert.equal(d.aggregateJobStatus(['SENT', 'SEND_UNCERTAIN'], 'X'), 'BLOCKED_UNCERTAIN');
  assert.equal(d.aggregateJobStatus(['SENT', 'ERROR'], 'X'), 'ERROR_PARTIAL');
  assert.equal(d.aggregateJobStatus(['ERROR'], 'X'), 'ERROR');
  assert.equal(d.aggregateJobStatus(['OMITTED'], 'X'), 'X');
  assert.deepEqual([...d.PROTECTED_DELIVERY_STATUSES].sort(), ['SENDING', 'SEND_UNCERTAIN', 'SENT']);
});

// ---- signed connector actions ----
check('policy-accepts-signed-claim-and-report-only', () => {
  const key = crypto.generateKeyPairSync('ed25519');
  const pem = key.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const binding = { id: 'binding-1', ownerUid: 'o', rootId: 'r', publicKeyPem: pem, generation: 1, state: 'ACTIVE' };
  const sign = (action, data, signer = key.privateKey) => {
    const unsigned = { bindingId: 'binding-1', generation: 1, action, nonce: crypto.randomBytes(32).toString('hex'), issuedAtMs: Date.now(), dataHash: p.canonicalDataHash(data) };
    return { ...unsigned, signature: crypto.sign(null, Buffer.from(p.operationSigningText(unsigned)), signer).toString('base64url') };
  };
  const claim = {};
  p.assertWorkerEnvelope(binding, sign('CLAIM_DELIVERY', claim), claim, Date.now());
  const rep = { jobId: 'j', deliveryId: 'd', leaseId: lease.leaseId, outcome: 'SENT' };
  p.assertWorkerEnvelope(binding, sign('REPORT_DELIVERY', rep), rep, Date.now());
  assert.throws(() => p.assertWorkerEnvelope(binding, sign('REPORT_DELIVERY', rep), { ...rep, outcome: 'ERROR' }, Date.now()), 'tampered report');
  assert.throws(() => p.assertWorkerEnvelope(binding, sign('SEND_DOCUMENT', claim), claim, Date.now()), 'unknown action');
  const other = crypto.generateKeyPairSync('ed25519');
  assert.throws(() => p.assertWorkerEnvelope(binding, sign('CLAIM_DELIVERY', claim, other.privateKey), claim, Date.now()), 'foreign key');
  assert.deepEqual([...p.SENDING_WORKER_ACTIONS], ['CLAIM_DELIVERY', 'REPORT_DELIVERY']);
  assert.equal(d.DOCUMENT_SENDER_AGENT_ID, 'hugo');
});

// ---- same-day catch-up: Mexico City calendar day only ----
check('mexico-day-start-and-same-day-catch-up', () => {
  // 2026-11-19 10:00 in Mexico City (UTC-6) opens at 2026-11-19 06:00 UTC.
  const start = Date.UTC(2026, 10, 19, 6, 0, 0);
  assert.equal(d.mexicoDayStartMs(Date.UTC(2026, 10, 19, 16, 0, 0)), start);
  assert.equal(d.mexicoDayStartMs(start), start, 'midnight belongs to its own day');
  assert.equal(d.mexicoDayStartMs(start - 1), start - 24 * 3600 * 1000, 'one ms before midnight is the previous day');
  assert.equal(d.mexicoDayStartMs(Date.UTC(2026, 10, 20, 5, 59, 59)), start, '23:59 Mexico is still the same day');
  const at = (ms) => ({ toMillis: () => ms });
  const quote = (over) => ready({ entityType: 'solicitudes', documentType: 'COTIZACION', ...over });
  assert.equal(d.sameDayCatchUpSourceType(quote({ createdAt: at(start + 3600000) }), start), 'COTIZACION_PDF');
  assert.equal(d.sameDayCatchUpSourceType(quote({ createdAt: at(start - 3600000) }), start), null, 'yesterday is never caught up');
  assert.equal(d.sameDayCatchUpSourceType(quote({ createdAt: at(start - 3600000), finalizedAt: at(start + 60000) }), start), 'COTIZACION_PDF', 'finalized today counts as today');
  assert.equal(d.sameDayCatchUpSourceType(quote({ createdAt: at(start + 25 * 3600000) }), start), null, 'tomorrow is not today');
  assert.equal(d.sameDayCatchUpSourceType(quote({}), start), null, 'no time, no catch-up');
  assert.equal(d.sameDayCatchUpSourceType(ready({ entityType: 'pagos', documentType: 'COMPROBANTE_PAGO', createdAt: at(start + 1) }), start), null, 'pago receipts are not sent');
});

// ---- recovery after Hugo was offline ----
const mx = (y, m, day, h, min) => Date.UTC(y, m - 1, day, h + 6, min); // Mexico City is UTC-6 in winter
const ts = (ms) => ({ toMillis: () => ms });
const NOW = mx(2026, 11, 25, 10, 0); // Wednesday 10:00, inside Hugo's hours
const recentJob = (over = {}) => ({ origin: 'AUTOMATIC', status: 'ERROR', createdAt: ts(NOW - 3 * 3600000), ...over });
const failed = (over = {}) => ({ status: 'ERROR', lastError: 'PRE_SEND_FAILED', errorAt: ts(NOW - 20 * 60000), ...over });
check('auto-retry-only-when-nothing-reached-whatsapp', () => {
  assert.equal(d.decideAutoRetry({ delivery: failed(), job: recentJob(), nowMs: NOW }), 'RETRY');
  for (const code of ['DOCUMENT_DOWNLOAD_FAILED', 'FILE_SIGNING_FAILED', 'SEND_FAILED_BEFORE_ATTEMPT']) assert.equal(d.decideAutoRetry({ delivery: failed({ lastError: code }), job: recentJob(), nowMs: NOW }), 'RETRY', code);
  // Permanent failures and unknown codes are never retried by themselves.
  for (const code of ['DESTINATION_INVALID', 'DOCUMENTS_MISSING', 'DOCUMENT_URL_INVALID', 'FILE_UNAVAILABLE', 'DOCUMENT_SCOPE_INVALID', '']) assert.equal(d.decideAutoRetry({ delivery: failed({ lastError: code }), job: recentJob(), nowMs: NOW }), 'SKIP', code || 'no code');
  // A delivery whose send was uncertain, sent, pending or sending is not an auto-retry candidate: a person decides the first.
  for (const status of ['SEND_UNCERTAIN', 'SENT', 'PENDING_SEND', 'SENDING', 'OMITTED']) assert.equal(d.decideAutoRetry({ delivery: failed({ status }), job: recentJob(), nowMs: NOW }), 'SKIP', status);
  assert.equal(d.decideAutoRetry({ delivery: failed({ retryBlocked: true }), job: recentJob(), nowMs: NOW }), 'SKIP', 'blocked stays blocked');
  assert.equal(d.decideAutoRetry({ delivery: failed({ attemptStartedAtMs: NOW - 60000 }), job: recentJob(), nowMs: NOW }), 'SKIP', 'an attempt may have reached the chat');
});
check('auto-retry-bounds', () => {
  assert.equal(d.decideAutoRetry({ delivery: failed({ autoRetryCount: 2 }), job: recentJob(), nowMs: NOW }), 'RETRY');
  assert.equal(d.decideAutoRetry({ delivery: failed({ autoRetryCount: d.AUTO_RETRY_MAX_ATTEMPTS }), job: recentJob(), nowMs: NOW }), 'SKIP', 'bounded number of retries');
  assert.equal(d.decideAutoRetry({ delivery: failed({ errorAt: ts(NOW - 2 * 60000) }), job: recentJob(), nowMs: NOW }), 'SKIP', 'backoff after a failure');
  assert.equal(d.decideAutoRetry({ delivery: failed({ errorAt: undefined }), job: recentJob(), nowMs: NOW }), 'RETRY', 'unknown failure time does not block');
  assert.equal(d.decideAutoRetry({ delivery: failed(), job: recentJob({ createdAt: ts(NOW - 25 * 3600000) }), nowMs: NOW }), 'SKIP', 'older than 24 h is never resurrected');
  assert.equal(d.decideAutoRetry({ delivery: failed(), job: recentJob({ origin: 'MANUAL' }), nowMs: NOW }), 'SKIP', 'manual jobs are a person\'s');
  assert.equal(d.decideAutoRetry({ delivery: failed(), job: recentJob({ createdAt: undefined }), nowMs: NOW }), 'SKIP', 'a job with no creation date is not retried');
});
check('auto-retry-respects-backlog-cutoff', () => {
  const justBefore = d.RECOVERED_BACKLOG_CUTOFF_MS - 3600000, justAfter = d.RECOVERED_BACKLOG_CUTOFF_MS + 3600000;
  assert.equal(d.decideAutoRetry({ delivery: failed(), job: recentJob({ createdAt: ts(justBefore) }), nowMs: justBefore + 2 * 3600000 }), 'SKIP', 'a job created before 2026-11-24 is never retried');
  assert.equal(d.decideAutoRetry({ delivery: failed({ errorAt: ts(justAfter) }), job: recentJob({ createdAt: ts(justAfter) }), nowMs: justAfter + 3600000 }), 'RETRY', 'from the cutoff on, it is current business');
});
check('reroute-only-group-not-visible', () => {
  const waiting = (over = {}) => ({ origin: 'AUTOMATIC', status: 'READY_FOR_MANUAL_SEND', targetDestinationsCount: 0, targetResolutionStatus: 'CLIENT_GROUP_NOT_VISIBLE', createdAt: ts(NOW - 3 * 3600000), ...over });
  assert.equal(d.shouldRerouteWaitingJob(waiting(), NOW), true);
  assert.equal(d.shouldRerouteWaitingJob(waiting({ targetResolutionStatus: 'CLIENT_GROUP_MISSING' }), NOW), false, 'no group assigned is a person\'s task');
  assert.equal(d.shouldRerouteWaitingJob(waiting({ targetResolutionStatus: 'INTERNAL_GROUP_MISSING' }), NOW), false, 'internal notices without a group are configuration');
  assert.equal(d.shouldRerouteWaitingJob(waiting({ targetResolutionStatus: 'INTERNAL_GROUP_NOT_VISIBLE' }), NOW), false);
  assert.equal(d.shouldRerouteWaitingJob(waiting({ targetDestinationsCount: 1 }), NOW), false);
  assert.equal(d.shouldRerouteWaitingJob(waiting({ origin: 'MANUAL' }), NOW), false);
  assert.equal(d.shouldRerouteWaitingJob(waiting({ status: 'READY_FOR_SEND' }), NOW), false);
  assert.equal(d.shouldRerouteWaitingJob(waiting({ createdAt: ts(NOW - 30 * 3600000) }), NOW), false, 'older than 24 h');
  assert.equal(d.shouldRerouteWaitingJob(waiting({ createdAt: ts(d.RECOVERED_BACKLOG_CUTOFF_MS - 1000) }), d.RECOVERED_BACKLOG_CUTOFF_MS + 1000), false, 'before the backlog cutoff');
});
check('delivery-alert', () => {
  const fresh = 30 * 1000, stale = 6 * 60000;
  // Healthy: heartbeat fresh and nothing waiting more than 15 minutes.
  assert.deepEqual(d.evaluateDeliveryAlert({ nowMs: NOW, heartbeatAgeMs: fresh, releasedAtMs: [NOW - 5 * 60000] }), { active: false, heartbeatMissing: false, unclaimedCount: 0, oldestUnclaimedMinutes: 0 });
  // Heartbeat missing for more than 5 minutes, or never seen.
  assert.equal(d.evaluateDeliveryAlert({ nowMs: NOW, heartbeatAgeMs: stale, releasedAtMs: [] }).heartbeatMissing, true);
  assert.equal(d.evaluateDeliveryAlert({ nowMs: NOW, heartbeatAgeMs: null, releasedAtMs: [] }).active, true);
  assert.equal(d.evaluateDeliveryAlert({ nowMs: NOW, heartbeatAgeMs: 4 * 60000, releasedAtMs: [] }).active, false, 'under 5 minutes is fine');
  // Alive but not claiming: documents waiting more than 15 minutes.
  const stuck = d.evaluateDeliveryAlert({ nowMs: NOW, heartbeatAgeMs: fresh, releasedAtMs: [NOW - 40 * 60000, NOW - 20 * 60000, NOW - 2 * 60000] });
  assert.deepEqual(stuck, { active: true, heartbeatMissing: false, unclaimedCount: 2, oldestUnclaimedMinutes: 40 });
  // Outside Hugo's hours nothing is late: Wednesday 21:00 and Sunday.
  assert.equal(d.evaluateDeliveryAlert({ nowMs: mx(2026, 11, 25, 21, 0), heartbeatAgeMs: null, releasedAtMs: [mx(2026, 11, 25, 19, 31)] }).active, false);
  assert.equal(d.evaluateDeliveryAlert({ nowMs: mx(2026, 11, 29, 11, 0), heartbeatAgeMs: null, releasedAtMs: [] }).active, false);
  // Just after opening, a document released the evening before is not "late" yet: the hours have not been open 15 minutes.
  const opening = mx(2026, 11, 26, 7, 40);
  assert.equal(d.evaluateDeliveryAlert({ nowMs: opening, heartbeatAgeMs: fresh, releasedAtMs: [mx(2026, 11, 25, 19, 31)] }).unclaimedCount, 0);
  assert.equal(d.evaluateDeliveryAlert({ nowMs: mx(2026, 11, 26, 7, 50), heartbeatAgeMs: fresh, releasedAtMs: [mx(2026, 11, 25, 19, 31)] }).unclaimedCount, 1, 'fifteen minutes into the day it is late');
});

console.log(`whatsapp-document-delivery-domain: ${checks} checks passed`);
