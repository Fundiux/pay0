const assert = require('node:assert/strict');
const lib = '../../functions/lib/modules/whatsappAutoReply/';
const { maskPhrase, findMissedQuestions, correctionLessonId, missedLessonId, isCorrectionCategory, MASKED_PHRASE_MAX } = require(lib + 'lessons.js');
const { OWNER_WORKING_HOURS } = require(lib + 'domain.js');

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (v, m) => { assert.ok(v, m); checks++; };

// Masking keeps how the client asks and drops who and how much.
eq(maskPhrase('Hola, ya salió la transferencia de $45,000.50 a Juan Pérez?'), 'hola, ya salió la transferencia de $# a [nombre]?');
ok(!/\d/.test(maskPhrase('mi correo es ana@empresa.com y el folio 12345')));
ok(maskPhrase('mira https://x.com/a?b=1 porfa').includes('[enlace]'));
ok(maskPhrase('a'.repeat(500)).length <= MASKED_PHRASE_MAX);
eq(maskPhrase(''), '');

// Ids are deterministic so a lesson is created once.
eq(correctionLessonId('reply_x'), 'corr__reply_x');
eq(missedLessonId('root1', 'm1'), missedLessonId('root1', 'm1'));
ok(isCorrectionCategory('TONE')); ok(!isCorrectionCategory('x'));

// Missed questions.
const NOW = Date.UTC(2026, 10, 24, 18, 0); // Tuesday 12:00 Mexico City
const MIN = 60000;
const row = (id, over = {}) => ({ id, chatId: 'g1', authorHash: 'client', fromMe: false, timestampMs: NOW - 32 * MIN, type: 'chat', body: '¿Ya salió mi transferencia?', ...over });
const base = { ownerByChat: { g1: 'u1' }, operatorHashes: new Set(['op']), repliedIds: new Set(), nowMs: NOW, workingHours: OWNER_WORKING_HOURS };
const run = (messages, over = {}) => findMissedQuestions({ ...base, messages, ...over });

let found = run([row('a')]);
eq(found.length, 1); eq(found[0].kind, 'STATUS_INQUIRY'); eq(found[0].subject, 'TRANSFER'); ok(found[0].withinHours);
ok(!/transferencia de \d/.test(found[0].phrase));
eq(run([row('a', { timestampMs: NOW - 10 * MIN })]).length, 0, 'still inside the reply window');
eq(run([row('a')], { repliedIds: new Set(['a']) }).length, 0, 'Hugo replied');
eq(run([row('a'), row('b', { authorHash: 'op', body: 'Ya lo revisamos', timestampMs: NOW - 31 * MIN })]).length, 0, 'a person answered');
eq(run([row('a'), row('b', { fromMe: true, body: 'ok', timestampMs: NOW - 31 * MIN })]).length, 0, 'the connected number answered');
eq(run([row('a', { authorHash: 'op' })]).length, 0, 'an operator asking is not a client');
eq(run([row('a', { body: 'Gracias, ya quedó' })]).length, 0, 'not a question');
eq(run([row('a')], { ownerByChat: {} }).length, 0, 'groups where Hugo does not act are ignored');
found = run([row('a', { body: '¿Me pueden dar la constancia?' })]);
eq(found[0].kind, 'QUESTION'); eq(found[0].subject, null);
found = run([row('a', { timestampMs: Date.UTC(2026, 10, 24, 5, 0) })], { nowMs: Date.UTC(2026, 10, 24, 5, 40) });
eq(found[0].withinHours, false, 'outside working hours is flagged as expected');

console.log(`whatsapp-reply-lessons: ${checks} checks passed`);
