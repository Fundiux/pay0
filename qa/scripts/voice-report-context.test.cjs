// Source helper unit tests: fake transaction transport, real authorization and validator.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
const ts = require('../../functions/node_modules/typescript');
const filename = path.resolve(__dirname, '../../functions/src/modules/agent007/voiceReportContext.ts');
const exported = {};
new Function('require', 'exports', ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText)(
  createRequire(path.resolve(__dirname, '../../functions/lib/modules/agent007/voiceReportContext.js')), exported);
const { beginVoiceReportTurn: begin, completeVoiceReportTurn: complete, saveVoiceCoreReferenceState: saveReferences } = exported;
const actor = { uid: 'voice-owner', rootId: 'voice-root', sessionId: 'rtc-synthetic' };
const query = { dateFrom: '2026-09-01', dateTo: '2026-09-30', limit: 5000, includeCompensated: false };
const result = (input = query, resolution) => ({ tool: 'getEarningsByClientReport', sourceSystem: 'PAY0', scope: { rootId: actor.rootId },
  data: { ...input, ...(resolution ? { clientResolution: { status: resolution } } : {}),
    ...(input.compareDateFrom ? { comparison: { dateFrom: input.compareDateFrom, dateTo: input.compareDateTo } } : {}), totalEarningsAmount: 123456789 } });
function database() {
  const rows = new Map([['users/voice-owner', { role: 'superadmin', rootId: actor.rootId, active: true }]]);
  return { rows, doc: value => ({ path: value }), async runTransaction(callback) {
    const staged = new Map([...rows].map(([key, value]) => [key, structuredClone(value)]));
    const tx = { async get(ref) { const value = staged.get(ref.path); return { exists: !!value, data: () => value && structuredClone(value) }; },
      update(ref, fields) { const value = staged.get(ref.path); assert(value); for (const [key, item] of Object.entries(fields)) {
        const parts = key.split('.'); let target = value; for (const part of parts.slice(0, -1)) target = target[part] ||= {};
        target[parts.at(-1)] = structuredClone(item);
      } },
      set(ref, value, options) { staged.set(ref.path, options?.merge ? { ...(staged.get(ref.path) || {}), ...structuredClone(value) } : structuredClone(value)); } };
    const output = await callback(tx); rows.clear(); for (const [key, value] of staged) rows.set(key, value); return output;
  } };
}
const reserve = (db, options = {}, identity = actor) => begin(db, identity, { reset: false, invalidate: true, now: 1000, ...options });
const state = db => [...db.rows].find(([key]) => key.includes('/voiceReportContexts/'))?.[1];

