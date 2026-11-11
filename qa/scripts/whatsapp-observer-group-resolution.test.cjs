'use strict';
const assert = require('node:assert/strict');
const { resolveObservableGroup } = require('../../functions/lib/modules/documentDelivery/whatsappObserverGroups.js');

// Minimal Firestore fake: collections of rows, equality filters, doc reads by path.
function fakeDb({ agentChats = [], legacy = {} }) {
  const snap = row => ({ exists: !!row, get: field => (row ? row[field] : undefined) });
  return {
    doc: path => ({ get: async () => snap(legacy[path]) }),
    collection: name => {
      assert.equal(name, 'whatsappAgentChats');
      const filters = [];
      const q = {
        where(field, op, value) { assert.equal(op, '=='); filters.push([field, value]); return q; },
        limit() { return q; },
        async get() { return { docs: agentChats.filter(row => filters.every(([f, v]) => row[f] === v)).map(snap) }; },
      };
      return q;
    },
  };
}
const chat = '120363000000000001@g.us';
const legacyPath = 'whatsappQrChats/' + encodeURIComponent(chat);
const agentRow = (over = {}) => ({ rootId: 'root-a', chatId: chat, name: 'MARTIN PDC - PAY0', isGroup: true, active: true, ...over });

(async () => {
  let checks = 0;
  const ok = (fn) => { fn(); checks++; };

  // Only in the agent's synced chats.
  let r = await resolveObservableGroup(fakeDb({ agentChats: [agentRow()] }), 'root-a', chat);
  ok(() => assert.deepEqual(r, { name: 'MARTIN PDC - PAY0', source: 'AGENT' }));

  // The reported bug: it also exists in the historic connector but that row is invalid. The agent row must win.
  for (const invalid of [{ rootId: 'root-other', isGroup: true }, { rootId: 'root-a', isGroup: false }, { rootId: 'root-a' }]) {
    r = await resolveObservableGroup(fakeDb({ agentChats: [agentRow()], legacy: { [legacyPath]: { name: 'Viejo', ...invalid } } }), 'root-a', chat);
    ok(() => assert.deepEqual(r, { name: 'MARTIN PDC - PAY0', source: 'AGENT' }));
  }

  // Agent row wins even when the historic one is valid.
  r = await resolveObservableGroup(fakeDb({ agentChats: [agentRow()], legacy: { [legacyPath]: { name: 'Viejo', rootId: 'root-a', isGroup: true } } }), 'root-a', chat);
  ok(() => assert.equal(r.source, 'AGENT'));

  // A stale agent row (inactive, private, other root) is skipped and a later valid row is used.
  r = await resolveObservableGroup(fakeDb({ agentChats: [agentRow({ active: false, name: 'Stale' }), agentRow({ isGroup: false }), agentRow({ rootId: 'root-b' }), agentRow({ name: 'Vigente' })] }), 'root-a', chat);
  ok(() => assert.deepEqual(r, { name: 'Vigente', source: 'AGENT' }));

  // Only a valid historic row is accepted as a fallback.
  r = await resolveObservableGroup(fakeDb({ legacy: { [legacyPath]: { name: '  Historico  Valido ', rootId: 'root-a', isGroup: true } } }), 'root-a', chat);
  ok(() => assert.deepEqual(r, { name: 'Historico Valido', source: 'LEGACY' }));
  r = await resolveObservableGroup(fakeDb({ legacy: { [legacyPath]: { name: 'X', rootId: 'root-other', isGroup: true } } }), 'root-a', chat);
  ok(() => assert.equal(r, null));

  // Nothing valid anywhere, a private chat and another root's group are all refused.
  ok(() => assert.equal(r, null));
  r = await resolveObservableGroup(fakeDb({ agentChats: [agentRow({ isGroup: false }), agentRow({ rootId: 'root-b' }), agentRow({ active: false })] }), 'root-a', chat);
  ok(() => assert.equal(r, null));
  r = await resolveObservableGroup(fakeDb({}), 'root-a', chat);
  ok(() => assert.equal(r, null));

  console.log(`whatsapp-observer-group-resolution: ${checks} checks passed`);
})().catch(error => { console.error(error); process.exit(1); });
