const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
const file = path.resolve('functions/src/modules/agent007/pay0Connector.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const mod = new Module(file, module); mod.filename = file; mod.paths = Module._nodeModulePaths(path.dirname(file));
const original = mod.require.bind(mod); mod.require = name => name === '../paymentApplications/complementGates' ? { isIqRepRequestHardEnabled: () => false } : original(name); mod._compile(compiled.outputText, file);
const { Pay0Connector } = process.env.PAY0_EVIDENCE_COMPILED === '1' ? require('../../functions/lib/modules/agent007/pay0Connector.js') : mod.exports;
function fixture() {
  const records = { clients: { alfa: { rootId: 'root', nombre: 'Cliente Alfa' }, foreign: { rootId: 'other', nombre: 'PRIVATE OTHER ROOT' } },
    solicitudes: { s: { rootId: 'root', clienteId: 'alfa', clienteNombre: 'Banco Afirme', tipoFactura: 'PPD', monto: 42, folio: 'S1', createdAt: new Date('2026-10-20') } },
    pagos: { p: { rootId: 'root', clienteId: 'alfa', clienteNombre: 'Banco Afirme', receiptLearningSignals: { detectedSenderName: 'Banco Afirme', detectedBankName: 'Afirme' }, montoTotal: 23, reportDateAt: new Date('2026-10-20'), createdAt: new Date('2026-10-20') } } };
  const reads = [];
  const snap = (collection, id) => ({ id, exists: !!records[collection]?.[id], data: () => records[collection]?.[id], get: field => records[collection]?.[id]?.[field] });
  const collection = name => { const filters = []; let count = Infinity; return {
    doc: id => ({ get: async () => { reads.push(`${name}/${id}`); return snap(name, id); } }),
    where(field, op, value) { filters.push([field, value]); return this; }, orderBy() { return this; }, limit(n) { count = n; return this; }, startAfter() { return this; },
    async get() { return { docs: Object.keys(records[name] || {}).filter(id => filters.every(([key, value]) => records[name][id][key] === value)).slice(0, count).map(id => snap(name, id)) }; }
  }; };
  const connector = () => new Pay0Connector({ collection }, { uid: 'actor', rootId: 'root', role: 'superadmin' });
  return { records, reads, connector };
}
test('Latest solicitud resolves canonical client and exact PPD/PUE without deriving from status', async () => {
  const f = fixture(); const item = (await f.connector().getLatestSolicitud()).data.item;
  assert.equal(item.cliente, 'Cliente Alfa'); assert.equal(item.clienteFuente, 'CLIENT_RECORD'); assert.equal(item.metodoPago, 'PPD'); assert.equal(item.monto, 42);
  f.records.solicitudes.s.tipoFactura = 'PUE'; assert.equal((await f.connector().getLatestSolicitud()).data.item.metodoPago, 'PUE');
  f.records.solicitudes.s.tipoFactura = 'pagado'; assert.equal((await f.connector().getLatestSolicitud()).data.item.metodoPago, null);
});
test('OCR bank/sender never becomes confirmed payer or canonical client', async () => {
  const f = fixture(); const payment = (await f.connector().searchReceivedPagos()).data.items[0];
  assert.equal(payment.cliente, 'Cliente Alfa'); assert.equal(payment.pagador, null); assert.equal(payment.pagadorFuente, 'NOT_RECORDED');
  assert.equal(payment.remitenteDetectado, 'Banco Afirme'); assert.equal(payment.remitenteFuente, 'RECEIPT_DETECTED'); assert.equal(payment.bancoDetectado, 'Afirme');
  assert.equal(payment.monto, 23); assert.equal((await f.connector().getPagoById('p')).data.cliente, 'Cliente Alfa');
  delete f.records.pagos.p.clienteId; delete f.records.pagos.p.clienteNombre;
  const bankOnly = (await f.connector().getPagoById('p')).data;
  assert.equal(bankOnly.cliente, null); assert.equal(bankOnly.pagador, null); assert.equal(bankOnly.remitenteDetectado, 'Banco Afirme');
});
test('Explicit registered payer remains separate even if it is a bank name', async () => {
  const f = fixture(); f.records.pagos.p.payerName = 'Banco Afirme';
  const payment = (await f.connector().getPagoById('p')).data;
  assert.equal(payment.pagador, 'Banco Afirme'); assert.equal(payment.pagadorFuente, 'CONFIRMED'); assert.equal(payment.cliente, 'Cliente Alfa');
});
test('Foreign/missing/invalid client IDs never fall back to unverified operation names', async () => {
  const f = fixture();
  for (const id of ['foreign', 'missing', '../foreign', 123]) {
    f.records.solicitudes.s.clienteId = id;
    const item = (await f.connector().getLatestSolicitud()).data.item;
    assert.equal(item.cliente, null); assert.equal(item.clienteFuente, 'UNRESOLVED'); assert.equal(item.folio, 'S1'); assert.equal(item.metodoPago, 'PPD');
  }
  assert(!f.reads.some(p => p.includes('../')));
});
test('Legacy snapshots are labelled only when no canonical client ID exists; foreign payments remain hidden', async () => {
  const f = fixture(); delete f.records.pagos.p.clienteId; f.records.pagos.p.clienteNombre = 'Legacy explicit client';
  const payment = (await f.connector().getPagoById('p')).data;
  assert.equal(payment.cliente, 'Legacy explicit client'); assert.equal(payment.clienteFuente, 'OPERATION_SNAPSHOT');
  f.records.pagos.p.rootId = 'other'; assert.equal((await f.connector().getPagoById('p')).data, null);
});
test('Recorded zero is preserved and absent or invalid amounts remain unknown', async () => {
  const f = fixture();
  f.records.solicitudes.s.amount = 0; assert.equal((await f.connector().getLatestSolicitud()).data.item.monto, 0);
  delete f.records.solicitudes.s.amount; delete f.records.solicitudes.s.monto;
  delete f.records.pagos.p.montoTotal;
  assert.equal((await f.connector().getLatestSolicitud()).data.item.monto, null);
  assert.equal((await f.connector().getPagoById('p')).data.monto, null);
  for (const value of ['', 'invalid', Infinity, true]) {
    f.records.solicitudes.s.monto = value; f.records.pagos.p.montoTotal = value;
    assert.equal((await f.connector().getLatestSolicitud()).data.item.monto, null);
    assert.equal((await f.connector().getPagoById('p')).data.monto, null);
  }
  f.records.pagos.p.montoTotal = 0; assert.equal((await f.connector().getPagoById('p')).data.monto, 0);
});
test('Existing semantic receipt evidence survives the client/payer boundary projection', async () => {
  const f = fixture();
  const semantic = { readerVersion: 'reader-v1', reviewRequired: true, reviewReasons: ['SYNTHETIC_REVIEW'], fields: { senderName: { value: 'Banco Afirme', provenance: 'DETECTED' }, transferAmount: { value: 23, provenance: 'DETECTED' } } };
  Object.assign(f.records.pagos.p.receiptLearningSignals, { semanticReceipt: semantic, analysisId: 'synthetic-analysis', readerVersion: 'reader-v2' });
  const payment = (await f.connector().getPagoById('p')).data;
  assert.deepEqual(payment.comprobante, { readerVersion: 'reader-v2', analysisId: 'synthetic-analysis', reviewRequired: true, reviewReasons: semantic.reviewReasons, fields: semantic.fields });
  assert.equal(payment.cliente, 'Cliente Alfa'); assert.equal(payment.pagador, null);
  const received = (await f.connector().searchReceivedPagos()).data.items[0];
  assert.deepEqual(received.comprobante, payment.comprobante);
});
