'use strict';
// Characterization only: a PASS documents present behavior, not parser isolation.
// Every real parser fixture runs in a separate killable process; no network/providers.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const functionsRequire = createRequire(path.join(root, 'functions/package.json'));

function extracted(file, names, bindings) {
  const ts = require('typescript');
  const source = ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const selected = source.statements.filter(node =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text) ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(source))));
  assert.equal(selected.length, names.length, 'All requested top-level symbols must exist');
  const code = ts.transpileModule(selected.map(n => n.getText(source)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  return new Function('exports', ...Object.keys(bindings), `${code}\nreturn {${names.join(',')}};`)(exports, ...Object.values(bindings));
}

async function fixture(name) {
  const JSZip = functionsRequire('jszip');
  const ts = require('typescript'), helper = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path.join(root, 'functions/src/utils/boundedZip.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(require, helper, helper.exports);
  const zipBindings = { ...helper.exports, HttpsError: class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } } };
  if (name === 'xml') {
    const { assertXml } = extracted('functions/src/modules/paymentApplications/complementPolicy.ts', ['xmlTags', 'assertXml'], { Buffer, XMLValidator: functionsRequire('fast-xml-parser').XMLValidator });
    assert.doesNotThrow(() => assertXml('<Comprobante><Emisor Rfc="AAA010101AAA"/></Comprobante>'));
    for (const xml of ['<!DOCTYPE Comprobante [<!ENTITY a "x">]><Comprobante>&a;</Comprobante>', '<Comprobante><!--x--></Comprobante>', '<Comprobante><![CDATA[x]]></Comprobante>', '<Comprobante><x></Comprobante>', '<Comprobante>' + 'x'.repeat(2_000_000) + '</Comprobante>']) {
      assert.throws(() => assertXml(xml), /REP_XML_INVALID/);
    }
  } else if (name === 'zip-expansion') {
    const xml = '<sst><si><t>' + 'A'.repeat(2 * 1024 * 1024) + '</t></si></sst>';
    const zip = new JSZip(); zip.file('xl/sharedStrings.xml', xml);
    const packed = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    assert.ok(packed.length < 10_000);
    const { parseOcFiscalMetadataBuffer } = extracted('functions/src/modules/solicitudDocuments/service.ts', ['xmlValue', 'excelColumn', 'parseOcFiscalMetadataBuffer'], zipBindings);
    // A highly compressible but bounded workbook remains compatible after hardening.
    assert.equal(await parseOcFiscalMetadataBuffer(packed), null);
  } else if (name === 'zip-forged-size') {
    const zip = new JSZip(); zip.file('a.xml', 'A'.repeat(128 * 1024));
    const packed = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const central = packed.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); assert.ok(central >= 0);
    packed.writeUInt32LE(1, central + 24);
    const loaded = await JSZip.loadAsync(packed);
    assert.equal(loaded.file('a.xml')._data.uncompressedSize, 1);
    // Library catches mismatch at end; metadata admission alone is not a byte budget.
    await assert.rejects(loaded.file('a.xml').async('nodebuffer'), /size mismatch/);
  } else if (name === 'oc-compatible') {
    const zip = new JSZip();
    const cell = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
    zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData><row r="1">${cell('A1', 'CANTIDAD')}${cell('B1', 'CLAVE UNIDAD')}${cell('C1', 'CLAVE SAT')}${cell('D1', 'DESCRIPCION')}</row><row r="2">${cell('A2', '2')}${cell('B2', 'E48')}${cell('C2', '81112100')}${cell('D2', 'Servicio sintetico')}</row></sheetData></worksheet>`);
    const { parseOcFiscalMetadataBuffer } = extracted('functions/src/modules/solicitudDocuments/service.ts', ['xmlValue', 'excelColumn', 'parseOcFiscalMetadataBuffer'], zipBindings);
    const result = await parseOcFiscalMetadataBuffer(await zip.generateAsync({ type: 'nodebuffer' }));
    assert.equal(result.productCode, '81112100'); assert.equal(result.unitCode, 'E48'); assert.equal(result.quantity, 2);
    assert.equal(result.description, 'Servicio sintetico'); assert.equal(result.items.length, 1);
  } else if (name === 'oc-sparse') {
    const zip = new JSZip();
    const xml = '<worksheet><sheetData>' + '<row><c r="XFD1" t="inlineStr"><is><t>x</t></is></c></row>'.repeat(10_000) + '</sheetData></worksheet>';
    zip.file('xl/worksheets/sheet1.xml', xml);
    const { parseOcFiscalMetadataBuffer } = extracted('functions/src/modules/solicitudDocuments/service.ts', ['xmlValue', 'excelColumn', 'parseOcFiscalMetadataBuffer'], zipBindings);
    await assert.rejects(parseOcFiscalMetadataBuffer(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })), error => error.code === 'invalid-argument');
  } else if (name === 'pdf-pages') {
    const { PDFDocument, StandardFonts } = functionsRequire('pdf-lib');
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let page = 1; page <= 6; page++) pdf.addPage().drawText(`Synthetic receipt page ${page}`, { font });
    // Import implementation directly: package index has unrelated debug-fixture side effects.
    const parse = functionsRequire('pdf-parse/lib/pdf-parse.js');
    const result = await parse(new Uint8Array(await pdf.save({ useObjectStreams: false })), { max: 5 });
    assert.equal(result.numpages, 6); assert.equal(result.numrender, 5);
    assert.match(result.text, /Synthetic receipt page 1/); assert.doesNotMatch(result.text, /Synthetic receipt page 6/);
  } else throw Error('UNKNOWN_FIXTURE');
}

if (process.argv[2] === '--fixture') {
  fixture(process.argv[3]).then(() => process.stdout.write('FIXTURE_PASS\n'), error => {
    process.stderr.write(String(error.message) + '\n' + String(error.stack || error)); process.exitCode = 1;
  });
} else {
  for (const name of ['xml', 'zip-expansion', 'zip-forged-size', 'oc-compatible', 'oc-sparse', 'pdf-pages']) {
    test(`bounded parser characterization: ${name}`, () => {
      const child = spawnSync(process.execPath, ['--max-old-space-size=128', __filename, '--fixture', name], {
        cwd: root, timeout: 15_000, maxBuffer: 32 * 1024, encoding: 'utf8', windowsHide: true,
      });
      assert.equal(child.error, undefined, child.error?.message);
      assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /FIXTURE_PASS/);
    });
  }
}
