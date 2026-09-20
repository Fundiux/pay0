const fs = require("node:fs/promises");
const path = require("node:path");
const { renderCanonicalQuotePdf } = require("../functions/lib/modules/documents/canonicalPdf.js");

async function main() {
  const output = await renderCanonicalQuotePdf({
    folio: "COT-S5C2U1E28-PREVIEW",
    companyName: "TROSTRE, S. DE R.L. DE C.V.", companyRfc: "TRO230717L64",
    clientName: "OIL SPILL CONTROL SOLUTIONS", clientRfc: "OSC2010305CA",
    reference: "S5C2U1E28", description: "RENTA DE BARRERAS ANTI DERRAME", productCode: "72141702", unit: "E48", quantity: 1,
    unitPrice: 215517.24, subtotal: 215517.24, iva: 34482.76, total: 250000,
    solicitudId: "S5C2U1E28", verificationUrl: "https://pay-0-system.web.app/verificar/cotizacion/prueba",
    deliveryLocation: "CARRETERA NUEVO LAREDO KM 12.5, GENERAL ESCOBEDO, NUEVO LEON",
    bankName: "BBVA MEXICO", bankAccount: "0121570099", bankClabe: "012903001215700991",
    items: [{ quantity: 1, unit: "E48", description: "RENTA DE BARRERAS ANTI DERRAME", productCode: "72141702" }],
  });
  const target = path.resolve("tmp/pdfs/s5c2u1e28/COT-S5C2U1E28-canonical-preview.pdf");
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, output); console.log(target);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
