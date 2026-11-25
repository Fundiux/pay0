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

// The delivery log is counts and stable codes only, so what went out can be checked from this machine.
{
  const lines = [], realLog = console.log;
  console.log = (...args) => { try { lines.push(JSON.parse(args[0])); } catch { /* not a JSON line */ } };
  try {
    await run(delivery({ text: 'Gracias por avisarnos.', mention: null }));
    await run(delivery({ kind: 'DOCUMENTS', documents: [] }));
    await run(null);
  } finally { console.log = realLog; }
  const reported = lines.filter(line => line.status === 'DELIVERY_REPORTED');
  eq(reported.map(line => [line.outcome, line.kind, line.code || null, line.sent, line.error]), [['SENT', 'TEXT', null, 1, 0], ['ERROR', 'DOCUMENTS', 'DOCUMENTS_MISSING', 0, 1]], 'one line per report, with the outcome and the stable error code');
  eq(lines.filter(line => line.status === 'DELIVERY_IDLE').map(line => line.reason), ['NOTHING_TO_SEND'], 'why nothing went out');
  ok(!/@g\.us|Gracias|\bj\b|\bd\b/.test(JSON.stringify(lines.filter(line => /^DELIVERY_/.test(line.status || '')))), 'counts and codes only: no ids, no chats, no text');
}

  // Capture in the team's internal group: nothing leaves the phone unless it addresses Hugo; a WhatsApp mention of this account is flagged.
  {
    const INTERNAL = '120363555000000201@g.us', CLIENT = '120363555000000001@g.us', batches = [], callbacks = {};
    const transport = { operate: async (action, data) => {
      if (action === 'HEARTBEAT') return { observedChats: [CLIENT, INTERNAL], addressedOnlyChats: [INTERNAL] };
      if (action === 'INBOUND_GROUP') { batches.push(data.messages); return { stored: data.messages.length }; }
      return {};
    }, synchronize: async () => ({}), getBinding: () => ({ id: 'b' }) };
    const client = { info: { wid: { _serialized: '5215500000000@c.us' } }, on: (name, cb) => { callbacks[name] = cb; }, initialize: async () => {}, destroy: async () => {}, getChats: async () => [] };
    const running = await runEnrolledConnector({ transport, client, encodeQr: async () => '', resetLocalSession: async () => {}, setTimer: fn => fn, clearTimer: () => {}, captureGroups: true });
    await callbacks.ready();
    await running.poll();
    const message = (id, chat, body, over = {}) => ({ id: { _serialized: id }, from: chat, author: '5215511112222@c.us', fromMe: false, timestamp: Math.floor(Date.now() / 1000), type: 'chat', body, ...over });
    for (const m of [
      message('c1', CLIENT, 'comentario de un cliente'), message('i1', INTERNAL, 'Hugo buen día'), message('i2', INTERNAL, 'plática del equipo'),
      message('i3', INTERNAL, '@5215500000000 ayuda', { mentionedIds: ['5215500000000@c.us'] }), message('i4', INTERNAL, 'plática', { mentionedIds: ['5215599999999@c.us'] }),
      message('i5', INTERNAL, 'Húgo?'), message('i6', INTERNAL, 'sin mención', { mentionedIds: [{ _serialized: '5215500000000@c.us' }] }),
      message('i7', INTERNAL, 'respuesta a Hugo', { hasQuotedMsg: true, getQuotedMessage: async () => ({ fromMe: true }) }),
      message('i8', INTERNAL, 'respuesta a otra persona', { hasQuotedMsg: true, getQuotedMessage: async () => ({ fromMe: false }) }),
      message('i9', INTERNAL, 'cita ilegible', { hasQuotedMsg: true, getQuotedMessage: async () => { throw new Error('gone'); } }),
    ]) await callbacks.message_create(m);
    await running.flush();
    const sent = batches.flat();
    eq(sent.map(m => m.messageId), ['c1', 'i1', 'i3', 'i5', 'i6', 'i7'], 'client groups keep everything; the internal group only what addresses Hugo');
    eq(sent.filter(m => m.mentionsMe).map(m => m.messageId), ['i3', 'i6', 'i7'], 'quoting one of his own messages addresses him');
    ok(!('mentionsMe' in sent[0]) && !('mentionsMe' in sent[1]), 'the flag is only sent when true');
    const stats = running.logCaptureStats();
    eq([stats.events, stats.groupEvents, stats.notObserved, stats.buffered, stats.groupsWithMessages, stats.observedGroups], [10, 10, 0, 6, 2, 2], 'capture counters');
    ok(!/@g\.us|hugo|buen/i.test(JSON.stringify(stats)), 'counts only: no ids or text');
    eq(running.logCaptureStats(), null, 'nothing new, nothing logged');
    await running.stop();
  }

  // History recovery on reconnect: what the observed groups received while the connector was away, read spaced out, bounded, never twice.
  {
    const A = '120363555000000001@g.us', B = '120363555000000002@g.us', C = '120363555000000003@g.us', INTERNAL = '120363555000000201@g.us';
    const NOW = Date.now(), MIN = 60000, HOUR = 60 * MIN;
    const msg = (id, chat, minutesAgo, over = {}) => ({ id: { _serialized: id }, from: chat, author: '5215511112222@c.us', fromMe: false, timestamp: Math.floor((NOW - minutesAgo * MIN) / 1000), type: 'chat', body: 'Buenos días', ...over });
    // The recovery runs in the background after a beat; its one count-only log line is what the tests read.
    const logs = [], realLog = console.log;
    console.log = (...args) => { try { const line = JSON.parse(args[0]); if (line && line.status === 'HISTORY_BACKFILL') logs.push(line); } catch { /* not a JSON line */ } realLog(...args); };
    async function recover({ previousReadyAtMs, history = {}, observed = [A, B], addressed = [], failing = [] }) {
      logs.length = 0;
      const batches = [], callbacks = {}, fetched = []; let waits = 0;
      const transport = { operate: async (action, data) => {
        if (action === 'HEARTBEAT') return { observedChats: observed, addressedOnlyChats: addressed, previousReadyAtMs };
        if (action === 'INBOUND_GROUP') { batches.push(data.messages); return { stored: data.messages.length }; }
        return {};
      }, synchronize: async () => ({}), getBinding: () => ({ id: 'b' }) };
      const client = { info: { wid: { _serialized: '5215500000000@c.us' } }, on: (name, cb) => { callbacks[name] = cb; }, initialize: async () => {}, destroy: async () => {}, getChats: async () => [],
        getChatById: async id => { if (failing.includes(id)) throw Error('chat gone'); return { fetchMessages: async options => { fetched.push([id, options.limit]); return history[id] || []; } }; } };
      const running = await runEnrolledConnector({ transport, client, encodeQr: async () => '', resetLocalSession: async () => {}, setTimer: fn => fn, clearTimer: () => {}, captureGroups: true,
        historySpacingMs: 0, wait: async () => { waits++; } });
      await callbacks.ready();
      return { running, callbacks, batches, fetched, waits: () => waits, poll: () => running.poll(), finish: async () => { await running.poll(); await new Promise(resolve => setTimeout(resolve, 40)); return logs.at(-1); } };
    }
    const sentIds = async r => { await r.running.flush(); return r.batches.flat().map(m => m.messageId); };

    // Window: since the last time it was ready (a minute of margin), group by group, spaced out, only the observed groups.
    let r = await recover({ previousReadyAtMs: NOW - 90 * MIN, observed: [A, B], history: {
      [A]: [msg('old', A, 200), msg('a1', A, 80), msg('a2', A, 40, { fromMe: true, from: '5215500000000@c.us', to: A, author: undefined })],
      [B]: [msg('b1', B, 60), msg('b1', B, 60)], [C]: [msg('c1', C, 30)] } });
    let counts = await r.finish();
    eq(r.fetched, [[A, 100], [B, 100]], 'one read per observed group, capped per chat');
    eq(counts.chats, 2); eq(counts.chatsRead, 2); eq(counts.errors, 0);
    eq(await sentIds(r), ['a1', 'a2', 'b1'], 'only what is inside the window, never the unobserved group, never twice');
    ok(counts.windowMinutes >= 90 && counts.windowMinutes <= 92, 'the window is the time away plus the margin');
    ok(!/@g\.us|Buenos/.test(JSON.stringify(counts)), 'the log has counts only: no ids and no text');
    ok(r.waits() >= 2, 'reads are spaced out');

    // Poll starts it once per process, in the background.
    r = await recover({ previousReadyAtMs: NOW - 10 * MIN, history: { [A]: [msg('a1', A, 5)] } });
    await r.poll(); await r.poll(); await new Promise(resolve => setTimeout(resolve, 30));
    eq(r.fetched.map(item => item[0]), [A, B], 'started once, not on every beat');

    // No baseline (first run) and a very short gap read nothing.
    r = await recover({ previousReadyAtMs: null, history: { [A]: [msg('a1', A, 5)] } }); counts = await r.finish(); eq(counts.skipped, 'NO_BASELINE'); eq(r.fetched, []);
    r = await recover({ previousReadyAtMs: NOW - 30000, history: { [A]: [msg('a1', A, 5)] } }); counts = await r.finish(); eq(counts.skipped, 'SHORT_GAP'); eq(r.fetched, []);

    // Never more than a day back, even after a long outage.
    r = await recover({ previousReadyAtMs: NOW - 5 * 24 * HOUR, observed: [A], history: { [A]: [msg('too-old', A, 25 * 60), msg('inside', A, 23 * 60)] } }); counts = await r.finish(); eq(await sentIds(r), ['inside']); ok(counts.windowMinutes <= 24 * 60);

    // Caps: a total cap, and the live buffer is never pushed out by recovery.
    const many = Array.from({ length: 700 }, (_unused, index) => msg('m' + index, A, 100 - index / 10));
    r = await recover({ previousReadyAtMs: NOW - 3 * HOUR, observed: [A, B], history: { [A]: many, [B]: [msg('b-late', B, 20)] } }); counts = await r.finish(); eq(counts.buffered, 600); eq(counts.capped, true, 'a total cap'); eq(r.fetched.filter(item => item[0] === B).length, 0, 'it stops at the cap');

    // The team's internal group keeps only what addresses Hugo, also when recovered.
    r = await recover({ previousReadyAtMs: NOW - 60 * MIN, observed: [A, INTERNAL], addressed: [INTERNAL], history: { [INTERNAL]: [msg('i1', INTERNAL, 30, { body: 'Hugo ayúdame' }), msg('i2', INTERNAL, 20, { body: 'plática del equipo' })] } }); await r.finish(); eq(await sentIds(r), ['i1']);

    // A group that cannot be read costs one error, not the rest.
    r = await recover({ previousReadyAtMs: NOW - 60 * MIN, observed: [A, B], failing: [A], history: { [B]: [msg('b1', B, 20)] } }); counts = await r.finish(); eq(counts.errors, 1); eq(counts.chatsRead, 1); eq(await sentIds(r), ['b1']);
    await r.running.stop();
    console.log = realLog;
  }

  // A mention of Hugo's account may carry the linked-device id (@lid) instead of the phone id: every way to recognise it.
  {
    const INTERNAL = '120363555000000201@g.us';
    async function mentionedWith(clientExtra, mentionedIds, body = '@alguien ayuda') {
      const batches = [], callbacks = {};
      const transport = { operate: async (action, data) => {
        if (action === 'HEARTBEAT') return { observedChats: [INTERNAL], addressedOnlyChats: [INTERNAL] };
        if (action === 'INBOUND_GROUP') { batches.push(data.messages); return {}; }
        return {};
      }, synchronize: async () => ({}), getBinding: () => ({ id: 'b' }) };
      const client = { info: { wid: { _serialized: '5215500000000@c.us', user: '5215500000000' } }, on: (name, cb) => { callbacks[name] = cb; }, initialize: async () => {}, destroy: async () => {}, getChats: async () => [], ...clientExtra };
      const running = await runEnrolledConnector({ transport, client, encodeQr: async () => '', resetLocalSession: async () => {}, setTimer: fn => fn, clearTimer: () => {}, captureGroups: true });
      await callbacks.ready(); await running.poll();
      await callbacks.message_create({ id: { _serialized: 'm1' }, from: INTERNAL, author: '5215511112222@c.us', fromMe: false, timestamp: Math.floor(Date.now() / 1000), type: 'chat', body, mentionedIds });
      await running.flush(); await running.stop();
      return batches.flat().map(m => ({ id: m.messageId, mentionsMe: m.mentionsMe === true }));
    }
    eq(await mentionedWith({}, ['5215500000000@c.us']), [{ id: 'm1', mentionsMe: true }], 'the phone id');
    eq(await mentionedWith({}, ['5215500000000:12@c.us']), [{ id: 'm1', mentionsMe: true }], 'the phone id with a device suffix');
    eq(await mentionedWith({ info: { wid: { _serialized: '5215500000000@c.us' }, lid: { _serialized: '88776655@lid' } } }, ['88776655@lid']), [{ id: 'm1', mentionsMe: true }], 'the own lid from client.info');
    eq(await mentionedWith({ getContactLidAndPhone: async ids => { eq(ids, ['5215500000000@c.us']); return [{ lid: '88776655@lid', pn: '5215500000000@c.us' }]; } }, ['88776655@lid']), [{ id: 'm1', mentionsMe: true }], 'the own lid from getContactLidAndPhone');
    eq(await mentionedWith({ getContactById: async id => { eq(id, '88776655@lid'); return { id: { _serialized: '88776655@lid' }, number: '5215500000000' }; } }, ['88776655@lid']), [{ id: 'm1', mentionsMe: true }], 'an unknown lid resolved to the own contact');
    eq(await mentionedWith({ getContactById: async () => ({ id: { _serialized: '1@lid' }, number: '5215599999999' }) }, ['1@lid']), [], 'a lid of someone else is not a mention (and nothing else addresses Hugo)');
    eq(await mentionedWith({ getContactById: async () => { throw Error('boom'); } }, ['1@lid']), [], 'a lookup that fails is not a mention');
    eq(await mentionedWith({ getContactById: async () => ({ number: '5215500000000' }) }, ['2@lid'], 'Hugo ayuda'), [{ id: 'm1', mentionsMe: true }], 'the name still addresses him and the lid resolves too');
  }

  console.log(`whatsapp-connector-mention: ${checks} checks passed`);
})().catch(error => { console.error(error); process.exit(1); });
