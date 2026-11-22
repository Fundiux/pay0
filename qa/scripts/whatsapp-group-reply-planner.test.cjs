'use strict';
const assert = require('node:assert/strict');
const { planGroupReplies } = require('../../functions/lib/modules/whatsappAutoReply/planner.js');
const { OWNER_WORKING_HOURS, REPLY_TEXT_VARIANTS: V } = require('../../functions/lib/modules/whatsappAutoReply/domain.js');

let checks = 0;
const ok = fn => { fn(); checks++; };
const MIN = 60_000, HOUR = 60 * MIN;
// Monday 2026-11-09 10:00 in Mexico City (UTC-6).
const NOW = Date.UTC(2026, 10, 9, 16, 0, 0);
const msg = (id, over = {}) => ({ id, chatId: 'g1@g.us', authorHash: 'client-hash', fromMe: false, timestampMs: NOW - 5 * MIN, type: 'chat', body: 'Buenos días', ...over });
const input = (over = {}) => ({
  config: { enabled: true, mode: 'STANDARD', workingHours: OWNER_WORKING_HOURS },
  nowMs: NOW,
  messages: [msg('m1')],
  ownerByChat: { 'g1@g.us': 'user-betell' },
  operatorHashes: new Set(['operator-hash']),
  firstObservedByChat: { 'g1@g.us': NOW - 80 * HOUR },
  repliedIds: new Set(),
  hasOpenSolicitud: () => false,
  clientNameByOwner: { 'user-betell': 'Betell' },
  ...over,
});
const kinds = plan => plan.map(item => item.kind);

// Switch off and gates.
ok(() => assert.deepEqual(planGroupReplies(input({ config: { enabled: false, mode: 'STANDARD', workingHours: OWNER_WORKING_HOURS } })), []));
ok(() => assert.deepEqual(planGroupReplies(input({ config: { mode: 'STANDARD', workingHours: OWNER_WORKING_HOURS } })), []));
ok(() => assert.deepEqual(planGroupReplies(input({ ownerByChat: {} })), []));
// A group in its first days: the greeting is answered from day one, anything else only after the learning period.
const asks = [msg('lq', { body: '¿Ya salió mi transferencia?', timestampMs: NOW - 5 * MIN })];
ok(() => assert.deepEqual(planGroupReplies(input({ messages: asks, firstObservedByChat: { 'g1@g.us': NOW - 71 * HOUR } })), []));
ok(() => assert.deepEqual(planGroupReplies(input({ messages: asks, firstObservedByChat: {} })), []));
ok(() => assert.deepEqual(kinds(planGroupReplies(input({ firstObservedByChat: { 'g1@g.us': NOW - 71 * HOUR } }))), ['GREETING']));
ok(() => assert.deepEqual(kinds(planGroupReplies(input({ firstObservedByChat: {} }))), ['GREETING']));
ok(() => assert.deepEqual(planGroupReplies(input({ config: { enabled: true, mode: 'STANDARD' } })), []));

// A greeting is answered with the owner's name.
ok(() => assert.deepEqual(planGroupReplies(input()), [{ messageId: 'm1', chatId: 'g1@g.us', ownerUserUid: 'user-betell', kind: 'GREETING', text: 'Buen día, Betell.', subject: null, notifyInternal: false }]));
// Team members and the agent itself are never answered; a team answer after the message stops it.
ok(() => assert.deepEqual(planGroupReplies(input({ messages: [msg('m1', { authorHash: 'operator-hash' })] })), []));
ok(() => assert.deepEqual(planGroupReplies(input({ messages: [msg('m1', { fromMe: true })] })), []));
ok(() => assert.deepEqual(planGroupReplies(input({ messages: [msg('m1'), msg('m2', { authorHash: 'operator-hash', timestampMs: NOW - 4 * MIN, body: 'Buen día' })] })), []));
ok(() => assert.deepEqual(planGroupReplies(input({ messages: [msg('m1'), msg('m2', { fromMe: true, timestampMs: NOW - 4 * MIN, body: 'Buen día' })] })), []));
ok(() => assert.deepEqual(planGroupReplies(input({ repliedIds: new Set(['m1']) })), []));

