const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const corePath = '../../functions/lib/modules/agent007/';
const helpers = require('../../functions/lib/modules/sharedCallables/helpers');
const { getEarningsByClientReportHandler } = require('../../functions/lib/modules/reports/callables');
const { executeEarningsReportTool } = require(corePath + 'reportConnector');
const { HugoToolRouter } = require(corePath + 'hugoCore/toolRouter');
const { HugoConversationCore } = require(corePath + 'hugoCore/conversationCore');
const { emptyConversationState } = require(corePath + 'hugoCore/conversationState');
const { formatVoicePlatformResult } = require(corePath + 'voiceDelegation');
const { earningsReportRequest } = require(corePath + 'hugoCore/reportSemantics');

// Only synthetic in-memory Firestore data. Every unknown access throws.
const users = {
  reviewer: { role: 'superadmin', rootId: 'fixture-root', active: true },
  administrator: { role: 'admin', rootId: 'fixture-root', active: true },
  denied: { role: 'admin', rootId: 'fixture-root', active: true, modules: { reportes: { view: false } } },
  disabled: { role: 'superadmin', rootId: 'fixture-root', active: false },
};
const rows = [
  { id: 'one', rootId: 'fixture-root', adminId: 'administrator', clienteId: 'client-one', grossAmount: 100, totalEarningsAmount: 12.35, createdAt: new Date('2026-10-03T10:00:00Z') },
  { id: 'two', rootId: 'fixture-root', adminId: 'other-admin', clienteId: 'client-two', grossAmount: 200, totalEarningsAmount: 25.10, createdAt: new Date('2026-10-04T10:00:00Z') },
  { id: 'compensated', rootId: 'fixture-root', adminId: 'administrator', clienteId: 'client-one', totalEarningsAmount: 99, status: 'COMPENSATED', createdAt: new Date('2026-10-05T10:00:00Z') },
  { id: 'foreign', rootId: 'foreign-root', clienteId: 'foreign-client', totalEarningsAmount: 99999, createdAt: new Date('2026-10-06T10:00:00Z') },
  { id: 'prior', rootId: 'fixture-root', clienteId: 'prior-client', totalEarningsAmount: 999, createdAt: new Date('2026-09-01T10:00:00Z') },
];
const originalDoc = helpers.db.doc;
const originalCollection = helpers.db.collection;
let queries = 0;
before(() => {
  helpers.db.doc = path => {
    assert.match(path, /^(users|usuarios)\/[a-z-]+$/);
    const user = users[path.split('/')[1]];
    return { get: async () => ({ exists: Boolean(user), data: () => user && structuredClone(user) }) };
  };
  helpers.db.collection = name => {
    assert.equal(name, 'earningsDistributions');
    queries++;
    let selected = [...rows];
    const query = {
      where(field, operator, value) {
        selected = selected.filter(row => operator === '==' ? row[field] === value : operator === '>=' ? row[field] >= value : row[field] <= value);
        return query;
      },
      orderBy(field, direction) { assert.deepEqual([field, direction], ['createdAt', 'desc']); selected.sort((a, b) => b.createdAt - a.createdAt); return query; },
      limit(value) { selected = selected.slice(0, value); return query; },
      async get() { return { docs: selected.map(row => ({ id: row.id, data: () => row })) }; },
    };
    return query;
  };
});
after(() => { helpers.db.doc = originalDoc; helpers.db.collection = originalCollection; });
const input = { dateFrom: '2026-10-01', dateTo: '2026-10-19', limit: 5000 };
const request = (uid = 'reviewer', data = input) => ({ auth: { uid, token: {} }, data });
const identity = { uid: 'reviewer', rootId: 'fixture-root', role: 'superadmin' };
const router = () => new HugoToolRouter(identity, { getEarningsByClientReport: data => executeEarningsReportTool(request(), data) });

