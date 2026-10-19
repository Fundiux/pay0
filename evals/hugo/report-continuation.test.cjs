const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.env.HUGO_TEST_FUNCTIONS_ROOT || 'functions');
const load = name => require(path.join(root, 'lib', name));
const helpers = load('modules/sharedCallables/helpers');
const { executeEarningsReportTool } = load('modules/agent007/reportConnector');
const { HugoConversationCore } = load('modules/agent007/hugoCore/conversationCore');
const { HugoToolRouter } = load('modules/agent007/hugoCore/toolRouter');
const { emptyConversationState, normalizeConversationState } = load('modules/agent007/hugoCore/conversationState');
const { formatEarningsReport, claimsUnexecutedReport } = load('modules/agent007/hugoCore/reportSemantics');
const identity = { uid: 'reviewer', rootId: 'fixture-root', role: 'superadmin' };
const users = { reviewer: { role: 'superadmin', rootId: identity.rootId, active: true }, denied: { role: 'superadmin', rootId: identity.rootId, active: false } };
const at = new Date('2026-09-10T12:00:00Z');
let rows, queries = 0;
const originalDoc = helpers.db.doc, originalCollection = helpers.db.collection;
function resetRows() {
  rows = Array.from({ length: 30 }, (_, i) => ({ id: `other-${i}`, rootId: identity.rootId, clienteId: `other-${i}`, clienteNombre: `Otro ${i}`, totalEarningsAmount: 100 + i, createdAt: at }));
  rows.push({ id: 'pc-a', rootId: identity.rootId, clienteId: 'pc', clienteNombre: 'PC Directo', totalEarningsAmount: 12.35, createdAt: at },
    { id: 'pc-b', rootId: identity.rootId, clienteId: 'pc', clienteNombre: 'PC Directo', totalEarningsAmount: 25.10, createdAt: at },
    { id: 'pc-comp', rootId: identity.rootId, clienteId: 'pc', clienteNombre: 'PC Directo', totalEarningsAmount: 99, status: 'COMPENSATED', createdAt: at },
    { id: 'foreign', rootId: 'foreign-root', clienteId: 'foreign', clienteNombre: 'PC Directo', totalEarningsAmount: 99999, createdAt: at });
}
before(() => {
  resetRows();
  helpers.db.doc = name => ({ get: async () => ({ exists: !!users[name.split('/')[1]], data: () => structuredClone(users[name.split('/')[1]]) }) });
  helpers.db.collection = name => {
    assert.equal(name, 'earningsDistributions'); queries++;
    let selected = [...rows];
    const query = { where: (key, op, value) => { selected = selected.filter(row => op === '==' ? row[key] === value : op === '>=' ? row[key] >= value : row[key] <= value); return query; },
      orderBy: () => query, limit: value => { selected = selected.slice(0, value); return query; }, get: async () => ({ docs: selected.map(row => ({ id: row.id, data: () => row })) }) };
    return query;
  };
});
after(() => { helpers.db.doc = originalDoc; helpers.db.collection = originalCollection; });
const request = (uid = identity.uid) => ({ auth: { uid, token: {} } });
const dates = { dateFrom: '2026-09-01', dateTo: '2026-09-30', limit: 5000 };
function conversation() {
  let state = emptyConversationState(identity.rootId), modelCalls = 0;
  const router = new HugoToolRouter(identity, { getEarningsByClientReport: data => executeEarningsReportTool(request(), data),
    searchSolicitudes: async () => blank('searchSolicitudes'), searchPagos: async () => blank('searchPagos'), getPaymentComplementStatus: async () => blank('getPaymentComplementStatus'), getIqCapabilities: async () => blank('getIqCapabilities') });
  const store = { loadConversationState: async () => ({ history: [], memory: { recommendations: [], rules: [] }, recentEntities: [], conversationState: state }) };
  const model = { generate: async () => { modelCalls++; return { text: 'El reporte está generado y listo para descargar.', model: 'synthetic', modelVersion: '1', promptVersion: 'hugo-v2', tokenUsage: null }; } };
  const blank = tool => ({ tool, sourceSystem: 'PAY0', retrievedAt: new Date().toISOString(), scope: { rootId: identity.rootId }, completeness: 'UNKNOWN', evidence: [], data: [], trace: { latencyMs: 0, result: 'OK' } });
  return { send: async message => { const out = await new HugoConversationCore(router, model, store).respond({ channel: 'WEB', identity, conversationId: `${identity.rootId}_${identity.uid}`, name: 'Fixture', message, promptVersion: 'hugo-v2' }); state = out.conversationState; return out; }, modelCalls: () => modelCalls, state: () => state };
}

test('exact reported sequence retains client and executes canonical report after date clarification', async () => {
  const session = conversation(), beforeQueries = queries;
  const first = await session.send('genera reporte utilidades cliente pc directo');
  assert.match(first.text, /fecha/i); assert.equal(queries, beforeQueries);
  const clarified = await session.send('hola dame un reporte de utilidades del cliente pc directo del mes de septiembre');
  assert.match(clarified.text, /fecha/i); assert.equal(queries, beforeQueries);
  const second = await session.send('septiembre');
  assert.match(second.text, /fecha/i); assert.equal(queries, beforeQueries);
  const report = await session.send('2026-09-01 al 2026-09-30');
  assert.deepEqual(report.toolsExecuted.map(row => row.tool), ['getEarningsByClientReport']);
  assert.match(report.text, /PC Directo/); assert.match(report.text, /37\.45/);
  assert.equal(report.reportExport.rows.length, 1);
  assert.equal(report.reportExport.rows[0].clienteId, 'pc');
  assert.equal(report.reportExport.rows[0].totalEarningsAmount, 37.45);
  assert.equal(session.modelCalls(), 0);
  const download = await session.send('¿Dónde lo descargo?');
  assert.equal(download.reportExport.rows[0].clienteId, 'pc');
  assert.equal(session.modelCalls(), 0);
});

