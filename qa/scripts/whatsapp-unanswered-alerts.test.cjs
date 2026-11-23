const assert = require('node:assert/strict');
const lib = '../../functions/lib/modules/whatsappAutoReply/';
const { planUnansweredAlerts, alertText, MAX_ALERTS, REMINDER_MS } = require(lib + 'unanswered.js');
const { OWNER_WORKING_HOURS } = require(lib + 'domain.js');

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (v, m) => { assert.ok(v, m); checks++; };

const MIN = 60000;
const NOW = Date.UTC(2026, 10, 24, 18, 0); // Tuesday 12:00 Mexico City
const row = (id, over = {}) => ({ id, chatId: 'g1', authorHash: 'client', fromMe: false, timestampMs: NOW - 4 * MIN, type: 'chat', body: '¿Ya salió mi transferencia?', ...over });
const base = { observedChats: new Set(['g1']), operatorHashes: new Set(['op']), ignoreHashes: new Set(['agent']), hugoTexts: {}, knownAlertIds: new Set(), openAlerts: [], nowMs: NOW, workingHours: OWNER_WORKING_HOURS, lookbackMs: 35 * MIN };
const plan = (messages, over = {}) => planUnansweredAlerts({ ...base, messages, ...over });

// First notice: only after 3 minutes.
eq(plan([row('a', { timestampMs: NOW - 2 * MIN })]).alerts.length, 0);
let p = plan([row('a')]);
eq(p.alerts.length, 1); eq(p.alerts[0].kind, 'FIRST'); eq(p.alerts[0].count, 1);
eq(plan([row('a', { timestampMs: NOW - 3 * MIN })]).alerts.length, 1, 'exactly 3 minutes counts');

// Not a notice when answered, not a client, not a question, not observed, known, too old, or off hours.
eq(plan([row('a'), row('b', { authorHash: 'op', timestampMs: NOW - 3 * MIN, body: 'Ya lo vemos' })]).alerts.length, 0, 'a team member answered');
eq(plan([row('a'), row('b', { fromMe: true, timestampMs: NOW - 3 * MIN, body: 'Ya lo vemos' })]).alerts.length, 0, 'the connected number answered');
eq(plan([row('a'), row('b', { fromMe: true, timestampMs: NOW - 3 * MIN, body: '  Ya lo   VEMOS ' })], { hugoTexts: { g1: new Set(['ya lo vemos']) } }).alerts.length, 1, "Hugo's own text is not an answer");
eq(plan([row('a'), row('b', { authorHash: 'agent', timestampMs: NOW - 3 * MIN })]).alerts.length, 1, "another agent is not a person answering");
eq(plan([row('a', { authorHash: 'op' })]).alerts.length, 0);
eq(plan([row('a', { authorHash: 'agent' })]).alerts.length, 0);
eq(plan([row('a', { body: 'Gracias, ya quedó' })]).alerts.length, 0);
eq(plan([row('a')], { observedChats: new Set() }).alerts.length, 0);
eq(plan([row('a')], { knownAlertIds: new Set(['a']) }).alerts.length, 0);
eq(plan([row('a', { timestampMs: NOW - 40 * MIN })]).alerts.length, 0);
eq(plan([row('a', { timestampMs: Date.UTC(2026, 10, 24, 5, 0) })], { nowMs: Date.UTC(2026, 10, 24, 5, 5) }).alerts.length, 0, 'off hours');
eq(plan([row('a', { body: '¿Me pueden dar la constancia?' })]).alerts[0].kind, 'FIRST', 'any question counts');

// Reminders every 5 minutes while unanswered.
const open = (over = {}) => ({ messageId: 'a', chatId: 'g1', questionAtMs: NOW - 8 * MIN, body: '¿Ya salió?', alertCount: 1, lastAlertAtMs: NOW - 5 * MIN, ...over });
p = plan([row('a', { timestampMs: NOW - 8 * MIN })], { openAlerts: [open()], knownAlertIds: new Set(['a']) });
eq(p.alerts.length, 1); eq(p.alerts[0].kind, 'REMINDER'); eq(p.alerts[0].count, 2); eq(p.alerts[0].minutes, 8);
eq(plan([row('a', { timestampMs: NOW - 8 * MIN })], { openAlerts: [open({ lastAlertAtMs: NOW - 2 * MIN })], knownAlertIds: new Set(['a']) }).alerts.length, 0, 'too soon');
eq(plan([], { openAlerts: [open({ lastAlertAtMs: NOW - (REMINDER_MS - 3000) })] }).alerts.length, 1, 'scheduler jitter is tolerated');

// An answer closes the alert; nothing more is sent.
p = plan([row('a', { timestampMs: NOW - 8 * MIN }), row('b', { authorHash: 'op', timestampMs: NOW - 1 * MIN })], { openAlerts: [open()], knownAlertIds: new Set(['a']) });
eq(p.resolve, ['a']); eq(p.alerts.length, 0);

// Old alerts expire after the cap and are not sent again; reminders pause off hours.
p = plan([], { openAlerts: [open({ alertCount: MAX_ALERTS })] });
eq(p.expire, ['a']); eq(p.alerts.length, 0);
eq(plan([], { openAlerts: [open()], nowMs: Date.UTC(2026, 10, 25, 4, 0) }).alerts.length, 0, 'no reminders off hours');

// Text: names the group and forwards the message; nothing internal.
const first = alertText(p.alerts[0] || { kind: 'FIRST', count: 1, body: '¿Ya salió mi transferencia?', minutes: 4 }, 'Contabilidad Oil');
ok(first.includes('«Contabilidad Oil»') && first.includes('más de 3 minutos') && first.includes('¿Ya salió mi transferencia?'));
const reminder = alertText({ kind: 'REMINDER', count: 3, body: 'hola?  \n ¿hay avance?', minutes: 13 }, 'Contabilidad Oil');
ok(reminder.includes('Recordatorio') && reminder.includes('13 minutos') && !reminder.includes('\n\n'));
ok(!/pay0|iq/i.test(first + reminder));

console.log(`whatsapp-unanswered-alerts: ${checks} checks passed`);