test('canonical report, authorized tool, written core and voice share the same controlled financial result', async () => {
  const canonical = await getEarningsByClientReportHandler(request());
  assert.equal(canonical.summary.totalEarningsAmount, 37.45);
  assert.equal(canonical.summary.operationsCount, 2);
  assert.equal(canonical.summary.grossAmount, 300);
  const result = await router().execute({ name: 'getEarningsByClientReport', input });
  assert.deepEqual(result.data.summary, canonical.summary);
  assert.equal(result.scope.rootId, 'fixture-root');
  assert.equal(result.data.rows.some(row => row.clienteId === 'foreign-client'), false);
  const speech = formatVoicePlatformResult('getEarningsByClientReport', result.data);
  assert.match(speech, /37\.45/);
  assert.match(speech, /compensadas excluidas/);
  const inclusive = await router().execute({ name: 'getEarningsByClientReport', input: { ...input, includeCompensated: true } });
  assert.equal(inclusive.data.summary.totalEarningsAmount, 136.45);
  assert.match(formatVoicePlatformResult('getEarningsByClientReport', inclusive.data), /compensadas incluidas/);
  assert.equal(earningsReportRequest('Reporte de utilidades por cliente del 2026-10-01 al 2026-10-19 incluye compensadas').includeCompensated, true);
  assert.equal(earningsReportRequest('Reporte de utilidades por cliente del 2026-10-01 al 2026-10-19 sin compensadas').includeCompensated, false);
  const data = { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: emptyConversationState(identity.rootId) }) };
  const adapter = { generate: async () => { throw Error('UNEXPECTED_MODEL_CALL'); }, generateCanonical: async () => { throw Error('UNEXPECTED_MODEL_CALL'); } };
  const core = new HugoConversationCore(router(), adapter, data);
  const response = await core.respond({ channel: 'WEB', identity, name: 'Fixture', conversationId: 'fixture-report', message: 'Reporte de utilidades por cliente del 2026-10-01 al 2026-10-19', promptVersion: 'hugo-v2' });
  assert.equal(response.text, speech);
  assert.equal(response.responsePolicy, 'DETERMINISTIC_OPERATION');
  assert.deepEqual(response.toolsExecuted.map(row => row.tool), ['getEarningsByClientReport']);
});

test('canonical handler rechecks authentication, profile status, module and administrator scope', async () => {
  const before = queries;
  await assert.rejects(() => getEarningsByClientReportHandler({ data: input }), { code: 'unauthenticated' });
  for (const uid of ['denied', 'disabled']) await assert.rejects(() => executeEarningsReportTool(request(uid), input), { code: 'permission-denied' });
  assert.equal(queries, before, 'denied callers must never query financial records');
  const admin = await getEarningsByClientReportHandler(request('administrator'));
  assert.equal(admin.summary.totalEarningsAmount, 12.35);
});

test('bounded reports disclose truncation and reject injected identity, malformed dates and limits', async () => {
  const limited = await router().execute({ name: 'getEarningsByClientReport', input: { ...input, limit: 1 } });
  assert.equal(limited.completeness, 'PARTIAL');
  assert.equal(limited.data.mayBeTruncated, true);
  assert.match(formatVoicePlatformResult('getEarningsByClientReport', limited.data), /puede estar incompleto/);
  for (const invalid of [{ rootId: 'foreign-root' }, { dateFrom: undefined }, { dateFrom: '2026-02-30' }, { dateTo: '2026-09-01' }, { limit: 5001 }, { limit: NaN }, { includeCompensated: 'true' }]) {
    await assert.rejects(() => router().execute({ name: 'getEarningsByClientReport', input: { ...input, ...invalid } }), /HUGO_TOOL_INVALID_INPUT/);
  }
  assert.equal(earningsReportRequest('reporte de utilidades por cliente del mes pasado'), null);
  assert.equal(earningsReportRequest('reporte de utilidades por cliente del 2026-02-30 al 2026-03-05'), null);
});

test('ambiguous or invalid report dates ask for a range before accessing data or a model', async () => {
  const data = { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: emptyConversationState(identity.rootId) }) };
  const adapter = { generate: async () => { throw Error('UNEXPECTED_MODEL_CALL'); }, generateCanonical: async () => { throw Error('UNEXPECTED_MODEL_CALL'); } };
  const core = new HugoConversationCore(router(), adapter, data);
  for (const period of ['del mes pasado', 'del 2026-02-30 al 2026-03-05']) {
    const before = queries;
    const response = await core.respond({ channel: 'WEB', identity, name: 'Fixture', conversationId: 'fixture-report', message: `Reporte de utilidades por cliente ${period}`, promptVersion: 'hugo-v2' });
    assert.match(response.text, /fecha inicial y final/);
    assert.equal(response.toolsExecuted.length, 0);
    assert.equal(queries, before);
  }
});