test('client ambiguity and absence export nothing and never expose another root', async () => {
  rows.push({ id: 'north', rootId: identity.rootId, clienteId: 'pc-north', clienteNombre: 'PC Norte', totalEarningsAmount: 100, createdAt: at });
  const ambiguous = await executeEarningsReportTool(request(), { ...dates, clientQuery: 'pc' });
  assert.equal(ambiguous.data.clientResolution.status, 'AMBIGUOUS'); assert.equal(ambiguous.data.reportExport, undefined); assert.equal(ambiguous.data.summary, null);
  assert.doesNotMatch(formatEarningsReport(ambiguous.data), /99999/);
  const missing = await executeEarningsReportTool(request(), { ...dates, clientQuery: 'foreign' });
  assert.equal(missing.data.clientResolution.status, 'NOT_FOUND'); assert.equal(missing.data.reportExport, undefined);
  resetRows();
});

test('compensated choice persists across clarification; expired or foreign pending context is discarded', async () => {
  const session = conversation();
  await session.send('reporte utilidades cliente pc directo incluye compensadas');
  const result = await session.send('2026-09-01 al 2026-09-30');
  assert.equal(result.reportExport.rows[0].totalEarningsAmount, 136.45); assert.equal(result.reportExport.includeCompensated, true);
  const state = session.state();
  assert.equal(normalizeConversationState(state, 'foreign-root').pendingEarningsReport, undefined);
  assert.equal(normalizeConversationState(state, identity.rootId, Date.now() + 31 * 60_000).pendingEarningsReport, undefined);
  assert.equal(normalizeConversationState({ ...state, turn: state.turn + 5 }, identity.rootId).pendingEarningsReport, undefined);
});

test('ambiguous client is resolved by the next answer without changing the saved period', async () => {
  rows.push({ id: 'north', rootId: identity.rootId, clienteId: 'pc-north', clienteNombre: 'PC Norte', totalEarningsAmount: 100, createdAt: at });
  const session = conversation();
  const first = await session.send('reporte utilidades cliente pc del 2026-09-01 al 2026-09-30');
  assert.equal(first.reportExport, undefined); assert.match(first.text, /varios clientes/);
  const resolved = await session.send('PC Directo');
  assert.equal(resolved.reportExport.rows.length, 1); assert.equal(resolved.reportExport.rows[0].clienteId, 'pc');
  assert.equal(resolved.reportExport.dateFrom, dates.dateFrom); assert.equal(session.modelCalls(), 0);
  const changedMonth = await session.send('octubre');
  assert.equal(changedMonth.reportExport, undefined); assert.match(changedMonth.text, /fecha/i);
  resetRows();
});

test('an unrelated topic clears the pending report rather than reusing its client', async () => {
  const session = conversation();
  await session.send('reporte utilidades cliente pc directo');
  await session.send('cambiando de tema');
  assert.equal(session.state().pendingEarningsReport, undefined);
});

test('client names retain de and del and cannot select a shorter exact name', async () => {
  for (const name of ['Banco', 'Banco de México', 'La Casa', 'La Casa del Sol']) rows.push({ id: name, rootId: identity.rootId, clienteId: name, clienteNombre: name, totalEarningsAmount: 1, createdAt: at });
  for (const name of ['Banco de México', 'La Casa del Sol']) {
    const result = await conversation().send(`reporte utilidades cliente ${name} del 2026-09-01 al 2026-09-30`);
    assert.equal(result.reportExport.rows[0].clienteNombre, name);
  }
  resetRows();
});

test('export bounds preserve canonical values and declare truncation; no undefined or nonfinite cells', async () => {
  for (let i = 0; i < 300; i++) rows.push({ id: `bulk${i}`, rootId: identity.rootId, clienteId: `bulk${i}`, clienteNombre: 'Cliente '.repeat(200), totalEarningsAmount: i, createdAt: at });
  const result = await executeEarningsReportTool(request(), dates), artifact = result.data.reportExport;
  assert.equal(artifact.rows.length, 250); assert.equal(artifact.truncatedByExport, true);
  assert.ok(Buffer.byteLength(JSON.stringify(artifact), 'utf8') <= 350000);
  assert.match(artifact.fileName, /^pay0-utilidades-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.ok(artifact.rows.every(row => row.clienteNombre.length <= 200 && Object.values(row).every(value => value !== undefined && (typeof value !== 'number' || Number.isFinite(value)))));
  await assert.rejects(executeEarningsReportTool(request('denied'), dates), e => e.code === 'permission-denied');
  resetRows();
});

test('an unsupported model claim cannot assert a report or download was generated', async () => {
  const result = await conversation().send('Hola');
  assert.equal(result.responsePolicy, 'UNBACKED_REPORT_CLAIM');
  assert.equal(result.reportExport, undefined); assert.match(result.text, /No he ejecutado/);
  for (const answer of ['Generaré el reporte y te entregaré el Excel.', 'Voy a preparar el reporte.', 'Te lo adjunto, listo.']) {
    assert.equal(claimsUnexecutedReport(answer, 'Necesito el reporte'), true);
  }
});
