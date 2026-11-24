const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { parseOcFiscalMetadataBuffer, parseOcDate } = require('../../functions/lib/modules/solicitudDocuments/service.js');
const { requirePricedQuoteLines, quotationIssuerContact, resolveQuoteDocumentDate } = require('../../functions/lib/modules/cotizaciones/callables.js');
const { stripOcTemplateHelp } = require('../../functions/lib/utils/ocTemplateText.js');
const { loadBaseQuotationBundle } = require('../../functions/lib/modules/documents/canonicalBundle.js');
const { inspectQuotationLogo, quotationLogoPrefix } = require('../../functions/lib/modules/companies/quotationLogo.js');

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

  const iq = new ExcelJS.Workbook();
  const order = iq.addWorksheet('Orden de Compra');
  const iqCells = {
    A1: 'ORDEN DE COMPRA', A3: 'P R O V E E D O R :', C4: 'PROVEEDOR QA', P4: 'Fecha', Q4: 46350,
    A6: 'C L I E N T E :', A7: 'Razón Social', C7: 'CLIENTE QA', J7: 'R.F.C.', K7: 'XAXX010101000',
    M7: 'Régimen Fiscal', N7: '601 - General de Ley', M8: 'Uso del CFDI', N8: 'G03 - Gastos en general',
    A9: 'Código Postal', C9: '64650', M9: 'Método de Pago', N9: 'PPD - Pago diferido',
    M10: 'Forma de Pago', N10: '99 - Por definir',
    B12: 'Unidad de Medida', D12: 'Clave Productos y Servicios', H12: 'Concepto',
    N12: 'Cantidad', P12: 'Precio Unitario', Q12: 'Importe',
    A13: 1, B13: 'E48 - Unidad de servicio', D13: '80101500 - Consultoría',
    H13: 'Servicio', N13: 1, P13: 500, Q13: { formula: 'N13*P13', result: 500 },
    A14: 2, Q14: { formula: 'N14*P14', result: 0 },
    A15: 3, B15: 'H87 - Pieza', D15: '26101700 - Refacción',
    H15: 'Refacción', N15: 2, P15: 250, Q15: 500,
    N26: 'Moneda', N27: 'MXN', O26: 'Subtotal', Q26: 1000, O27: 'IVA', Q27: 160, O28: 'Total', Q28: 1160,
  };
  for (const [address, value] of Object.entries(iqCells)) order.getCell(address).value = value;
  order.mergeCells('A6:Q6');
  order.mergeCells('C7:I7');
  order.mergeCells('N9:Q9');
  order.mergeCells('O28:P28');
  const iqBytes = Buffer.from(await iq.xlsx.writeBuffer());
  const iqMetadata = await quoteLines(iqBytes);
  assert.deepEqual(await parseOcFiscalMetadataBuffer(iqBytes), iqMetadata);
  assert.deepEqual(await parseOcFiscalMetadataBuffer(iqBytes, true), iqMetadata);
  assert.deepEqual(iqMetadata.items.map(item => [item.productCode, item.unit, item.quantity, item.amount]), [
    ['80101500', 'E48', 1, 500], ['26101700', 'H87', 2, 500],
  ]);
  assert.equal(iqMetadata.clientName, 'CLIENTE QA');
  assert.equal(iqMetadata.postalCode, '64650');
  assert.equal(iqMetadata.paymentMethod, 'PPD');
  assert.equal(iqMetadata.paymentForm, '99');
  assert.equal(iqMetadata.cfdiUse, 'G03');
  assert.equal(requirePricedQuoteLines(iqMetadata, 1160).iva, 160);

  // Saved without recalculation: amount and totals are formulas with no cached
  // value, and template rows sit at quantity 0 with no concept.
  const uncached = await quoteLines(await workbook([
    ['Moneda', 'MXN - Pesos Mexicanos'],
    ['FECHA:', { formula: 'TODAY()' }],
    ['Cantidad', 'Clave Unidad', 'Clave Concepto', 'Concepto', 'PRECIO UNITARIO', 'Importe'],
    [3, 'E48', '', 'Servicio de inteligencia de datos', 95500.333, { formula: 'A4*E4' }],
    [0, '', '', '', 0, { formula: 'A5*E5' }],
    ['', '', '', '', 0, { formula: 'A6*E6' }],
    ['', '', '', '', 'Subtotal:', { formula: 'SUM(F4:F6)' }],
    ['', '', '', '', 'IVA:', { formula: 'F7*0.16' }],
    ['', '', '', '', 'TOTAL:', { formula: 'F7+F8' }],
  ]));
  assert.equal(uncached.items.length, 1, 'quantity-0 template rows are not lines');
  assert.equal(uncached.items[0].amount, 286501, 'uncached amount is quantity times the stated unit price');
  assert.equal(uncached.date, '', 'TODAY() is not a fixed OC date');
  assert.equal(requirePricedQuoteLines(uncached, 332341.16).subtotal, 286501, 'uncached totals fall back to the solicitud total');

  assert.throws(() => requirePricedQuoteLines({ ...labelled, items: [{ ...labelled.items[0], amount: null, unitPrice: null }] }, 1160), /precio e importe/);
  assert.throws(() => requirePricedQuoteLines({ ...labelled, items: [{ ...labelled.items[0], amount: 900 }] }, 1160), /no cuadran/);
  assert.doesNotThrow(() => requirePricedQuoteLines({ ...labelled, items: [{ ...labelled.items[0], amount: 1000.01 }] }, 1160), 'a one-cent gap is tolerated');

  assert.equal(parseOcDate('31/02/2026'), '', 'impossible dates are rejected');

  // The template's instruction column never becomes part of a value.
  const withHelp = await quoteLines(await workbook([
    ['Razon Social:', 'INSERVICE TELECOM SA DE CV', '* Obligatorio (Cliente, tal como aparece en la CIF)'],
    ['PROVEEDOR:', 'NORREY', 'Opcional (Nosotros lo validamos con Producto)'],
    ['Cantidad', 'Unidad', 'Clave SAT', 'Descripcion', 'Precio Unitario', 'Importe'],
    [1, 'E48', '', 'Servicio', 100, 100],
  ]));
  assert.equal(withHelp.clientName, 'INSERVICE TELECOM SA DE CV');
  assert.equal(stripOcTemplateHelp('INSERVICE TELECOM SA DE CV * Obligatorio (Cliente, tal como aparece en la CIF)'), 'INSERVICE TELECOM SA DE CV', 'names stored before the fix are cleaned');
  assert.equal(stripOcTemplateHelp('REFACCIONARIA ELITE'), 'REFACCIONARIA ELITE');
  const base = loadBaseQuotationBundle({ companyId: 'qa', companyName: 'EMPRESA QA', rfc: 'OII200101AB1' });
  assert.equal(base.snapshot.templateId, 'PAY0-BASE-COTIZACION');
  assert.match(base.html, /src="{{logoUrl}}"/, 'companies without a package use the shared base layout with a logo slot');
  assert.match(base.html, /{{qr}}/);

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

  // Issuer logo on the company record: only real PNG/JPEG bytes up to 1 MB, stored under the company root.
  assert.equal(inspectQuotationLogo(Buffer.from('89504e470d0a1a0a0000', 'hex')).contentType, 'image/png');
  assert.equal(inspectQuotationLogo(Buffer.from('ffd8ffe000', 'hex')).extension, 'jpg');
  assert.throws(() => inspectQuotationLogo(Buffer.from('%PDF-1.7')), /FORMAT_INVALID/, 'a PDF renamed as .png is rejected');
  assert.throws(() => inspectQuotationLogo(Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(1024 * 1024)])), /SIZE_INVALID/);
  assert.equal(quotationLogoPrefix('root1', 'co1'), 'company-quotation-logos/root1/co1/');
  console.log('PASS quotation mirrors OC lines, prices, date and number; issuer contact falls back to the alias; issuer logo accepts only PNG/JPEG');
})().catch(error => { console.error(error); process.exitCode = 1; });
