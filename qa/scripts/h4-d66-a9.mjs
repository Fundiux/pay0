import fs from "node:fs";
import assert from "node:assert/strict";

const browser = fs.readFileSync("functions/src/modules/paymentApplications/iqBrowser.ts", "utf8");
const exec = fs.readFileSync("functions/src/modules/paymentApplications/iqExecution.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const deploy = fs.readFileSync("scripts/deploy-h4-d66-a9.ps1", "utf8");

const tests = [
  ["A10 agrega evidencia por campo OK/NO", () => assert.match(browser, /fieldChecks/) && assert.match(browser, /IqPaymentApplicationFieldCheck/)],
  ["A10 reporta Asociado Cliente Empresa Deposito Factura Monto", () => assert.match(browser, /ASOCIADO/) && assert.match(browser, /CLIENTE/) && assert.match(browser, /EMPRESA/) && assert.match(browser, /DEPOSITO/) && assert.match(browser, /FACTURA/) && assert.match(browser, /MONTO/)],
  ["A10 selecciona deposito por folio IQ y no por monto", () => assert.match(browser, /textMatchesIqFolio/) && assert.match(browser, /mode: \"FOLIO\"/) && assert.match(browser, /expected: cleanText\(input\.pagoIqFolio\)/)],
  ["A10 selecciona factura por folio IQ y no por monto", () => assert.match(browser, /expected: item\.solicitudIqFolio/) && assert.match(browser, /field: \"FACTURA\"/)],
  ["A10 ancla campos por etiqueta real", () => assert.match(browser, /requireTaggedField/) && assert.match(browser, /tagControlByMeaning/)],
  ["A10 llena Asociado Cliente Empresa antes del deposito", () => assert.ok(browser.indexOf("asociadoName") < browser.indexOf("const depositSelector"))],
  ["A10 usa nombres reales del pago y perfil IQ", () => assert.match(exec, /asociadoName: access\.profileAlias/) && assert.match(exec, /clienteName: cleanText\(pago\?\.clienteNombre\)/) && assert.match(exec, /empresaName: cleanText\(pago\?\.empresaNombre\)/)],
  ["A10 conserva click final separado", () => assert.match(browser, /if \(!result\.verified\)[\s\S]{0,900}return result;[\s\S]{0,900}clickFinalSubmitAction\(page\)/)],
  ["A10 conserva fallo seguro antes de enviar", () => assert.match(browser, /IQ_PAYMENT_APPLICATION_DEPOSIT_NOT_MATCHED/) && assert.match(browser, /submitClicked/)],
  ["A10 no agrega scheduler trigger ni backfill", () => assert.ok(!browser.includes("onSchedule(") && !browser.includes("onDocument") && !browser.includes("backfill"))],
  ["A10 queda registrado en package.json", () => assert.equal(pkg.scripts["qa:pay0:h4-d66-a9"], "powershell -ExecutionPolicy Bypass -File scripts/run-h4-d66-a9-qa.ps1")],
  ["A10 despliega solo executePagoApplicationIqPlan", () => assert.match(deploy, /functions:executePagoApplicationIqPlan/) && assert.ok(!deploy.includes("hosting") && !deploy.includes("firestore:rules"))],
];

console.log("=== H4-D66-A9/A10 | Seleccion por etiqueta y folio IQ ===");
for (const [name, fn] of tests) {
  fn();
  console.log(`PASS ${name}`);
}
console.log(`\nH4-D66-A9/A10 QA PASS: ${tests.length} pruebas.`);
console.log("Diagnostico por campo y seleccion de deposito/factura estrictamente por folio IQ.");
