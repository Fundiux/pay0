const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const ts = require('typescript');
const measurementMode = process.argv.includes('--measure') || require.main !== module;
const test = measurementMode ? () => {} : require('node:test').test;
let receiptSourceRef = null;

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function load(file, deps) {
  const exports = {};
  const sourceText = receiptSourceRef && /receipt(?:PdfCallables|Semantics)\.ts$/.test(file)
    ? require('node:child_process').execFileSync('git', ['show', `${receiptSourceRef}:${file}`], { encoding: 'utf8' })
    : fs.readFileSync(file, 'utf8');
  const source = ts.transpileModule(sourceText, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('exports', 'require', source)(exports, name => {
    assert(Object.hasOwn(deps, name), `Unexpected dependency: ${name}`);
    return deps[name];
  });
  return exports;
}
const generated = load('functions/src/modules/users/authorizationPolicy.generated.ts', {});
const defaults = load('functions/src/modules/users/defaultModules.ts', { './authorizationPolicy.generated': generated });
const restrictions = load('functions/src/modules/users/restrictions.ts', {});
const authz = load('functions/src/modules/users/authorization.ts', { './defaultModules': defaults, './restrictions': restrictions });
const guard = load('functions/src/utils/authGuard.ts', {
  'firebase-functions': { https: { HttpsError } }, '../modules/users/authorization': authz,
});
const quota = load('functions/src/modules/pagos/receiptOcrQuota.ts', {
  crypto, 'firebase-functions/v2/https': { HttpsError }, '../../utils/authGuard': guard,
});
const key = (scope, value) => `receiptProcessingQuotas/${scope}_${crypto.createHash('sha256').update(value).digest('hex')}`;
const profile = (rootId = 'r1') => ({ role: 'operador', rootId, active: true });

// Optimistic transactions retry on observed-version conflict and commit writes
// atomically. This fake models races; it never connects to Firebase or Vision.
function database(seed = {}) {
  const docs = new Map(Object.entries(seed)), versions = new Map();
  const mergeFields = (previous, patch) => {
    const result = { ...previous };
    for (const [key, value] of Object.entries(patch)) {
      result[key] = value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length
        ? mergeFields(previous?.[key] || {}, value) : value;
    }
    return result;
  };
  return {
    docs, conflicts: 0,
    doc: path => ({ path, id: path.split('/').at(-1), get: async () => {
      const value = docs.get(path); return { exists: value !== undefined, id: path.split('/').at(-1), data: () => value,
        get: field => field.split('.').reduce((v, key) => v?.[key], value) };
    }, set: async value => docs.set(path, value) }),
    async getAll(...refs) { return Promise.all(refs.map(ref => ref.get())); },
    async runTransaction(run) {
      for (let attempt = 0; attempt < 1000; attempt++) {
        const reads = new Map(), writes = new Map();
        const get = async reference => {
          const ref = reference.path || reference;
          reads.set(ref, versions.get(ref) || 0);
          const data = docs.get(ref);
          return { exists: data !== undefined, get: field => field.split('.').reduce((v, key) => v?.[key], data), data: () => data === undefined ? undefined : structuredClone(data) };
        };
        await run({ get, getAll: (...refs) => Promise.all(refs.map(get)), set: (ref, data, options) => {
          const target = ref.path || ref;
          writes.set(target, options?.merge ? mergeFields(writes.get(target) || docs.get(target) || {}, data) : data);
        } });
        if ([...reads].some(([ref, version]) => (versions.get(ref) || 0) !== version)) { this.conflicts++; continue; }
        for (const [ref, data] of writes) { docs.set(ref, data); versions.set(ref, (versions.get(ref) || 0) + 1); }
        return;
      }
      throw Error('Too many synthetic transaction conflicts');
    },
  };
}

test('PAY0 profile and pagos.create permission are mandatory; rejected calls reserve nothing', async () => {
  for (const user of [undefined, { ...profile(), active: false }, { ...profile(), deleted: true },
    { ...profile(), role: 'visitor' }, { ...profile(), modules: { pagos: { view: true, create: false } } },
    { ...profile(), modules: { pagos: { view: false, create: true } } }]) {
    const db = database(user ? { 'users/u1': user } : {});
    await assert.rejects(quota.reserveReceiptProcessing(db, { uid: 'u1' }, 1000), { code: 'permission-denied' });
    assert.equal([...db.docs.keys()].filter(k => k.startsWith('receiptProcessingQuotas/')).length, 0);
  }
  await assert.rejects(quota.reserveReceiptProcessing(database(), undefined, 1000), { code: 'unauthenticated' });
});

test('concurrent actor reservations never exceed 60; failed root reservation never charges actor', async () => {
  const db = database({ 'users/u1': profile() });
  const results = await Promise.allSettled(Array.from({ length: 70 }, () => quota.reserveReceiptProcessing(db, { uid: 'u1' }, 1000)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 60);
  assert(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'resource-exhausted'));
  assert(db.conflicts > 0);
  assert.equal(db.docs.get(key('actor', 'u1')).used, 60);
  assert.equal(db.docs.get(key('root', 'r1')).used, 60);

  const rootDb = database({ 'users/u1': profile(), 'users/u2': profile(),
    [key('root', 'r1')]: { used: 599, windowStartedAtMs: 1000 } });
  const rootResults = await Promise.allSettled(['u1', 'u2'].map(uid => quota.reserveReceiptProcessing(rootDb, { uid }, 1000)));
  assert.equal(rootResults.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(rootDb.docs.get(key('root', 'r1')).used, 600);
  assert.equal([...rootDb.docs.keys()].filter(k => k.startsWith('receiptProcessingQuotas/actor_')).length, 1);
});

test('window expiry is exact, root changes do not reset actor quota, and corrupt counters fail closed', async () => {
  const state = { used: 60, windowStartedAtMs: 1000 };
  const db = database({ 'users/u1': profile('new-root'), [key('actor', 'u1')]: state });
  await assert.rejects(quota.reserveReceiptProcessing(db, { uid: 'u1' }, 3600999), { code: 'resource-exhausted' });
  await quota.reserveReceiptProcessing(db, { uid: 'u1' }, 3601000);
  assert.deepEqual(db.docs.get(key('actor', 'u1')), { version: 1, used: 1, windowStartedAtMs: 3601000 });
  assert.equal(db.docs.has(key('root', 'r1')), false);
  for (const bad of [{ used: -1, windowStartedAtMs: 1 }, { used: 0, windowStartedAtMs: 1001 }, { used: '0', windowStartedAtMs: 1 }]) {
    const corrupt = database({ 'users/u1': profile(), [key('actor', 'u1')]: bad });
    await assert.rejects(quota.reserveReceiptProcessing(corrupt, { uid: 'u1' }, 1000), { code: 'resource-exhausted' });
  }
});

function receiptHandler(db, counters, providerError = false, pdfPages = 1, pdfOcrMode = false, actualPdfParser = null) {
  const http = { HttpsError, onCall: (_options, fn) => fn };
  const module = load('functions/src/modules/pagos/receiptPdfCallables.ts', {
    'firebase-functions/v2/https': http,
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP', increment: value => value } }, './receiptOcrQuota': quota,
    'node:crypto': crypto,
    '../sharedCallables/helpers': { db, getMyUser: async uid => db.docs.get(`users/${uid}`), getRootId: async uid => db.docs.get(`users/${uid}`)?.rootId || uid },
    '../../utils/authGuard': guard,
    './receiptSemantics': load('functions/src/modules/pagos/receiptSemantics.ts', {}),
    './receiptLearning': load('functions/src/modules/pagos/receiptLearning.ts', { 'node:crypto': crypto }),
    './receiptIdentification': { identifyParsedReceipt: async input => ({ outcome: 'REVIEW_REQUIRED', analysisId: input.analysisId, readerVersion: input.readerVersion, semanticReceipt: input.semanticReceipt }) },
    'pdf-parse': actualPdfParser || (async (_bytes, options) => { counters.pdf++; assert.equal(options.max, 5); return { text: pdfOcrMode ? '' : 'Monto: 100 MXN', numpages: pdfPages }; }),
    '@google-cloud/vision': { v1: { ImageAnnotatorClient: class {
      async documentTextDetection() { counters.vision++; if (providerError) throw Error('SECRET_PROVIDER_RESPONSE'); return [{ fullTextAnnotation: { text: 'Monto: 100 MXN' } }]; }
      async batchAnnotateFiles(input) {
        counters.vision++;
        assert.deepEqual(input.requests[0].pages, Array.from({length: pdfPages}, (_, i) => i + 1));
        const count = pdfOcrMode === 'partial' ? pdfPages - 1 : pdfPages;
        return [{ responses: [{ totalPages: pdfPages, responses: Array.from({length:count}, () => pdfOcrMode === 'page-error' ? { error: { message: 'SECRET_PAGE_ERROR' } } : { fullTextAnnotation: { text: 'Monto: 100 MXN' } }) }] }];
      }
    } } },
  });
  module.parsePagoReceiptPdf.correct = module.correctPagoReceiptSemanticField;
  module.parsePagoReceiptPdf.parseText = module.parseReceiptText;
  return module.parsePagoReceiptPdf;
}

test('callable rejects unauthorized and oversized requests before parser/provider; permitted PDF keeps result contract', async () => {
  const counters = { pdf: 0, vision: 0 }, db = database();
  const parse = receiptHandler(db, counters);
  const input = { auth: { uid: 'u1' }, data: { base64: Buffer.from('%PDF-synthetic').toString('base64'), contentType: 'application/pdf', rootId: 'forged' } };
  await assert.rejects(parse(input), { code: 'permission-denied' });
  assert.deepEqual(counters, { pdf: 0, vision: 0 });
  db.docs.set('users/u1', profile());
  await assert.rejects(parse({ ...input, data: { base64: 'A'.repeat(1400000) } }), { code: 'invalid-argument' });
  const result = await parse(input);
  assert.equal(result.ok, true); assert.equal(result.textSource, 'PDF_TEXT'); assert.equal(result.receipt.amount, 100);
  assert.match(result.analysisId, /^[a-f0-9]{64}$/); assert.equal(result.readerVersion, load('functions/src/modules/pagos/receiptSemantics.ts', {}).RECEIPT_READER_VERSION);
  assert.ok(result.semanticReceipt.fields); assert.equal(result.identification.analysisId, result.analysisId); assert.equal(result.cacheHit, false);
  const cached = await parse(input); assert.equal(cached.cacheHit, true); assert.equal(cached.providerCalls, 0);
  assert.deepEqual(cached.semanticReceipt, result.semanticReceipt);
  assert.deepEqual(counters, { pdf: 1, vision: 0 });
  assert.equal(db.docs.has(key('root', 'forged')), false);
});

test('legacy policy2 extraction refreshes once without changing analysis identity or human corrections', async () => {
  const counters = { pdf: 0, vision: 0 }, db = database({ 'users/u1': profile() });
  const handler = receiptHandler(db, counters, false, 1, false, async (_bytes, options) => {
    counters.pdf++; assert.equal(options.max, 5);
    return { numpages: 1, text: 'Transferencia SPEI MXN\nMonto: 100 MXN\nFecha de operación: 2026-10-16\nReferencia: DEMO1234\nEstado: Pendiente' };
  });
  const input = { auth: { uid: 'u1' }, data: { base64: Buffer.from('%PDF-synthetic-cache-policy').toString('base64'), contentType: 'application/pdf' } };
  const first = await handler(input), analysisPath = `pagoReceiptAnalyses/${first.analysisId}`;
  const previous = db.docs.get(analysisPath);
  db.docs.set(analysisPath, { ...previous, processingPolicyVersion: 2, createdAt: 'LEGACY_CREATED_AT', customTrace: 'KEEP_TRACE',
    receipt: { ...previous.receipt, amount: 9999, amountVerified: false, executionConfirmed: false,
      warnings: ['Importe sin etiqueta inequívoca o importes contradictorios; requiere revisión.', 'Ejecución de la transferencia sin confirmar; requiere revisión.'] },
    semanticReceipt: { ...previous.semanticReceipt, reviewRequired: true, reviewReasons: ['AMOUNT_REQUIRES_REVIEW', 'EXECUTION_REQUIRES_REVIEW'],
      fields: { ...previous.semanticReceipt.fields, transferAmount: { ...previous.semanticReceipt.fields.transferAmount, value: 9999, normalizedValue: 9999, decision: 'REVIEW' } } } });
  const correction = await handler.correct({ auth: input.auth, data: { analysisId: first.analysisId, field: 'transferAmount', correctedField: 'transferAmount', correctedValue: '125.50', expectedCorrectionVersion: 0 } });
  const before = structuredClone(db.docs.get(analysisPath));
  const refreshed = await handler(input), persisted = db.docs.get(analysisPath);
  assert.equal(refreshed.analysisId, first.analysisId); assert.equal(refreshed.readerVersion, first.readerVersion);
  assert.equal(refreshed.cacheHit, false); assert.equal(refreshed.correctionVersion, correction.correctionVersion);
  assert.equal(refreshed.receipt.amount, 125.5); assert.equal(refreshed.receipt.executionConfirmed, false);
  assert.equal(refreshed.semanticReceipt.fields.transferAmount.provenance, 'HUMAN_CORRECTION');
  assert.equal(refreshed.semanticReceipt.reviewRequired, false); assert.deepEqual(refreshed.semanticReceipt.reviewReasons, []);
  assert.equal(persisted.processingPolicyVersion, 4); assert.equal(persisted.receipt.amount, 100);
  assert.equal(persisted.createdAt, 'LEGACY_CREATED_AT'); assert.equal(persisted.customTrace, 'KEEP_TRACE');
  assert.deepEqual(persisted.humanCorrectionsByActor, before.humanCorrectionsByActor);
  assert.deepEqual(persisted.correctionVersionsByActor, before.correctionVersionsByActor);
  assert.deepEqual(persisted.humanCorrections, before.humanCorrections);
  const cached = await handler(input);
  assert.equal(cached.cacheHit, true); assert.equal(cached.providerCalls, 0); assert.equal(cached.receipt.amount, 125.5);
  assert.equal(cached.correctionVersion, correction.correctionVersion); assert.deepEqual(counters, { pdf: 2, vision: 0 });
});

test('OCR failures remain charged and never expose provider errors', async () => {
  const counters = { pdf: 0, vision: 0 }, db = database({ 'users/u1': profile() });
  const parse = receiptHandler(db, counters, true);
  await assert.rejects(parse({ auth: { uid: 'u1' }, data: { base64: 'aGVsbG8=', contentType: 'image/png' } }), error => {
    assert.equal(error.code, 'failed-precondition'); assert(!error.message.includes('SECRET')); return true;
  });
  assert.equal(counters.vision, 1); assert.equal(db.docs.get(key('actor', 'u1')).used, 1);
});


test('long PDF is rejected explicitly instead of returning partial extraction or invoking OCR', async () => {
  const counters = { pdf: 0, vision: 0 }, db = database({ 'users/u1': profile() });
  const parse = receiptHandler(db, counters, false, 6);
  await assert.rejects(parse({ auth: { uid: 'u1' }, data: { base64: Buffer.from('%PDF-1.4 synthetic').toString('base64'), contentType: 'application/pdf' } }), error => {
    assert.equal(error.code, 'invalid-argument'); assert.match(error.message, /5 paginas/); return true;
  });
  assert.equal(counters.pdf, 1); assert.equal(counters.vision, 0);
});


test('receipt memory keys isolate roots; advisory never promotes or overrides accepted evidence', () => {
  const learning = load('functions/src/modules/pagos/receiptLearning.ts', { 'node:crypto': crypto });
  const pattern = learning.receiptPattern({ readerVersion: 'v1', bankName: 'Banco', evidenceLabel: 'Folio', fromField: 'folio', toField: 'reference' });
  assert.notEqual(learning.receiptMemoryId('root-a', pattern.key), learning.receiptMemoryId('root-b', pattern.key));
  assert.equal(learning.receiptMemoryId('root-a', pattern.key), learning.receiptMemoryId('root-a', pattern.key));
  const advisory = { patternKey: pattern.key, memoryPatternKey: pattern.key, memoryStatus: 'CANDIDATE', documentEvidenceDecision: 'ACCEPTED' };
  assert.equal(learning.memoryCanAdvise(advisory), false);
  assert.equal(learning.memoryCanAdvise({ ...advisory, documentEvidenceDecision: 'MISSING' }), true);
  assert.equal(learning.memoryCanAdvise({ ...advisory, documentEvidenceDecision: 'MISSING', memoryStatus: 'REJECTED' }), false);
});

test('semantic reader keeps transfer, balance, commission and ambiguous execution distinct', () => {
  const semantics = load('functions/src/modules/pagos/receiptSemantics.ts', {});
  const text = 'Monto transferido: 100 MXN\nSaldo disponible: 900 MXN\nComision bancaria: 10 MXN\nReferencia: 1234567\nClave de rastreo: ABC123';
  const semantic = semantics.buildSemanticReceipt(text, { amount: 100, amountVerified: true, executionConfirmed: false, dateVerified: false, reference: '1234567' });
  assert.equal(semantic.fields.transferAmount.value, 100);
  assert.equal(semantic.fields.accountBalance.value, 900);
  assert.equal(semantic.fields.bankCommission.value, 10);
  assert.ok(semantic.reviewRequired);
  assert.equal(semantic.fields.reference.value, '1234567');
  assert.ok(semantic.fields.trackingKey.value);
});

const splitLabelCases = [
  ['beneficiaryName', 'Beneficiario:\nEMPRESA SINTETICA SA'],
  ['reference', 'Referencia\n00012345'],
  ['destinationAccount', 'Cuenta destino:\n012345678901234567'],
  ['concept', 'Concepto\nFactura sintetica 123'],
  ['time', 'Hora:\n13:45:30'],
];
for (const [field, text] of splitLabelCases) test(`split PDF/OCR label preserves ${field}`, () => {
  const parse = receiptHandler(database(), { pdf: 0, vision: 0 }).parseText;
  assert.equal(parse(text)[field], text.split('\n')[1]);
});

const identifierCases = [
  ['trackingKey', 'Clave de rastreo:\nABC001234', 'ABC001234'],
  ['folio', 'Folio electrónico: 00012345', '00012345'],
  ['transactionId', 'Número de operación:\n00098765', '00098765'],
];
for (const [field, text, expected] of identifierCases) test(`identifier evidence preserves ${field} and its original value`, () => {
  const semantic = load('functions/src/modules/pagos/receiptSemantics.ts', {}).buildSemanticReceipt(text, {});
  assert.equal(semantic.fields[field].value, expected);
  assert.ok(semantic.fields[field].excerpt.includes(expected));
  assert.equal(semantic.fields[field].decision, 'ACCEPTED');
});

test('missing split values do not consume a subsequent label or authorize payment', () => {
  const parse = receiptHandler(database(), { pdf: 0, vision: 0 }).parseText;
  const receipt = parse('Beneficiario:\nReferencia: 00012345\nConcepto:\nMonto: 100 MXN');
  assert.equal(receipt.beneficiaryName, '');
  assert.equal(receipt.concept, '');
  assert.equal(receipt.executionConfirmed, false);
  assert.equal(receipt.dateVerified, false);
  const semantic = load('functions/src/modules/pagos/receiptSemantics.ts', {}).buildSemanticReceipt('Clave de rastreo:\nReferencia: 00012345', receipt);
  assert.equal(semantic.fields.trackingKey.decision, 'MISSING');
  assert.equal(semantic.reviewRequired, true);
  assert.equal(parse('Beneficiario\nReferencia 123').beneficiaryName, '');
  const unpunctuated = load('functions/src/modules/pagos/receiptSemantics.ts', {}).buildSemanticReceipt('Clave de rastreo\nReferencia 123', {});
  assert.equal(unpunctuated.fields.trackingKey.decision, 'MISSING');
});


test('correction writes root-scoped candidate memories without cross-root overwrite or promotion', async () => {
  const db = database({ 'users/u1': profile('root-a'), 'users/u2': profile('root-b') });
  const fields = { reference: { value: '12345', normalizedValue: '12345', label: 'Referencia', confidence: 'HIGH', decision: 'ACCEPTED' }, bankName: { normalizedValue: 'Banco' }, folio: { decision: 'MISSING' } };
  for (const [id, rootId] of [['a'.repeat(64), 'root-a'], ['b'.repeat(64), 'root-b']]) db.docs.set(`pagoReceiptAnalyses/${id}`, { rootId, readerVersion: 'PAY0_RECEIPT_SEMANTIC_V1', contentSha256: 'c'.repeat(64), semanticReceipt: { fields } });
  const handler = receiptHandler(db, { pdf: 0, vision: 0 });
  const a = await handler.correct({ auth: { uid: 'u1' }, data: { analysisId: 'a'.repeat(64), field: 'reference', correctedField: 'folio', correctedValue: '12345' } });
  const b = await handler.correct({ auth: { uid: 'u2' }, data: { analysisId: 'b'.repeat(64), field: 'reference', correctedField: 'folio', correctedValue: '12345' } });
  assert.notEqual(a.memoryId, b.memoryId);
  assert.equal(db.docs.get(`agent007Memory/${a.memoryId}`).rootId, 'root-a');
  assert.equal(db.docs.get(`agent007Memory/${b.memoryId}`).rootId, 'root-b');
  assert.equal(db.docs.get(`agent007Memory/${a.memoryId}`).status, 'CANDIDATE');
  assert.equal(db.docs.has(`agent007Memory/receipt_${a.patternKey}`), false);
});

test('repeated feedback is idempotent and new observations preserve rejected governance', async () => {
  const db = database({ 'users/u1': profile() });
  const analysisId = 'a'.repeat(64);
  db.docs.set(`pagoReceiptAnalyses/${analysisId}`, { rootId: 'r1', readerVersion: 'test-reader', contentSha256: 'b'.repeat(64), semanticReceipt: { fields: {
    reference: { value: '12345', label: 'Referencia', confidence: 'MEDIUM' }, bankName: { normalizedValue: 'Banco' },
  } } });
  const correct = receiptHandler(db, { pdf: 0, vision: 0 }).correct;
  const request = { auth: { uid: 'u1' }, data: { analysisId, field: 'reference', correctedField: 'folio', correctedValue: '12345' } };
  const first = await correct(request);
  const memoryPath = `agent007Memory/${first.memoryId}`;
  db.docs.set(memoryPath, { ...db.docs.get(memoryPath), status: 'REJECTED', createdAt: 'ORIGINAL', receiptLearning: { key: first.patternKey, confirmations: 7 } });
  await correct(request);
  assert.equal(db.docs.get(memoryPath).receiptLearning.confirmations, 7);
  assert.equal(db.docs.get(memoryPath).status, 'REJECTED');
  await correct({ ...request, data: { ...request.data, correctedValue: '98765' } });
  assert.equal(db.docs.get(memoryPath).status, 'REJECTED');
  assert.equal(db.docs.get(memoryPath).createdAt, 'ORIGINAL');
  assert.equal(db.docs.get(`pagoReceiptCorrections/${first.correctionId}`).autoResult.normalizedValue, '12345');
  assert.equal(db.docs.get(`pagoReceiptAnalyses/${analysisId}`).humanCorrectionsByActor.u1.reference.correctedValue, '98765');
  assert.equal(Object.hasOwn(db.docs.get(`pagoReceiptAnalyses/${analysisId}`), 'humanCorrections.reference'), false);
});

test('legacy memory fallback reads only same root and scoped candidate takes precedence', async () => {
  const learning = load('functions/src/modules/pagos/receiptLearning.ts', { 'node:crypto': crypto });
  const readerVersion = load('functions/src/modules/pagos/receiptSemantics.ts', {}).RECEIPT_READER_VERSION;
  const bytes = Buffer.from('%PDF-synthetic');
  const contentSha = crypto.createHash('sha256').update(bytes).digest('hex');
  const analysisId = crypto.createHash('sha256').update(`r1|${contentSha}|${readerVersion}`).digest('hex');
  const pattern = learning.receiptPattern({ readerVersion, bankName: 'Banco', evidenceLabel: 'Referencia', fromField: 'reference', toField: 'folio' });
  for (const memoryRoot of ['r1', 'foreign']) {
    const db = database({ 'users/u1': profile() });
    db.docs.set(`pagoReceiptAnalyses/${analysisId}`, { rootId: 'r1', readerVersion, processingPolicyVersion: 4, receipt: { amount: 100 }, textSource: 'PDF_TEXT', semanticReceipt: { readerVersion, fields: { reference: { label: 'Referencia', value: '12345' }, bankName: { normalizedValue: 'Banco' }, folio: { decision: 'MISSING' } } } });
    db.docs.set(`agent007Memory/receipt_${pattern.key}`, { rootId: memoryRoot, status: 'CANDIDATE', content: 'legacy', receiptLearning: { key: pattern.key } });
    const handler = receiptHandler(db, { pdf: 0, vision: 0 });
    const input = { auth: { uid: 'u1' }, data: { base64: bytes.toString('base64'), contentType: 'application/pdf' } };
    const result = await handler(input);
    assert.equal(result.learningContext.length, memoryRoot === 'r1' ? 1 : 0);
    db.docs.set(`agent007Memory/${learning.receiptMemoryId('r1', pattern.key)}`, { rootId: 'r1', status: 'CANDIDATE', content: 'scoped', receiptLearning: { key: pattern.key } });
    const scoped = await handler(input); assert.equal(scoped.learningContext.length, 1); assert.equal(scoped.learningContext[0].content, 'scoped');
  }
});


test('PDF OCR requests verified pages and rejects partial or errored responses', async () => {
  for (const mode of ['complete', 'partial', 'page-error']) {
    const counters = { pdf: 0, vision: 0 }, db = database({ 'users/u1': profile() });
    const handler = receiptHandler(db, counters, false, 2, mode);
    const input = { auth: { uid: 'u1' }, data: { base64: Buffer.from('%PDF-synthetic').toString('base64'), contentType: 'application/pdf' } };
    if (mode === 'complete') assert.equal((await handler(input)).textSource, 'VISION_OCR');
    else await assert.rejects(handler(input), error => error.code === 'failed-precondition' && !error.message.includes('SECRET'));
    assert.deepEqual(counters, { pdf: 1, vision: 1 });
  }
});

// Reuse exactly the regression fixtures; no production documents or providers.
// node qa/scripts/remediation-ocr-quota.test.cjs --measure <baseline-commit>
if (measurementMode && require.main === module) {
  const requestedRef = process.argv[process.argv.indexOf('--measure') + 1];
  if (!requestedRef || !/^[a-f0-9]{7,40}$/i.test(requestedRef)) throw Error('Supply an explicit baseline commit hash');
  const baselineCommit = require('node:child_process').execFileSync('git', ['rev-parse', '--verify', `${requestedRef}^{commit}`], { encoding: 'utf8' }).trim();
  function measure(ref) {
    receiptSourceRef = ref;
    const parse = receiptHandler(database(), { pdf: 0, vision: 0 }).parseText;
    const semantics = load('functions/src/modules/pagos/receiptSemantics.ts', {});
    const fields = [
      ...splitLabelCases.map(([field, text]) => ({ field, exact: parse(text)[field] === text.split('\n')[1] })),
      ...identifierCases.map(([field, text, expected]) => ({ field, exact: semantics.buildSemanticReceipt(text, {}).fields[field].value === expected })),
    ];
    const exactFields = fields.filter(field => field.exact).length;
    return { readerVersion: semantics.RECEIPT_READER_VERSION, exactFields, totalFields: fields.length, exactFieldRate: exactFields / fields.length, fields };
  }
  const metrics = {
    schemaVersion: 1, fixtureSet: 'synthetic-split-labels-and-accented-identifiers-v1',
    scope: 'Eight targeted synthetic field fixtures; not production accuracy or OCR provider quality.',
    baselineCommit,
    reproduce: `node qa/scripts/remediation-ocr-quota.test.cjs --measure ${baselineCommit}`,
    regressionCommand: 'node --test qa/scripts/remediation-ocr-quota.test.cjs',
    baseline: measure(baselineCommit), candidate: measure(null),
  };
  fs.mkdirSync('output', { recursive: true });
  fs.writeFileSync('output/receipt-reader-metrics.json', `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(JSON.stringify(metrics));
}

module.exports.createEvaluationReader = (ref = null) => {
  receiptSourceRef = ref;
  const parse = receiptHandler(database(), { pdf: 0, vision: 0 }).parseText;
  const semantic = load('functions/src/modules/pagos/receiptSemantics.ts', {});
  return { parse, semantic: semantic.buildSemanticReceipt, readerVersion: semantic.RECEIPT_READER_VERSION };
};


test('operational correction validation rejects ambiguous values and unrelated reclassification', () => {
  const learning = load('functions/src/modules/pagos/receiptLearning.ts', { 'node:crypto': crypto });
  for (const [field, value] of [['transferAmount', '1,000'], ['transferAmount', '-1'], ['transferAmount', '1.001'], ['executionDate', '2025-02-29'], ['executionTime', '24:00'], ['sourceAccount', 'abc']])
    assert.throws(() => learning.normalizeReceiptCorrection(field, field, value));
  assert.throws(() => learning.normalizeReceiptCorrection('transferAmount', 'reference', '123'));
  assert.equal(learning.normalizeReceiptCorrection('transferAmount', 'transferAmount', '100.50'), 100.5);
  assert.equal(learning.normalizeReceiptCorrection('executionDate', 'executionDate', '2024-02-29'), '2024-02-29');
});

test('operational corrections preserve OCR and execution evidence, version edits, and survive cached parsing', async () => {
  const db = database({ 'users/u1': profile() });
  const handler = receiptHandler(db, { pdf: 0, vision: 0 });
  const input = { auth: { uid: 'u1' }, data: { base64: Buffer.from('%PDF-synthetic').toString('base64'), contentType: 'application/pdf' } };
  const parsed = await handler(input);
  const analysisPath = `pagoReceiptAnalyses/${parsed.analysisId}`;
  const original = structuredClone(db.docs.get(analysisPath));
  const request = { auth: input.auth, data: { analysisId: parsed.analysisId, field: 'transferAmount', correctedField: 'transferAmount', correctedValue: '250.50', expectedCorrectionVersion: 0 } };
  const first = await handler.correct(request);
  assert.equal(first.receipt.amount, 250.5);
  assert.equal(first.correctionVersion, 1);
  assert.equal(first.semanticReceipt.fields.transferAmount.provenance, 'HUMAN_CORRECTION');
  assert.equal(first.receipt.executionConfirmed, original.receipt.executionConfirmed);
  assert.deepEqual(db.docs.get(analysisPath).semanticReceipt, original.semanticReceipt);
  assert.deepEqual(db.docs.get(analysisPath).receipt, original.receipt);
  assert.equal((await handler.correct(request)).correctionVersion, 1);
  await assert.rejects(handler.correct({ ...request, data: { ...request.data, correctedValue: '251' } }), { code: 'aborted' });
  const second = await handler.correct({ ...request, data: { ...request.data, field: 'concept', correctedField: 'concept', correctedValue: 'Pago sintetico', expectedCorrectionVersion: 1 } });
  assert.equal(second.correctionVersion, 2);
  assert.equal(second.receipt.amount, 250.5);
  assert.equal(second.receipt.concept, 'Pago sintetico');
  const cached = await handler(input);
  assert.equal(cached.receipt.amount, 250.5);
  assert.equal(cached.receipt.concept, 'Pago sintetico');
  assert.equal(cached.correctionVersion, 2);
  const changed = await handler.correct({ ...request, data: { ...request.data, correctedValue: '300', expectedCorrectionVersion: 2 } });
  const reverted = await handler.correct({ ...request, data: { ...request.data, expectedCorrectionVersion: 3 } });
  assert.equal(changed.correctionVersion, 3);
  assert.equal(reverted.correctionVersion, 4);
  assert.notEqual(reverted.correctionId, first.correctionId);
  assert.equal(reverted.receipt.amount, 250.5);
  assert.equal([...db.docs.keys()].some(key => key.startsWith('pagos/')), false);
});


test('operational same-field memories are retrieved on the next document as advice only', async () => {
  const db = database({ 'users/u1': profile() });
  const handler = receiptHandler(db, { pdf: 0, vision: 0 });
  const input = text => ({ auth: { uid: 'u1' }, data: { base64: Buffer.from(text).toString('base64'), contentType: 'application/pdf' } });
  const firstInput = input('%PDF-first-synthetic');
  const first = await handler(firstInput);
  const correction = await handler.correct({ auth: firstInput.auth, data: { analysisId: first.analysisId, field: 'concept', correctedField: 'concept', correctedValue: 'Private synthetic concept', expectedCorrectionVersion: 0 } });
  const next = await handler(input('%PDF-second-synthetic'));
  const advisory = next.learningContext.find(row => row.id === correction.memoryId);
  assert.ok(advisory);
  assert.equal(advisory.advisory, true);
  assert.ok(!advisory.content.includes('Private synthetic concept'));
  assert.notEqual(next.receipt.concept, 'Private synthetic concept');
  const sameDocument = await handler(firstInput);
  assert.equal(sameDocument.learningContext.find(row => row.id === correction.memoryId).advisory, false);
  const memory = db.docs.get(`agent007Memory/${correction.memoryId}`);
  db.docs.set(`agent007Memory/${correction.memoryId}`, { ...memory, status: 'REJECTED' });
  const rejected = await handler(input('%PDF-third-synthetic'));
  assert.equal(rejected.learningContext.find(row => row.id === correction.memoryId).advisory, false);
});


test('actor overlays remain isolated and legacy correction ownership is preserved', async () => {
  const db = database({ 'users/u1': profile(), 'users/u2': profile() });
  const handler = receiptHandler(db, { pdf: 0, vision: 0 });
  const input = { auth: { uid: 'u1' }, data: { base64: Buffer.from('%PDF-isolation').toString('base64'), contentType: 'application/pdf' } };
  const initial = await handler(input);
  const edit = (uid, value, version) => handler.correct({ auth: { uid }, data: { analysisId: initial.analysisId, field: 'transferAmount', correctedField: 'transferAmount', correctedValue: value, expectedCorrectionVersion: version } });
  const a = await edit('u1', '200', 0);
  const b = await edit('u2', '300', 0);
  assert.equal(a.correctionVersion, 1); assert.equal(b.correctionVersion, 1);
  await edit('u2', '400', 1);
  const againA = await handler(input), againB = await handler({ ...input, auth: { uid: 'u2' } });
  assert.equal(againA.receipt.amount, 200); assert.equal(againA.correctionVersion, 1);
  assert.equal(againB.receipt.amount, 400); assert.equal(againB.correctionVersion, 2);
  const learning = load('functions/src/modules/pagos/receiptLearning.ts', { 'node:crypto': crypto });
  const legacy = { correctionVersion: 7, humanCorrections: { concept: { actorUid: 'u1', correctedValue: 'A' }, reference: { actorUid: 'u2', correctedValue: 'B' } } };
  assert.deepEqual(Object.keys(learning.getReceiptActorCorrectionState(legacy, 'u1').corrections), ['concept']);
  assert.equal(learning.getReceiptActorCorrectionState(legacy, 'u1').version, 7);
  const own = { ...legacy, correctionVersionsByActor: { u1: 8 }, humanCorrectionsByActor: { u1: { concept: { actorUid: 'u1', correctedValue: 'NEW' } } } };
  assert.equal(learning.getReceiptActorCorrectionState(own, 'u1').corrections.concept.correctedValue, 'NEW');
  assert.deepEqual(legacy.humanCorrections.reference, { actorUid: 'u2', correctedValue: 'B' });
});


test('real PDF bytes parse through typed-array boundary and retain page and malformed guards', async () => {
  const { PDFDocument, StandardFonts } = require('../../functions/node_modules/pdf-lib');
  const realParser = require('../../functions/node_modules/pdf-parse');
  const makePdf = async pages => {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pages; i++) pdf.addPage().drawText('Monto: 1000 MXN', { x: 40, y: 700, size: 14, font });
    return Buffer.from(await pdf.save());
  };
  const counters = { pdf: 0, vision: 0 };
  const handler = receiptHandler(database({ 'users/u1': profile() }), counters, false, 1, false, async (bytes, options) => {
    assert.ok(bytes instanceof Uint8Array && !Buffer.isBuffer(bytes), 'pdf.js must not receive Node Buffer slice semantics');
    assert.equal(options.max, 5);
    return realParser(bytes, options);
  });
  const input = bytes => ({ auth: { uid: 'u1' }, data: { base64: bytes.toString('base64'), contentType: 'application/pdf' } });
  const bytes = await makePdf(1), digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const parsed = await handler(input(bytes));
  assert.equal(parsed.receipt.amount, 1000);
  assert.equal(parsed.contentSha256, digest);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), digest);
  await assert.rejects(handler(input(await makePdf(6))), { code: 'invalid-argument' });
  await assert.rejects(handler(input(Buffer.from('%PDF-1.7 malformed document'))), { code: 'failed-precondition' });
  assert.equal(counters.vision, 0, 'Unverified PDFs never fall back to partial OCR');
});
