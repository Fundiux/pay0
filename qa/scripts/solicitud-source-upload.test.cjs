const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { test } = require('node:test');
function load(file, deps = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('exports', 'require', js)(exports, name => { assert(name in deps, name); return deps[name]; });
  return exports;
}
function action(context) {
  const file = 'src/components/NuevaSolicitudModal.tsx', source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body;
  function visit(n) { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'handleSave') body = n.initializer.getText(ast); ts.forEachChild(n, visit); } visit(ast);
  const js = ts.transpileModule(`return ${body}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(context), js)(...Object.values(context));
}
test('source failure stays visible, retains File and folio, retry/double click cannot create another Solicitud', async () => {
  let creates = 0, closes = 0, resets = 0, releases = 0, error = '', finish;
  const file = {}, submission = { current: null }, saving = { current: false };
  let fail = true;
  const context = {
    beginOperationTiming: () => () => { releases++; }, formData: { monto: '98,000', tipoFactura: 'PUE' },
    saving, submission, isSolicitudFormComplete: true, facturaXmlFile: null, ordenCompraFile: file,
    facturaXmlParsed: null, ordenCompraParsed: { montoSolicitud: 98000, tipoFactura: 'PUE' },
    selectedCompany: { despachoId: 'iq' }, setIsSubmitting() {}, setSaveError: v => { error = v; },
    createSolicitud: async () => { creates++; return { solicitudId: 's1', folio: 'S1' }; },
    uploadSolicitudDoc: async input => {
      assert.equal(input.file, file); assert.equal(input.solicitudId, 's1');
      await new Promise(resolve => { finish = resolve; });
      if (fail) throw new Error('controlled upload failure');
    },
    window: { dispatchEvent() {} }, CustomEvent: class {}, setOrdenCompraUploadPct() {},
    onClose: () => { closes++; }, resetForm: () => { resets++; }, alert() { assert.fail('unexpected validation'); },
  };
  const run = action(context), event = { preventDefault() {} };
  const pending = run(event); await new Promise(setImmediate);
  await run(event); assert.equal(creates, 1); assert.equal(closes, 0);
  finish(); await pending;
  assert.match(error, /S1.*archivo pendiente.*controlled upload failure/);
  assert.equal(resets, 0); assert.equal(releases, 0); assert.equal(submission.current.solicitudId, 's1');
  fail = false; const retry = run(event); await new Promise(setImmediate); finish(); await retry;
  assert.equal(creates, 1); assert.equal(closes, 1); assert.equal(resets, 1); assert.equal(releases, 1);
});
test('upload resumes same uploadId and stored bytes; download URL failure cannot block finalize/enqueue', async () => {
  let init = 0, bytes = 0, finalize = 0, fail = true;
  const calls = { initSolicitudDocumentUpload: 'init', finalizeSolicitudDocumentUpload: 'finalize' };
  const helper = load('src/lib/uploadSolicitudDoc.ts', {
    '@/lib/callableNames': { CALLABLES: calls }, '@/lib/firebaseClient': { functions: {}, storage: {} },
    '@/canonicos/materialidad': { MATERIALIDAD_CANONICAL_DOCUMENTS: [] },
    'firebase/functions': { httpsCallable: (_, name) => async input => {
      if (name === 'init') { init++; return { data: { uploadId: 'u1', storagePath: 'local/s1/u1' } }; }
      assert.equal(input.uploadId, 'u1'); finalize++;
      if (fail) throw new Error('controlled finalize failure');
      return { data: { ok: true } };
    } },
    'firebase/storage': { ref: (_, path) => path, getDownloadURL: async () => { throw Error('link unavailable'); },
      uploadBytesResumable: () => { bytes++; return { snapshot: {}, on: (_, progress, reject, done) => done() }; } },
  });
  const input = { solicitudId: 's1', documentType: 'ORDEN_COMPRA', file: { size: 1, name: 'synthetic.xlsx' } };
  await assert.rejects(helper.uploadSolicitudDoc(input), /finalize failure/);
  fail = false; assert.equal((await helper.uploadSolicitudDoc(input)).ok, true);
  assert.equal(init, 1); assert.equal(bytes, 1); assert.equal(finalize, 2);
});
test('creator enrichment survives listeners; discovery resolves authenticated creator, never operational owner', () => {
  const { replaceOperationRow } = load('src/lib/liveOperationRows.ts');
  const { recordCreatorLabel } = load('src/lib/recordCreator.ts');
  const before = [{ id: 's1', createdBy: 'actor', createdByDisplayName: 'Actor' }];
  const next = replaceOperationRow(before, 's1', { id: 's1', createdBy: 'actor', status: 'OK' });
  assert.equal(recordCreatorLabel(next[0]), 'Actor');
  assert.equal(recordCreatorLabel({ createdBy: 'actor', operationalOwnerName: 'Another' }, [{ uid: 'actor', displayName: 'Actor', username: 'a' }]), 'Actor');
  const changed = replaceOperationRow(before, 's1', { id: 's1', createdBy: 'other' });
  assert.equal(recordCreatorLabel(changed[0]), 'No disponible');
  assert.equal(recordCreatorLabel(replaceOperationRow(before, 's1', { id: 's1', createdBy: 'actor', createdByDisplayName: '' })[0]), 'No disponible');
});
const http = require('node:http');
test('Solicitud HTTP core sends one multipart POST with the original OC bytes and records response timing', async () => {
  const source = fs.readFileSync('functions/src/modules/iq/solicitudHttpCreateA53.ts', 'utf8');
  const ast = ts.createSourceFile('core.ts', source, ts.ScriptTarget.Latest, true);
  const code = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ['postOnce', 'buildFormData'].includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
  let posts = 0; const stages = [], original = Buffer.from('isolated synthetic OC bytes');
  const server = http.createServer(async (req, res) => {
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/invoices'); posts++;
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    assert(body.includes(original.toString())); assert(body.includes('synthetic.xlsx'));
    assert(body.includes('name="client_id"')); assert(body.includes('name="company_id"'));
    assert(body.includes('98000')); res.writeHead(201); res.end('{"id":991}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const ctx = { readFile: async () => original, clean: x => String(x || '').trim(), authHeaders: async () => ({}),
      operationTiming: stage => { stages.push(stage); return Date.now(); },
      fetchIq: (url, opts) => { assert.equal(url.origin, origin); return fetch(url, opts); } };
    const run = new Function(...Object.keys(ctx), ts.transpileModule(code + '\nreturn postOnce;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText)(...Object.values(ctx));
    const result = await run({ apiOrigin: origin }, { key: 'local-s1', amount: 98000, invoiceType: 'PUE', orderFilePath: 'synthetic', orderFileName: 'synthetic.xlsx', comments: 'local-correlation' }, { clientId: 1, companyId: 2 });
    assert.equal(result.status, 201); assert.equal(posts, 1); assert.deepEqual(stages, ['iq_dispatch_at', 'iq_response_at']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('legacy callable envelope reproduces persisted-without-upload; current service unwraps it', async () => {
  const { execFileSync } = require('node:child_process');
  const baseline = execFileSync('git', ['show', 'fe2b98b:src/services/solicitudes.ts'], { encoding: 'utf8' });
  let persisted = 0;
  const deps = { 'firebase/functions': { httpsCallable: () => async () => { persisted++; return { data: { ok: true, solicitudId: 's1', folio: 'S1' } }; } }, '@/lib/firebaseClient': { functions: {} } };
  const old = {};
  new Function('exports', 'require', ts.transpileModule(baseline, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(old, key => deps[key]);
  const response = await old.createSolicitud({});
  assert.equal(persisted, 1); assert.equal(response.solicitudId, undefined, 'modal cannot reach upload after persistence');
  const current = await load('src/services/solicitudes.ts', deps).createSolicitud({});
  assert.equal(current.solicitudId, 's1'); assert.equal(current.folio, 'S1');
});
test('OC autofill feedback remains correct when React defers the state updater', async () => {
  const source = fs.readFileSync('src/components/NuevaSolicitudModal.tsx', 'utf8');
  const ast = ts.createSourceFile('modal.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body;
  function visit(n) { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'applyOrdenCompraAutofill') body = n.initializer.getText(ast); ts.forEachChild(n, visit); } visit(ast);
  let message = '', updater;
  const ctx = { setOrdenCompraParseBusy() {}, setOrdenCompraParseMsg: v => { message = v; }, setOrdenCompraParsed() {},
    parseOrdenCompraFile: async () => ({ clienteNombre: 'Client', proveedorNombre: 'Company', montoSolicitud: 98000, tipoFactura: 'PUE' }),
    matchOptionByLabel: (_, label) => ({ value: label, label }), clientOptions: [], companyOptions: [], operationOptions: [],
    findFacturaSubtotalOperation: () => ({ value: 'FACTURA_SUBTOTAL', label: 'Factura subtotal' }), setFormData: fn => { updater = fn; },
  };
  const run = new Function(...Object.keys(ctx), ts.transpileModule(`return ${body}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText)(...Object.values(ctx));
  await run({ name: 'synthetic.xlsx' });
  assert.match(message, /Autollenado completo/);
  assert.equal(updater({}).companyId, 'Company');
});
