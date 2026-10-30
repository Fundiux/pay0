const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const workspace = path.resolve(__dirname, '../..');
const file = process.env.PAY0_REPORT_SEMANTICS_FILE || path.join(workspace, 'functions/src/modules/agent007/hugoCore/reportSemantics.ts');
const semantics = {};
const source = fs.readFileSync(file, 'utf8');
new Function('exports', 'require', file.endsWith('.ts') ? ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText : source)(semantics, name => { throw Error(`Unexpected runtime dependency: ${name}`); });
const pending = (changes = {}) => ({ rootId: 'root-a', clientQuery: 'pc directo', includeCompensated: false,
  stage: 'DATES', resolvedAt: 1000, resolvedTurn: 1, ...changes });

test('natural client report without the word cliente asks for dates without inventing a year', () => {
  const result = semantics.pendingReportRequest('Dame un reporte de utilidades de pc directo del mes de septiembre');
  assert.equal(result.intent, true);
  assert.equal(result.clientQuery, 'pc directo');
  assert.equal(result.request, null);
  assert.equal(result.periodMonth, 9);
});

for (const ending of ['.', '»', '"']) {
  test(`terminal punctuation ${ending} does not become part of the client`, () => {
    const result = semantics.pendingReportRequest(`Dame un reporte de utilidades de pc directo del mes de septiembre${ending}`);
    assert.equal(result.intent, true);
    assert.equal(result.clientQuery, 'pc directo');
    assert.equal(result.periodMonth, 9);
    assert.equal(result.request, null);
  });
}

test('month and format survive clarification until an explicit year is supplied', () => {
  const format = semantics.pendingReportRequest('en pdf', pending({ periodMonth: 9 }));
  assert.equal(format.periodMonth, 9);
  assert.equal(format.format, 'PDF');
  assert.equal(format.request, null);
  const year = semantics.pendingReportRequest('2026', pending({ periodMonth: 9, format: 'PDF' }));
  assert.equal(year.request.dateFrom, '2026-09-01');
  assert.equal(year.request.dateTo, '2026-09-30');
  assert.equal(year.request.clientQuery, 'pc directo');
  assert.equal(year.request.format, 'PDF');
});

test('a month in a client name alone is not a reporting period', () => {
  const result = semantics.pendingReportRequest('Dame un reporte de utilidades del cliente Banco de Septiembre en PDF');
  assert.equal(result.intent, true);
  assert.equal(result.clientQuery, 'Banco de Septiembre');
  assert.equal(result.periodMonth, undefined);
  assert.equal(result.request, null);
});

for (const [text, format] of [['en pdf', 'PDF'], ['en excel', 'XLSX']]) {
  test(`${text} preserves the pending client without inventing dates`, () => {
    const result = semantics.pendingReportRequest(text, pending());
    assert.equal(result.intent, true);
    assert.equal(result.clientQuery, 'pc directo');
    assert.equal(result.format, format);
    assert.equal(result.request, null);
    const acknowledgement = semantics.reportPeriodClarification(9, format);
    assert.match(acknowledgement, new RegExp(format === 'PDF' ? 'PDF' : 'Excel|XLSX'));
    assert.match(acknowledgement, /año/);
    assert.doesNotMatch(acknowledgement, /generad[oa]|adjunt[oa]|archivo listo/i);
  });
  test(`${text} reuses an existing client and explicit period`, () => {
    const result = semantics.pendingReportRequest(text, pending({ stage: 'READY', dateFrom: '2026-09-01', dateTo: '2026-09-30', format: 'PDF' }));
    assert.equal(result.request.clientQuery, 'pc directo');
    assert.equal(result.request.dateFrom, '2026-09-01');
    assert.equal(result.request.dateTo, '2026-09-30');
    assert.equal(result.request.format, format);
  });
}

test('explicit dates retain the previously requested PDF format and client', () => {
  const result = semantics.pendingReportRequest('2026-09-01 al 2026-09-30', pending({ format: 'PDF' }));
  assert.equal(result.request.clientQuery, 'pc directo');
  assert.equal(result.request.format, 'PDF');
});

test('a new calendar-month report does not inherit an earlier comparison or format', () => {
  const previous = pending({ stage: 'READY', clientQuery: 'cliente anterior', format: 'XLSX',
    dateFrom: '2026-08-01', dateTo: '2026-08-31', compareDateFrom: '2026-07-01', compareDateTo: '2026-07-31' });
  const result = semantics.pendingReportRequest('Dame un reporte de utilidades de pc directo del mes de septiembre de 2026', previous);
  assert.equal(result.request.clientQuery, 'pc directo');
  assert.equal(result.request.dateFrom, '2026-09-01');
  assert.equal(result.request.dateTo, '2026-09-30');
  assert.equal(result.request.compareDateFrom, undefined);
  assert.equal(result.request.compareDateTo, undefined);
  assert.equal(result.request.format, undefined);
  const continuation = semantics.pendingReportRequest('en pdf', previous);
  assert.equal(continuation.request.compareDateFrom, '2026-07-01');
  assert.equal(continuation.request.compareDateTo, '2026-07-31');
});

test('a greeting exits the report branch rather than repeating the previous report', () => {
  for (const text of ['hola', 'hola María', 'buenas tardes']) {
    assert.match(semantics.reportConversationResetReply(text), /Hola/);
    assert.deepEqual(semantics.pendingReportRequest(text, pending({ stage: 'READY', dateFrom: '2026-09-01', dateTo: '2026-09-30' })), { intent: false, request: null });
  }
});
