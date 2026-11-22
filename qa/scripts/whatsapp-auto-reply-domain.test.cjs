'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const d = require('../../functions/lib/modules/whatsappAutoReply/domain.js');

let checks = 0;
const ok = (fn) => { fn(); checks++; };
const MIN = 60_000, HOUR = 60 * MIN;
// Monday 2026-11-09 10:00 in Mexico City (UTC-6).
const NOW = Date.UTC(2026, 10, 9, 16, 0, 0);
const hours = { timezone: 'America/Mexico_City', windows: [{ days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' }] };
const base = (over = {}) => ({
  config: { enabled: true, workingHours: hours }, nowMs: NOW, firstObservedAtMs: NOW - 80 * HOUR,
  message: { timestampMs: NOW - 5 * MIN, fromMe: false, authorIsOperator: false, type: 'chat', body: 'Buenos días' },
  laterMessages: [], hasOpenSolicitud: true, alreadyReplied: false, clientName: 'Betell', ...over,
});
const withBody = (body, extra = {}) => base({ message: { ...base().message, body }, ...extra });
const none = (input, reason) => { const r = d.decideGroupReply(input); assert.deepEqual(r, { action: 'NONE', reason }); };

// Classification.
ok(() => assert.equal(d.classifyMessage('Buenos días'), 'GREETING'));
ok(() => assert.equal(d.classifyMessage('¡Hola, buenas tardes!'), 'GREETING'));
ok(() => assert.equal(d.classifyMessage('buen dia equipo'), 'GREETING'));
ok(() => assert.equal(d.classifyMessage('¿Ya salió mi transferencia?'), 'STATUS_INQUIRY'));
ok(() => assert.equal(d.classifyMessage('cuando sale mi factura'), 'STATUS_INQUIRY'));
ok(() => assert.equal(d.classifyMessage('¿Me pueden ayudar con otra cosa?'), 'QUESTION'));
ok(() => assert.equal(d.classifyMessage('adjunto la factura'), 'OTHER'));
ok(() => assert.equal(d.classifyMessage('gracias'), 'OTHER'));
ok(() => assert.equal(d.classifyMessage('Buenos días, ¿ya salió mi pago?'), 'STATUS_INQUIRY'));

// Status questions as clients write them: the owner's own examples first, then close variants.
const transfers = [
  'saben como va la tranferencia que solicite?', 'saben si ya quedo la transferencia?', 'nos pueden apoyar con la transferencia',
  'nos urge la transferencia nos podrian apoyar.', '¿Ya salió mi transferencia?', 'alguna novedad de la transferencia', 'cómo va mi dispersión',
  'para cuándo estaría la transferencia', 'cómo vamos con el spei', 'urge la transferencia por favor', 'aún no me llega la trasferencia',
  'me confirman si ya salió la transferencia', 'cuánto falta para la transferencia', 'sigue pendiente la dispersion',
];
const invoices = [
  'saben como va la factura que solicite', 'saben si ya quedo la factura', 'nos pueden apoyar con la factura', 'nos urge la factura nos podrian apoyar',
  'buen día, me confirman si ya salió la factura', 'falta mucho para la factura', 'aún no me llega la factura', 'urge la factura por favor',
  'cómo va mi solicitud?', 'ya llegó la factura?',
];
ok(() => { for (const text of transfers) { assert.equal(d.classifyMessage(text), 'STATUS_INQUIRY', text); assert.equal(d.statusSubject(text), 'TRANSFER', text); } });
ok(() => { for (const text of invoices) { assert.equal(d.classifyMessage(text), 'STATUS_INQUIRY', text); assert.equal(d.statusSubject(text), 'INVOICE', text); } });
// Statements, thanks and attachments are not questions, even when they mention the request.
ok(() => { for (const text of ['adjunto la factura', 'gracias, ya quedó la factura', 'gracias por la transferencia', 'gracias', 'ok']) assert.notEqual(d.classifyMessage(text), 'STATUS_INQUIRY', text); });
ok(() => assert.equal(d.classifyMessage('gracias, ya quedó la factura'), 'OTHER'));
// A thank-you that also asks for something is still a question.
ok(() => assert.equal(d.classifyMessage('gracias, nos pueden apoyar con la transferencia'), 'STATUS_INQUIRY'));
ok(() => assert.equal(d.statusSubject('cómo va la factura y la transferencia'), 'OTHER'));

// What the system lookup decides: found = processing, not found = ask who it is for, unknown = neutral.
const statusMsg = (over = {}) => ({ ...base(), message: { ...base().message, body: '¿Ya salió mi transferencia?', timestampMs: NOW - 5 * MIN }, hasOpenSolicitud: false, ...over });
const V = d.REPLY_TEXT_VARIANTS;
const isReply = (result, kind, list) => { assert.equal(result.action, 'REPLY'); assert.equal(result.kind, kind); assert.ok(list.includes(result.text), result.text); };
ok(() => isReply(d.decideGroupReply(statusMsg({ requestLookup: 'FOUND' })), 'PROCESSING', V.PROCESSING.TRANSFER));
ok(() => isReply(d.decideGroupReply(statusMsg({ requestLookup: 'NOT_FOUND' })), 'REQUEST_DATA', V.REQUEST_DATA.TRANSFER));
ok(() => isReply(d.decideGroupReply(statusMsg({ requestLookup: 'UNKNOWN' })), 'VALIDATING', V.VALIDATING));
ok(() => isReply(d.decideGroupReply(statusMsg({ requestLookup: 'UNKNOWN', hasOpenSolicitud: true })), 'PROCESSING', V.PROCESSING.TRANSFER));
// The lookup never overrides the waiting time or a team answer.
ok(() => assert.deepEqual(d.decideGroupReply(statusMsg({ requestLookup: 'FOUND', message: { ...base().message, body: '¿Ya salió mi transferencia?', timestampMs: NOW - 2 * MIN } })), { action: 'NONE', reason: 'WAITING_FOR_HUMAN' }));
ok(() => assert.equal(d.decideGroupReply(statusMsg({ requestLookup: 'NOT_FOUND', laterMessages: [{ timestampMs: NOW - 4 * MIN, fromMe: false, authorIsOperator: true }] })).action, 'NONE'));
// A status reply names what the client asked about: a transfer or an invoice, one or the other, never both.
const invoiceMsg = (over = {}) => ({ ...base(), message: { ...base().message, body: 'saben como va la factura que solicite', timestampMs: NOW - 5 * MIN }, hasOpenSolicitud: false, ...over });
ok(() => isReply(d.decideGroupReply(invoiceMsg({ requestLookup: 'FOUND' })), 'PROCESSING', V.PROCESSING.INVOICE));
ok(() => isReply(d.decideGroupReply(invoiceMsg({ requestLookup: 'NOT_FOUND' })), 'REQUEST_DATA', V.REQUEST_DATA.INVOICE));
// When the subject is unclear (both or neither), only the neutral wording fits, whatever the lookup says.
const unclear = (body, lookup) => d.decideGroupReply({ ...base(), message: { ...base().message, body, timestampMs: NOW - 5 * MIN }, hasOpenSolicitud: true, requestLookup: lookup });
ok(() => { for (const lookup of ['FOUND', 'NOT_FOUND', 'UNKNOWN']) isReply(unclear('cómo va la factura y la transferencia?', lookup), 'VALIDATING', V.VALIDATING); });
ok(() => isReply(unclear('¿ya llegó mi pago?', 'FOUND'), 'VALIDATING', V.VALIDATING));
// Every wording: warm, no brand, no time promised, and it names only its own subject.
const all = [...V.VALIDATING, ...V.PROCESSING.TRANSFER, ...V.PROCESSING.INVOICE, ...V.REQUEST_DATA.TRANSFER, ...V.REQUEST_DATA.INVOICE];
ok(() => { for (const text of all) { assert.doesNotMatch(text, /pay\s*-?\s*0|despacho/i, text); assert.doesNotMatch(text, /\b(minutos?|horas?|hoy|mañana|días)\b/i, text); assert.doesNotMatch(text, /dispersi[oó]n|sin tiempo estimado|ya se está procesando/i, text); } });
ok(() => { for (const text of [...V.PROCESSING.TRANSFER, ...V.REQUEST_DATA.TRANSFER]) { assert.match(text, /transferencia/, text); assert.doesNotMatch(text, /factura/i, text); } });
ok(() => { for (const text of [...V.PROCESSING.INVOICE, ...V.REQUEST_DATA.INVOICE]) { assert.match(text, /factura/i, text); assert.doesNotMatch(text, /transferencia|comprobante/i, text); } });
ok(() => { for (const text of [...V.REQUEST_DATA.TRANSFER, ...V.REQUEST_DATA.INVOICE]) assert.match(text, /nombre del cliente, o de la empresa o persona que realizó el pago/, text); });
ok(() => { for (const text of V.PROCESSING.TRANSFER) assert.match(text, /comprobante/, text); });
ok(() => assert.ok(V.VALIDATING.length >= 2 && V.PROCESSING.TRANSFER.length >= 2 && V.PROCESSING.INVOICE.length >= 2 && V.REQUEST_DATA.TRANSFER.length >= 2 && V.REQUEST_DATA.INVOICE.length >= 2));
// The wording is chosen from the message id: stable for one message, varied across messages.
ok(() => assert.equal(d.replyText('PROCESSING', 'TRANSFER', 'msg-1'), d.replyText('PROCESSING', 'TRANSFER', 'msg-1')));
ok(() => assert.ok(new Set(Array.from({ length: 40 }, (_, i) => d.replyText('PROCESSING', 'INVOICE', `msg-${i}`))).size >= 2));
ok(() => assert.ok(new Set(Array.from({ length: 40 }, (_, i) => d.replyText('VALIDATING', 'OTHER', `msg-${i}`))).size >= 2));
ok(() => assert.ok(V.PROCESSING.TRANSFER.includes(d.replyText('PROCESSING', 'TRANSFER', ''))));

// Gates, in order.
ok(() => none(base({ config: { workingHours: hours } }), 'DISABLED'));
ok(() => none(base({ config: { enabled: false, workingHours: hours } }), 'DISABLED'));
ok(() => none(base({ message: { ...base().message, fromMe: true } }), 'NOT_A_CLIENT_MESSAGE'));
ok(() => none(base({ message: { ...base().message, authorIsOperator: true } }), 'NOT_A_CLIENT_MESSAGE'));
ok(() => none(base({ message: { ...base().message, type: 'image', body: '' } }), 'NOT_TEXT'));
ok(() => none(base({ alreadyReplied: true }), 'ALREADY_REPLIED'));
// The first 3 days are only for learning.
ok(() => none(base({ firstObservedAtMs: NOW - 71 * HOUR }), 'LEARNING_PERIOD'));
ok(() => none(base({ firstObservedAtMs: null }), 'LEARNING_PERIOD'));
ok(() => assert.equal(d.decideGroupReply(base({ firstObservedAtMs: NOW - 72 * HOUR })).action, 'REPLY'));
// Off hours: nothing, and no hours configured means never.
ok(() => none(base({ firstObservedAtMs: 0, nowMs: Date.UTC(2026, 10, 9, 2, 0, 0), message: { ...base().message, timestampMs: Date.UTC(2026, 10, 9, 1, 55, 0) } }), 'OFF_HOURS'));
ok(() => none(base({ firstObservedAtMs: 0, nowMs: Date.UTC(2026, 10, 8, 18, 0, 0), message: { ...base().message, timestampMs: Date.UTC(2026, 10, 8, 17, 55, 0) } }), 'OFF_HOURS'));
ok(() => none(base({ config: { enabled: true } }), 'OFF_HOURS'));
ok(() => none(base({ config: { enabled: true, workingHours: { timezone: 'No/Existe', windows: hours.windows } } }), 'OFF_HOURS'));
// A person of the team answering after the message stops the agent; an earlier one does not.
ok(() => none(base({ laterMessages: [{ timestampMs: NOW - 4 * MIN, fromMe: false, authorIsOperator: true }] }), 'HUMAN_ANSWERED'));
ok(() => none(base({ laterMessages: [{ timestampMs: NOW - 4 * MIN, fromMe: true, authorIsOperator: false }] }), 'HUMAN_ANSWERED'));
ok(() => assert.equal(d.decideGroupReply(base({ laterMessages: [{ timestampMs: NOW - 6 * MIN, fromMe: false, authorIsOperator: true }] })).action, 'REPLY'));
ok(() => assert.equal(d.decideGroupReply(base({ laterMessages: [{ timestampMs: NOW - 4 * MIN, fromMe: false, authorIsOperator: false }] })).action, 'REPLY'));
ok(() => none(base({ message: { ...base().message, timestampMs: NOW - 31 * MIN } }), 'TOO_OLD'));
ok(() => none(withBody('gracias'), 'NOT_A_QUESTION'));

// Replies.
ok(() => assert.deepEqual(d.decideGroupReply(base({ message: { ...base().message, timestampMs: NOW - 10_000 } })), { action: 'REPLY', kind: 'GREETING', text: 'Buen día, Betell.' }));
ok(() => assert.deepEqual(d.decideGroupReply(base({ clientName: '' })), { action: 'REPLY', kind: 'GREETING', text: 'Buen día.' }));
// Status: only "processing" when a real open request exists, and only after the 3 minute wait.
const status = (extra) => withBody('¿Ya salió mi transferencia?', extra);
ok(() => isReply(d.decideGroupReply(status({})), 'PROCESSING', V.PROCESSING.TRANSFER));
ok(() => isReply(d.decideGroupReply(status({ hasOpenSolicitud: false })), 'VALIDATING', V.VALIDATING));
ok(() => none(status({ message: { ...base().message, body: '¿Ya salió mi transferencia?', timestampMs: NOW - 2 * MIN } }), 'WAITING_FOR_HUMAN'));
ok(() => assert.equal(d.decideGroupReply(status({ message: { ...base().message, body: '¿Ya salió mi transferencia?', timestampMs: NOW - 3 * MIN } })).action, 'REPLY'));
ok(() => none(status({ config: { enabled: true, workingHours: hours, humanWaitMs: 10 * MIN } }), 'WAITING_FOR_HUMAN'));
// Anything deeper than a status question is only validated, never answered with content.
ok(() => isReply(d.decideGroupReply(withBody('¿Me pueden ayudar con otra cosa?')), 'VALIDATING', V.VALIDATING));
// The "processing" text promises no time.

// Working hours boundaries (Monday 09:00 in, 18:00 out).
ok(() => assert.equal(d.isWithinWorkingHours(hours, Date.UTC(2026, 10, 9, 15, 0, 0)), true));
ok(() => assert.equal(d.isWithinWorkingHours(hours, Date.UTC(2026, 10, 9, 14, 59, 0)), false));
ok(() => assert.equal(d.isWithinWorkingHours(hours, Date.UTC(2026, 10, 10, 0, 0, 0)), false));

// The owner's hours: Mon-Fri 07:30-19:30, Saturday 08:00-15:00, never Sunday.
const owner = d.OWNER_WORKING_HOURS;
const at = (day, h, m) => Date.UTC(2026, 10, day, h + 6, m, 0); // Mexico City is UTC-6
ok(() => assert.equal(d.isWithinWorkingHours(owner, at(9, 7, 29)), false));
ok(() => assert.equal(d.isWithinWorkingHours(owner, at(9, 7, 30)), true));
ok(() => assert.equal(d.isWithinWorkingHours(owner, at(9, 19, 29)), true));
ok(() => assert.equal(d.isWithinWorkingHours(owner, at(9, 19, 30)), false));
ok(() => assert.equal(d.isWithinWorkingHours(owner, at(14, 7, 59)), false));
ok(() => assert.equal(d.isWithinWorkingHours(owner, at(14, 8, 0)), true));
ok(() => assert.equal(d.isWithinWorkingHours(owner, at(14, 14, 59)), true));
ok(() => assert.equal(d.isWithinWorkingHours(owner, at(14, 15, 0)), false));
ok(() => assert.equal(d.isWithinWorkingHours(owner, at(15, 12, 0)), false));

// Operator hashes match how the connector hashes authors, in both Mexican id forms.
const hashOf = (rootId, authorId) => createHash('sha256').update(`${rootId}|${authorId}`).digest('hex').slice(0, 32);
const hashes = d.operatorAuthorHashes('root-a', ['525512345678', 'invalid']);
ok(() => assert.equal(hashes.size, 2));
ok(() => assert.ok(hashes.has(hashOf('root-a', '525512345678@c.us'))));
ok(() => assert.ok(hashes.has(hashOf('root-a', '5215512345678@c.us'))));
ok(() => assert.ok(!hashes.has(hashOf('root-b', '525512345678@c.us'))));

console.log(`whatsapp-auto-reply-domain: ${checks} checks passed`);
