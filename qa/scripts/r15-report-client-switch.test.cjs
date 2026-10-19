const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const base = path.resolve(__dirname, '../../functions/src/modules/agent007/hugoCore');
const cache = new Map();
function load(name) {
  if (process.env.HUGO_TEST_FUNCTIONS_ROOT) return require(path.resolve(process.env.HUGO_TEST_FUNCTIONS_ROOT, 'lib/modules/agent007/hugoCore', name + '.js'));
  const file = path.join(base, name + '.ts');
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('exports', 'require', code)(exports, dep => dep.startsWith('./') ? load(dep.slice(2)) : require(dep));
  return exports;
}
const { pendingReportRequest } = load('reportSemantics');
const { buildHugoContextV2 } = load('contextBuilderV2');
const { emptyConversationState } = load('conversationState');
const rootId = 'synthetic-root', now = Date.parse('2026-10-19T12:00:00Z');
const ready = () => ({ rootId, stage: 'READY', clientQuery: 'pc directo', format: 'PDF', dateFrom: '2026-09-01', dateTo: '2026-09-30', includeCompensated: false, resolvedAt: now, resolvedTurn: 1 });
test('exact elliptical request clears PC and asks before splitting an ambiguous client/month', () => {
  const result = pendingReportRequest('ahora dame uno de inservice de septiembre', ready());
  assert.equal(result.intent, true); assert.equal(result.clientQuery, undefined); assert.equal(result.needsClient, true);
  assert.equal(result.request.clientQuery, undefined); assert.equal(result.request.format, 'PDF');
  assert.equal(result.request.dateFrom, '2026-09-01'); assert.equal(result.request.dateTo, '2026-09-30');
});
test('another client is requested before any unrestricted report can execute', async () => {
  let state = { ...emptyConversationState(rootId), turn: 1, pendingEarningsReport: ready(), lastEarningsReport: { rootId, query: { dateFrom: '2026-09-01', dateTo: '2026-09-30', clientQuery: 'pc directo', format: 'PDF' }, resolvedAt: now, resolvedTurn: 1 } };
  const calls = [];
  const router = { execute: async request => { calls.push(request); return { tool: request.name, sourceSystem: 'PAY0', retrievedAt: new Date(now).toISOString(), scope: { rootId }, completeness: 'COMPLETE', evidence: [], trace: { latencyMs: 0, result: 'OK' }, data: { clientResolution: { status: 'RESOLVED' } } }; } };
  const first = await buildHugoContextV2({ message: 'ahora ocupo de otro cliente', rootId, now, conversationState: state, router });
  assert.match(first.clarification, /nombre.*cliente/i); assert.equal(calls.length, 0);
  state = first.conversationState; assert.equal(state.pendingEarningsReport.stage, 'CLIENT');
  assert.equal(state.lastEarningsReport, undefined);
  assert.equal(state.pendingEarningsReport.clientQuery, undefined); assert.equal(state.pendingEarningsReport.dateFrom, '2026-09-01');
  const next = await buildHugoContextV2({ message: 'inservice', rootId, now, conversationState: state, router });
  assert.equal(calls.length, 1); assert.equal(calls[0].input.clientQuery, 'inservice'); assert.equal(calls[0].input.format, 'PDF');
  assert.equal(next.conversationState.pendingEarningsReport.clientQuery, 'inservice');
});
test('explicit month follow-up uses the known year, never the calendar year', () => {
  const result = pendingReportRequest('ahora dame uno de inservice del mes de octubre', ready());
  assert.equal(result.clientQuery, 'inservice'); assert.equal(result.request.dateFrom, '2026-10-01'); assert.equal(result.request.dateTo, '2026-10-31');
});
test('a month without a known contextual year still requires clarification', () => {
  const previous = { ...ready(), stage: 'DATES', periodMonth: 9 };
  delete previous.dateFrom; delete previous.dateTo;
  const result = pendingReportRequest('octubre', previous);
  assert.equal(result.intent, true); assert.equal(result.periodMonth, 10); assert.equal(result.request, null);
});
test('month in a client name remains part of the name', () => {
  const result = pendingReportRequest('ahora dame uno del cliente Banco de Septiembre', ready());
  assert.equal(result.clientQuery, 'Banco de Septiembre'); assert.equal(result.request.dateFrom, '2026-09-01');
});
test('an ambiguous month in an elliptical business name never silently selects Banco', () => {
  const result = pendingReportRequest('ahora dame uno de Banco de Septiembre', ready());
  assert.equal(result.needsClient, true); assert.equal(result.clientQuery, undefined); assert.equal(result.request.clientQuery, undefined);
});
test('a report month follow-up cannot restore the old client while waiting for the new name', () => {
  const previous = { ...ready(), stage: 'CLIENT' }; delete previous.clientQuery;
  const result = pendingReportRequest('quiero el reporte de septiembre', previous);
  assert.equal(result.intent, true); assert.equal(result.needsClient, true); assert.equal(result.clientQuery, undefined);
  assert.equal(result.request.clientQuery, undefined); assert.equal(result.request.dateFrom, '2026-09-01');
});
test('name declaration before the word cliente overrides the old client', () => {
  const result = pendingReportRequest('INSERVICE TELECOM es el nombre del cliente quiero el reporte de todo el mes de septiembre', ready());
  assert.equal(result.clientQuery, 'INSERVICE TELECOM'); assert.equal(result.request.clientQuery, 'INSERVICE TELECOM');
  assert.equal(result.request.dateFrom, '2026-09-01'); assert.equal(result.request.format, 'PDF');
});
for (const message of ['ahora dame uno de inservice de septiembre', 'ahora ocupo de otro cliente']) {
  test(`elliptical request needs live report context: ${message}`, () => assert.equal(pendingReportRequest(message).intent, false));
}
for (const message of ['hola', 'ahora consulta solicitudes', 'explícame septiembre', 'explícame cómo crear un PDF', 'otro tema']) {
  test(`unrelated conversation is not captured: ${message}`, () => assert.equal(pendingReportRequest(message, ready()).intent, false));
}
