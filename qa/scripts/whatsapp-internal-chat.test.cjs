const assert = require('node:assert/strict');
const lib = '../../functions/lib/modules/';
const { isAddressedToHugo, internalKindOf, planInternalReplies, INTERNAL_TEXTS, INTERNAL_MAX_AGE_MS, INTERNAL_COOLDOWN_MS } = require(lib + 'whatsappAutoReply/internalChatPlan.js');
const { buildGroupAlertText } = require(lib + 'documentDelivery/whatsappDeliveryDomain.js');

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (v, m) => { assert.ok(v, m); checks++; };

// Addressing: a WhatsApp mention of his number or his name; nothing else.
ok(isAddressedToHugo({ body: 'x', mentionsMe: true }));
ok(isAddressedToHugo({ body: 'Hugo, ¿me ayudas?' }));
ok(isAddressedToHugo({ body: 'oye HUGO' }));
ok(!isAddressedToHugo({ body: 'ya llegó el cliente' }));
ok(!isAddressedToHugo({ body: 'Hugoberto ya llegó' }), 'only the word Hugo');

// A bare greeting gets the greeting; anything else the limited answer.
for (const body of ['Hugo', 'Hugo buen día', '@5215500000000 hola', 'Hola Hugo!', 'hugo buenas tardes', 'Hugo, ¿cómo estás?']) eq(internalKindOf(body), 'INTERNAL_GREETING', body);
for (const body of ['Hugo ¿qué pasó con la factura de Betell?', '@5215500000000 ¿me das el saldo?', 'Hugo hay una duda con una transferencia']) eq(internalKindOf(body), 'INTERNAL_LIMITED', body);

// The fixed texts: mention placeholder, no figures, and the limited ones say what Hugo cannot do.
for (const kind of Object.keys(INTERNAL_TEXTS)) for (const text of INTERNAL_TEXTS[kind]) { ok(text.includes('{{MENCION}}')); ok(!/\d/.test(text)); }
for (const text of INTERNAL_TEXTS.INTERNAL_LIMITED) ok(/no puedo resolver|todavía no puedo/.test(text));

const NOW = Date.UTC(2026, 10, 24, 18, 0), MIN = 60000;
const row = (id, over = {}) => ({ id, chatId: 'g1', authorHash: 'person', fromMe: false, timestampMs: NOW - 5000, body: 'Hugo buen día', waMessageId: 'wa-' + id, ...over });
const base = { nowMs: NOW, ignoreHashes: new Set(['agent']), repliedIds: new Set(), lastReplyAtByChat: {} };
const plan = (messages, over = {}) => planInternalReplies({ ...base, messages, ...over });

let p = plan([row('a')]);
eq(p.length, 1); eq(p[0].kind, 'INTERNAL_GREETING'); eq(p[0].mentionMessageId, 'wa-a'); eq(p[0].chatId, 'g1');
eq(plan([row('a', { body: 'comentario del equipo' })]).length, 0, 'not addressed');
eq(plan([row('a', { body: 'comentario', mentionsMe: true })]).length, 1, 'a mention is enough');
eq(plan([row('a', { fromMe: true })]).length, 0, 'never his own messages');
eq(plan([row('a', { authorHash: 'agent' })]).length, 0, 'never another agent');
eq(plan([row('a')], { repliedIds: new Set(['a']) }).length, 0, 'not twice');
eq(plan([row('a', { timestampMs: NOW - INTERNAL_MAX_AGE_MS - 1000 })]).length, 0, 'too old');
eq(plan([row('a')], { lastReplyAtByChat: { g1: NOW - INTERNAL_COOLDOWN_MS + 1000 } }).length, 0, 'cooldown');
eq(plan([row('a')], { lastReplyAtByChat: { g1: NOW - INTERNAL_COOLDOWN_MS - 1000 } }).length, 1);
eq(plan([row('a'), row('b', { timestampMs: NOW - 3000 })]).length, 1, 'one reply per group per run');
eq(plan([row('a'), row('b', { chatId: 'g2' })]).length, 2, 'one per group');
eq(plan([row('a', { waMessageId: undefined })])[0].mentionMessageId, null, 'no message id, no mention');

// The notice for a solicitud without a group names who uploaded it.
const named = buildGroupAlertText({ clientName: 'Betell', userName: 'Juan', check: { status: 'NO_GROUP_ASSIGNED' } });
ok(/el usuario Juan subió una solicitud del cliente Betell, pero no tengo acceso a un grupo de WhatsApp para ese cliente porque aún no tiene uno asignado/.test(named));
ok(/Betell.*no tiene grupo/.test(buildGroupAlertText({ clientName: 'Betell', check: { status: 'NO_GROUP_ASSIGNED' } })), 'the generic text stays when nobody is known');
eq(buildGroupAlertText({ clientName: 'Betell', userName: 'Juan', check: { status: 'OK' } }), null);

console.log(`whatsapp-internal-chat: ${checks} checks passed`);
