const assert = require('node:assert/strict');
const lib = '../../functions/lib/modules/whatsappAutoReply/';
const { readAgentModes, agentCanAct, applyModeChange, mayGreet, modeOf } = require(lib + 'modes.js');
const { summarizeReplyMetrics, mexicoMonthKey } = require(lib + 'metrics.js');
const { repeatBlockReason, REPEAT_COOLDOWN_MS } = require(lib + 'planner.js');
const { classifyRecords } = require(lib + 'requestLookup.js');

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };

// Modes: observer is the default and only ACTING is stored.
eq(readAgentModes(undefined), {});
eq(readAgentModes({ hugo: 'ACTING', maria: 'OBSERVER', sofia: 'x', n: 3 }), { hugo: 'ACTING' });
eq(modeOf({}, 'hugo'), 'OBSERVER');

// Only Hugo greets; nobody acts where Hugo observes; a disabled agent never acts.
ok(mayGreet('hugo')); ok(!mayGreet('maria')); ok(!mayGreet('sofia'));
ok(agentCanAct('hugo', { hugo: 'ACTING' }, true));
ok(!agentCanAct('hugo', {}, true));
ok(!agentCanAct('maria', { maria: 'ACTING' }, true), 'Hugo observing blocks María');
ok(!agentCanAct('maria', { hugo: 'ACTING', maria: 'ACTING' }, false), 'a disabled agent never acts');
ok(agentCanAct('maria', { hugo: 'ACTING', maria: 'ACTING' }, true));

const inGroup = ['hugo', 'maria', 'sofia'];
const enabled = id => id === 'hugo' || id === 'maria';
const change = (modes, agentId, mode, reason) => applyModeChange({ change: { agentId, mode, reason }, modes, agentsInGroup: inGroup, enabledInCatalog: enabled });

let r = change({}, 'maria', 'ACTING');
ok(!r.ok && r.code === 'HUGO_MUST_ACT_FIRST');
r = change({}, 'sofia', 'ACTING');
ok(!r.ok && r.code === 'AGENT_DISABLED');
r = change({}, 'iq', 'ACTING');
ok(!r.ok && r.code === 'AGENT_NOT_IN_GROUP');
r = change({}, 'hugo', 'ACTING');
ok(r.ok); eq(r.modes, { hugo: 'ACTING' });
r = change({ hugo: 'ACTING' }, 'hugo', 'ACTING');
ok(!r.ok && r.code === 'NO_CHANGE');
r = change({ hugo: 'ACTING' }, 'maria', 'ACTING');
ok(r.ok); eq(r.modes, { hugo: 'ACTING', maria: 'ACTING' });
r = change({ hugo: 'ACTING' }, 'hugo', 'OBSERVER', '  ');
ok(!r.ok && r.code === 'REASON_REQUIRED');
r = change({ hugo: 'ACTING', maria: 'ACTING' }, 'hugo', 'OBSERVER', 'Respondió mal');
ok(r.ok); eq(r.modes, {}); eq(r.changed.sort(), ['hugo', 'maria'], 'Hugo going back pulls María back');
r = change({ hugo: 'ACTING', maria: 'ACTING' }, 'maria', 'OBSERVER', 'Prueba');
ok(r.ok); eq(r.modes, { hugo: 'ACTING' });

