const assert = require("node:assert/strict");
const { renderCanonicalQuotePdf } = require("../../functions/lib/modules/documents/canonicalPdf.js");
(async () => {
  console.log("CHECKPOINT=PDF_RENDER_START");
  const pdf = await renderCanonicalQuotePdf({
    folio: "COT-TEST-001", companyName: "TROSTRE", companyRfc: "TRO230717L64",
    clientName: "CLIENTE QA", clientRfc: "XAXX010101000", reference: "OC-QA-001",
    description: "Servicio de prueba controlada", unit: "E48", quantity: 2,
    unitPrice: 500, subtotal: 1000, iva: 160, total: 1160,
    items: [{ quantity: 2, unit: "E48", productCode: "72141702", description: "Servicio de prueba controlada" }],
    verificationUrl: "https://example.test/verificar/qa",
  });
  assert(pdf.length > 1000, "El PDF debe contener contenido renderizado");
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  console.log(`CHECKPOINT=PDF_RENDERED bytes=${pdf.length}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
