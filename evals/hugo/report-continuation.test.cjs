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
    searchSolicitudes: async () => blank('searchSolicitudes'), searchPagos: async () => blank('searchPagos'), getPaymentComplementStatus: async () => blank('getPaymentComplementStatus'), getIqCapabilities: async () => blank('getIqCapabilities'),
    getAuthorizedCapabilities: async () => blank('getAuthorizedCapabilities'), getLastOperationDiagnostic: async () => blank('getLastOperationDiagnostic') });
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
  assert.match(report.text, /PDF.*Excel/); assert.equal(report.reportExport, undefined); assert.equal(queries, beforeQueries);
  const chosen = await session.send('Excel');
  assert.deepEqual(chosen.toolsExecuted.map(row => row.tool), ['getEarningsByClientReport']);
  assert.match(chosen.text, /PC Directo/); assert.match(chosen.text, /37\.45/);
  assert.equal(chosen.reportExport.rows.length, 1);
  assert.equal(chosen.reportExport.rows[0].clienteId, 'pc');
  assert.equal(chosen.reportExport.rows[0].totalEarningsAmount, 37.45);
  assert.equal(chosen.reportExport.format, 'XLSX');
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
  const result = await session.send('2026-09-01 al 2026-09-30 en Excel');
  assert.equal(result.reportExport.rows[0].totalEarningsAmount, 136.45); assert.equal(result.reportExport.includeCompensated, true);
  const state = session.state();
  assert.equal(normalizeConversationState(state, 'foreign-root').pendingEarningsReport, undefined);
  assert.equal(normalizeConversationState(state, identity.rootId, Date.now() + 31 * 60_000).pendingEarningsReport, undefined);
  assert.equal(normalizeConversationState({ ...state, turn: state.turn + 5 }, identity.rootId).pendingEarningsReport, undefined);
});

test('ambiguous client is resolved by the next answer without changing the saved period', async () => {
  rows.push({ id: 'north', rootId: identity.rootId, clienteId: 'pc-north', clienteNombre: 'PC Norte', totalEarningsAmount: 100, createdAt: at });
  const session = conversation();
  const first = await session.send('reporte utilidades cliente pc del 2026-09-01 al 2026-09-30 en Excel');
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
    const result = await conversation().send(`reporte utilidades cliente ${name} del 2026-09-01 al 2026-09-30 en Excel`);
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
  const result = await conversation().send('Necesito ayuda con un archivo');
  assert.equal(result.responsePolicy, 'UNBACKED_REPORT_CLAIM');
  assert.equal(result.reportExport, undefined); assert.match(result.text, /No he ejecutado/);
  for (const answer of ['Generaré el reporte y te entregaré el Excel.', 'Voy a preparar el reporte.', 'Te lo adjunto, listo.', 'Ya generé el PDF.']) {
    assert.equal(claimsUnexecutedReport(answer, 'Necesito el reporte'), true);
  }
});

test('R1.3 exact quoted PDF transcript preserves client, repeats intentionally and resets on greetings', async () => {
  const session = conversation();
  const report = await session.send('reporte de utilidades del cliente pc directo», del 2026-09-01 al 2026-09-30 y lo quiero en formato pdf');
  assert.equal(report.reportExport.format, 'PDF');
  assert.equal(report.reportExport.fileName, 'pay0-utilidades-2026-09-01-a-2026-09-30.pdf');
  assert.equal(report.reportExport.rows[0].clienteId, 'pc');
  assert.equal(report.reportExport.rows[0].totalEarningsAmount, 37.45);
  const repeat = await session.send('geera el reporte de utilidades nuevamente');
  assert.equal(repeat.reportExport.format, 'PDF'); assert.equal(repeat.reportExport.rows[0].clienteId, 'pc');
  assert.equal(repeat.reportExport.rows.length, 1);
  assert.equal(repeat.reportExport.dateFrom, '2026-09-01'); assert.equal(repeat.reportExport.dateTo, '2026-09-30');
  const beforeGreetings = queries;
  for (const message of ['hola', 'hola', 'hola Maria']) {
    const greeting = await session.send(message);
    assert.match(greeting.text, /^Hola\./); assert.equal(greeting.reportExport, undefined);
    assert.equal(session.state().pendingEarningsReport, undefined);
    assert.equal(session.state().lastEarningsReport, undefined);
  }
  assert.equal(queries, beforeGreetings); assert.equal(session.modelCalls(), 0);
  const orphanDates = await session.send('2026-09-01 al 2026-09-30');
  assert.equal(orphanDates.reportExport, undefined); assert.match(orphanDates.text, /Qu[eé] reporte/);
  assert.equal(session.state().pendingEarningsReport, undefined); assert.equal(queries, beforeGreetings);
  const unpromptedName = await session.send('pc directo');
  assert.equal(unpromptedName.reportExport, undefined); assert.equal(queries, beforeGreetings);
});

