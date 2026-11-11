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
ok(() => assert.deepEqual(d.decideGroupReply(status({})), { action: 'REPLY', kind: 'PROCESSING', text: d.REPLY_TEXTS.processing }));
ok(() => assert.deepEqual(d.decideGroupReply(status({ hasOpenSolicitud: false })), { action: 'REPLY', kind: 'VALIDATING', text: d.REPLY_TEXTS.validating }));
ok(() => none(status({ message: { ...base().message, body: '¿Ya salió mi transferencia?', timestampMs: NOW - 2 * MIN } }), 'WAITING_FOR_HUMAN'));
ok(() => assert.equal(d.decideGroupReply(status({ message: { ...base().message, body: '¿Ya salió mi transferencia?', timestampMs: NOW - 3 * MIN } })).action, 'REPLY'));
ok(() => none(status({ config: { enabled: true, workingHours: hours, humanWaitMs: 10 * MIN } }), 'WAITING_FOR_HUMAN'));
// Anything deeper than a status question is only validated, never answered with content.
ok(() => assert.deepEqual(d.decideGroupReply(withBody('�Me pueden ayudar con otra cosa?')), { action: 'REPLY', kind: 'VALIDATING', text: d.REPLY_TEXTS.validating }));
// The "processing" text promises no time.
ok(() => assert.match(d.REPLY_TEXTS.processing, /No contamos con un tiempo estimado/));
ok(() => assert.match(d.REPLY_TEXTS.processing, /orden en que fueron llegando/));

// Working hours boundaries (Monday 09:00 in, 18:00 out).
ok(() => assert.equal(d.isWithinWorkingHours(hours, Date.UTC(2026, 10, 9, 15, 0, 0)), true));
ok(() => assert.equal(d.isWithinWorkingHours(hours, Date.UTC(2026, 10, 9, 14, 59, 0)), false));
ok(() => assert.equal(d.isWithinWorkingHours(hours, Date.UTC(2026, 10, 10, 0, 0, 0)), false));

// Operator hashes match how the connector hashes authors, in both Mexican id forms.
const hashOf = (rootId, authorId) => createHash('sha256').update(`${rootId}|${authorId}`).digest('hex').slice(0, 32);
const hashes = d.operatorAuthorHashes('root-a', ['525512345678', 'invalid']);
ok(() => assert.equal(hashes.size, 2));
ok(() => assert.ok(hashes.has(hashOf('root-a', '525512345678@c.us'))));
ok(() => assert.ok(hashes.has(hashOf('root-a', '5215512345678@c.us'))));
ok(() => assert.ok(!hashes.has(hashOf('root-b', '525512345678@c.us'))));

console.log(`whatsapp-auto-reply-domain: ${checks} checks passed`);
