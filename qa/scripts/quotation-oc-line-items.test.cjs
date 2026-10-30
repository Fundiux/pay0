const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { parseOcFiscalMetadataBuffer, parseOcDate } = require('../../functions/lib/modules/solicitudDocuments/service.js');
const { requirePricedQuoteLines, quotationIssuerContact, resolveQuoteDocumentDate } = require('../../functions/lib/modules/cotizaciones/callables.js');

async function workbook(rows) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('OC');
  rows.forEach((values, index) => { sheet.getRow(index + 1).values = values; });
  return Buffer.from(await book.xlsx.writeBuffer());
}
const quoteLines = buffer => parseOcFiscalMetadataBuffer(buffer, true, undefined, true);

(async () => {
  // Real-world shape: Excel serial date, a blank unit price heading, and a
  // three-decimal unit price whose line amount rounds half-up.
  const oc = await workbook([
    ['Orden de Compra'],
    ['PROVEEDOR:', 'REFACCIONARIA ELITE'],
    ['', '', '', 'FECHA:', 46296],
    ['Razon Social:', 'CLIENTE QA'],
    ['Cantidad', 'Clave Unidad', 'Clave Concepto', 'Concepto', '', 'Importe'],
    [4, 'H87', '26101700', 'BUJIA DE COBRE', 317.58, 1270.32],
    [7, 'H87', '15121501', 'ACEITE 15W40', 880.525, 6163.675],
    ['', '', '', '', '', 0],
    ['', '', '', '', 'Subtotal:', 7433.995],
    ['', '', '', '', 'IVA:', 1189.4392],
    ['', '', '', '', 'TOTAL:', 8623.4342],
  ]);
  const parsed = await quoteLines(oc);
  assert.equal(parsed.date, '2026-10-01', 'Excel serial 46296 is 1 Oct 2026');
  assert.equal(parsed.number, '', 'no labelled OC number means no number');
  assert.equal(parsed.items.length, 2, 'empty template rows are not lines');
  assert.equal(parsed.items[0].unitPrice, 317.58, 'blank heading: unit price derived from the amount');
  assert.equal(parsed.items[1].unitPrice, 880.525, 'stated three-decimal unit price is kept');
  const quote = requirePricedQuoteLines(parsed, 8623.43);
  assert.deepEqual(quote.items.map(item => item.amount), [1270.32, 6163.68]);
  assert.equal(quote.subtotal, 7434, 'OC subtotal wins when it reconciles with the total, rounded half-up');
  assert.equal(quote.iva, 1189.44);

  const labelled = await quoteLines(await workbook([
    ['No. de Orden:', 'OC-1234'],
    ['Fecha:', '15/09/2026'],
    ['Cantidad', 'Unidad', 'Clave SAT', 'Descripcion', 'Precio Unitario', 'Importe'],
    [2, 'E48', '72141702', 'Servicio', 500, 1000],
    ['Subtotal:', 1000], ['IVA:', 160], ['TOTAL:', 1160],
  ]));
  assert.equal(labelled.number, 'OC-1234');
  assert.equal(labelled.date, '2026-09-15', 'text dates are day first');
  assert.equal(requirePricedQuoteLines(labelled, 1160).items[0].unitPrice, 500);

  assert.throws(() => requirePricedQuoteLines({ ...labelled, items: [{ ...labelled.items[0], amount: null, unitPrice: null }] }, 1160), /precio e importe/);
  assert.throws(() => requirePricedQuoteLines({ ...labelled, items: [{ ...labelled.items[0], amount: 900 }] }, 1160), /no cuadran/);
  assert.doesNotThrow(() => requirePricedQuoteLines({ ...labelled, items: [{ ...labelled.items[0], amount: 1000.01 }] }, 1160), 'a one-cent gap is tolerated');

  assert.equal(parseOcDate('31/02/2026'), '', 'impossible dates are rejected');

  // Quote date window: 45 days before the solicitud was created (Mexico City days).
  const created = Date.parse('2026-10-17T17:30:00Z'), uploaded = Date.parse('2026-10-17T17:29:00Z');
  assert.deepEqual(resolveQuoteDocumentDate('2026-10-06', created, uploaded), { date: '2026-10-06', source: 'ORDEN_COMPRA' });
  assert.deepEqual(resolveQuoteDocumentDate('2026-03-10', created, uploaded), { date: '2026-10-03', source: 'ORDEN_COMPRA_DIA_MES_CORREGIDO' }, '"3 octubre" typed in a US-locale Excel');
  assert.deepEqual(resolveQuoteDocumentDate('2026-01-10', created, uploaded), { date: '2026-10-01', source: 'ORDEN_COMPRA_DIA_MES_CORREGIDO' });
  assert.deepEqual(resolveQuoteDocumentDate('2025-07-21', created, uploaded), { date: '2026-10-17', source: 'CARGA_OC_FECHA_FUERA_DE_RANGO' }, 'a stale template date falls back to the upload day');
  assert.deepEqual(resolveQuoteDocumentDate('', created, uploaded), { date: '2026-10-17', source: 'CARGA_OC_SIN_FECHA' });
  assert.deepEqual(resolveQuoteDocumentDate('2026-11-02', created, uploaded), { date: '2026-10-17', source: 'CARGA_OC_FECHA_FUERA_DE_RANGO' }, 'a date after the solicitud is not accepted');
  assert.equal(resolveQuoteDocumentDate('2026-09-02', created, uploaded).date, '2026-09-02', 'the window edge (45 days) is accepted');
  assert.equal(resolveQuoteDocumentDate('2026-09-01', created, uploaded).source, 'CARGA_OC_FECHA_FUERA_DE_RANGO');
  assert.deepEqual(resolveQuoteDocumentDate('2026-03-10', created, null), { date: '2026-10-03', source: 'ORDEN_COMPRA_DIA_MES_CORREGIDO' });
  assert.deepEqual(resolveQuoteDocumentDate('', created, null), { date: '2026-10-17', source: 'SOLICITUD_SIN_FECHA' });
  assert.equal(quotationIssuerContact({ quotationContact: 'ventas@elite.mx', depositAlias: 'ELITE' }), 'ventas@elite.mx');
  assert.equal(quotationIssuerContact({ depositAlias: 'Mercacobra' }), 'contacto@mercacobra.mx');
  assert.equal(quotationIssuerContact({ depositAlias: 'REFACCIONES Y TRABAJAOS' }), 'contacto@refaccionesytrabajaos.mx');
  assert.equal(quotationIssuerContact({}), '');
  console.log('PASS quotation mirrors OC lines, prices, date and number; issuer contact falls back to the alias');
})().catch(error => { console.error(error); process.exitCode = 1; });
