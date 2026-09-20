const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { parseOcFiscalMetadataBuffer } = require("../../functions/lib/modules/solicitudDocuments/service.js");

async function main() {
  const source = process.argv[2] || resolve(__dirname, "../../tmp/oc-diagnostics/OC_TRANSUNISA_TROSTRE.xlsx");
  const parsed = await parseOcFiscalMetadataBuffer(readFileSync(source));
  assert(parsed, "La OC debe producir metadatos fiscales");
  assert.equal(parsed.productCode, "72101510");
  assert.equal(parsed.unitCode, "E48");
  assert.equal(parsed.description, "SERVICIO DE REPARACION DE SISTEMAS DE PLOMERIA");
  assert.equal(parsed.items[0]?.description, "SERVICIO DE REPARACION DE SISTEMAS DE PLOMERIA");
  assert.equal(parsed.fiscalRegime, "601");
  assert.equal(parsed.postalCode, "06700");
  assert.equal(parsed.cfdiUse, "G03");
  assert.equal(parsed.paymentMethod, "PUE");
  assert.match(parsed.deliveryLocation, /GUADALAJARA/i);
  console.log(JSON.stringify({ ok: true, source, parsed }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
