const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');

function load(file, dependencies) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('exports', 'require', js)(exports, name => {
    assert(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  });
  return exports;
}

function paymentAction(context) {
  const file = 'src/app/pagos/page.tsx';
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'onCreatePago') body = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(body, 'onCreatePago is present');
  const js = ts.transpileModule(`return ${body}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(...Object.keys(context), js)(...Object.values(context));
}

test('Pago upload waits for authoritative READY and never requests an unused download URL', async () => {
  let finishFinalize, urlReads = 0, finalizeCalls = 0;
  const finalizeGate = new Promise(resolve => { finishFinalize = resolve; });
  const helper = load('src/lib/uploadPagoDoc.ts', {
    '@/lib/firebaseClient': { functions: {}, storage: {} },
    '@/lib/callableNames': { CALLABLES: { initPagoDocumentUpload: 'init', finalizePagoDocumentUpload: 'finalize' } },
    'firebase/functions': { httpsCallable: (_, name) => async () => {
      if (name === 'init') return { data: { uploadId: 'receipt-1', storagePath: 'local/receipt-1' } };
      finalizeCalls++;
      await finalizeGate;
      return { data: { status: 'READY', active: true, uploadId: 'receipt-1' } };
    } },
    'firebase/storage': {
      ref: (_, path) => path,
      getDownloadURL: async () => { urlReads++; throw Error('unused download URL'); },
      uploadBytesResumable: () => ({ snapshot: { ref: {} }, on: (_, progress, reject, done) => done() }),
    },
  });
  let completed = false;
  const pending = helper.uploadPagoDoc({ pagoId: 'p1', documentType: 'COMPROBANTE_PAGO', file: { name: 'receipt.pdf', type: 'application/pdf', size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer } }).then(result => { completed = true; return result; });
  while (finalizeCalls === 0) await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false, 'document confirmation is mandatory');
  finishFinalize();
  assert.equal((await pending).status, 'READY');
  assert.equal(urlReads, 0, 'download URL cannot hold the user interface');
});

test('Pago modal releases after receipt READY, without waiting for slow IQ; document failure keeps the error visible', async () => {
  let finishReceipt, finishIq, overlay = false, saving = false, modalOpen = true, released = 0, message = '', iqCompleted = false;
  const receiptGate = new Promise(resolve => { finishReceipt = resolve; });
  const iqGate = new Promise(resolve => { finishIq = resolve; });
  let failReceipt = false;
  const context = {
    beginOperationTiming: () => id => { assert.equal(id, 'p1'); assert.equal(overlay, false); released++; },
    canCreatePagos: true, saving: false, montoTotal: '100', setPageMsg: value => { message = value; },
    isPagoFormComplete: true, missingPagoFields: [], selectedClientId: 'client', selectedCompanyId: 'company',
    selectedOperationTypeKey: 'FACTURA_SUBTOTAL', selectedCompany: { despachoId: 'iq', label: 'Company' },
    comprobantePagoFile: { name: 'receipt.pdf' }, receiptLearningSignals: {}, fechaPago: '2026-10-08',
    paymentTime: '12:00:00', paymentForm: '03', moneda: 'MXN', notaInicial: '',
    parseMoneyInput: value => Number(value), setSaving: value => { saving = value; },
    globalLoading: { async run(_, task) { overlay = true; try { return await task(); } finally { overlay = false; } } },
    async createPagoWithReceipt({ onPagoCreated }) { onPagoCreated('p1'); await receiptGate; if (failReceipt) throw Object.assign(Error('controlled receipt failure'), { pagoId: 'p1' }); void iqGate.then(() => { iqCompleted = true; }); return 'p1'; },
    setSelectedClientId() {}, setSelectedCompanyId() {}, setSelectedOperationTypeKey() {}, setMontoTotal() {},
    setFechaPago() {}, setPaymentTime() {}, setMoneda() {}, setPaymentForm() {}, setNotaInicial() {},
    setReceiptLearningSignals() {}, setComprobantePagoFile() {}, setOpenNewPago: value => { modalOpen = value; },
  };
  const run = paymentAction(context);
  const pending = run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(overlay, true); assert.equal(saving, true); assert.equal(released, 0);
  finishReceipt();
  await pending;
  assert.equal(overlay, false); assert.equal(saving, false); assert.equal(modalOpen, false); assert.equal(released, 1);
  assert.equal(iqCompleted, false, 'an outstanding IQ response cannot hold the modal');
  finishIq(); await iqGate;
  failReceipt = true; released = 0; modalOpen = true;
  await run();
  assert.equal(released, 0, 'failed receipt must never be timed as successful UI release');
  assert.equal(modalOpen, true); assert.match(message, /comprobante no termino de guardarse/);
});
