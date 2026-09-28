const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { canonicalCompanyCatalog, loadCanonicalBundle } = require("../../functions/lib/modules/documents/canonicalBundle.js");
const { renderCanonicalQuotePdf, renderCanonicalConstanciaPdf } = require("../../functions/lib/modules/documents/canonicalPdf.js");
const { RECEIPT_ACCEPTANCE_TEXT } = require("../../functions/lib/modules/signatureLinks/acceptance.js");
const { signaturePng, acceptance } = require("./canonical-document-fixtures.cjs");
const parsePdf = require("../../functions/node_modules/pdf-parse/lib/pdf-parse.js");
const { PDFDocument } = require("../../functions/node_modules/pdf-lib");
const output = path.resolve("tmp/pdfs/corporate-resources");
let checks = 0;
function check(condition, label) { assert.ok(condition, label); checks++; }
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const companies = canonicalCompanyCatalog();
  check(companies.length === 21, "All 21 published companies are packaged");
  const uses = ["COTIZACION", "CONSTANCIA_ENTREGA_BIENES", "CONSTANCIA_SERVICIO"];
  for (const company of companies) for (const use of uses) {
    const bundle = loadCanonicalBundle(company.rfc, use);
    check(/^[a-f0-9]{64}$/.test(bundle.snapshot.templateBundleSha256), "Content digest is exact");
    check(bundle.logo.length > 100 && bundle.reference.length > 1000, "Published brand/reference exist");
    if (use !== "COTIZACION") {
      check((bundle.html.match(/class="sign"/g) || []).length === 1 && !bundle.html.includes("firmaEmpresa") && !bundle.html.includes("ENTREGA / PRESTA"), "One recipient signature only");
      check(bundle.html.includes("{{receiptLocation}}") && bundle.html.includes("{{receiptAddress}}"), "Declared location is represented");
    }
  }
  const chosen = [companies.find(row => row.rfc === "TRO230717L64"), companies.find(row => row.rfc === "ECO1907171N7"), companies.find(row => !["TRO230717L64", "ECO1907171N7"].includes(row.rfc))];
  const report = [];
  for (const company of chosen) for (const use of uses) {
    const bundle = loadCanonicalBundle(company.rfc, use);
    const common = { folio: `QA-${use}-${company.rfc}`, companyName: company.companyName, companyRfc: company.rfc,
      clientName: "CLIENTE SINTÉTICO & ASOCIADOS <PRUEBA>", clientRfc: "XAXX010101000", solicitudId: "fixture-documento",
      reference: "OC-SINTETICA-123", description: "Servicio de mantenimiento y suministro de materiales de prueba; sin operación comercial real.",
      canonicalBundle: bundle, verificationUrl: "https://example.invalid/verificar/constancia/fixture-sin-datos-reales" };
    const pdf = use === "COTIZACION" ? await renderCanonicalQuotePdf({ ...common, quantity: 2, unitPrice: 500, subtotal: 1000, iva: 160, total: 1160,
      bankName: "Banco de pruebas", bankAccount: "0000000000", bankClabe: "000000000000000000", deliveryLocation: acceptance.receiptAddress }) :
      await renderCanonicalConstanciaPdf({ ...common, kind: use, solicitudFolio: "SOL-SINTETICA-123", cotizacion: "COT-SINTETICA-123", cfdi: "NO-FISCAL-PRUEBA",
        receptorName: acceptance.signerName, receptorRole: acceptance.signerRole, receiptLocation: acceptance.receiptLocation,
        receiptAddress: acceptance.receiptAddress, observations: acceptance.observations, acceptanceText: RECEIPT_ACCEPTANCE_TEXT,
        signatureHash: "a".repeat(64), signaturePng: signaturePng(), items: [{ quantity: 2, unit: "Unidad", description: common.description }] });
    const filename = `${company.rfc}-${use}.pdf`;
    fs.writeFileSync(path.join(output, filename), pdf);
    const parsed = await parsePdf(pdf), doc = await PDFDocument.load(pdf);
    const compact = parsed.text.replace(/\s+/g, " ");
    check(compact.includes(company.rfc) && !/\{\{/.test(compact), "Correct issuer and no unfilled placeholders");
    check(doc.getPageCount() === 1, `Normal ${use} fixture fits one page`);
    if (use !== "COTIZACION") {
      check(compact.includes("Almacén de pruebas") && compact.includes("Calle de Pruebas 123"), "Actual declared place/address print");
      check(!compact.includes("ENTREGA / PRESTA") && compact.includes("Firma de la persona receptora"), "Only receiver signs");
      check(compact.includes("salvo las observaciones registradas"), "Exact acceptance text prints");
    }
    report.push({ filename, pages: doc.getPageCount(), template: bundle.snapshot });
  }
  fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify({ checks, files: report }, null, 2));
  console.log(JSON.stringify({ result: "PASS", checks, pdfs: report.length, output }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
