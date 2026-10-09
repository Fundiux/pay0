'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const fr = createRequire(path.join(root, 'functions/package.json'));
const JSZip = fr('jszip');
function load(file, bindings = {}, names) {
  let source = readFileSync(path.join(root, file), 'utf8');
  if (names) {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const nodes = tree.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text) || ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.includes(d.name.getText(tree))));
    assert.equal(nodes.length, names.length); source = nodes.map(n => n.getText(tree)).join('\n') + '\nexports.selected = {' + names.join(',') + '};';
  }
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(bindings), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(require, module, module.exports, ...Object.values(bindings));
  return names ? module.exports.selected : module.exports;
}
const helper = load('functions/src/utils/boundedZip.ts');
const { openBoundedWorkbook: open, WORKBOOK_LIMITS: limits, createWorkbookStructureBudget: budget } = helper;
const invalid = /WORKBOOK_INVALID_OR_LIMIT_EXCEEDED/;
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const pack = async files => { const zip = new JSZip(); for (const [name, value] of files) zip.file(name, value); return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }); };
const offsets = b => ({ central: b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])), local: 0 });

test('expanded exact budget is allowed, +1 rejected before extraction, compressed bound before directory parsing', async () => {
  const exact = await pack([['a.xml', 'a'.repeat(limits.entryBytes)]]);
  assert.equal((await open(exact).readText('a.xml')).length, limits.entryBytes);
  assert.throws(() => open(Buffer.alloc(limits.compressedBytes + 1)), invalid);
  assert.throws(() => open(Buffer.alloc(limits.compressedBytes)), invalid); // size accepted, malformed directory rejected
  assert.throws(() => open(Buffer.from('broken')), invalid);
  const large = await pack([['a.xml', 'a'.repeat(limits.entryBytes + 1)]]);
  assert.throws(() => open(large), invalid);
});
test('stored archive at compressed byte limit and empty zip stay compatible; aggregate reads are bounded', async () => {
  const empty = new JSZip(); assert.equal(await open(await empty.generateAsync({ type: 'nodebuffer' })).readText('missing'), '');
  const zip = new JSZip(); zip.file('a', '');
  const overhead = (await zip.generateAsync({ type: 'nodebuffer' })).length;
  zip.file('a', 'x'.repeat(limits.compressedBytes - overhead));
  const bytes = await zip.generateAsync({ type: 'nodebuffer' }); assert.equal(bytes.length, limits.compressedBytes);
  assert.equal((await open(bytes).readText('a')).length, limits.compressedBytes - overhead);
  const repeated = open(await pack([['a', 'x'.repeat(limits.entryBytes)]]));
  for (let i = 0; i < limits.totalBytes / limits.entryBytes; i++) await repeated.readText('a');
  await assert.rejects(repeated.readText('a'), invalid);
});
test('forged sizes bypass no stream budget and poison later reads', async () => {
  const bytes = await pack([['a.xml', 'A'.repeat(128 * 1024)]]), { central, local } = offsets(bytes);
  bytes.writeUInt32LE(1, central + 24); bytes.writeUInt32LE(1, local + 22);
  const zip = open(bytes); await assert.rejects(zip.readText('a.xml'), invalid); await assert.rejects(zip.readText('missing.xml'), invalid);
});
test('CRC mismatch and malformed compressed content fail closed', async () => {
  const bytes = await pack([['a.xml', 'abc'.repeat(300)]]), { central, local } = offsets(bytes);
  bytes.writeUInt32LE(0, central + 16); bytes.writeUInt32LE(0, local + 14);
  await assert.rejects(open(bytes).readText('a.xml'), invalid);
  const broken = await pack([['a.xml', 'abc'.repeat(300)]]);
  broken[30 + broken.readUInt16LE(26) + broken.readUInt16LE(28)] = 0xff;
  await assert.rejects(open(broken).readText('a.xml'), invalid);
});
test('entry, worksheet and total expansion admission precedes decompression', async () => {
  const many = await pack(Array.from({ length: 257 }, (_, i) => [`f${i}`, ''])); assert.throws(() => open(many), invalid);
  const sheets = await pack(Array.from({ length: 33 }, (_, i) => [`xl/worksheets/sheet${i + 1}.xml`, ''])); assert.throws(() => open(sheets), invalid);
  const total = await pack(Array.from({ length: 5 }, (_, i) => [`f${i}`, 'x'.repeat(limits.entryBytes)])); assert.throws(() => open(total), invalid);
});
test('paths, case aliases, mismatched headers, encryption, ZIP64 and multi disk are denied', async () => {
  for (const name of ['../a.xml', '/a.xml', 'a\\b.xml', 'C:a.xml']) { const bytes = await pack([[name, 'a']]); assert.throws(() => open(bytes), invalid); }
  const alias = await pack([['a.xml', 'a'], ['A.xml', 'a']]); assert.throws(() => open(alias), invalid);
  for (const mutation of ['header', 'encrypted', 'zip64', 'disk']) {
    const bytes = await pack([['a.xml', 'a']]), { central } = offsets(bytes);
    if (mutation === 'header') bytes[30] = 0x62;
    if (mutation === 'encrypted') bytes.writeUInt16LE(1, central + 8);
    if (mutation === 'zip64') bytes.writeUInt32LE(0xffffffff, central + 24);
    if (mutation === 'disk') bytes.writeUInt16LE(1, bytes.length - 22 + 4);
    assert.throws(() => open(bytes), invalid);
  }
});
test('structure limits reject sparse columns and excessive rows/cells without allocating arrays', () => {
  const b = budget(); b.cell('XFD1048576');
  for (const ref of ['XFE1', 'AAAA1', 'A0', 'A1048577', '']) assert.throws(() => b.cell(ref), invalid);
  const rows = budget(); for (let i = 0; i < limits.rows; i++) rows.row(); assert.throws(() => rows.row(), invalid);
  const cells = budget(); for (let i = 0; i < limits.cells; i++) cells.cell('A1'); assert.throws(() => cells.cell('A1'), invalid);
  const strings = budget(); for (let i = 0; i < limits.sharedStrings; i++) strings.sharedString(); assert.throws(() => strings.sharedString(), invalid);
});
test('sparse OC row spans consume a cumulative budget before array allocation; Map cells do not', () => {
  const spans = budget();
  for (let i = 0; i < 12; i++) { spans.row(); spans.cell('XFD1', true); spans.cell('A1', true); }
  // 12*16384 = 196608. Construct the exact remainder's Excel column.
  const column = value => { let result = ''; while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); } return result; };
  spans.row(); spans.cell(`${column(limits.materializedCells - 12 * 16384)}1`, true);
  assert.throws(() => spans.cell(`${column(limits.materializedCells - 12 * 16384 + 1)}1`, true), invalid);
  const maps = budget(); for (let i = 0; i < 100; i++) { maps.row(); maps.cell('XFD1'); }
});
test('ordinary catalog headers, fiscal values and shared strings retain output contract', async () => {
  const names = ['REQUIRED_HEADERS', 'ALLOWED_STATUS', 'MAX_CATALOG_ROWS', 'text', 'normalizedHeader', 'decodeXml', 'xmlText', 'columnNumber', 'readCellValue', 'parseCompanyInvoiceCatalogWorkbook'];
  const parser = load('functions/src/modules/facturama/companyCatalog.ts', { ...helper, HttpsError }, names);
  const values = ['81112100', 'Servicio SAT', 'SERVICIO', 'E48', 'Servicio', 'Servicio comercial', 'TI', 'Actividad', 'Objeto', 'NO', 'AUTORIZADO'];
  const cells = row => row.map((value, i) => `<c r="${String.fromCharCode(65 + i)}${row === values ? 5 : 4}" t="inlineStr"><is><t>${value}</t></is></c>`).join('');
  const xml = `<worksheet><sheetData><row r="4">${cells(parser.REQUIRED_HEADERS)}</row><row r="5">${cells(values).replace('<c r="B5" t="inlineStr"><is><t>Servicio SAT</t></is></c>', '<c r="B5" t="s"><v>0</v></c>')}</row></sheetData></worksheet>`;
  const results = await parser.parseCompanyInvoiceCatalogWorkbook(await pack([['xl/sharedStrings.xml', '<sst><si><t>Servicio SAT</t></si></sst>'], ['xl/worksheets/sheet1.xml', xml]]));
  assert.equal(results.length, 1); assert.equal(results[0].productCode, values[0]); assert.equal(results[0].unitCode, 'E48'); assert.equal(results[0].commercialDescription, 'Servicio comercial');
  assert.equal(results[0].satDescription, 'Servicio SAT');
});
test('checked-in canonical catalog remains readable under bounded parser', async () => {
  const names = ['REQUIRED_HEADERS', 'ALLOWED_STATUS', 'MAX_CATALOG_ROWS', 'text', 'normalizedHeader', 'decodeXml', 'xmlText', 'columnNumber', 'readCellValue', 'parseCompanyInvoiceCatalogWorkbook'];
  const parser = load('functions/src/modules/facturama/companyCatalog.ts', { ...helper, HttpsError }, names);
  const bytes = readFileSync(path.join(root, 'src/canonicos/formatos/catalogo empresas propias/CATALOGO_PRODUCTOS_SERVICIOS_TROSTRE_v1.2_PRUEBA_PAY0.xlsx'));
  const entries = await parser.parseCompanyInvoiceCatalogWorkbook(bytes);
  assert.ok(entries.length > 0 && entries.length <= 500);
  assert.ok(entries.every(entry => /^\d{8}$/.test(entry.productCode) && entry.commercialDescription));
});
test('OC enforces structure limits and accepts table on later worksheet with self-closing merged cell', async () => {
  const parser = load('functions/src/modules/solicitudDocuments/service.ts', { ...helper, HttpsError }, ['xmlValue', 'excelColumn', 'parseOcFiscalMetadataBuffer']);
  const cell = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const xml = `<worksheet><sheetData><row>${cell('A1', 'CANTIDAD')}${cell('B1', 'CLAVE UNIDAD')}${cell('C1', 'CLAVE SAT')}${cell('D1', 'DESCRIPCION')}</row><row>${cell('A2', '2')}${cell('B2', 'E48')}${cell('C2', '81112100')}<c r="D2"/>${cell('E2', 'Servicio sintetico')}</row></sheetData></worksheet>`;
  const result = await parser.parseOcFiscalMetadataBuffer(await pack([['xl/worksheets/sheet1.xml', '<worksheet/>'], ['xl/worksheets/sheet2.xml', xml]]));
  assert.equal(result.productCode, '81112100'); assert.equal(result.unitCode, 'E48'); assert.equal(result.quantity, 2);
  await assert.rejects(parser.parseOcFiscalMetadataBuffer(await pack([['xl/worksheets/sheet1.xml', xml.replace('A1', 'XFE1')]])), e => e.code === 'invalid-argument');
  const rows = '<worksheet>' + '<row><c r="A1"><v>1</v></c></row>'.repeat(limits.rows + 1) + '</worksheet>';
  await assert.rejects(parser.parseOcFiscalMetadataBuffer(await pack([['xl/worksheets/sheet1.xml', rows]])), e => e.code === 'invalid-argument');
});