test('R1.3 quotation delimiters never become part of the selected client', async () => {
  for (const client of ['«pc directo»', '“pc directo”', '"pc directo"', 'pc directo»,', 'pc directo;']) {
    const result = await conversation().send(`reporte utilidades cliente ${client} del 2026-09-01 al 2026-09-30 en PDF`);
    assert.equal(result.reportExport?.rows[0].clienteId, 'pc', client);
    assert.equal(result.reportExport.format, 'PDF');
  }
});

test('R1.3 missing format is clarified before reading data and format persists through missing dates', async () => {
  const first = conversation(), count = queries;
  const pending = await first.send('reporte utilidades cliente pc directo del 2026-09-01 al 2026-09-30');
  assert.match(pending.text, /PDF.*Excel/); assert.equal(pending.reportExport, undefined); assert.equal(queries, count);
  assert.equal(first.state().pendingEarningsReport.stage, 'FORMAT');
  const ambiguousFormat = await first.send('PDF o Excel');
  assert.match(ambiguousFormat.text, /PDF.*Excel/); assert.equal(ambiguousFormat.reportExport, undefined); assert.equal(queries, count);
  const xlsx = await first.send('lo quiero en Excel');
  assert.equal(xlsx.reportExport.format, 'XLSX'); assert.match(xlsx.reportExport.fileName, /\.xlsx$/);
  const second = conversation();
  await second.send('reporte utilidades cliente pc directo en formato PDF');
  const pdf = await second.send('2026-09-01 al 2026-09-30');
  assert.equal(pdf.reportExport.format, 'PDF'); assert.equal(pdf.reportExport.rows[0].clienteId, 'pc');
});

test('R1.3 missing client cannot turn arbitrary messages into a report query', async () => {
  for (const message of ['hola Maria', 'nueva conversación', '¿Qué puedes hacer?', 'explícame otra cosa']) {
    const session = conversation();
    const missing = await session.send('reporte utilidades cliente inexistente del 2026-09-01 al 2026-09-30 en PDF');
    assert.match(missing.text, /No encontré/);
    const count = queries, next = await session.send(message);
    assert.equal(next.reportExport, undefined); assert.equal(queries, count);
    assert.equal(session.state().pendingEarningsReport, undefined);
  }
});

test('R1.3 an empty canonical result does not promise a PDF attachment or download', async () => {
  const result = await conversation().send('reporte de utilidades por cliente del 2027-01-01 al 2027-01-31 en PDF');
  assert.equal(result.reportExport, undefined);
  assert.match(result.text, /0 operaciones/);
  assert.doesNotMatch(result.text, /archivo|adjunto|descarga|PDF|XLSX/i);
});

test('R1.3 a quoted client containing a month preserves the clarified period and format', async () => {
  for (const name of ['Banco de Septiembre', 'Banco de México']) rows.push({ id: name, rootId: identity.rootId, clienteId: name, clienteNombre: name, totalEarningsAmount: 1, createdAt: at });
  const session = conversation();
  const ambiguous = await session.send('reporte utilidades cliente Banco del 2026-09-01 al 2026-09-30 en PDF');
  assert.match(ambiguous.text, /varios clientes/);
  const selected = await session.send('"Banco de Septiembre"');
  assert.equal(selected.reportExport.rows[0].clienteNombre, 'Banco de Septiembre');
  assert.equal(selected.reportExport.dateFrom, '2026-09-01'); assert.equal(selected.reportExport.dateTo, '2026-09-30');
  assert.equal(selected.reportExport.format, 'PDF');
  resetRows();
});