// Modes: only greetings, or greetings plus validation.
const status = [msg('q1', { body: '¿Ya salió mi transferencia?', timestampMs: NOW - 5 * MIN })];
ok(() => assert.deepEqual(planGroupReplies(input({ config: { enabled: true, mode: 'GREETINGS_ONLY', workingHours: OWNER_WORKING_HOURS }, messages: status })), []));
ok(() => assert.deepEqual(kinds(planGroupReplies(input({ messages: status }))), ['VALIDATING']));
ok(() => assert.ok(V.VALIDATING.includes(planGroupReplies(input({ messages: status }))[0].text)));
ok(() => assert.deepEqual(kinds(planGroupReplies(input({ messages: status, hasOpenSolicitud: uid => uid === 'user-betell' }))), ['PROCESSING']));
ok(() => assert.deepEqual(kinds(planGroupReplies(input({ messages: status, hasOpenSolicitud: () => false }))), ['VALIDATING']));
// A missing mode behaves as the safer greetings-only mode.
ok(() => assert.deepEqual(planGroupReplies(input({ config: { enabled: true, workingHours: OWNER_WORKING_HOURS }, messages: status })), []));
ok(() => assert.equal(planGroupReplies(input({ config: { enabled: true, workingHours: OWNER_WORKING_HOURS } })).length, 1));

// The system lookup: found = already processing, not found = ask who it is for and tell the internal team, unknown = neutral.
const transferAsk = [msg('t1', { body: 'nos urge la transferencia nos podrian apoyar.', timestampMs: NOW - 5 * MIN })];
const invoiceAsk = [msg('f1', { body: 'saben como va la factura que solicite', timestampMs: NOW - 5 * MIN })];
const lookupWith = result => (owner, subject, row) => { seen.push([owner, subject, row.id]); return result; };
const seen = [];
ok(() => { const plan = planGroupReplies(input({ messages: transferAsk, lookupRequest: lookupWith('FOUND') })); assert.deepEqual(kinds(plan), ['PROCESSING']); assert.equal(plan[0].subject, 'TRANSFER'); assert.equal(plan[0].notifyInternal, false); });
ok(() => { const plan = planGroupReplies(input({ messages: invoiceAsk, lookupRequest: lookupWith('NOT_FOUND') })); assert.deepEqual(kinds(plan), ['REQUEST_DATA']); assert.equal(plan[0].subject, 'INVOICE'); assert.equal(plan[0].notifyInternal, true); assert.ok(V.REQUEST_DATA.INVOICE.includes(plan[0].text)); assert.doesNotMatch(plan[0].text, /transferencia/); });
ok(() => assert.deepEqual(kinds(planGroupReplies(input({ messages: transferAsk, lookupRequest: lookupWith('UNKNOWN') }))), ['VALIDATING']));
ok(() => assert.deepEqual(kinds(planGroupReplies(input({ messages: transferAsk }))), ['VALIDATING']));
// The lookup receives the group's owner user and what the client asked about, and is only consulted for status questions.
ok(() => { seen.length = 0; planGroupReplies(input({ messages: transferAsk, lookupRequest: lookupWith('FOUND') })); assert.deepEqual(seen, [['user-betell', 'TRANSFER', 't1']]); });
ok(() => { seen.length = 0; planGroupReplies(input({ messages: [msg('g1')], lookupRequest: lookupWith('FOUND') })); assert.deepEqual(seen, []); });
// Greetings-only mode never sends the data request, whatever the lookup says.
ok(() => assert.deepEqual(planGroupReplies(input({ config: { enabled: true, mode: 'GREETINGS_ONLY', workingHours: OWNER_WORKING_HOURS }, messages: transferAsk, lookupRequest: lookupWith('NOT_FOUND') })), []));
// A thank-you about the request is not answered.
ok(() => assert.deepEqual(planGroupReplies(input({ messages: [msg('th', { body: 'gracias, ya quedó la factura', timestampMs: NOW - 5 * MIN })], lookupRequest: lookupWith('NOT_FOUND') })), []));

// The 3 minute wait applies to questions, not to greetings.
const fresh = [msg('q2', { body: '¿Ya salió mi factura?', timestampMs: NOW - 2 * MIN })];
ok(() => assert.deepEqual(planGroupReplies(input({ messages: fresh })), []));

// One reply per group per run, oldest message first, and a hard cap across groups.
const two = [msg('a', { timestampMs: NOW - 9 * MIN }), msg('b', { timestampMs: NOW - 8 * MIN, body: 'Buenas tardes' })];
ok(() => assert.deepEqual(planGroupReplies(input({ messages: two })).map(item => item.messageId), ['a']));
const many = Array.from({ length: 8 }, (_, i) => msg('x' + i, { chatId: `g${i}@g.us` }));
const owners = Object.fromEntries(many.map(row => [row.chatId, 'user-betell']));
const observed = Object.fromEntries(many.map(row => [row.chatId, NOW - 80 * HOUR]));
ok(() => assert.equal(planGroupReplies(input({ messages: many, ownerByChat: owners, firstObservedByChat: observed })).length, 5));
ok(() => assert.equal(planGroupReplies(input({ messages: many, ownerByChat: owners, firstObservedByChat: observed, maxReplies: 2 })).length, 2));

console.log(`whatsapp-group-reply-planner: ${checks} checks passed`);
