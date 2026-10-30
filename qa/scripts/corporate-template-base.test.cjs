const assert = require('node:assert/strict');
const { PDFDocument } = require('../../functions/node_modules/pdf-lib');
const { DOCUMENT_TEMPLATE_TYPES, globalTemplateBase } = require('../../functions/lib/modules/canonicalCenter/globalTemplateBase.js');
const { renderCanonicalQuotePdf, renderCanonicalConstanciaPdf } = require('../../functions/lib/modules/documents/canonicalPdf.js');

(async () => {
  for (const use of DOCUMENT_TEMPLATE_TYPES) {
    const base = await globalTemplateBase({ use, companyId: 'company', companyName: 'Empresa de prueba', rfc: 'TRO230717L64' });
    assert.equal(base.snapshot.documentUse, use);
    assert.match(base.snapshot.referencePdfSha256, /^[a-f0-9]{64}$/);
    assert.match(base.snapshot.templateBundleSha256, /^[a-f0-9]{64}$/);
    assert.equal((await PDFDocument.load(base.reference)).getPageCount(), 1);
    if (use === 'COTIZACION') assert.match(base.html, /{{items}}/);
    if (use.startsWith('CONSTANCIA')) assert.match(base.html, /{{itemsHtml}}/);
  }
  if (process.env.PAY0_CHROMIUM_PATH) {
    const base = await globalTemplateBase({ use: 'COTIZACION', companyId: 'company', companyName: 'Empresa de prueba', rfc: 'TRO230717L64' });
    const pdf = await renderCanonicalQuotePdf({ folio: 'COT-1', companyName: 'Empresa de prueba', companyRfc: 'TRO230717L64', clientName: 'Cliente QA', clientRfc: 'XAXX010101000', reference: 'OC-1', description: 'Servicio comercial', subtotal: 100, iva: 16, total: 116, unitPrice: 100, verificationUrl: 'https://example.test/quote/1', canonicalBundle: base });
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
    const certificate = await globalTemplateBase({ use: 'CONSTANCIA_ENTREGA_BIENES', companyId: 'company', companyName: 'Empresa de prueba', rfc: 'TRO230717L64' });
    const certificatePdf = await renderCanonicalConstanciaPdf({ folio: 'CONST-1', kind: 'CONSTANCIA_ENTREGA_BIENES', companyName: 'Empresa de prueba', companyRfc: 'TRO230717L64', clientName: 'Cliente QA', clientRfc: 'XAXX010101000', solicitudFolio: 'S-1', reference: 'OC-1', cotizacion: 'COT-1', cfdi: 'XML-1', description: 'Bien', receptorName: 'Receptor QA', signatureHash: 'a'.repeat(64), receiptLocation: 'México', receiptAddress: 'Domicilio', acceptanceText: 'Recibido', canonicalBundle: certificate });
    assert.equal((await PDFDocument.load(certificatePdf)).getPageCount(), 1);
  }
  console.log('PASS seven company template bases, valid immutable reference PDFs and renderer placeholders');
})().catch(error => { console.error(error); process.exitCode = 1; });
