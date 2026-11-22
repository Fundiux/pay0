// Tolerant OC recognition: synthetic fixtures only (no client documents).
// Run after `npm run build` in functions/: node qa/scripts/oc-tolerant-recognition.test.cjs
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { PDFDocument, StandardFonts } = require('../../functions/node_modules/pdf-lib');
const service = require('../../functions/lib/modules/solicitudDocuments/service.js');
const recognition = require('../../functions/lib/modules/solicitudDocuments/ocRecognition.js');
const semantic = require('../../functions/lib/modules/solicitudDocuments/ocSemanticExtraction.js');
const { requirePricedQuoteLines } = require('../../functions/lib/modules/cotizaciones/callables.js');

const { parseLocaleAmount, parseFlexibleOcDate, recognizeOcFromRows, recognizeOcFromText, validateOcCandidate, recognitionLogEntry } = recognition;
const CLIENT_RFC = 'XAXX010101000';
const COMPANY_RFC = 'EKU9003173C9';

async function workbook(rows, sheetName = 'OC') {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet(sheetName);
  rows.forEach((values, index) => { sheet.getRow(index + 1).values = values; });
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function pdf(lines) {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Courier);
  let page = doc.addPage([612, 792]), y = 750;
  for (const line of lines) {
    if (line === '<PAGE>') { page = doc.addPage([612, 792]); y = 750; continue; }
    page.drawText(line, { x: 40, y, size: 9, font }); y -= 12;
  }
  return Buffer.from(await doc.save());
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('amount formats', () => {
  const cases = [['1,234.56', 1234.56], ['1.234,56', 1234.56], ['1 234,56', 1234.56], ['$1,234.56 MXN', 1234.56], ['$ 12,500', 12500],
    ['(1,000.00)', -1000], ['12,50', 12.5], ['880.525', 880.525], ['1.234.567', 1234567], ['MXN 99.90', 99.9], [7540, 7540]];
  for (const [raw, expected] of cases) assert.equal(parseLocaleAmount(raw), expected, String(raw));
  for (const raw of ['16%', 'abc', '1,2,3', '12-34', 'Calle 5 No. 10', '']) assert.equal(parseLocaleAmount(raw), null, String(raw));
});

test('date formats', () => {
  assert.equal(parseFlexibleOcDate('15/11/2026'), '2026-11-15');
  assert.equal(parseFlexibleOcDate('2026-11-15'), '2026-11-15');
  assert.equal(parseFlexibleOcDate('15 de noviembre de 2026'), '2026-11-15');
  assert.equal(parseFlexibleOcDate('15-Nov-2026'), '2026-11-15');
  assert.equal(parseFlexibleOcDate('November 15, 2026'), '2026-11-15');
  assert.equal(parseFlexibleOcDate('46296'), '2026-10-01');
  assert.equal(parseFlexibleOcDate('31/02/2026'), '');
});

test('regression: canonical OC stays on the deterministic reader with identical output', async () => {
  const oc = await workbook([
    ['Orden de Compra'], ['PROVEEDOR:', 'PROVEEDOR QA'], ['', '', '', 'FECHA:', 46296],
    ['Razon Social:', 'CLIENTE QA'], ['RFC:', CLIENT_RFC], ['Moneda', 'MXN'],
    ['Cantidad', 'Clave Unidad', 'Clave Concepto', 'Concepto', 'Precio unitario', 'Importe'],
    [4, 'H87', '26101700', 'BUJIA DE COBRE', 317.58, 1270.32],
    [7, 'H87', '15121501', 'ACEITE 15W40', 880.525, 6163.675],
    ['', '', '', '', 'Subtotal:', 7433.995], ['', '', '', '', 'IVA:', 1189.4392], ['', '', '', '', 'TOTAL:', 8623.4342],
  ]);
  const strict = await service.parseOcFiscalMetadataBuffer(oc, true, undefined, true);
  const layered = await service.parseOcQuotationLinesBuffer(oc, { solicitudTotal: 8623.43 });
  assert.deepEqual(layered, strict, 'priced deterministic output is returned untouched');
  assert.equal(layered.recognition, undefined);
  assert.ok(await service.parseOcCommercialMetadataBuffer(oc), 'commercial reader still accepts it');
});

test('Excel with English labels, no SAT columns, European numbers', async () => {
  const oc = await workbook([
    ['PURCHASE ORDER'], ['PO Number:', 'PO-77812'], ['Order Date:', '03/11/2026'],
    ['Bill To:', 'CLIENTE QA'], ['RFC:', CLIENT_RFC], ['Supplier RFC', COMPANY_RFC], ['Currency', 'Pesos mexicanos'],
    ['Item', 'Description', 'Qty', 'Unit Price', 'Amount'],
    ['1', 'Mantenimiento preventivo', '2', '1.250,00', '2.500,00'],
    ['2', 'Refacciones varias', '3', '500,00', '1.500,00'],
    ['', '', '', 'Subtotal', '4.000,00'], ['', '', '', 'Tax 16%', '640,00'], ['', '', '', 'Grand Total', '4.640,00'],
  ]);
  assert.equal(await service.parseOcCommercialMetadataBuffer(oc), null, 'deterministic reader rejects this layout');
  const lines = await service.parseOcQuotationLinesBuffer(oc, { solicitudTotal: 4640 });
  assert.equal(lines.recognition.layer, 'TOLERANT');
  assert.equal(lines.recognition.status, 'ACCEPTED');
  assert.equal(lines.total, 4640); assert.equal(lines.subtotal, 4000); assert.equal(lines.iva, 640);
  assert.equal(lines.number, 'PO-77812'); assert.equal(lines.date, '2026-11-03');
  assert.equal(lines.clientRfc, CLIENT_RFC); assert.equal(lines.currency, 'MXN');
  const quote = requirePricedQuoteLines(lines, 4640);
  assert.deepEqual(quote.items.map(item => item.amount), [2500, 1500]);
});

test('Spanish synonyms: P.U., I.V.A., Total a pagar, per-line Total column', () => {
  const result = recognizeOcFromRows([
    ['ORDEN DE COMPRA No.', '4500123'], ['Fecha de emisión', '15/11/2026'], ['Cliente', 'CLIENTE QA'], ['R.F.C.', CLIENT_RFC],
    ['Cant.', 'U.M.', 'Descripción', 'P.U.', 'Total'],
    ['10', 'PZA', 'Guantes de nitrilo', '$45.00', '$450.00'],
    ['1', 'SERV', 'Flete local', '$550.00', '$550.00'],
    ['', '', '', 'Sub-total', '$1,000.00'], ['', '', '', 'I.V.A. 16%', '$160.00'], ['', '', '', 'Total a pagar', '$1,160.00 M.N.'],
  ], 'XLSX', { solicitudTotal: 1160, registeredClientRfc: CLIENT_RFC });
  assert.equal(result.status, 'ACCEPTED', JSON.stringify(result.issues));
  assert.equal(result.candidate.items.length, 2);
  assert.equal(result.candidate.items[0].unit, 'PZA');
  assert.equal(result.candidate.total, 1160);
  assert.equal(result.candidate.number, '4500123');
});

test('multi-page table: repeated header, page markers, per-page subtotal ignored', () => {
  const header = ['Cantidad', 'Descripcion', 'Precio Unitario', 'Importe'];
  const rows = [['Orden de compra', 'OC-9'], ['Fecha', '2026-11-10'], ['RFC', CLIENT_RFC], ['Moneda', 'MXN'], header];
  for (let i = 1; i <= 30; i++) rows.push([String(i % 3 + 1), `Material ${i}`, '100.00', `${(i % 3 + 1) * 100}.00`]);
  rows.splice(20, 0, ['Página 1 de 2'], header);
  const sum = rows.slice(5).filter(row => /^Material/.test(row[1] || '')).reduce((acc, row) => acc + Number(row[3]), 0);
  rows.push(['', '', 'Subtotal', sum.toFixed(2)], ['', '', 'IVA', (sum * 0.16).toFixed(2)], ['', '', 'Total', (sum * 1.16).toFixed(2)]);
  const result = recognizeOcFromRows(rows, 'XLSX', { solicitudTotal: Math.round(sum * 116) / 100 });
  assert.equal(result.status, 'ACCEPTED', JSON.stringify(result.issues));
  assert.equal(result.candidate.items.length, 30);
});

test('CSV OC (semicolon, decimal comma) is read instead of failing the upload', async () => {
  const csv = Buffer.from([
    'Orden de compra;OC-552', 'Fecha;05/11/2026', 'RFC cliente;' + CLIENT_RFC, 'Moneda;MXN', '',
    'Cantidad;Descripcion;Precio unitario;Importe', '2;"Servicio de limpieza; turno nocturno";1.500,00;3.000,00',
    ';;Subtotal;3.000,00', ';;IVA;480,00', ';;Total;3.480,00',
  ].join('\r\n'), 'utf8');
  const result = await service.recognizeOcBuffer(csv, { solicitudTotal: 3480 }, { semantic: false });
  assert.equal(result.format, 'CSV');
  assert.equal(result.status, 'ACCEPTED', JSON.stringify(result.issues));
  assert.equal(result.candidate.items[0].description, 'Servicio de limpieza; turno nocturno');
});

test('scanned-like noisy text with OCR artefacts', () => {
  const text = [
    'ORDEN  DE  COMPRA   No. 88123', 'Fecha: 12 de noviembre de 2026', 'Proveedor RFC: ' + COMPANY_RFC,
    'Cliente: CLIENTE QA   RFC: ' + CLIENT_RFC, '------------------------------------------',
    'CANT | DESCRIPCION                | P.UNIT    | IMPORTE', '3 | Cartucho de toner negro | $1,200.00 | $3,600.00',
    '1   PZA  Kit de limpieza      400.00     400.00', 'Pagina 1 de 1', 'Tel. 55 1234 5678  CP 06600',
    'SUBTOTAL:   $4,000.00', 'IVA 16%:    $640.00', 'TOTAL:      $4,640.00 MXN',
  ].join('\n');
  const result = recognizeOcFromText(text, 'TEXT', { solicitudTotal: 4640, registeredClientRfc: CLIENT_RFC, companyRfc: COMPANY_RFC });
  assert.equal(result.status, 'ACCEPTED', JSON.stringify(result.issues));
  assert.equal(result.candidate.items.length, 2);
  assert.equal(result.candidate.clientRfc, CLIENT_RFC);
  assert.equal(result.candidate.number, '88123');
  assert.equal(result.candidate.date, '2026-11-12');
});

test('PDF OC text layer, two pages', async () => {
  const buffer = await pdf([
    'ORDEN DE COMPRA No. 3021', 'Fecha: 08/11/2026', 'RFC: ' + CLIENT_RFC, 'Moneda: MXN', '',
    'Cant  Descripcion                 P.U.        Importe', '5     Silla operativa             1,000.00    5,000.00',
    '<PAGE>', 'Cant  Descripcion                 P.U.        Importe', '2     Escritorio ejecutivo        2,500.00    5,000.00', '',
    'Subtotal: 10,000.00', 'IVA: 1,600.00', 'Total: 11,600.00',
  ]);
  const result = await service.recognizeOcBuffer(buffer, { solicitudTotal: 11600 }, { semantic: false });
  assert.equal(result.format, 'PDF');
  assert.equal(result.status, 'ACCEPTED', JSON.stringify(result.issues));
  assert.equal(result.candidate.items.length, 2);
});

test('inconsistent totals go to review, never accepted', () => {
  const result = recognizeOcFromRows([
    ['OC', 'A-1'], ['Fecha', '01/11/2026'], ['RFC', CLIENT_RFC], ['Moneda', 'MXN'],
    ['Cantidad', 'Descripcion', 'Precio', 'Importe'], ['1', 'Servicio', '1000', '1000'],
    ['', '', 'Subtotal', '1000'], ['', '', 'IVA', '160'], ['', '', 'Total', '1200'],
  ], 'XLSX', { solicitudTotal: 1200 });
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.ok(result.issues.includes('TOTALS_INCONSISTENT'));
});

test('lines that do not add up to the subtotal go to review', () => {
  const result = recognizeOcFromRows([
    ['OC', 'A-2'], ['Moneda', 'MXN'], ['Cantidad', 'Descripcion', 'Precio', 'Importe'], ['1', 'Servicio', '900', '900'],
    ['', '', 'Subtotal', '1000'], ['', '', 'IVA', '160'], ['', '', 'Total', '1160'],
  ], 'XLSX', { solicitudTotal: 1160 });
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.ok(result.issues.includes('LINES_DO_NOT_MATCH_SUBTOTAL'));
});

test('total different from the solicitud, foreign currency, other client RFC: review', () => {
  const rows = (extra = [], total = '1160') => [['OC', 'A-3'], ['RFC', CLIENT_RFC], ...extra,
    ['Cantidad', 'Descripcion', 'Precio', 'Importe'], ['1', 'Servicio', '1000', '1000'],
    ['', '', 'Subtotal', '1000'], ['', '', 'IVA', '160'], ['', '', 'Total', total]];
  assert.ok(recognizeOcFromRows(rows(), 'XLSX', { solicitudTotal: 1500 }).issues.includes('TOTAL_DIFFERS_FROM_SOLICITUD'));
  const usd = recognizeOcFromRows(rows([['Moneda', 'USD']]), 'XLSX', { solicitudTotal: 1160 });
  assert.equal(usd.status, 'REVIEW_REQUIRED'); assert.ok(usd.issues.includes('FOREIGN_CURRENCY'));
  const other = recognizeOcFromRows(rows(), 'XLSX', { solicitudTotal: 1160, registeredClientRfc: 'AAA010101AAA' });
  assert.equal(other.status, 'REVIEW_REQUIRED'); assert.ok(other.issues.includes('CLIENT_RFC_MISMATCH'));
});

test('missing folio is a soft issue, not a crash; missing total is review', () => {
  const noFolio = recognizeOcFromRows([
    ['Fecha', '01/11/2026'], ['RFC', CLIENT_RFC], ['Moneda', 'MXN'], ['Cantidad', 'Descripcion', 'Precio', 'Importe'], ['2', 'Servicio', '500', '1000'],
    ['', '', 'Subtotal', '1000'], ['', '', 'IVA', '160'], ['', '', 'Total', '1160'],
  ], 'XLSX', { solicitudTotal: 1160 });
  assert.ok(noFolio.issues.includes('OC_NUMBER_NOT_FOUND'));
  assert.equal(noFolio.status, 'ACCEPTED', JSON.stringify(noFolio.issues));
  const noTotal = recognizeOcFromRows([['Cantidad', 'Descripcion', 'Precio', 'Importe'], ['2', 'Servicio', '500', '1000']], 'XLSX', { solicitudTotal: 1160 });
  assert.equal(noTotal.status, 'REVIEW_REQUIRED'); assert.ok(noTotal.issues.includes('TOTAL_NOT_FOUND'));
  assert.equal(recognizeOcFromRows([['hola'], ['nada que ver']], 'XLSX', {}).status, 'UNREADABLE');
  assert.equal(recognizeOcFromText('', 'TEXT', {}).status, 'UNREADABLE');
});

test('binary garbage is not an OC; zip bombs still rejected as before', async () => {
  const garbage = Buffer.from(Array.from({ length: 2000 }, (_, i) => (i * 37) % 256));
  assert.equal(await service.recognizeOcBuffer(garbage, {}, { semantic: false }), null);
  const fakeZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
  await assert.rejects(() => service.recognizeOcBuffer(fakeZip, {}, { semantic: false }), /Excel es invalido/);
});

test('log entry carries reason codes only', () => {
  const result = recognizeOcFromRows([['Razon social', 'CLIENTE SECRETO'], ['RFC', CLIENT_RFC], ['Cantidad', 'Descripcion', 'Precio', 'Importe'], ['1', 'X servicio', '10', '10'], ['', '', 'Total', '11.60']], 'XLSX', {});
  const entry = JSON.stringify(recognitionLogEntry(result));
  assert.ok(!entry.includes('SECRETO') && !entry.includes(CLIENT_RFC) && !entry.includes('11.6'));
});

test('semantic layer: disabled by default, never auto-accepts, rejects invented figures', async () => {
  const source = 'Orden 77\nRFC ' + CLIENT_RFC + '\n2 Servicio de jardineria 500.00 1,000.00\nSubtotal 1,000.00 IVA 160.00 Total 1,160.00 MXN';
  const answer = { items: [{ quantity: 2, unit: '', productCode: '', description: 'Servicio de jardineria', unitPrice: 500, amount: 1000 }], subtotal: 1000, iva: 160, retention: null, total: 1160, currency: 'MXN', clientName: 'X', clientRfc: CLIENT_RFC, number: '77', date: '2026-11-01', paymentMethod: '', confidence: 0.99 };
  let calls = 0;
  const call = async () => { calls++; return JSON.stringify(answer); };
  assert.equal(await semantic.extractOcSemantically(source, 'TEXT', { solicitudTotal: 1160 }, call), null, 'flag off by default');
  assert.equal(calls, 0);
  const reviewed = await semantic.extractOcSemantically(source, 'TEXT', { solicitudTotal: 1160 }, call, true);
  assert.equal(reviewed.status, 'REVIEW_REQUIRED'); assert.ok(reviewed.issues.includes('SEMANTIC_REQUIRES_REVIEW'));
  const invented = await semantic.extractOcSemantically(source, 'TEXT', { solicitudTotal: 1160 }, async () => JSON.stringify({ ...answer, total: 1260, iva: 260 }), true);
  assert.ok(invented.issues.includes('SEMANTIC_VALUE_NOT_IN_SOURCE'));
  const hallucinatedRfc = await semantic.extractOcSemantically(source, 'TEXT', {}, async () => JSON.stringify({ ...answer, clientRfc: 'AAA010101AAA' }), true);
  assert.equal(hallucinatedRfc.candidate.clientRfc, '');
  assert.equal(await semantic.extractOcSemantically(source, 'TEXT', {}, async () => 'not json', true), null);
  process.env.OC_SEMANTIC_AUTO_ACCEPT = 'true';
  try {
    const auto = await semantic.extractOcSemantically(source, 'TEXT', { solicitudTotal: 1160 }, call, true);
    assert.equal(auto.status, 'ACCEPTED', JSON.stringify(auto.issues));
    const low = await semantic.extractOcSemantically(source, 'TEXT', { solicitudTotal: 1160 }, async () => JSON.stringify({ ...answer, confidence: 0.7 }), true);
    assert.equal(low.status, 'REVIEW_REQUIRED', 'low model confidence is never auto-accepted');
  } finally { delete process.env.OC_SEMANTIC_AUTO_ACCEPT; }
});

test('validator never derives a total and flags unusual IVA', () => {
  const base = { items: [{ quantity: 1, unit: '', productCode: '', description: 'S', unitPrice: 100, amount: 100 }], subtotal: 100, iva: 30, retention: null, total: 130, currency: 'MXN', clientName: '', clientRfc: CLIENT_RFC, rfcs: [CLIENT_RFC], number: '1', date: '2026-11-01', paymentMethod: '' };
  const odd = validateOcCandidate(base, { solicitudTotal: 130 });
  assert.equal(odd.status, 'REVIEW_REQUIRED'); assert.ok(odd.issues.includes('IVA_RATE_UNUSUAL'));
  const noTotal = validateOcCandidate({ ...base, iva: 16, total: null }, { solicitudTotal: 116 });
  assert.equal(noTotal.candidate.total, null); assert.equal(noTotal.status, 'REVIEW_REQUIRED');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`ok - ${name}`); }
    catch (error) { failed++; console.error(`not ok - ${name}\n`, error); }
  }
  console.log(failed ? `FAIL ${failed}/${tests.length}` : `PASS ${tests.length} tolerant OC recognition tests`);
  process.exitCode = failed ? 1 : 0;
})();
