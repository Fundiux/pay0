const assert = require('node:assert/strict');
const { runEnrolledConnector } = require('../../tools/whatsapp-qr-connector/enrolledConnector.cjs');
const { matchesSentText, withoutMention, GREETING_WITH_MENTION, MENTION_TOKEN } = require('../../functions/lib/modules/whatsappAutoReply/mention.js');
const { normalizeText } = require('../../functions/lib/modules/whatsappAutoReply/unanswered.js');

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (v, m) => { assert.ok(v, m); checks++; };

// Server-side helpers.
eq(MENTION_TOKEN, '{{MENCION}}');
eq(withoutMention(GREETING_WITH_MENTION), 'Buen día.');
eq(withoutMention('Hola, {{MENCION}}, buen día'), 'Hola, buen día');
const sent = new Set([normalizeText(GREETING_WITH_MENTION)]);
ok(matchesSentText(sent, 'Buen día, @5215511112222.', normalizeText), 'a mentioned greeting is still recognised as Hugo');
ok(matchesSentText(sent, 'Buen día.', normalizeText), 'so is the greeting without the mention');
ok(!matchesSentText(sent, 'Buen día, Juan.', normalizeText));
ok(!matchesSentText(undefined, 'Buen día.', normalizeText));

// Connector: resolves the author from the inbound message id at send time.
const GROUP = '120363555000000001@g.us';
async function run(delivery, getMessageById) {
  const sent = [], reports = [], callbacks = {};
  const transport = { operate: async (action, data) => {
    if (action === 'CLAIM_DELIVERY') return { delivery };
    if (action === 'REPORT_DELIVERY') { reports.push(data.outcome); return { attemptAuthorized: true }; }
    return {};
  }, synchronize: async () => ({}), getBinding: () => ({ id: 'b' }) };
  const client = { on: (name, cb) => { callbacks[name] = cb; }, initialize: async () => {}, destroy: async () => {}, getChats: async () => [],
    ...(getMessageById ? { getMessageById } : {}),
    sendMessage: async (chatId, content, options) => { sent.push({ chatId, content, options }); return { id: { _serialized: 'out-1' } }; } };
  const running = await runEnrolledConnector({ transport, client, encodeQr: async () => '', resetLocalSession: async () => {}, setTimer: fn => fn, clearTimer: () => {}, sendDocuments: true, fetchFile: async () => Buffer.alloc(1), createMedia: () => ({}) });
  await callbacks.ready();
  await running.deliver();
  await running.stop();
  return { sent, reports };
}
const delivery = (over = {}) => ({ jobId: 'j', deliveryId: 'd', leaseId: 'l', chatId: GROUP, kind: 'TEXT', text: GREETING_WITH_MENTION, mention: { messageId: 'false_g_ABC_5215511112222@c.us' }, documents: [], ...over });
const inbound = (over = {}) => ({ fromMe: false, from: GROUP, author: '5215511112222@c.us', ...over });

(async () => {
  let r = await run(delivery(), async id => { eq(id, 'false_g_ABC_5215511112222@c.us'); return inbound(); });
  eq(r.sent.length, 1); eq(r.sent[0].content, 'Buen día, @5215511112222.'); eq(r.sent[0].options, { mentions: ['5215511112222@c.us'] }); eq(r.reports, ['ATTEMPT', 'SENT']);

  // A linked-device id loses its device suffix in the visible text but is mentioned as given.
  r = await run(delivery(), async () => inbound({ author: '5215511112222:7@lid' }));
  eq(r.sent[0].content, 'Buen día, @5215511112222.'); eq(r.sent[0].options, { mentions: ['5215511112222:7@lid'] });

  // Anything that cannot be resolved sends the plain greeting, never the placeholder and never an error.
  for (const [name, d, lookup] of [
    ['message not found', delivery(), async () => null],
    ['lookup fails', delivery(), async () => { throw Error('boom'); }],
    ['from another chat', delivery(), async () => inbound({ from: '120363000000000099@g.us' })],
    ['own message', delivery(), async () => inbound({ fromMe: true })],
    ['bad author id', delivery(), async () => inbound({ author: 'abc@c.us' })],
    ['no mention id', delivery({ mention: null }), async () => inbound()],
    ['client without lookup', delivery(), undefined],
  ]) {
    r = await run(d, lookup);
    eq(r.sent.length, 1, name); eq(r.sent[0].content, 'Buen día.', name); eq(r.sent[0].options, {}, name); eq(r.reports, ['ATTEMPT', 'SENT'], name);
  }

  // A text without the placeholder is untouched and never looks anything up.
  r = await run(delivery({ text: 'Gracias por avisarnos.', mention: null }), async () => { throw Error('must not be called'); });
  eq(r.sent[0].content, 'Gracias por avisarnos.'); eq(r.sent[0].options, {});

  console.log(`whatsapp-connector-mention: ${checks} checks passed`);
})().catch(error => { console.error(error); process.exit(1); });
