'use strict';
const assert = require('node:assert/strict');
const { summarizeAgentChats } = require('../../functions/lib/modules/documentDelivery/whatsappAgentChatsDomain.js');

const ts = ms => ({ toMillis: () => ms });
const rows = [
  { chatId: 'g2@g.us', name: '  Betell   Operaciones ', isGroup: true, active: true, archived: false, pinned: true, lastSyncedAt: ts(1000) },
  { chatId: 'g1@g.us', name: 'Acier', isGroup: true, active: true, archived: true, pinned: false },
  { chatId: 'g3@g.us', name: 'Viejo', isGroup: true, active: false },
  { chatId: '5215512345678@c.us', name: 'Juan Perez', isGroup: false, active: true },
  { chatId: '5215587654321@c.us', name: 'Otro', isGroup: false, active: true },
  { chatId: '5215500000000@c.us', name: 'Inactivo', isGroup: false, active: false },
];
const out = summarizeAgentChats(rows);
assert.deepEqual(out.groups.map(g => g.name), ['Acier', 'Betell Operaciones']);
assert.equal(out.groups[1].lastSyncedAtMs, 1000);
assert.equal(out.groups[0].lastSyncedAtMs, null);
assert.equal(out.privateChats, 2);
assert.equal(out.truncated, false);
// A private chat never leaves the server: no id, name or number in the result.
const text = JSON.stringify(out);
for (const secret of ['5215512345678', 'Juan Perez', '5215587654321', 'Otro', 'Inactivo', 'Viejo']) assert.ok(!text.includes(secret), secret);
assert.equal(summarizeAgentChats([], true).truncated, true);
console.log('whatsapp-agent-chats-summary: 8 checks passed');
