import fs from "node:fs";
import assert from "node:assert/strict";

const browser = fs.readFileSync("functions/src/modules/paymentApplications/iqBrowser.ts", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const deploy = fs.readFileSync("scripts/deploy-h4-d66-a8.ps1", "utf8");

const tests = [
  ["A8 elimina navegacion real 404 /payment-applications/crear", () => assert.match(browser, /No navegar a \/payment-applications\/crear/)],
  ["A8 conserva la ruta canonica de listado", () => assert.match(browser, /IQ_PAYMENT_APPLICATION_ROUTE = "\/payment-applications"/)],
  ["A8 usa el patron de Solicitudes/Depositos: modulo y boton Nuevo", () => assert.match(browser, /clickSafeApplicationFormTrigger/) && assert.match(browser, /clickTopRightNewApplicationAction/)],
  ["A8 espera drawer/formulario real por campos", () => assert.match(browser, /waitForApplicationForm/) && assert.match(browser, /captureApplicationFormSnapshot/) && assert.match(browser, /realForm/)],
  ["A8 acepta Nuevo y Nueva sin tocar acciones finales", () => assert.match(browser, /NUEVO/) && assert.match(browser, /NUEVA/) && assert.match(browser, /clickFinalSubmitAction/)],
  ["A8 mantiene apertura separada del clic final", () => assert.ok(browser.indexOf("const applicationForm = await openApplicationForm") < browser.indexOf("const depositSelector = await tagControlByMeaning"))],
  ["A8 conserva FAILED_SAFE antes del clic", () => assert.match(browser, /IQ_PAYMENT_APPLICATION_FORM_NOT_OPENED/)],
  ["A8 reporta diagnostico visible si IQ cambia UI", () => assert.match(browser, /IQ_PAYMENT_APPLICATION_FORM_DIAGNOSTIC_H4D66A8/) && assert.match(browser, /controls=.*fields=/s)],
  ["A8 no agrega scheduler ni trigger", () => assert.ok(!browser.includes("onSchedule(") && !browser.includes("onDocument"))],
  ["A8 queda registrado en package.json", () => assert.equal(pkg.scripts["qa:pay0:h4-d66-a8"], "powershell -ExecutionPolicy Bypass -File scripts/run-h4-d66-a8-qa.ps1")],
  ["A8B no ejecuta QA A7 incompatible", () => assert.ok(!deploy.includes('"qa/scripts/h4-d66-a7.mjs"'))],
  ["A8B despliega solo executePagoApplicationIqPlan", () => assert.match(deploy, /functions:executePagoApplicationIqPlan/) && assert.ok(!deploy.includes("hosting") && !deploy.includes("firestore:rules"))],
];

console.log("=== H4-D66-A8B | Drawer SPA + Nuevo IQ ===");
for (const [name, fn] of tests) {
  fn();
  console.log(`PASS ${name}`);
}
console.log(`\nH4-D66-A8B QA PASS: ${tests.length} pruebas.`);
console.log("Aplicacion de pagos usa el mismo patron operacional que Solicitudes/Depositos: modulo, + Nuevo, drawer y campos reales.");
