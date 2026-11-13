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
  assert.deepEqual(d.DELIVERY_SOURCE_TYPES.sort(), ['COMPLEMENTO_PAGO_PDF_XML', 'CONSTANCIA_FIRMADA_PDF', 'CONSTANCIA_FIRMA_LINK', 'COTIZACION_PDF', 'DISPERSION_COMPROBANTE', 'FACTURA_PDF_XML']);
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

// ---- destination order ----
const group = '120363000000000001@g.us';
const hugoGroup = { bindingId: 'hugo-binding', chatId: group, name: 'Cliente Norte', isGroup: true, active: true, rootId: 'r1' };
const legacyRoute = { routeId: 'route', matchType: 'DEFAULT', destinations: [{ safeDocId: 'legacy', chatId: '120363000000000009@g.us', chatName: 'Legacy', chatType: 'GROUP' }] };
const base = { assignment: { groupChatId: group, groupName: 'Cliente Norte' }, hugoGroup, rootId: 'r1', legacyRoute, clientPhone: '5215550000000', clientName: 'Norte' };
check('destination-order', () => {
  const first = d.chooseDeliveryDestination(base);
  assert.equal(first.source, 'CLIENT_GROUP');
  assert.equal(first.destinations[0].chatId, group);
  assert.equal(first.destinations[0].connectorId, 'hugo-binding');
  assert.equal(d.chooseDeliveryDestination({ ...base, hugoGroup: null }).source, 'LEGACY_ROUTE', 'Hugo does not see the group');
  assert.equal(d.chooseDeliveryDestination({ ...base, hugoGroup: { ...hugoGroup, active: false } }).source, 'LEGACY_ROUTE');
  assert.equal(d.chooseDeliveryDestination({ ...base, hugoGroup: { ...hugoGroup, rootId: 'other' } }).source, 'LEGACY_ROUTE', 'foreign root');
  assert.equal(d.chooseDeliveryDestination({ ...base, hugoGroup: { ...hugoGroup, chatId: '120363000000000002@g.us' } }).source, 'LEGACY_ROUTE', 'different group');
  assert.equal(d.chooseDeliveryDestination({ ...base, assignment: null }).source, 'LEGACY_ROUTE');
  assert.equal(d.chooseDeliveryDestination({ ...base, assignment: null, legacyRoute: null }).source, 'CLIENT_PHONE');
  assert.equal(d.chooseDeliveryDestination({ ...base, assignment: null, legacyRoute: null }).destinations[0].chatId, '5215550000000@c.us');
  assert.equal(d.chooseDeliveryDestination({ ...base, assignment: null, legacyRoute: { ...legacyRoute, destinations: [{}] } }).source, 'LEGACY_ROUTE_INVALID');
  assert.equal(d.chooseDeliveryDestination({ ...base, assignment: null, legacyRoute: null, clientPhone: null }).source, 'NONE');
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

console.log(`whatsapp-document-delivery-domain: ${checks} checks passed`);
