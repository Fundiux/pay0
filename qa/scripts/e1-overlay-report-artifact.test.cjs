const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const JSZip = require('../../functions/node_modules/jszip');
const ts = require('typescript');
const base = process.env.PAY0_E1_OVERLAY_DIR;
if (!base) throw Error('PAY0_E1_OVERLAY_DIR_REQUIRED');
function moduleFrom(source, deps = {}) {
  const exports = {};
  vm.runInNewContext(source, { exports, require: name => {
    assert.ok(name in deps, `Unexpected dependency ${name}`); return deps[name];
  }});
  return exports;
}
for (const name of ['sendAgent007Message', 'delegateHugoVoiceTurn']) test(`${name}: exact artifact preserves legacy tools and validates report dates/identity`, async () => {
  const input = JSON.parse(fs.readFileSync(path.join(base, `release-${name}`, 'input.json')));
  const bytes = fs.readFileSync(input.archive);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), input.archiveSha256);
  const artifact = await JSZip.loadAsync(bytes);
  const original = await JSZip.loadAsync(fs.readFileSync(path.join(base, '..', `${name}-previous.zip`)));
  const source = await original.file('src/modules/agent007/hugoCore/toolRouter.ts').async('string');
  const ast = ts.createSourceFile('toolRouter.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]).find(d => d.name.getText(ast) === 'HUGO_READ_TOOLS');
  const expression = ts.isAsExpression(declaration.initializer) ? declaration.initializer.expression : declaration.initializer;
  const legacyNames = expression.properties.map(p => p.name.getText(ast));
  const semantics = moduleFrom(await artifact.file('lib/modules/agent007/hugoCore/reportSemantics.js').async('string'));
  const router = moduleFrom(await artifact.file('lib/modules/agent007/hugoCore/toolRouter.js').async('string'), { './reportSemantics': semantics });
  assert.deepEqual(Object.keys(router.HUGO_READ_TOOLS).filter(k => k !== 'getEarningsByClientReport').sort(), legacyNames.sort());
  assert.equal(semantics.earningsReportRequest('reporte de utilidades por cliente del mes'), null);
  const parsed = semantics.earningsReportRequest('reporte de utilidades por cliente 2026-10-01 al 2026-10-19');
  assert.equal(parsed.dateFrom, '2026-10-01'); assert.equal(parsed.includeCompensated, false);
  assert.throws(() => semantics.validateEarningsReportInput({ dateFrom: '2026-10-19', dateTo: '2026-10-01' }));
  let calls = 0;
  const result = { sourceSystem: 'PAY0', tool: 'getEarningsByClientReport', retrievedAt: 'fixture', scope: { rootId: 'fixture-root' }, completeness: 'COMPLETE', evidence: [], data: {}, trace: { latencyMs: 0, result: 'OK' } };
  const instance = new router.HugoToolRouter({ uid: 'fixture', rootId: 'fixture-root', role: 'operador' }, { getEarningsByClientReport: async () => { calls++; return result; } });
  await assert.rejects(instance.execute({ name: 'getEarningsByClientReport', input: { dateFrom: '2026-10-01', dateTo: '2026-10-19', actorUid: 'injected' } }));
  assert.equal(calls, 0);
  assert.equal(await instance.execute({ name: 'getEarningsByClientReport', input: parsed }), result);
  assert.equal(calls, 1);
});