test('stores validated filters only and preserves explicit compensated/client/format settings', async () => {
  const db = database(), { ticket } = await reserve(db);
  const input = { ...query, clientQuery: 'Synthetic Client', format: 'PDF', includeCompensated: true };
  assert.deepEqual(await complete(db, ticket, input, result(input, 'RESOLVED'), 1000), { current: true, remembered: true });
  const next = await reserve(db, { invalidate: false, now: 1001 });
  assert.deepEqual(next.previous.query, input);
  assert.equal(JSON.stringify(state(db)).includes('totalEarningsAmount'), false);
  assert.equal(JSON.stringify(state(db)).includes('123456789'), false);
});
test('newer response B wins even when earlier A completes last', async () => {
  const db = database(), a = await reserve(db), b = await reserve(db);
  const nextQuery = { ...query, dateFrom: '2026-10-01', dateTo: '2026-10-31' };
  await complete(db, b.ticket, nextQuery, result(nextQuery), 1000);
  assert.deepEqual(await complete(db, a.ticket, query, result(), 1000), { current: false, remembered: false });
  assert.deepEqual(state(db).report.query, nextQuery);
});
test('failed or ambiguous new query cannot revive an earlier client', async () => {
  const db = database(), a = await reserve(db); await complete(db, a.ticket, query, result(), 1000);
  const b = await reserve(db); assert(b.previous); assert.equal(state(db).report, undefined);
  assert.deepEqual(await complete(db, b.ticket, query, result(query, 'AMBIGUOUS'), 1000), { current: true, remembered: false });
  assert.equal((await reserve(db)).previous, null);
});
test('different actor, root and RTC never share report filters', async () => {
  const db = database(), a = await reserve(db); await complete(db, a.ticket, query, result(), 1000);
  db.rows.set('users/other', { role: 'superadmin', rootId: actor.rootId, active: true });
  assert.equal((await reserve(db, {}, { ...actor, uid: 'other' })).previous, null);
  assert.equal((await reserve(db, {}, { ...actor, sessionId: 'rtc-other' })).previous, null);
  await assert.rejects(reserve(db, {}, { ...actor, rootId: 'foreign-root' }), error => error.code === 'permission-denied');
});
test('role/root revocation is checked both before loading and after query', async () => {
  const db = database(), a = await reserve(db);
  db.rows.set('users/voice-owner', { role: 'admin', rootId: actor.rootId, active: true });
  await assert.rejects(complete(db, a.ticket, query, result(), 1000), error => error.code === 'permission-denied');
  await assert.rejects(reserve(db), error => error.code === 'permission-denied');
  db.rows.set('users/voice-owner', { role: 'superadmin', rootId: 'foreign-root', active: true });
  await assert.rejects(reserve(db), error => error.code === 'permission-denied');
});
test('TTL, four intervening turns, reset and future timestamps fail closed', async () => {
  const db = database(), a = await reserve(db); await complete(db, a.ticket, query, result(), 1000);
  assert.equal((await reserve(db, { invalidate: false, now: 1000 + 31 * 60000 })).previous, null);
  const b = await reserve(db); await complete(db, b.ticket, query, result(), 1000);
  for (let i = 0; i < 5; i++) await reserve(db, { invalidate: false });
  assert.equal((await reserve(db, { invalidate: false })).previous, null);
  const c = await reserve(db); await complete(db, c.ticket, query, result(), 1000);
  assert.equal((await reserve(db, { reset: true })).previous, null);
  const d = await reserve(db); await complete(db, d.ticket, query, result(), 2000);
  assert.equal((await reserve(db, { now: 1000 })).previous, null);
});
test('malformed counters and foreign parent cannot be reset into a valid ticket', async () => {
  const db = database(); await reserve(db);
  const record = state(db); record.generation = null;
  await assert.rejects(reserve(db), error => error.code === 'failed-precondition');
  const other = database(); other.rows.set(`agent007Conversations/${actor.rootId}_${actor.uid}_global`, { rootId: actor.rootId, ownerUid: 'other', status: 'ACTIVE' });
  await assert.rejects(reserve(other), error => error.code === 'permission-denied');
});
test('wrong scope and injected money/identity filters cannot be remembered', async () => {
  const db = database(), a = await reserve(db);
  await assert.rejects(complete(db, a.ticket, { ...query, amount: 100 }, result(), 1000));
  await assert.rejects(complete(db, a.ticket, query, { ...result(), scope: { rootId: 'foreign' } }, 1000), error => error.code === 'permission-denied');
  assert.equal(state(db).report, undefined);
});
test('corrupt stored query extras cannot be injected into a later tool', async () => {
  const db = database(), a = await reserve(db); await complete(db, a.ticket, query, result(), 1000);
  state(db).report.query.rootId = 'foreign';
  assert.equal((await reserve(db, { invalidate: false })).previous, null);
});
const emptyState = () => ({ version: 'conversation-state-v2', rootId: actor.rootId, turn: 1, activeEntity: null, recentEntities: [], pendingAmbiguity: [], lastIntent: null });
const parentPath = `agent007Conversations/${actor.rootId}_${actor.uid}_global`;
const parentWithText = () => ({ rootId: actor.rootId, ownerUid: actor.uid, status: 'ACTIVE', conversationState: {
  ...emptyState(), lastEarningsReport: { textSentinel: 'TEXT_REPORT_UNCHANGED' }, pendingEarningsReport: { textSentinel: 'TEXT_PENDING_UNCHANGED' },
} });
test('VOICE report references never replace the global TEXT report map', async () => {
  const db = database(); db.rows.set(parentPath, parentWithText()); const a = await reserve(db);
  const before = structuredClone(db.rows.get(parentPath).conversationState);
  assert.deepEqual(await saveReferences(db, a.ticket, { ...emptyState(), lastEarningsReport: { wrong: 'VOICE_ONLY' } }, true), { current: true, globalUpdated: false });
  assert.deepEqual(db.rows.get(parentPath).conversationState, before);
  assert.equal(state(db).referenceState.lastEarningsReport, undefined);
});
test('non-report reference leaves preserve TEXT fields and concurrent TEXT changes win', async () => {
  const db = database(); db.rows.set(parentPath, parentWithText()); const a = await reserve(db);
  const voiceState = { ...emptyState(), turn: 2, lastIntent: 'STATUS' };
  assert.deepEqual(await saveReferences(db, a.ticket, voiceState, false), { current: true, globalUpdated: true });
  assert.equal(db.rows.get(parentPath).conversationState.lastEarningsReport.textSentinel, 'TEXT_REPORT_UNCHANGED');
  assert.equal(db.rows.get(parentPath).conversationState.pendingEarningsReport.textSentinel, 'TEXT_PENDING_UNCHANGED');
  const b = await reserve(db); const latest = { ...parentWithText().conversationState, turn: 9, lastEarningsReport: { textSentinel: 'NEWER_TEXT' } };
  db.rows.get(parentPath).conversationState = structuredClone(latest);
  assert.deepEqual(await saveReferences(db, b.ticket, voiceState, false), { current: true, globalUpdated: false });
  assert.deepEqual(db.rows.get(parentPath).conversationState, latest);
  assert.equal((await reserve(db)).referenceState.turn, 2);
});
test('a late Core reference writer cannot overwrite a newer RTC generation', async () => {
  const db = database(), a = await reserve(db); await reserve(db);
  assert.deepEqual(await saveReferences(db, a.ticket, emptyState(), false), { current: false, globalUpdated: false });
  assert.equal(state(db).referenceState, undefined);
});
