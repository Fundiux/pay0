// Actual trigger handlers with in-memory reconciliation, no SDK initialization or external calls.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), vm = require('node:vm'), ts = require('typescript');
const filename = path.resolve(__dirname, '../../functions/src/modules/agent007/reconciliationMaintenance.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const now = Date.parse('2026-09-28T08:00:00Z'), db = Object.freeze({ fixture: true }), logs = [], moduleUnderTest = { exports: {} };
let calls = 0, failure, checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
vm.runInNewContext(code, { module: moduleUnderTest, exports: moduleUnderTest.exports, Date: { now: () => now, parse: Date.parse },
  console: { warn: (...args) => logs.push(args) },
  require: name => {
    if (name === 'firebase-functions/v2/firestore') return { onDocumentWritten: (options, handler) => ({ options, handler }) };
    if (name === '../sharedCallables/helpers') return { db };
    if (name === './reconciliation') return { reconcileAgent007Recommendations: async (database, rootId) => { assert.equal(database, db); assert.equal(rootId, 'synthetic-root'); calls++; if (failure) throw failure; return 4; } };
    throw Error('UNEXPECTED_DEPENDENCY');
  },
}, { filename });
const api = moduleUnderTest.exports;
const event = (time = new Date(now - 1000).toISOString(), before = { rootId: 'synthetic-root', status: 'PENDIENTE' }, after = { rootId: 'synthetic-root', status: 'CONCILIADO' }) => ({ time, data: { before: { data: () => before }, after: { data: () => after } } });
async function main() {
  for (const [name, document] of [['reconcileHugoOnSolicitudChange', 'solicitudes/{solicitudId}'], ['reconcileHugoOnPagoChange', 'pagos/{pagoId}']]) {
    const trigger = api[name];
    check(trigger.options.document === document && trigger.options.retry === true && trigger.options.timeoutSeconds === 120 && trigger.options.memory === '512MiB' && trigger.options.maxInstances === 2, 'Bounded runtime options for ' + name);
    for (const time of [undefined, null, '', 'invalid', new Date(now - 20 * 60000 - 1).toISOString(), new Date(now + 1).toISOString()]) {
      const change = event(); change.time = time; const before = calls;
      await trigger.handler(change);
      check(calls === before, 'Missing/invalid/old/future time cannot reconcile: ' + name);
    }
    const before = calls;
    await trigger.handler(event(new Date(now - 20 * 60000).toISOString()));
    check(calls === before + 1, 'Exactly 20 minute event is eligible: ' + name);
  }
  for (const [before, after] of [[undefined, { rootId: 'synthetic-root', status: 'CONCILIADO' }], [{ rootId: 'synthetic-root' }, undefined], [{ rootId: 'other', status: 'PENDIENTE' }, { rootId: 'synthetic-root', status: 'CONCILIADO' }], [{ rootId: 'synthetic-root', status: 'CONCILIADO', updatedAt: 1 }, { rootId: 'synthetic-root', status: 'CONCILIADO', updatedAt: 2 }]]) {
    const previous = calls;
    const change = event(); change.data = { before: { data: () => before }, after: { data: () => after } };
    await api.reconcileForPay0Event('pago', change);
    check(calls === previous, 'Existing source/root/irrelevant-change omission remains intact');
  }
  for (const code of ['permission-denied', 'unauthenticated', 'not-found', 'failed-precondition', 'invalid-argument', 'already-exists', 'unimplemented', 'firestore/permission-denied', 3, 5, 6, 7, 9, 12, 16]) {
    failure = Object.assign(Error('private details must never reach logs'), { code });
    const previous = logs.length;
    check(await api.reconcileForPay0Event('pago', event()) === 0 && logs.length === previous + 1, 'Permanent code is acknowledged once: ' + code);
  }
  check(!JSON.stringify(logs).includes('private details') && !JSON.stringify(logs).includes('synthetic-root'), 'Permanent diagnostics contain only allowlisted reason codes');
  for (const code of ['aborted', 'unavailable', 'deadline-exceeded', 'resource-exhausted', 'internal', 4, 8, 10, 13, 14, undefined]) {
    failure = Object.assign(Error('transient synthetic failure'), { code });
    await assert.rejects(api.reconcileForPay0Event('solicitud', event()), error => error === failure); checks++;
  }
  failure = undefined;
  check(await api.reconcileForPay0Event('solicitud', event()) === 4, 'Successful reconciliation result is preserved');
  console.log(JSON.stringify({ ok: true, checks, externalActions: 0, emulatorUsed: false, coverage: 'both actual trigger handlers, runtime limits, event age, permanent/transient codes and source omissions' }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