// Measurement: one bucket per agent and group plus a total per agent.
const replies = [
  { agentId: 'hugo', chatId: 'g1', groupName: 'Uno', kind: 'GREETING', subject: null, responseMs: 60000, aiTokens: 0, escalated: false, humanCorrection: false, monthKey: '2026-11' },
  { agentId: 'hugo', chatId: 'g1', groupName: 'Uno', kind: 'REQUEST_DATA', subject: 'TRANSFER', responseMs: 180000, aiTokens: 0, escalated: true, humanCorrection: true, monthKey: '2026-11' },
  { agentId: 'hugo', chatId: 'g2', groupName: 'Dos', kind: 'PROCESSING', subject: 'INVOICE', responseMs: 120000, aiTokens: 10, escalated: false, humanCorrection: false, monthKey: '2026-11' },
  { agentId: 'hugo', chatId: 'g2', groupName: 'Dos', kind: 'GREETING', subject: null, responseMs: 1, aiTokens: 0, escalated: false, humanCorrection: false, monthKey: '2026-10' },
];
const events = [
  { agentId: 'hugo', chatId: 'g1', groupName: 'Uno', mode: 'ACTING', reason: null, monthKey: '2026-11' },
  { agentId: 'hugo', chatId: 'g1', groupName: 'Uno', mode: 'OBSERVER', reason: 'Respondió mal', monthKey: '2026-11' },
  { agentId: 'hugo', chatId: 'g2', groupName: 'Dos', mode: 'OBSERVER', reason: 'Otro mes', monthKey: '2026-10' },
];
const buckets = summarizeReplyMetrics(replies, events, '2026-11');
const total = buckets.find(row => row.agentId === 'hugo' && row.chatId === null);
const g1 = buckets.find(row => row.chatId === 'g1');
eq(total.replies, 3); eq(total.humanCorrections, 1); eq(total.escalations, 1); eq(total.aiTokens, 10);
eq(total.avgResponseMs, 120000); eq(total.byKind, { GREETING: 1, REQUEST_DATA: 1, PROCESSING: 1 });
eq(total.returnsToObserver, 1); eq(total.returnReasons, ['Respondió mal']); eq(total.actingChanges, 1);
eq(g1.replies, 2); eq(g1.avgResponseMs, 120000); eq(g1.groupName, 'Uno');
eq(summarizeReplyMetrics([], [], '2026-11'), []);
eq(mexicoMonthKey(Date.UTC(2026, 10, 30, 23, 0, 0)), '2026-11');
eq(mexicoMonthKey(Date.UTC(2026, 11, 1, 3, 0, 0)), '2026-11', '3:00 UTC on Dec 1 is still November in Mexico City');

// Turn memory: one greeting per Mexico day; the same answer is not repeated inside the cooldown.
const NOW = Date.UTC(2026, 10, 9, 16, 0, 0);
const last = { lastReplyAtMs: NOW - 10 * 60 * 1000, lastKind: 'PROCESSING', lastSubject: 'INVOICE', lastGreetingAtMs: NOW - 2 * 60 * 60 * 1000 };
eq(repeatBlockReason(undefined, 'GREETING', null, NOW), null);
eq(repeatBlockReason(last, 'GREETING', null, NOW), 'ALREADY_GREETED_TODAY');
eq(repeatBlockReason({ ...last, lastGreetingAtMs: NOW - 26 * 60 * 60 * 1000 }, 'GREETING', null, NOW), null);
eq(repeatBlockReason({ ...last, lastGreetingAtMs: null }, 'GREETING', null, NOW), null);
eq(repeatBlockReason(last, 'PROCESSING', 'INVOICE', NOW), 'REPEAT_COOLDOWN');
eq(repeatBlockReason(last, 'PROCESSING', 'TRANSFER', NOW), null);
eq(repeatBlockReason(last, 'REQUEST_DATA', 'INVOICE', NOW), null);
eq(repeatBlockReason(last, 'PROCESSING', 'INVOICE', NOW + REPEAT_COOLDOWN_MS), null);

// Lookup: found only for an open request; not found only without any record; otherwise unknown.
const inactive = new Set(['CANCELADA']), done = new Set(['COMPLETADA']);
eq(classifyRecords([], inactive, done), 'NOT_FOUND');
eq(classifyRecords(['EN_PROCESO'], inactive, done), 'FOUND');
eq(classifyRecords(['COMPLETADA', 'EN_PROCESO'], inactive, done), 'FOUND');
eq(classifyRecords(['COMPLETADA'], inactive, done), 'UNKNOWN');
eq(classifyRecords(['CANCELADA'], inactive, done), 'UNKNOWN');
eq(classifyRecords(['CANCELADA', 'COMPLETADA'], inactive, done), 'UNKNOWN');

console.log(`whatsapp-reply-modes: ${checks} checks passed`);