test('R2 additive comparison preserves the explicit PDF and single-client scope', async () => {
  const session = conversation();
  const first = await session.send('reporte de utilidades del cliente PC Directo del 2026-09-01 al 2026-09-30 en formato PDF');
  assert.equal(first.reportExport.format, 'PDF');
  const compared = await session.send('compara con 2026-08-01 al 2026-08-31');
  assert.equal(compared.reportExport.format, 'PDF');
  assert.deepEqual(compared.reportExport.rows.map(row=>row.clienteId), ['pc']);
  assert.match(compared.text, /Comparaci.n con 2026-08-01/);
});
test('R2 additive explicit comparison preserves the requested client', async () => {
  const session = conversation();
  const result = await session.send('compara reporte de utilidades del cliente PC Directo del 2026-09-01 al 2026-09-30 contra 2026-08-01 al 2026-08-31 en formato PDF');
  assert.deepEqual(result.reportExport.rows.map(row=>row.clienteId), ['pc']);
  assert.equal(result.reportExport.format, 'PDF');
});
test('R2 comparison keeps both periods and client while clarifying the file format', async () => {
  const session = conversation();
  const before = queries;
  const clarification = await session.send('compara reporte de utilidades del cliente PC Directo del 2026-09-01 al 2026-09-30 contra 2026-08-01 al 2026-08-31');
  assert.match(clarification.text, /PDF.*Excel/);
  assert.equal(queries, before);
  const result = await session.send('PDF');
  assert.equal(queries, before + 2);
  assert.equal(result.reportExport.format, 'PDF');
  assert.deepEqual(result.reportExport.rows.map(row=>row.clienteId), ['pc']);
  assert.match(result.text, /Comparaci.n con 2026-08-01/);
});
test('R2 malformed saved comparison filters cannot survive normalization', () => {
  const state = emptyConversationState(identity.rootId);
  state.pendingEarningsReport = { rootId: identity.rootId, stage: 'FORMAT', resolvedAt: Date.now(), resolvedTurn: 0, includeCompensated: false,
    compareDateFrom: '2026-09-30', compareDateTo: '2026-09-01' };
  assert.equal(normalizeConversationState(state, identity.rootId).pendingEarningsReport, undefined);
  state.pendingEarningsReport.dateFrom = '2026-09-01'; state.pendingEarningsReport.dateTo = '2026-09-30';
  assert.equal(normalizeConversationState(state, identity.rootId).pendingEarningsReport, undefined);
});


test('R2 greetings and a new conversation clear client, format and comparison context', async () => {
  for (const reset of ['hola Maria', 'nueva conversacion']) {
    const session = conversation();
    const first = await session.send('reporte de utilidades del cliente PC Directo del 2026-09-01 al 2026-09-30 en formato PDF');
    assert.equal(first.reportExport.format, 'PDF');
    const before = queries;
    await session.send(reset);
    assert.equal(session.state().lastEarningsReport, undefined);
    assert.equal(session.state().pendingEarningsReport, undefined);
    const periodOnly = await session.send('2026-08-01 al 2026-08-31');
    assert.equal(periodOnly.reportExport, undefined);
    assert.equal(queries, before);
    assert.match(periodOnly.text, /reporte|cliente/i);
    const comparison = await session.send('comparalo con 2026-08-01 al 2026-08-31');
    assert.equal(comparison.reportExport, undefined);
    assert.equal(queries, before);
    assert.equal(session.state().pendingEarningsReport?.clientQuery, undefined);
    assert.equal(session.state().pendingEarningsReport?.format, undefined);
  }
});
